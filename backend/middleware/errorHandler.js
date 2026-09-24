/**
 * Centralized error handling middleware.
 * Logs full error details on the server but never leaks stack traces or internals to clients.
 */
function errorHandler(err, req, res, next) {
  console.error('[Error Handler]', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
