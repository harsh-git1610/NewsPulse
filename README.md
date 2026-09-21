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
