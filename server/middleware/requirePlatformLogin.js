
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS || 30000);
const platformUserCache = new Map();
const linkedinAuthCache = new Map();

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

export async function requirePlatformLogin(req, res, next) {
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
          `${process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api'}/auth/refresh`,
          {},
          {
            headers: {
              'Cookie': `refreshToken=${req.cookies.refreshToken}`
            },
            withCredentials: true
          }
        );
        if (refreshResponse.status !== 200) {
          console.error('[requirePlatformLogin] Refresh failed, status:', refreshResponse.status, refreshResponse.data);
          // Clear refreshToken cookie to prevent infinite loop
          res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none',
            domain: process.env.COOKIE_DOMAIN || '.suitegenie.in'
          });
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
          const accessTokenCookie = setCookieHeader.find(cookie => cookie.startsWith('accessToken='));
          if (accessTokenCookie) {
            const newToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
            res.cookie('accessToken', newToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'none', // must be 'none' for cross-domain
              domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
              maxAge: 15 * 60 * 1000
            });
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
        // Clear refreshToken cookie to prevent infinite loop
        res.clearCookie('refreshToken', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'none',
          domain: process.env.COOKIE_DOMAIN || '.suitegenie.in'
        });
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
            `${process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api'}/auth/refresh`,
            {},
            {
              headers: {
                'Cookie': `refreshToken=${req.cookies.refreshToken}`
              },
              withCredentials: true
            }
          );
          const setCookieHeader = refreshResponse.headers['set-cookie'];
          if (setCookieHeader) {
            const accessTokenCookie = setCookieHeader.find(cookie => cookie.startsWith('accessToken='));
            if (accessTokenCookie) {
              const newToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
              res.cookie('accessToken', newToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'none',
                domain: process.env.COOKIE_DOMAIN || '.suitegenie.in',
                maxAge: 15 * 60 * 1000
              });
              decoded = jwt.verify(newToken, process.env.JWT_SECRET);
              token = newToken;
            }
          }
        } catch (refreshError) {
          // Clear refreshToken cookie to prevent infinite loop
          res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none',
            domain: process.env.COOKIE_DOMAIN || '.suitegenie.in'
          });
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
    if (req.user && req.user.id) {
      try {
        const linkedinCacheKey = req.user.id;
        const cachedLinkedinAuth = getCacheValue(linkedinAuthCache, linkedinCacheKey);
        let linkedinAuth = cachedLinkedinAuth;

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
