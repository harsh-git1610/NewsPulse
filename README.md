# NewsPulse — Topic-Clustered News Timeline

**Live Demo:** [https://newspulse-frontend.vercel.app](https://newspulse-frontend.vercel.app) *(Replace with your live frontend URL)*  
**Backend API:** [https://newspulse-api.onrender.com](https://newspulse-api.onrender.com) *(Replace with your live backend URL)*  
**Video Walkthrough (2–3 mins):** [Loom / YouTube Link](https://www.loom.com/) *(Replace with your unlisted video link)*

---

## Overview

**NewsPulse** is an automated news aggregation, topic modeling, and interactive visualization system. It ingests live articles from major global news RSS feeds, extracts full text content, dynamically groups related articles into topic clusters using natural language processing (TF-IDF + Cosine Similarity + Union-Find), and renders them on an editorial timeline interface.

---

## 1. Architecture: What Runs Where & Why

The system follows a decoupled three-tier architecture:

```
┌─────────────────────────────────┐
│     Next.js / React Frontend    │  Hosted on Vercel
│   Interactive vis-timeline UI   │  (SSR + Static Client Bundle)
└────────────────┬────────────────┘
                 │ HTTP REST / JSON
                 ▼
┌─────────────────────────────────┐
│       Node.js Express API       │  Hosted on Render / Railway
│   Cluster endpoints & Job runner│  (Handles CORS, validation, child processes)
└────────────────┬────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐   ┌──────────────────────────────┐
│  PostgreSQL  │   │     Python Data Pipeline     │
│ Hosted Neon  │◄──┤  1. ingest.py (feedparser)   │
│  (Database)  │   │  2. cluster.py (scikit-learn)│
└──────────────┘   └──────────────────────────────┘
```

- **Frontend (Next.js 14 App Router, TypeScript):** Deployed on **Vercel** for instant global CDN caching, responsive rendering, and zero-config deployment. Communicates with the backend using the environment variable `NEXT_PUBLIC_API_URL`.
- **Backend API (Node.js, Express):** Deployed on **Render / Railway**. Provides clean REST endpoints for timeline data and orchestrates background ingestion jobs using `child_process.spawn`. Fails fast on startup if environment variables are missing and returns appropriate HTTP status codes (`200`, `202`, `400`, `404`, `409`, `500`).
- **Data Pipeline (Python 3):** Two modular scripts:
  - `ingest.py`: Scrapes RSS feeds, normalizes schema inconsistencies, extracts body text with `trafilatura`, and inserts records.
  - `cluster.py`: Computes TF-IDF feature matrices, computes pairwise cosine similarities, groups stories with Union-Find, and saves clusters.
- **Database (PostgreSQL on Neon):** Free-tier hosted serverless PostgreSQL with relational integrity, unique URL constraints to prevent duplicate articles, and indexed timestamps (`idx_articles_published_at`).

---

## 2. RSS News Sources & Ingestion (`ingest.py`)

Articles are pulled from 4 public news outlets:

| Source | RSS Feed URL | Specific Formatting Handled |
|---|---|---|
| **BBC News** | `http://feeds.bbci.co.uk/news/rss.xml` | Standard `<description>`, clean `<pubDate>` |
| **NPR** | `https://feeds.npr.org/1001/rss.xml` | Occasional missing pubDates, fallback to current UTC time |
| **The Guardian** | `https://www.theguardian.com/world/rss` | Prefers `<content:encoded>` for richer body over description |
| **Al Jazeera** | `https://www.aljazeera.com/xml/rss/all.xml` | CDATA tags, extra HTML entity escaping |

### Ingestion Robustness & Edge-Cases
- **Format Inconsistencies:** Custom parser adapters for each source strip raw HTML, decode entities, and normalize diverse date formats into UTC timestamps using `python-dateutil`.
- **Full Article Extraction:** RSS summaries are often truncated. The pipeline uses `trafilatura` to extract the main article body text from the live web page, falling back gracefully to the summary if a paywall or parsing error occurs.
- **Deduplication:** Articles are deduplicated against the database using `url TEXT UNIQUE` with `ON CONFLICT (url) DO NOTHING`. Repeated runs only download and process newly published dispatches.
- **Polite Crawling:** Incorporates a 0.5-second request delay between article fetches to respect origin host rate limits.

---

## 3. Topic Grouping: Approach, Rationale & Tuning (`cluster.py`)

### Chosen Approach: Option B (TF-IDF + Cosine Similarity + Union-Find)

Rather than simple keyword-overlap, we implemented **Option B (TF-IDF with Cosine Similarity)** for several key engineering reasons:

1. **Information Weighting (IDF Penalty):** Raw keyword matching treats frequent news words (e.g. *"reported"*, *"minister"*, *"today"*) with the same weight as specific topical terms (e.g. *"Artemis"*, *"Hezbollah"*, *"Gaza"*). TF-IDF naturally suppresses pervasive vocabulary while amplifying event-defining keywords.
2. **Length Invariance:** Different sources provide summaries of varying lengths. Cosine similarity normalizes vectors by their Euclidean norm, evaluating semantic alignment regardless of whether a summary is 20 words or 150 words.
3. **Dynamic Graph Clustering (Union-Find):** Unlike $K$-Means (which forces an artificial number of clusters $K$), Union-Find dynamically discovers connected components based on whether pairwise similarity exceeds the threshold.

### Text Representation & Feature Extraction
- **Weighted Input:** Title carries the most concise topical signal. Articles are vectorized as `title + " " + title + " " + summary` (doubling title term frequencies).
- **Vectorizer Parameters:**
  - `stop_words='english'`: Strips common grammatical filler words.
  - `ngram_range=(1, 2)`: Captures single keywords and key 2-word phrases (e.g., *"interest rates"*, *"health department"*).
  - `token_pattern=r"(?u)\b[a-zA-Z]{2,}\b"`: Restricts tokens to alphabetic characters, explicitly preventing numbers (e.g., `650`, `000`) from skewing similarity or corrupting headlines.
  - `max_df=0.8`: Discards terms appearing in over 80% of documents to remove corpus-specific noise.

### Parameter Tuning: The `--sweep` Diagnostic
To pick the optimal `similarity_threshold` objectively, a `--sweep` CLI flag was built into `cluster.py`. Running `python cluster.py --sweep` evaluates grouping metrics across thresholds from `0.05` to `0.40` on the active dataset:

```
Threshold Sweep Results (Articles: 172):
Threshold | Clusters | Singletons | Multi-Article | Max Cluster Size
------------------------------------------------------------------
     0.05 |       18 |          3 |            15 |               84  (Over-clustering)
     0.10 |       46 |         19 |            27 |               38  (Over-clustering)
     0.15 |       78 |         49 |            29 |               18  (Good cross-source grouping)
     0.20 |      102 |         74 |            28 |               11  (Optimal balance)
     0.25 |      118 |         92 |            26 |                7  (Default: High coherence)
     0.30 |      134 |        112 |            22 |                4  (Over-fragmented)
     0.35 |      149 |        133 |            16 |                3  (Over-fragmented)
     0.40 |      158 |        148 |            10 |                2  (Near-total isolation)
```

**Selection Rationale:**
- At **`0.05–0.10`**, clusters become "super-clusters" grouping loosely related international stories together.
- At **`0.30+`**, genuine multi-source stories across BBC, Guardian, and NPR fragment into isolated singletons because outlets use differing headlines.
- The default was set to **`0.25`** (with `0.20` configurable via `-t 0.20`), guaranteeing that multi-article clusters share coherent real-world topics.

### Readable Headline Selection (Medoid Approach)
Instead of displaying raw TF-IDF comma-separated keywords (e.g. `"city, 000 strong, 650 000"`):
- **1-Article Clusters:** Display the article's actual journalist-written headline directly.
- **Multi-Article Clusters:** The script calculates the cluster centroid and selects the headline of the **central article (medoid)** with the highest cosine similarity to the cluster mean vector.

---

## 4. Key Limitations of the Approach

While TF-IDF with Union-Find is fast, deterministic, and requires no heavy external language models, it has two notable limitations:

1. **Lack of Semantic Understanding (Vocabulary Mismatch):**  
   TF-IDF relies purely on lexical overlap. If BBC headlines *"Automobile workers launch nationwide strike"* while NPR writes *"Auto union walks out of factory plants"*, TF-IDF will not understand that *"automobile"* and *"auto"* or *"strike"* and *"walk out"* describe the exact same concept. In the absence of shared named entities, these articles may remain in separate clusters. *(Mitigation for future iterations: Dense vector embeddings via `sentence-transformers` or OpenAI embeddings).*
2. **Transitive Chaining in Union-Find:**  
   If Article A is related to Article B (similarity 0.26), and Article B is related to Article C (similarity 0.26), Union-Find groups A, B, and C together—even if the similarity between A and C is low (e.g., 0.12). At threshold 0.25 this is minimal, but at lower thresholds it can create thematic drift.

---

## 5. REST API Documentation (`app.js`)

Base URL: `http://localhost:5000` (or your live deployed backend URL)

### Endpoints

#### 1. `GET /clusters`
List all topic clusters with aggregate article counts, earliest publication time, and latest publication time.
```bash
curl -i http://localhost:5000/clusters
```
**Response (200 OK):**
```json
[
  {
    "id": 1463,
    "label": "Australian health department data breach under investigation",
    "article_count": 2,
    "start_time": "2026-09-23T11:47:17.000Z",
    "end_time": "2026-09-24T08:42:35.000Z"
  }
]
```

#### 2. `GET /clusters/:id`
Full details of a single cluster, including its member articles sorted chronologically (`published_at ASC`).
```bash
curl -i http://localhost:5000/clusters/1463
```
**Response (200 OK):**
```json
{
  "id": 1463,
  "label": "Australian health department data breach under investigation",
  "articles": [
    {
      "id": 412,
      "title": "Australian health department identifies data breach",
      "source": "guardian",
      "url": "https://www.theguardian.com/world/article/...",
      "published_at": "2026-09-23T11:47:17.000Z"
    }
  ]
}
```

#### 3. `GET /timeline`
Clusters specifically shaped for charting and timeline libraries (`start`, `end`, `article_count`, and a normalized `intensity` float from 0.0 to 1.0 based on maximum cluster size).
```bash
curl -i http://localhost:5000/timeline
```

#### 4. `POST /ingest/trigger`
Triggers the background execution of `ingest.py` followed by `cluster.py`. Returns HTTP `202 Accepted` with a `jobId`. Concurrent requests return `409 Conflict`.
```bash
curl -i -X POST http://localhost:5000/ingest/trigger
```

#### 5. `GET /ingest/status/:jobId`
Enables the frontend to poll job progress (`running`, `completed`, `failed`).
```bash
curl -i http://localhost:5000/ingest/status/1
```

---

## 6. Frontend Features (`frontend/`)

- **Interactive Timeline Visualization:** Powered by `vis-timeline`. Cluster blocks span their active chronological window from earliest to latest dispatch.
- **Dynamic Cluster Intensity:** Block heights visually scale between 24px and 120px proportional to cluster intensity (number of articles).
- **Source Filtering:** Dynamic, non-destructive inline filters allow toggling individual sources (BBC, NPR, Guardian, Al Jazeera) on or off.
- **Sliding Inspection Drawer:** Clicking any cluster slides open a fixed right-side detail drawer with chronological articles, source indicators, and direct links.
- **Live Wire Refresh:** The "Refresh data" button triggers the pipeline via `POST /ingest/trigger` and polls the status, displaying an animated pulse indicator only while processing.
- **Editorial Filter Toolbar:**
  - **Time Window:** `ALL DISPATCHES` | `TODAY` | `PAST 24H`
  - **Scope:** `ALL TOPICS` | `DEVELOPING (2+ ARTICLES)`
  - **Sort Order:** `NEWEST FIRST` | `MOST COVERED`

---

## 7. Local Setup & Installation

### Prerequisites
- Python 3.8+
- Node.js 18+
- A running PostgreSQL database (e.g. Neon, Supabase, or local Postgres)

### 1. Database & Environment Configuration
Create a `.env` file in the root folder:
```env
DATABASE_URL=postgres://user:password@ep-example.neon.tech/newspulse?sslmode=require
PORT=5000
FRONTEND_ORIGIN=http://localhost:3000
PYTHON_BIN=python
```

### 2. Python Pipeline Setup
```bash
# Create and activate virtual environment inside scraper/
cd scraper
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run initial ingestion and clustering
python ingest.py
python cluster.py
```

### 3. Backend API Setup
```bash
cd backend

# Install Node dependencies
npm install

# Start API server
npm run dev
```
Backend runs at `http://localhost:5000`.

### 4. Frontend Setup
In a new terminal window:
```bash
cd frontend

# Install frontend dependencies
npm install

# Configure local environment
echo "NEXT_PUBLIC_API_URL=http://localhost:5000" > .env.local

# Run Next.js development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 8. Video Walkthrough Guide (2–3 Minutes)

When recording your submission walkthrough video (via Loom or OBS), follow this structured outline matching the assessment instructions:

1. **0:00 – 0:45 (Live Demo):**
   - Open your live frontend URL.
   - Show the interactive timeline spanning across dates.
   - Click a cluster block to reveal the slide-out detail drawer with member articles.
   - Click a source toggle (`BBC`, `GUARDIAN`) to show how the timeline reacts.
   - Hit **"Refresh data"** to show the live polling button state.
2. **0:45 – 1:30 (Topic Grouping Explanation):**
   - Open `cluster.py`.
   - Explain how TF-IDF vectorization extracts n-grams from titles + summaries while filtering numbers.
   - Explain how cosine similarity measures document proximity, and how Union-Find groups connected stories.
   - Mention the representative headline (medoid) selection.
3. **1:30 – 2:15 (One Hard Problem & Solution):**
   - Discuss handling **feed format inconsistencies and headline noise**: e.g., how numbers like `650,000` initially dominated TF-IDF scores as `"650 000"`, and how you resolved this by cleaning the token pattern (`r"(?u)\b[a-zA-Z]{2,}\b"`) and implementing the `--sweep` diagnostic to systematically select the similarity threshold.
4. **2:15 – 2:45 (Future Improvements):**
   - Mention upgrading from lexical TF-IDF to dense semantic embeddings (`sentence-transformers`) to handle cross-outlet synonyms and paraphrase detection.
