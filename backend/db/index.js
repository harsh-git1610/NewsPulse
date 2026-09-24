const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set. Exiting.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

async function initDb() {
  const query = `
    CREATE TABLE IF NOT EXISTS ingest_jobs (
      id SERIAL PRIMARY KEY,
      status TEXT CHECK (status IN ('running', 'completed', 'failed')),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      error TEXT
    );
  `;
  try {
    await pool.query(query);
    console.log('Database initialized: ingest_jobs table verified/created.');
  } catch (err) {
    console.error('Failed to initialize database tables:', err);
    throw err;
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initDb,
};
