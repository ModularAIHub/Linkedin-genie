
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { pool } from '../config/database.js';
import dotenv from 'dotenv';
dotenv.config();

export async function requirePlatformLogin(req, res, next) {
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
            token = newToken;
          }
        }
      } catch (refreshError) {
        // If refresh fails, redirect to platform login
        const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
        return res.redirect(platformLoginUrl);
      }
    }

    // 3. If still no token, redirect to login
    if (!token) {
      const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
      const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
      return res.redirect(platformLoginUrl);
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
          const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
          const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
          return res.redirect(platformLoginUrl);
        }
      } else {
        // Invalid token, redirect to login
        const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
        const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
        return res.redirect(platformLoginUrl);
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
    const currentUrl = `${process.env.CLIENT_URL || 'http://localhost:5175'}${req.originalUrl}`;
    const platformLoginUrl = `${process.env.PLATFORM_URL || 'http://localhost:3000'}/login?redirect=${encodeURIComponent(currentUrl)}`;
    return res.redirect(platformLoginUrl);
  }
}
