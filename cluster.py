import argparse
import collections
import logging
import os
import sys
from typing import Any, Dict, List, Optional

import numpy as np
import psycopg
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_SIMILARITY_THRESHOLD = 0.25


class UnionFind:
    """Disjoint Set Union (DSU) / Union-Find data structure with path compression and union by rank."""

    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, i: int) -> int:
        if self.parent[i] != i:
            self.parent[i] = self.find(self.parent[i])
        return self.parent[i]

    def union(self, i: int, j: int) -> None:
        root_i = self.find(i)
        root_j = self.find(j)
        if root_i == root_j:
            return
        if self.rank[root_i] < self.rank[root_j]:
            self.parent[root_i] = root_j
        elif self.rank[root_i] > self.rank[root_j]:
            self.parent[root_j] = root_i
        else:
            self.parent[root_j] = root_i
            self.rank[root_i] += 1


def init_cluster_db(conn: psycopg.Connection) -> None:
    """Ensure clusters and cluster_articles tables and indices exist."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS clusters (
                id SERIAL PRIMARY KEY,
                label TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cluster_articles (
                cluster_id INT REFERENCES clusters(id) ON DELETE CASCADE,
                article_id INT REFERENCES articles(id) ON DELETE CASCADE,
                PRIMARY KEY (cluster_id, article_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cluster_articles_cluster_id ON cluster_articles (cluster_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cluster_articles_article_id ON cluster_articles (article_id)")
        conn.commit()


def fetch_articles(conn: psycopg.Connection, recluster_all: bool = True) -> List[Dict[str, Any]]:
    """Fetch articles from the database to be clustered."""
    with conn.cursor() as cur:
        if recluster_all:
            query = """
                SELECT id, title, summary, body_text, published_at
                FROM articles
                ORDER BY id ASC
            """
        else:
            query = """
                SELECT a.id, a.title, a.summary, a.body_text, a.published_at
                FROM articles a
                LEFT JOIN cluster_articles ca ON a.id = ca.article_id
                WHERE ca.article_id IS NULL
                ORDER BY a.id ASC
            """
        cur.execute(query)
        rows = cur.fetchall()

    articles = []
    for row in rows:
        articles.append({
            "id": row[0],
            "title": row[1] or "",
            "summary": row[2] or "",
            "body_text": row[3] or "",
            "published_at": row[4],
        })
    return articles


def build_article_corpus(articles: List[Dict[str, Any]]) -> List[str]:
    """
    Build input text per article: title repeated twice + summary (title-weighting).
    """
    corpus = []
    for art in articles:
        title = art.get("title", "").strip()
        summary = art.get("summary", "").strip()
        text = f"{title} {title} {summary}".strip()
        corpus.append(text if text else "Untitled Article")
    return corpus


def extract_tfidf_matrix(corpus: List[str]) -> tuple[Any, Optional[np.ndarray]]:
    """
    Compute TF-IDF matrix using scikit-learn's TfidfVectorizer.
    Handles small corpora (<5 articles) and edge-cases (e.g. n=1 or all stop words) gracefully.
    """
    if not corpus:
        return None, None

    # max_df must be 1.0 when corpus size <= 2 to prevent max_df < min_df error
    max_df = 0.8 if len(corpus) > 2 else 1.0

    try:
        vectorizer = TfidfVectorizer(
            stop_words="english",
            max_df=max_df,
            min_df=1,
            ngram_range=(1, 2),
        )
        tfidf_matrix = vectorizer.fit_transform(corpus)
        feature_names = np.array(vectorizer.get_feature_names_out())
        return tfidf_matrix, feature_names
    except ValueError as e:
        logger.warning(f"TF-IDF vectorization warning (retrying without stop_words): {e}")
        try:
            fallback_vectorizer = TfidfVectorizer(
                stop_words=None,
                max_df=1.0,
                min_df=1,
                ngram_range=(1, 2),
            )
            tfidf_matrix = fallback_vectorizer.fit_transform(corpus)
            feature_names = np.array(fallback_vectorizer.get_feature_names_out())
            return tfidf_matrix, feature_names
        except Exception as err:
            logger.warning(f"Fallback TF-IDF vectorization failed: {err}")
            return None, None


def generate_cluster_label(
    cluster_indices: List[int],
    tfidf_matrix: Any,
    feature_names: Optional[np.ndarray],
    articles: List[Dict[str, Any]],
    top_n: int = 3,
) -> str:
    """
    Generate cluster label from the top terms of the cluster's averaged TF-IDF vector.
    """
    if tfidf_matrix is not None and feature_names is not None and len(feature_names) > 0:
        sub_matrix = tfidf_matrix[cluster_indices]
        mean_vector = np.asarray(sub_matrix.mean(axis=0)).flatten()
        nonzero_indices = np.where(mean_vector > 0)[0]
        if len(nonzero_indices) > 0:
            sorted_indices = nonzero_indices[np.argsort(-mean_vector[nonzero_indices])]
            top_terms = [feature_names[idx] for idx in sorted_indices[:top_n]]
            if top_terms:
                return ", ".join(top_terms)

    # Fallback to key title words if TF-IDF yields no terms
    first_title = articles[cluster_indices[0]].get("title", "").strip()
    if first_title:
        words = [w for w in first_title.split() if len(w) > 3]
        if words:
            return ", ".join(words[:top_n])
        return first_title[:60]
    return "General News"


def log_cluster_distribution(clusters: Dict[int, List[int]]) -> None:
    """Log distribution of formed cluster sizes."""
    num_clusters = len(clusters)
    sizes = [len(idxs) for idxs in clusters.values()]
    if not sizes:
        logger.info("No clusters formed.")
        return

    size_counts = collections.Counter(sizes)
    singletons = size_counts.get(1, 0)
    multi_article = num_clusters - singletons
    min_size = min(sizes)
    max_size = max(sizes)
    avg_size = sum(sizes) / num_clusters

    logger.info(
        f"Formed {num_clusters} clusters (Singletons: {singletons}, Multi-article: {multi_article}) | "
        f"Sizes -> Min: {min_size}, Max: {max_size}, Avg: {avg_size:.1f}"
    )

    # Breakdown by size buckets
    buckets = collections.defaultdict(int)
    for s in sizes:
        if s == 1:
            buckets["1 article"] += 1
        elif 2 <= s <= 4:
            buckets["2-4 articles"] += 1
        elif 5 <= s <= 9:
            buckets["5-9 articles"] += 1
        else:
            buckets["10+ articles"] += 1

    bucket_str = ", ".join(f"{k}: {v}" for k, v in sorted(buckets.items()))
    logger.info(f"Cluster size distribution: {bucket_str}")


def run_clustering(
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    db_url: Optional[str] = None,
    recluster_all: bool = True,
    print_clusters: bool = False,
) -> Dict[str, int]:
    """
    Cluster articles using TF-IDF + Cosine Similarity + Union-Find.
    
    Default assumption: recluster_all=True performs full recompute over the articles table,
    re-fitting TF-IDF and refreshing cluster assignments.

    Returns:
        {"clusters_created": N, "articles_clustered": N}
    """
    if db_url is None:
        db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            raise ValueError("Database URL must be provided or set in DATABASE_URL environment variable.")

    logger.info(
        f"Starting clustering (threshold={similarity_threshold}, recluster_all={recluster_all})"
    )

    with psycopg.connect(db_url) as conn:
        init_cluster_db(conn)
        articles = fetch_articles(conn, recluster_all=recluster_all)
        n_articles = len(articles)

        if n_articles == 0:
            logger.info("No articles found to cluster.")
            return {"clusters_created": 0, "articles_clustered": 0}

        logger.info(f"Fetched {n_articles} articles for clustering")

        corpus = build_article_corpus(articles)
        tfidf_matrix, feature_names = extract_tfidf_matrix(corpus)

        uf = UnionFind(n_articles)

        # Pairwise cosine similarity and union-find clustering
        if tfidf_matrix is not None and n_articles > 1:
            sim_matrix = cosine_similarity(tfidf_matrix)
            for i in range(n_articles):
                for j in range(i + 1, n_articles):
                    if sim_matrix[i, j] >= similarity_threshold:
                        uf.union(i, j)

        # Group indices by root
        grouped_clusters: Dict[int, List[int]] = collections.defaultdict(list)
        for i in range(n_articles):
            root = uf.find(i)
            grouped_clusters[root].append(i)

        log_cluster_distribution(grouped_clusters)

        # Generate labels and store
        clusters_to_persist = []
        for cluster_indices in grouped_clusters.values():
            label = generate_cluster_label(cluster_indices, tfidf_matrix, feature_names, articles)
            article_ids = [articles[idx]["id"] for idx in cluster_indices]
            clusters_to_persist.append((label, article_ids, cluster_indices))

        if print_clusters:
            print("\n" + "=" * 70)
            print(f"CLUSTERING RESULTS (Threshold: {similarity_threshold}, Total: {len(clusters_to_persist)} clusters)")
            print("=" * 70)
            for idx, (label, _, indices) in enumerate(clusters_to_persist, 1):
                print(f"\n[Cluster #{idx}] Label: {label} ({len(indices)} articles)")
                for art_idx in indices:
                    art = articles[art_idx]
                    print(f"  - [{art['id']}] {art['title']}")
            print("\n" + "=" * 70 + "\n")

        with conn.cursor() as cur:
            if recluster_all:
                cur.execute("TRUNCATE TABLE cluster_articles, clusters CASCADE")

            for label, article_ids, _ in clusters_to_persist:
                cur.execute(
                    "INSERT INTO clusters (label, created_at) VALUES (%s, NOW()) RETURNING id",
                    (label,),
                )
                cluster_id = cur.fetchone()[0]
                for art_id in article_ids:
                    cur.execute(
                        "INSERT INTO cluster_articles (cluster_id, article_id) VALUES (%s, %s)",
                        (cluster_id, art_id),
                    )
            conn.commit()

        result = {
            "clusters_created": len(clusters_to_persist),
            "articles_clustered": n_articles,
        }
        logger.info(f"Clustering complete: {result}")
        return result


SWEEP_THRESHOLDS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]


def run_threshold_sweep(
    thresholds: List[float] = SWEEP_THRESHOLDS,
    db_url: Optional[str] = None,
) -> None:
    """
    Run diagnostic threshold sweep across all articles to help select an optimal similarity_threshold.
    Does NOT write to or modify the database.
    """
    if db_url is None:
        db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            raise ValueError("Database URL must be provided or set in DATABASE_URL environment variable.")

    logger.info("Starting threshold sweep diagnostic across articles table...")

    with psycopg.connect(db_url) as conn:
        articles = fetch_articles(conn, recluster_all=True)

    n_articles = len(articles)
    if n_articles == 0:
        print("\nNo articles found in database to evaluate.")
        return

    print(f"\nFetched {n_articles} articles. Building TF-IDF matrix...")
    corpus = build_article_corpus(articles)
    tfidf_matrix, _ = extract_tfidf_matrix(corpus)

    if tfidf_matrix is None or n_articles <= 1:
        print(f"Dataset too small for threshold sweep ({n_articles} articles).")
        return

    print("Computing pairwise cosine similarity matrix...")
    sim_matrix = cosine_similarity(tfidf_matrix)

    print("\n" + "=" * 80)
    print("THRESHOLD SWEEP DIAGNOSTIC REPORT")
    print(f"Total Articles: {n_articles}")
    print("=" * 80)
    header = f"{'Threshold':<11} | {'Clusters':<10} | {'Singletons':<12} | {'Multi-Article':<15} | {'Largest':<9} | {'% In Clusters':<13}"
    print(header)
    print("-" * len(header))

    for threshold in thresholds:
        uf = UnionFind(n_articles)
        for i in range(n_articles):
            for j in range(i + 1, n_articles):
                if sim_matrix[i, j] >= threshold:
                    uf.union(i, j)

        grouped = collections.defaultdict(list)
        for i in range(n_articles):
            root = uf.find(i)
            grouped[root].append(i)

        num_clusters = len(grouped)
        sizes = [len(idxs) for idxs in grouped.values()]
        singletons = sum(1 for s in sizes if s == 1)
        multi_article = num_clusters - singletons
        largest_cluster = max(sizes) if sizes else 0
        multi_article_total_docs = sum(s for s in sizes if s > 1)
        pct_in_multi = (multi_article_total_docs / n_articles) * 100

        print(
            f"{threshold:<11.2f} | {num_clusters:<10} | {singletons:<12} | {multi_article:<15} | {largest_cluster:<9} | {pct_in_multi:<11.1f}%"
        )

    print("=" * 80)
    print("Interpretation:")
    print(" - Low threshold (<0.10): Can merge unrelated stories into giant mega-clusters.")
    print(" - High threshold (>0.30): May split related stories into isolated singletons.")
    print(" - Sweet spot: High multi-article clusters with balanced cluster sizes.\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cluster news articles by topic using TF-IDF, cosine similarity, and Union-Find."
    )
    parser.add_argument(
        "-t",
        "--threshold",
        type=float,
        default=DEFAULT_SIMILARITY_THRESHOLD,
        help=f"Cosine similarity threshold for clustering (default: {DEFAULT_SIMILARITY_THRESHOLD})",
    )
    parser.add_argument(
        "--db-url",
        type=str,
        default=None,
        help="PostgreSQL connection string (defaults to DATABASE_URL env var)",
    )
    parser.add_argument(
        "--unassigned-only",
        action="store_true",
        help="Only cluster unassigned articles instead of full recompute (default is full recompute)",
    )
    parser.add_argument(
        "--recluster-all",
        action="store_true",
        default=True,
        help="Perform full recompute across all articles (default behavior)",
    )
    parser.add_argument(
        "-p",
        "--print-clusters",
        action="store_true",
        help="Print cluster labels and article titles for threshold tuning",
    )
    parser.add_argument(
        "--sweep",
        action="store_true",
        help="Run diagnostic threshold sweep across [0.05..0.40] without writing to database",
    )

    args = parser.parse_args()

    try:
        if args.sweep:
            run_threshold_sweep(db_url=args.db_url)
            return

        run_clustering(
            similarity_threshold=args.threshold,
            db_url=args.db_url,
            recluster_all=not args.unassigned_only,
            print_clusters=args.print_clusters,
        )
    except Exception as e:
        logger.error(f"Clustering run failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
