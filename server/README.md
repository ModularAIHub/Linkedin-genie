# LinkedIn Genie Backend

This is the Node.js backend for LinkedIn Genie.

## Features
- LinkedIn OAuth 2.0 authentication
- Post creation (text, image, video, document, carousel)
- Company page and personal profile support
- Scheduling and automation
- Analytics dashboard (views, likes, comments, shares)
- AI-powered content and image generation
- Webhook and rate limit handling

## Setup
1. Install dependencies:
   ```sh
   npm install
   ```
2. Configure environment variables in `.env` (see `env.example`)
3. Run database migration in `migrations/20250919_create_linkedin_posts_table.sql`
4. Start the backend server:
   ```sh
   npm start
   ```

## Notes
- All Twitter logic has been replaced with LinkedIn API integration.
- For frontend, see the `../client/` directory.
