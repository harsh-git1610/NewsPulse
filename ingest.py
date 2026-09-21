import logging
import datetime
import traceback
from typing import Dict, Any, List, Optional
import feedparser
import trafilatura
from dateutil import parser as date_parser
import psycopg

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Feed Definitions
FEEDS = {
    "bbc": "http://feeds.bbci.co.uk/news/rss.xml",
    "npr": "https://feeds.npr.org/1001/rss.xml",
    "guardian": "https://www.theguardian.com/world/rss",
    "nyt": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "aljazeera": "https://www.aljazeera.com/xml/rss/all.xml"
}

def _parse_date(date_str: Optional[str]) -> Optional[datetime.datetime]:
    if not date_str:
        return None
    try:
        dt = date_parser.parse(date_str)
        # Ensure timezone aware
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt
    except Exception as e:
        logger.debug(f"Failed to parse date string {date_str}: {e}")
        return None

def _get_summary(entry: Any) -> str:
    if 'content' in entry and len(entry.content) > 0:
        return entry.content[0].value
    if 'description' in entry:
        return entry.description
    if 'summary' in entry:
        return entry.summary
    return ""

def _get_guid(entry: Any, url: str) -> str:
    return getattr(entry, 'id', url)

# Adapters
def parse_bbc(entry: Any) -> Dict[str, Any]:
    url = getattr(entry, 'link', '')
    return {
        "source": "bbc",
        "title": getattr(entry, 'title', ''),
        "summary": _get_summary(entry),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url)
    }

def parse_npr(entry: Any) -> Dict[str, Any]:
    url = getattr(entry, 'link', '')
    return {
        "source": "npr",
        "title": getattr(entry, 'title', ''),
        "summary": _get_summary(entry),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url)
    }

def parse_guardian(entry: Any) -> Dict[str, Any]:
    url = getattr(entry, 'link', '')
    return {
        "source": "guardian",
        "title": getattr(entry, 'title', ''),
        "summary": _get_summary(entry),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url)
    }

def parse_nyt(entry: Any) -> Dict[str, Any]:
    url = getattr(entry, 'link', '')
    return {
        "source": "nyt",
        "title": getattr(entry, 'title', ''),
        "summary": _get_summary(entry),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url)
    }

def parse_aljazeera(entry: Any) -> Dict[str, Any]:
    url = getattr(entry, 'link', '')
    return {
        "source": "aljazeera",
        "title": getattr(entry, 'title', ''),
        "summary": _get_summary(entry),
        "url": url,
        "published_at": _parse_date(getattr(entry, 'published', None)),
        "guid": _get_guid(entry, url)
    }

PARSERS = {
    "bbc": parse_bbc,
    "npr": parse_npr,
    "guardian": parse_guardian,
    "nyt": parse_nyt,
    "aljazeera": parse_aljazeera
}

def fetch_article_text(url: str) -> Optional[str]:
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded is None:
            logger.warning(f"Failed to fetch article text for URL: {url} - trafilatura returned None")
            return None
        text = trafilatura.extract(downloaded)
        if text is None:
            logger.warning(f"Failed to extract article text for URL: {url} - trafilatura returned None")
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
        conn.commit()

def run_ingestion(db_url: str) -> Dict[str, Any]:
    stats = {
        "fetched": 0,
        "inserted": 0,
        "failed": 0,
        "errors": []
    }
    
    logger.info("Starting RSS ingestion run")
    
    try:
        conn = psycopg.connect(db_url)
        init_db(conn)
    except Exception as e:
        logger.error(f"Failed to connect to database or initialize schema: {e}")
        stats["failed"] += 1
        stats["errors"].append(str(e))
        return stats

    for source, feed_url in FEEDS.items():
        logger.info(f"Fetching feed for {source} at {feed_url}")
        try:
            feed = feedparser.parse(feed_url)
            parser_fn = PARSERS[source]
            
            for entry in feed.entries:
                try:
                    stats["fetched"] += 1
                    
                    parsed_entry = parser_fn(entry)
                    if not parsed_entry.get("url"):
                        logger.warning(f"Skipping entry from {source} with no URL")
                        continue
                        
                    # Fetch body
                    body_text = fetch_article_text(parsed_entry["url"])
                    
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
                            parsed_entry.get("guid")
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
