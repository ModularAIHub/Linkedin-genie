# LinkedIn Genie

This is a placeholder README for the LinkedIn Genie module. The codebase will mirror Tweet Genie, adapted for LinkedIn's API and features.

## Structure
- `server/` — Node.js backend for LinkedIn Genie (OAuth, scheduling, posting, analytics)
- `client/` — React frontend for composing, scheduling, and viewing LinkedIn posts

## Setup
- Copy structure and logic from Tweet Genie
- Replace Twitter-specific logic with LinkedIn API integration
- Enforce platform login for access

## Environment Variables

See `server/env.example` for all required LinkedIn API and database environment variables. Update your `.env` file accordingly.

## Database Migration

Run the migration in `server/migrations/20250919_create_linkedin_posts_table.sql` to create the `linkedin_posts` table with all LinkedIn-specific fields.

## Analytics

Analytics dashboard and backend logic are adapted for LinkedIn metrics (views, shares, likes, comments, etc.).

## Testing

- Test all frontend and backend endpoints for LinkedIn post creation, scheduling, analytics, and error handling.
- Validate LinkedIn OAuth 2.0 integration and company page posting.
- Ensure all environment variables are set and database is migrated.

---

For more details, see the Tweet Genie documentation and adapt for LinkedIn as needed.

## Work in progress.