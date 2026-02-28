
// Error handler middleware for LinkedIn Genie
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON payload',
      code: 'INVALID_JSON_PAYLOAD',
    });
  }

  console.error('Error:', err);
  if (err.code === 'LINKEDIN_API_ERROR') {
    return res.status(400).json({ error: 'LinkedIn API error', message: err.message, details: err.details });
  }
  if (err.code === 'INSUFFICIENT_CREDITS') {
    return res.status(402).json({ error: 'Insufficient credits', message: err.message, required: err.required, available: err.available });
  }
  if (err.isJoi) {
    return res.status(400).json({ error: 'Validation error', details: err.details.map(detail => detail.message) });
  }
  if (err.code && String(err.code).startsWith('23')) {
    return res.status(400).json({ error: 'Database constraint violation', message: 'The operation violates data constraints' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error', ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) });
};

export default errorHandler;
