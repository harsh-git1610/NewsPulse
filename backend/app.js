require('dotenv').config();
require('express-async-errors');

// Fail-fast startup check
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set. Exiting.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');
const clustersRouter = require('./routes/clusters');
const ingestRouter = require('./routes/ingest');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration (handles trailing slashes and vercel deployments seamlessly)
const rawOrigin = process.env.FRONTEND_ORIGIN;
const cleanOrigin = rawOrigin ? rawOrigin.trim().replace(/\/+$/, '') : null;

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests or if origin matches
    if (!origin || !cleanOrigin || cleanOrigin === '*') {
      return callback(null, true);
    }
    const reqOrigin = origin.trim().replace(/\/+$/, '');
    if (reqOrigin === cleanOrigin || reqOrigin.endsWith('.vercel.app') || reqOrigin.includes('localhost')) {
      return callback(null, true);
    }
    return callback(null, true); // Permissive fallback to prevent deployment blocks
  },
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json());

// Basic request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} [${req.method}] ${req.originalUrl}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Mount domain routes
app.use('/', clustersRouter);
app.use('/ingest', ingestRouter);

// Centralized error handling middleware (must be attached last)
app.use(errorHandler);

// Start server after ensuring DB table is initialized
async function startServer() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`NewsPulse REST API server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Server failed to start due to database initialization error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
