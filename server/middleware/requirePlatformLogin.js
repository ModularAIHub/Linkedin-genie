
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookieUtils.js';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS || 30000);
const platformUserCache = new Map();
const linkedinAuthCache = new Map();
const PLATFORM_API_BASE_URL = process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api';

const getCacheValue = (cache, key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCacheValue = (cache, key, value) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS
  });
};

const shouldAttachLinkedinAuth = (req) => {
  const path = String(req?.originalUrl || req?.path || '').split('?')[0];
  return /^\/api\/(posts|schedule|linkedin)(?:\/|$)/.test(path);
};

const resolveSocialLinkedinUserId = (row = {}) => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const fromMetadata = String(metadata?.linkedin_user_id || '').trim();
  if (fromMetadata) return fromMetadata;

  const accountId = String(row?.account_id || '').trim();
  if (!accountId || accountId.startsWith('org:')) return null;
  return accountId;
};

const extractCookieValue = (setCookieHeader, cookieName) => {
  if (!Array.isArray(setCookieHeader)) return null;

  const targetPrefix = `${cookieName}=`;
  const rawCookie = setCookieHeader.find((cookie) => String(cookie).startsWith(targetPrefix));
  if (!rawCookie) return null;

  return rawCookie.slice(targetPrefix.length).split(';')[0] || null;
};

const applyPlatformRefreshedAuthCookies = (res, setCookieHeader) => {
  const newAccessToken = extractCookieValue(setCookieHeader, 'accessToken');
  if (!newAccessToken) return null;

  const newRefreshToken = extractCookieValue(setCookieHeader, 'refreshToken');

  // If platform rotates refresh tokens, persist the rotated cookie locally.
  // If it doesn't, keep the existing one instead of clearing it.
  setAuthCookies(res, newAccessToken, newRefreshToken || null);

  return newAccessToken;
};

const buildPlatformRefreshHeaders = (req) => {
  const refreshToken = req.cookies?.refreshToken;
  const csrfToken = req.cookies?._csrf || req.headers['x-csrf-token'];
  const cookieParts = [`refreshToken=${refreshToken}`];
  const headers = {};

  if (csrfToken) {
    cookieParts.push(`_csrf=${csrfToken}`);
    headers['x-csrf-token'] = csrfToken;
  }

  headers.Cookie = cookieParts.join('; ');
  return headers;
};

export async function requirePlatformLogin(req, res, next) {
  // Allow internal service requests authenticated by `internalAuth` middleware to pass through.
  if (req.isInternal) {
    // Internal callers may supply `x-platform-user-id` for user-scoped lookups.
    return next();
  }
  // Helper: detect API/XHR request
  function isApiRequest(req) {
    const accept = req.headers['accept'] || '';
    const xrw = req.headers['x-requested-with'] || '';
    return accept.includes('application/json') || xrw === 'XMLHttpRequest' || req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/auth/');
  }

  try {
    // Reduce logging noise - only log when debugging auth issues
    // console.log('[requirePlatformLogin] Incoming cookies:', req.cookies);
    
    // 1. Get token from cookie or header
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    // 2. If no token, try refresh
    if (!token && req.cookies?.refreshToken) {
      try {
        const refreshResponse = await axios.post(
          `${PLATFORM_API_BASE_URL}/auth/refresh`,
          {},
          {
            headers: buildPlatformRefreshHeaders(req),
            withCredentials: true
          }
        );
        if (refreshResponse.status !== 200) {
          console.error('[requirePlatformLogin] Refresh failed, status:', refreshResponse.status, refreshResponse.data);
          clearAuthCookies(res);
          if (isApiRequest(req)) {
            return res.status(401).json({ error: 'Unauthorized: refresh failed', details: refreshResponse.data });
          } else {
            const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
            const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
            return res.redirect(platformLoginUrl);
          }
        }
        const setCookieHeader = refreshResponse.headers['set-cookie'];
        if (setCookieHeader) {
          const newToken = applyPlatformRefreshedAuthCookies(res, setCookieHeader);
          if (newToken) {
            token = newToken;
          } else {
            console.error('[requirePlatformLogin] No accessToken in set-cookie after refresh:', setCookieHeader);
            if (isApiRequest(req)) {
              return res.status(401).json({ error: 'Unauthorized: no access token after refresh', details: setCookieHeader });
            } else {
              const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
              const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
              return res.redirect(platformLoginUrl);
            }
          }
        } else {
          console.error('[requirePlatformLogin] No set-cookie header after refresh:', refreshResponse.headers);
          if (isApiRequest(req)) {
            return res.status(401).json({ error: 'Unauthorized: no set-cookie after refresh', details: refreshResponse.headers });
          } else {
            const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
            const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
            return res.redirect(platformLoginUrl);
          }
        }
      } catch (refreshError) {
        console.error('[requirePlatformLogin] Exception during refresh:', refreshError?.response?.data || refreshError.message, refreshError.stack);
        clearAuthCookies(res);
        if (isApiRequest(req)) {
          return res.status(401).json({ error: 'Unauthorized: refresh exception', details: refreshError?.response?.data || refreshError.message });
        } else {
          const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
          const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
          return res.redirect(platformLoginUrl);
        }
      }
    }

    // 3. If still no token, return 401 for API, redirect for browser
    if (!token) {
      if (isApiRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized: no token' });
      } else {
        const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
        return res.redirect(platformLoginUrl);
      }
    }

    // 4. Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      // If expired and refresh token, try refresh
      if (jwtError.name === 'TokenExpiredError' && req.cookies?.refreshToken) {
        try {
          const refreshResponse = await axios.post(
            `${PLATFORM_API_BASE_URL}/auth/refresh`,
            {},
            {
              headers: buildPlatformRefreshHeaders(req),
              withCredentials: true
            }
          );
          const setCookieHeader = refreshResponse.headers['set-cookie'];
          if (setCookieHeader) {
            const newToken = applyPlatformRefreshedAuthCookies(res, setCookieHeader);
            if (newToken) {
              decoded = jwt.verify(newToken, process.env.JWT_SECRET);
              token = newToken;
            } else {
              throw new Error('No access token in Platform refresh response');
            }
          }
        } catch (refreshError) {
          clearAuthCookies(res);
          if (isApiRequest(req)) {
            return res.status(401).json({ error: 'Unauthorized: refresh failed' });
          } else {
            const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
            const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
            return res.redirect(platformLoginUrl);
          }
        }
      } else {
        // Invalid token, return 401 for API, redirect for browser
        if (isApiRequest(req)) {
          return res.status(401).json({ error: 'Unauthorized: invalid token' });
        } else {
          const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
          const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
          return res.redirect(platformLoginUrl);
        }
      }
    }

    // 5. Get user info from platform
    const platformCacheKey = `${decoded.userId}:${decoded.email || ''}`;
    const cachedPlatformUser = getCacheValue(platformUserCache, platformCacheKey);

    if (cachedPlatformUser) {
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        ...cachedPlatformUser
      };
    } else {
      try {
        const response = await axios.get(`${process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api'}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          timeout: 8000
        });

        const userPayload = response.data || {};
        setCacheValue(platformUserCache, platformCacheKey, userPayload);
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          ...userPayload
        };
      } catch {
        req.user = {
          id: decoded.userId,
          email: decoded.email
        };
      }
    }

    // Attach LinkedIn access token and URN if user is authenticated
    if (req.user && req.user.id && shouldAttachLinkedinAuth(req)) {
      try {
        const linkedinCacheKey = req.user.id;
        const cachedLinkedinAuth = getCacheValue(linkedinAuthCache, linkedinCacheKey);
        let linkedinAuth = cachedLinkedinAuth;

        if (!linkedinAuth) {
          const { rows: socialRows } = await pool.query(
            `SELECT access_token, account_id, metadata
             FROM social_connected_accounts
             WHERE user_id::text = $1::text
               AND team_id IS NULL
               AND platform = 'linkedin'
               AND is_active = true
             ORDER BY updated_at DESC NULLS LAST, id DESC
             LIMIT 1`,
            [req.user.id]
          );

          if (socialRows[0]) {
            linkedinAuth = {
              access_token: socialRows[0].access_token,
              linkedin_user_id: resolveSocialLinkedinUserId(socialRows[0]),
            };
            setCacheValue(linkedinAuthCache, linkedinCacheKey, linkedinAuth);
          }
        }

        if (!linkedinAuth) {
          const { rows } = await pool.query(
            `SELECT access_token, linkedin_user_id FROM linkedin_auth WHERE user_id = $1`,
            [req.user.id]
          );
          linkedinAuth = rows[0] || null;
          setCacheValue(linkedinAuthCache, linkedinCacheKey, linkedinAuth);
        }

        if (linkedinAuth?.access_token && linkedinAuth?.linkedin_user_id) {
          req.user.linkedinAccessToken = linkedinAuth.access_token;
          req.user.linkedinUrn = `urn:li:person:${linkedinAuth.linkedin_user_id}`;
          req.user.linkedinUserId = linkedinAuth.linkedin_user_id;
        }
      } catch (err) {
        console.error('[requirePlatformLogin] Failed to fetch LinkedIn token/URN:', err);
      }
    }
    next();
  } catch (error) {
    if (isApiRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized: exception' });
    } else {
      const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
      const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
      return res.redirect(platformLoginUrl);
    }
  }
}
