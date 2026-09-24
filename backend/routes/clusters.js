const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateParamId } = require('../middleware/validate');

/**
 * GET /clusters
 * List all clusters with aggregate article count, start_time, and end_time.
 * Uses LEFT JOIN to ensure clusters with 0 linked articles are not excluded.
 */
router.get('/clusters', async (req, res) => {
  const query = `
    SELECT 
      c.id, 
      c.label, 
      COUNT(ca.article_id)::int AS article_count, 
      MIN(a.published_at) AS start_time, 
      MAX(a.published_at) AS end_time
    FROM clusters c
    LEFT JOIN cluster_articles ca ON c.id = ca.cluster_id
    LEFT JOIN articles a ON ca.article_id = a.id
    GROUP BY c.id, c.label
    ORDER BY c.id ASC;
  `;
  const { rows } = await db.query(query);
  res.json(rows);
});

/**
 * GET /clusters/:id
 * Full cluster detail with its member articles sorted by published_at ASC.
 * Returns 404 if cluster does not exist.
 */
router.get('/clusters/:id', validateParamId('id'), async (req, res) => {
  const clusterId = req.params.id;

  const clusterRes = await db.query('SELECT id, label FROM clusters WHERE id = $1', [clusterId]);
  if (clusterRes.rowCount === 0) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const cluster = clusterRes.rows[0];

  const articlesQuery = `
    SELECT 
      a.id, 
      a.title, 
      a.source, 
      a.url, 
      a.published_at
    FROM articles a
    JOIN cluster_articles ca ON a.id = ca.article_id
    WHERE ca.cluster_id = $1
    ORDER BY a.published_at ASC;
  `;
  const articlesRes = await db.query(articlesQuery, [clusterId]);

  res.json({
    id: cluster.id,
    label: cluster.label,
    articles: articlesRes.rows,
  });
});

/**
 * GET /timeline
 * Clusters shaped for charting libraries with start, end, article_count, and normalized intensity.
 * Intensity is normalized (0 to 1) based on max article count across all clusters.
 * Returns 1.0 if only 1 cluster exists; returns [] if 0 clusters exist.
 */
router.get('/timeline', async (req, res) => {
  const query = `
    SELECT 
      c.id, 
      c.label, 
      COUNT(ca.article_id)::int AS article_count, 
      MIN(a.published_at) AS start, 
      MAX(a.published_at) AS end
    FROM clusters c
    LEFT JOIN cluster_articles ca ON c.id = ca.cluster_id
    LEFT JOIN articles a ON ca.article_id = a.id
    GROUP BY c.id, c.label
    ORDER BY c.id ASC;
  `;
  const { rows } = await db.query(query);

  if (rows.length === 0) {
    return res.json([]);
  }

  if (rows.length === 1) {
    return res.json([
      {
        id: rows[0].id,
        label: rows[0].label,
        start: rows[0].start,
        end: rows[0].end,
        article_count: rows[0].article_count,
        intensity: 1.0,
      },
    ]);
  }

  const maxCount = Math.max(...rows.map((r) => r.article_count));
  const timeline = rows.map((r) => ({
    id: r.id,
    label: r.label,
    start: r.start,
    end: r.end,
    article_count: r.article_count,
    intensity: maxCount > 0 ? Number((r.article_count / maxCount).toFixed(4)) : 0,
  }));

  res.json(timeline);
});

module.exports = router;
