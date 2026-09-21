# NewsPulse - RSS Ingestion Module

This module fetches articles from 5 news feeds (BBC, NPR, The Guardian, NYT, Al Jazeera), normalizes their data, extracts full article text, and stores them in a Postgres database.

## Requirements

Ensure you have Python 3.8+ installed. You can install the dependencies via:

```bash
pip install -r requirements.txt
```

## Running the Ingestion Script

The `ingest.py` script runs standalone and takes its database configuration from the `DATABASE_URL` environment variable.

### 1. Set the Database URL
Set the environment variable pointing to your Postgres database instance:

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL="postgres://user:password@localhost:5432/newspulse"
```

**Linux/macOS:**
```bash
export DATABASE_URL="postgres://user:password@localhost:5432/newspulse"
```

### 2. Run the Script
Simply execute the script:
```bash
python ingest.py
```

The script will automatically create the required `articles` table if it does not already exist, fetch the RSS feeds, extract body text, insert records, and log its progress to standard output. It ensures no duplicate articles are stored based on their URL.

## Topic Clustering Module

The `cluster.py` module groups ingested articles by topic using TF-IDF feature extraction, cosine similarity, and Union-Find clustering.

### Key Details
- **Text input weighting**: Articles are vectorized as `title repeated twice + summary`.
- **TF-IDF & Cosine Similarity**: Scikit-learn's `TfidfVectorizer` is configured with `stop_words='english'`, `max_df=0.8`, `min_df=1`, `ngram_range=(1,2)`.
- **Union-Find clustering**: Formed dynamically without requiring an upfront cluster count.
- **Top-term Labels**: Automatically extracts the top 3 terms of each cluster's averaged TF-IDF vector.
- **Full recompute by default**: Refits TF-IDF across all articles and refreshes the `clusters` and `cluster_articles` tables.

### Running Clustering

Execute clustering with default parameters (threshold = 0.25, full recompute):
```bash
python cluster.py
```

### Options & Threshold Tuning

- `-p`, `--print-clusters`: Inspect cluster labels and article titles for manual threshold tuning.
- `-t <float>`, `--threshold <float>`: Configure similarity threshold (default: `0.25`).
- `--unassigned-only`: Only cluster articles that have not yet been assigned to any cluster.
- `--db-url <url>`: Override the `DATABASE_URL` environment variable.

Example tuning command:
```bash
python cluster.py -t 0.30 -p
```

