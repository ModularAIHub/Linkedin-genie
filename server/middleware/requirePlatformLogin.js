
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';
import dotenv from 'dotenv';
dotenv.config();

export async function requirePlatformLogin(req, res, next) {
  // Helper: detect API/XHR request
  function isApiRequest(req) {
    const accept = req.headers['accept'] || '';
    const xrw = req.headers['x-requested-with'] || '';
    return accept.includes('application/json') || xrw === 'XMLHttpRequest' || req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/auth/');
  }

  try {
    console.log('[requirePlatformLogin] Incoming cookies:', req.cookies);
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
          `${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/refresh`,
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
            `${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/refresh`,
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
                sameSite: 'lax',
                maxAge: 15 * 60 * 1000
              });
              decoded = jwt.verify(newToken, process.env.JWT_SECRET);
              token = newToken;
            }
          }
        } catch (refreshError) {
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
    try {
      const response = await axios.get(`${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        ...response.data
      };
    } catch (platformError) {
      req.user = {
        id: decoded.userId,
        email: decoded.email
      };
    }

    // Attach LinkedIn access token and URN if user is authenticated
    if (req.user && req.user.id) {
      try {
        const { rows } = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_auth WHERE user_id = $1`,
          [req.user.id]
        );
        if (rows.length > 0) {
          req.user.linkedinAccessToken = rows[0].access_token;
          req.user.linkedinUrn = `urn:li:person:${rows[0].linkedin_user_id}`;
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
