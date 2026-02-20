import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { requirePlatformLogin } from '../middleware/requirePlatformLogin.js';
import { resolveRequestPlanType } from '../middleware/planAccess.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookieUtils.js';

const router = express.Router();

// Handle auth callback from platform - sets httpOnly cookie (GET method for redirects)
router.get('/callback', async (req, res) => {
  try {
    const { token, refreshToken, session, redirect } = req.query;
    let finalToken = token;
    let finalRefreshToken = refreshToken;
    if (session) {
      try {
        const decoded = jwt.verify(session, process.env.JWT_SECRET);
        if (decoded.type === 'session') {
          finalToken = decoded.accessToken;
          finalRefreshToken = decoded.refreshToken;
        } else {
          throw new Error('Invalid session token type');
        }
      } catch (error) {
        const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
        return res.redirect(`${platformUrl}/login?error=invalid_session`);
      }
    }
    if (!finalToken) {
      const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
      return res.redirect(`${platformUrl}/login`);
    }
    setAuthCookies(res, finalToken, finalRefreshToken);
    const finalRedirectUrl = redirect || '/dashboard';
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5175';
    const redirectTo = `${clientUrl}${finalRedirectUrl}`;
    res.redirect(redirectTo);
  } catch (error) {
    const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
    res.redirect(`${platformUrl}/login?error=callback_failed`);
  }
});

// Validate authentication and attempt refresh if needed
router.get('/validate', requirePlatformLogin, async (req, res) => {
  if (!req.user || !req.user.id) {
    console.error('[auth/validate] Missing or invalid user object:', req.user);
    return res.status(401).json({ success: false, error: 'User not authenticated', user: null });
  }

  const resolvedPlanType = await resolveRequestPlanType(req);
  const baseUser =
    req.user?.user && typeof req.user.user === 'object'
      ? { ...req.user.user }
      : { ...(req.user || {}) };

  const normalizedUser = {
    ...baseUser,
    id: baseUser.id || req.user?.id || null,
    userId: baseUser.userId || req.user?.userId || req.user?.id || null,
    email: baseUser.email || req.user?.email || null,
    name: baseUser.name || req.user?.name || '',
    plan_type: resolvedPlanType,
    planType: resolvedPlanType,
  };

  res.json({
    success: true,
    user: normalizedUser
  });
});

// Refresh token endpoint for client-side token refresh
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }
    const refreshResponse = await axios.post(
      `${process.env.PLATFORM_URL || 'http://localhost:3000'}/api/auth/refresh`,
      {},
      {
        headers: {
          'Cookie': `refreshToken=${refreshToken}`
        },
        withCredentials: true
      }
    );
    const setCookieHeader = refreshResponse.headers['set-cookie'];
    if (setCookieHeader) {
      const accessTokenCookie = setCookieHeader.find(cookie => cookie.startsWith('accessToken='));
      const refreshTokenCookie = setCookieHeader.find(cookie => cookie.startsWith('refreshToken='));
      if (accessTokenCookie) {
        const newAccessToken = accessTokenCookie.split('accessToken=')[1].split(';')[0];
        setAuthCookies(res, newAccessToken, refreshTokenCookie ? refreshTokenCookie.split('refreshToken=')[1].split(';')[0] : undefined);
        return res.json({ success: true, message: 'Token refreshed' });
      } else {
        throw new Error('No access token in Platform response');
      }
    } else {
      throw new Error('No cookies in Platform response');
    }
  } catch (error) {
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

// Logout route - clears cookie
router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ success: true });
});

export default router;
