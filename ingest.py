import logging
import datetime
import time
import re
from typing import Dict, Any, Optional
import feedparser
import trafilatura
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
import psycopg
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

FEEDS = {
    "bbc": "http://feeds.bbci.co.uk/news/rss.xml",
    "npr": "https://feeds.npr.org/1001/rss.xml",
    "guardian": "https://www.theguardian.com/world/rss",
    "aljazeera": "https://www.aljazeera.com/xml/rss/all.xml",
}

REQUEST_DELAY_SECONDS = 0.5  # be polite to article hosts


def _parse_date(date_str: Optional[str]) -> Optional[datetime.datetime]:
    if not date_str:
        return None
    try:
        dt = date_parser.parse(date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt
    except Exception as e:
        logger.debug(f"Failed to parse date string {date_str}: {e}")
        return None


def _strip_html(raw: str) -> str:
    if not raw:
        return ""
    text = BeautifulSoup(raw, "html.parser").get_text(separator=" ")
    return re.sub(r"\s+", " ", text).strip()


def _get_guid(entry: Any, url: str) -> str:
    return getattr(entry, 'id', url)


# --- Per-source adapters: each handles that feed's actual quirks ---

def parse_bbc(entry: Any) -> Dict[str, Any]:
    # BBC: clean <description>, reliable <pubDate>
    url = getattr(entry, 'link', '')
    return {
        "source": "bbc",
        "title": getattr(entry, 'title', ''),
        "summary": _strip_html(getattr(entry, 'description', '') or getattr(entry, 'summary', '')),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url),
    }


def parse_npr(entry: Any) -> Dict[str, Any]:
    # NPR: summary is usually clean, occasionally missing published date entirely
    url = getattr(entry, 'link', '')
    return {
        "source": "npr",
        "title": getattr(entry, 'title', ''),
        "summary": _strip_html(getattr(entry, 'summary', '')),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url),
    }


def parse_guardian(entry: Any) -> Dict[str, Any]:
    # Guardian: prefers content:encoded (richer body) over description when present
    url = getattr(entry, 'link', '')
    if 'content' in entry and len(entry.content) > 0:
        raw_summary = entry.content[0].value
    else:
        raw_summary = getattr(entry, 'summary', '')
    return {
        "source": "guardian",
        "title": getattr(entry, 'title', ''),
        "summary": _strip_html(raw_summary),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url),
    }


def parse_aljazeera(entry: Any) -> Dict[str, Any]:
    # Al Jazeera: descriptions sometimes wrapped in CDATA with extra whitespace/entities
    url = getattr(entry, 'link', '')
    return {
        "source": "aljazeera",
        "title": getattr(entry, 'title', '').strip(),
        "summary": _strip_html(getattr(entry, 'summary', '') or getattr(entry, 'description', '')),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url),
    }


PARSERS = {
    "bbc": parse_bbc,
    "npr": parse_npr,
    "guardian": parse_guardian,
    "aljazeera": parse_aljazeera,
}


def fetch_article_text(url: str) -> Optional[str]:
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded is None:
            logger.warning(f"Failed to fetch article text for URL: {url}")
            return None
        text = trafilatura.extract(downloaded)
        if text is None:
            logger.warning(f"Failed to extract article text for URL: {url}")
            return None
        return text
    except Exception as e:
        logger.warning(f"Error fetching/extracting article text for URL: {url} - {e}")
        return None


def init_db(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS articles (
                id SERIAL PRIMARY KEY,
                source TEXT,
                title TEXT,
                summary TEXT,
                body_text TEXT,
                url TEXT UNIQUE,
                published_at TIMESTAMPTZ,
                fetched_at TIMESTAMPTZ DEFAULT NOW(),
                guid TEXT
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at)")
        conn.commit()


def run_ingestion(db_url: str) -> Dict[str, Any]:
    stats = {"fetched": 0, "inserted": 0, "failed": 0, "errors": []}
    logger.info("Starting RSS ingestion run")

    conn = None
    try:
        conn = psycopg.connect(db_url)
        init_db(conn)

        # Pre-fetch existing URLs to avoid re-downloading existing articles
        existing_urls = set()
        with conn.cursor() as cur:
            cur.execute("SELECT url FROM articles WHERE url IS NOT NULL")
            existing_urls = {row[0] for row in cur.fetchall()}
        logger.info(f"Found {len(existing_urls)} existing articles in database")

        for source, feed_url in FEEDS.items():
            logger.info(f"Fetching feed for {source} at {feed_url}")
            try:
                feed = feedparser.parse(feed_url)

                if feed.bozo:
                    logger.warning(f"Feed {source} is malformed (bozo=1): {feed.bozo_exception}")

                if not feed.entries:
                    logger.warning(f"Feed {source} returned zero entries — possibly dead or restructured")
                    continue

                parser_fn = PARSERS[source]

                for entry in feed.entries:
                    try:
                        stats["fetched"] += 1
                        parsed_entry = parser_fn(entry)

                        if not parsed_entry.get("url"):
                            logger.warning(f"Skipping entry from {source} with no URL")
                            continue

                        # Skip already ingested articles immediately
                        if parsed_entry["url"] in existing_urls:
                            continue

                        body_text = fetch_article_text(parsed_entry["url"])
                        time.sleep(REQUEST_DELAY_SECONDS)

                        now = datetime.datetime.now(datetime.timezone.utc)
                        pub_date = parsed_entry["published_at"] or now

                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO articles (source, title, summary, body_text, url, published_at, fetched_at, guid)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (url) DO NOTHING
                            """, (
                                parsed_entry["source"],
                                parsed_entry["title"],
                                parsed_entry["summary"],
                                body_text,
                                parsed_entry["url"],
                                pub_date,
                                now,
                                parsed_entry.get("guid"),
                            ))
                            if cur.rowcount > 0:
                                stats["inserted"] += 1
                        conn.commit()

                    except Exception as e:
                        conn.rollback()
                        logger.warning(f"Failed to process entry from {source}: {e}")
                        stats["failed"] += 1
                        stats["errors"].append(f"{source} entry error: {e}")

            except Exception as e:
                logger.warning(f"Failed to fetch or parse feed {source}: {e}")
                stats["failed"] += 1
                stats["errors"].append(f"{source} feed error: {e}")

    except Exception as e:
        logger.error(f"Failed to connect to database or initialize schema: {e}")
        stats["failed"] += 1
        stats["errors"].append(str(e))
    finally:
        if conn is not None:
            conn.close()

    logger.info(f"Ingestion run complete. Stats: {stats}")
    return stats


if __name__ == "__main__":
    import os
    import sys

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        logger.error("DATABASE_URL environment variable is required to run standalone.")
        sys.exit(1)

    result = run_ingestion(db_url)
    print("Final Result:", result)