# LinkedIn Genie Backend CORS and Cookie Guide

## Allowed Origins (local)
- `http://localhost:5175` (LinkedIn Genie frontend)
- `http://localhost:5173` (platform frontend)
- `http://localhost:5174` (Tweet Genie frontend)

## Cookie/Credential Requirements
- Frontend API client uses `withCredentials: true`.
- Backend includes `cookie-parser` and validates platform auth cookies.
- Strategy Builder endpoints can rely on cookies for user auth and BYOK key lookup.

## Why This Matters for PDF + Gemini
`/api/strategy/upload-linkedin-profile-pdf` may use:
- access token cookie
- refresh token cookie
- optional Authorization header

These are used to resolve user AI key preference (platform vs BYOK) before calling Gemini.

## Deployment Checklist
- Update allowed origins in `middleware/cors.js`.
- Ensure `credentials: true` is preserved in CORS config.
- Ensure proxy/load balancer forwards cookies and auth headers.
- Verify SameSite/Secure cookie settings match environment (local vs prod HTTPS).
