const express = require('express');
const router = express.Router();
const path = require('path');
const { spawn } = require('child_process');
const db = require('../db');
const { validateParamId } = require('../middleware/validate');

/**
 * Execute the two-step Python pipeline in the background:
 * 1. ingest.py (scraper)
 * 2. cluster.py (clustering)
 */
function runPipeline(jobId) {
  const scraperDir = path.resolve(__dirname, '..');
  const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

  console.log(`[Job #${jobId}] Spawning scraper (${pythonBin} ingest.py)...`);

  const ingestProcess = spawn(pythonBin, ['ingest.py'], {
    cwd: scraperDir,
    env: process.env,
  });

  let ingestStderr = '';

  ingestProcess.stderr.on('data', (chunk) => {
    ingestStderr += chunk.toString();
  });

  ingestProcess.on('error', async (err) => {
    console.error(`[Job #${jobId}] Failed to start ingest.py:`, err);
    const errorMsg = `Failed to spawn ${pythonBin}: ${err.message}`.slice(0, 2000);
    try {
      await db.query(
        `UPDATE ingest_jobs SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`,
        [errorMsg, jobId]
      );
    } catch (dbErr) {
      console.error(`[Job #${jobId}] Error updating job status on spawn error:`, dbErr);
    }
  });

  ingestProcess.on('close', async (code) => {
    if (code !== 0) {
      console.error(`[Job #${jobId}] ingest.py exited with non-zero code ${code}`);
      const truncatedError = (ingestStderr || `ingest.py exited with code ${code}`).slice(-2000);
      try {
        await db.query(
          `UPDATE ingest_jobs SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`,
          [truncatedError, jobId]
        );
      } catch (dbErr) {
        console.error(`[Job #${jobId}] Failed to update failed job status:`, dbErr);
      }
      return; // Stop here; do NOT proceed to cluster.py
    }

    console.log(`[Job #${jobId}] ingest.py finished successfully. Spawning clustering (${pythonBin} cluster.py)...`);

    const clusterProcess = spawn(pythonBin, ['cluster.py'], {
      cwd: scraperDir,
      env: process.env,
    });

    let clusterStderr = '';

    clusterProcess.stderr.on('data', (chunk) => {
      clusterStderr += chunk.toString();
    });

    clusterProcess.on('error', async (err) => {
      console.error(`[Job #${jobId}] Failed to start cluster.py:`, err);
      const errorMsg = `Failed to spawn ${pythonBin} cluster.py: ${err.message}`.slice(0, 2000);
      try {
        await db.query(
          `UPDATE ingest_jobs SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`,
          [errorMsg, jobId]
        );
      } catch (dbErr) {
        console.error(`[Job #${jobId}] Error updating job status on cluster spawn error:`, dbErr);
      }
    });

    clusterProcess.on('close', async (clusterCode) => {
      try {
        if (clusterCode === 0) {
          console.log(`[Job #${jobId}] cluster.py completed successfully. Pipeline finished.`);
          await db.query(
            `UPDATE ingest_jobs SET status = 'completed', finished_at = NOW() WHERE id = $1`,
            [jobId]
          );
        } else {
          console.error(`[Job #${jobId}] cluster.py failed with code ${clusterCode}`);
          const truncatedError = (clusterStderr || `cluster.py exited with code ${clusterCode}`).slice(-2000);
          await db.query(
            `UPDATE ingest_jobs SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`,
            [truncatedError, jobId]
          );
        }
      } catch (dbErr) {
        console.error(`[Job #${jobId}] Failed to update final job status:`, dbErr);
      }
    });
  });
}

/**
 * POST /ingest/trigger
 * Spawns the ingestion & clustering pipeline in the background.
 * Returns 409 Conflict if an ingestion job is already running.
 */
router.post('/trigger', async (req, res) => {
  // Check for currently running job
  const runningRes = await db.query(
    `SELECT id FROM ingest_jobs WHERE status = 'running' LIMIT 1`
  );

  if (runningRes.rowCount > 0) {
    return res.status(409).json({
      error: 'Ingestion already in progress',
      jobId: runningRes.rows[0].id,
    });
  }

  // Create new running job row
  const insertRes = await db.query(
    `INSERT INTO ingest_jobs (status, started_at) VALUES ('running', NOW()) RETURNING id`
  );
  const jobId = insertRes.rows[0].id;

  // Run pipeline in the background without blocking response
  runPipeline(jobId);

  res.status(202).json({ jobId });
});

/**
 * GET /ingest/status/:jobId
 * Return job status for polling: { status, startedAt, finishedAt }.
 * Returns 404 if the job does not exist. Does not expose internal error details.
 */
router.get('/status/:jobId', validateParamId('jobId'), async (req, res) => {
  const jobId = req.params.jobId;

  const jobRes = await db.query(
    `SELECT status, started_at, finished_at FROM ingest_jobs WHERE id = $1`,
    [jobId]
  );

  if (jobRes.rowCount === 0) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const row = jobRes.rows[0];
  res.json({
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
});

module.exports = router;
