# LinkedIn Genie Backend CORS & Cookie Guide

- CORS is enabled for:
  - http://localhost:5175 (LinkedIn Genie frontend)
  - http://localhost:5173 (Platform frontend)
  - http://localhost:5174 (Tweet Genie frontend)
- Credentials (cookies) are allowed cross-domain.
- Axios in the frontend uses `withCredentials: true`.
- Backend uses `cookie-parser` and checks cookies in `requirePlatformLogin`.

No further action is needed for cross-domain or cookie support. If deploying, update allowedOrigins in `middleware/cors.js`.
