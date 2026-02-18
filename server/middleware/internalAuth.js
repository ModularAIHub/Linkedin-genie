import crypto from 'crypto';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config({ quiet: true });

export default function internalAuth(req, res, next) {
  try {
    const headerKey = req.headers['x-internal-api-key'] || req.headers['x-internal-api-key'.toLowerCase()];
    const expected = process.env.INTERNAL_API_KEY || process.env.LINKEDIN_INTERNAL_API_KEY || '';

    // If no header present, continue to other auth middleware
    if (!headerKey) return next();

    // Timing-safe compare when expected is present
    const a = Buffer.from(String(headerKey));
    const b = Buffer.from(String(expected));
    if (a.length === 0 || b.length === 0) {
      return res.status(401).json({ error: 'Invalid internal API key' });
    }

    // Use crypto.timingSafeEqual for constant-time comparison
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
      return res.status(401).json({ error: 'Invalid internal API key' });
    }

    // Mark request as internal so downstream handlers can behave accordingly
    req.isInternal = true;
    req.internalCaller = req.headers['x-internal-caller'] || req.ip || 'internal';
    logger.info('[internalAuth] internal request authenticated', { caller: req.internalCaller });
    return next();
  } catch (err) {
    console.error('[internalAuth] Error validating internal key:', err);
    return res.status(401).json({ error: 'Invalid internal API key' });
  }
}
