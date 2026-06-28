import { ApiError } from '../utils/ApiError.js';
import { isDbConnected } from '../config/db.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route ${req.method} ${req.path}` });
}

// Centralised error formatter.
export function errorHandler(err, _req, res, _next) {
  // Mongoose / driver errors -> friendly messages
  if (err?.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation failed', details: Object.values(err.errors).map((e) => e.message) });
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || { field: 1 })[0];
    return res.status(409).json({ error: `That ${field} is already in use` });
  }
  if (err?.name === 'CastError') {
    return res.status(400).json({ error: `Invalid ${err.path}` });
  }
  // DB unreachable
  const dbMsg = err?.message || '';
  if (!isDbConnected() && (/^Mongo/i.test(err?.name || '') || /buffering|ECONNREFUSED|topology|ENOTFOUND|querySrv|must be connected|initial connection|before running operations/i.test(dbMsg))) {
    return res.status(503).json({ error: 'Database unavailable — is MongoDB running and MONGODB_URI set?' });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
