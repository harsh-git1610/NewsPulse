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

---

## Express.js REST API

The Express API serves cluster data from PostgreSQL and manages background ingestion/clustering jobs.

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | - | PostgreSQL connection string (fails fast on startup if omitted) |
| `PORT` | No | `3000` | Port for the HTTP server |
| `FRONTEND_ORIGIN` | No | `*` | Allowed CORS origin (e.g. `https://my-frontend.vercel.app`) |
| `PYTHON_BIN` | No | `python` (Win) / `python3` (Linux) | Python binary invoked for pipeline child processes |

### Installation & Startup

```bash
# Install Node.js dependencies
npm install

# Start the API server
npm start

# Or in development mode with auto-reload
npm run dev
```

### API Endpoints & Example curl Commands

#### 1. Health Check
```bash
curl -i http://localhost:3000/health
# Response: 200 OK
# {"status":"ok"}
```

#### 2. List All Clusters
```bash
curl -i http://localhost:3000/clusters
# Response: 200 OK
# [{"id":1,"label":"nasa, artemis, moon","article_count":4,"start_time":"2026-09-21T18:00:00.000Z","end_time":"2026-09-21T21:30:00.000Z"}]
```

#### 3. Cluster Details by ID
```bash
# Valid ID (articles sorted by published_at ASC)
curl -i http://localhost:3000/clusters/1

# Invalid ID (non-positive integer) -> 400 Bad Request
curl -i http://localhost:3000/clusters/abc
# {"error":"Invalid id"}

# Non-existent cluster -> 404 Not Found
curl -i http://localhost:3000/clusters/999999
# {"error":"Cluster not found"}
```

#### 4. Chart Timeline
Returns cluster data with `intensity` normalized between 0 and 1:
```bash
curl -i http://localhost:3000/timeline
# Response: 200 OK
# [{"id":1,"label":"nasa, artemis, moon","start":"2026-09-21T18:00:00.000Z","end":"2026-09-21T21:30:00.000Z","article_count":4,"intensity":1.0}]
```

#### 5. Trigger Pipeline (Ingestion + Clustering)
Spawns `ingest.py` followed by `cluster.py` in the background and returns immediately:
```bash
curl -i -X POST http://localhost:3000/ingest/trigger
# Response: 202 Accepted
# {"jobId":1}

# Concurrent trigger while job is running -> 409 Conflict
curl -i -X POST http://localhost:3000/ingest/trigger
# Response: 409 Conflict
# {"error":"Ingestion already in progress","jobId":1}
```

#### 6. Polling Ingestion Job Status
```bash
# Poll job status using returned jobId
curl -i http://localhost:3000/ingest/status/1
# Response: 200 OK
# {"status":"running","startedAt":"2026-09-22T00:50:00.000Z","finishedAt":null}

# Invalid jobId -> 400 Bad Request
curl -i http://localhost:3000/ingest/status/abc
# {"error":"Invalid jobId"}

# Non-existent jobId -> 404 Not Found
curl -i http://localhost:3000/ingest/status/999999
# {"error":"Job not found"}
```

---

## Next.js Timeline Frontend (`frontend/`)

A Next.js (App Router, TypeScript) dashboard visualizes topic clusters over an interactive timeline using `vis-timeline`.

### Local Setup & Development

```bash
cd frontend

# Install frontend dependencies
npm install

# Start development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) (or whichever port Next.js binds to, e.g. 3001 if backend runs on 3000).

### Build & Production Deployment (e.g. Vercel)

> [!IMPORTANT]
> **Build-Time Environment Variable:**
> `NEXT_PUBLIC_API_URL` is baked into the frontend JavaScript bundle at **build time**.
> When deploying to platforms like Vercel, you **must set `NEXT_PUBLIC_API_URL` in the Vercel Project Settings (Environment Variables)** prior to triggering the build. Setting it only in a local `.env` or changing it after build will not take effect without a redeployment.

### Features & Semantics

1. **Interactive Timeline**:
   - Clusters span `start` -> `end` dates of their constituent articles.
   - For single-article clusters (`start === end`), the end is visually padded by +30 minutes so it renders as a visible block rather than a zero-width line.
   - Block opacity and borders dynamically scale according to cluster `intensity` (0.0 to 1.0).
   - Clicking a cluster block opens the details modal.

2. **Source Filtering Semantics**:
   - Sources are derived dynamically from the ingested articles (no hardcoded list).
   - **Inclusive filtering**: A timeline cluster remains visible if **any** of its member articles originate from a currently selected source.
   - Opening a cluster modal additionally filters the member article list to match active source selections.

3. **Ingestion Polling Lifecycle**:
   - The "Refresh data" button calls `POST /ingest/trigger`.
   - If the backend returns `409 Conflict`, the frontend attaches to the existing `jobId` rather than failing.
   - Polls `GET /ingest/status/:jobId` every 3 seconds, disabling the button and showing a spinner.
   - Automatically stops polling when completed (refetching timeline), when failed (displaying error toast), on component unmount (avoiding orphaned intervals), or upon reaching a 40-attempt (~2 min) timeout.



