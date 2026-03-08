# LinkedIn Genie

LinkedIn Genie is the LinkedIn-focused product in SuiteGenie. It includes post creation, scheduling, analytics, and Strategy Builder with profile/context enrichment.

## Project Structure
- `server/`: Node.js backend (auth, posting, scheduling, analytics, strategy APIs)
- `client/`: React frontend (composer, analytics UI, strategy workflow)

## Current Strategy Builder Flow
Strategy analysis combines:
- Recent LinkedIn post history
- Connected account snapshot (name, followers, headline, etc.)
- Optional portfolio URL metadata
- Optional user-entered context
- Optional uploaded LinkedIn profile PDF
- Context Vault (strategy-scoped persisted signal snapshot)

Recent reliability improvements:
- Strategy AI now requests strict JSON schema from Gemini to reduce malformed/truncated responses.
- Niche derivation filters junk phrase artifacts (for example pronoun/focus fragments) before saving.
- LinkedIn strategy snapshot calls now retry with rolling `LinkedIn-Version` headers by default.
- Prompt Pack is quality-first for LinkedIn (`~12` prompts, bounded `11-14`) with usage-aware regenerate hints.
- Context Vault auto-refreshes after analysis/prompt/content-plan/PDF flows and stores compact performance + usage state.

## LinkedIn Profile PDF Extraction
When a user uploads a profile PDF in Strategy Builder:
- Backend first sends PDF plus known context plus recent posts to Gemini for structured extraction.
- Expected fields: `about`, `skills`, `experience`, `confidence`, `notes`.
- If Gemini fails, backend can fall back to local extraction heuristics.
- Response includes `discoveries.extractionSource` (`gemini` or `local_fallback`) and warnings when extraction quality is low.

## Known LinkedIn API Limitation
Some tokens/apps cannot read full personal profile fields from LinkedIn API and return:
- `403 ACCESS_DENIED`
- `me.GET.NO_VERSION`

Because of this, PDF upload exists as fallback for personal `about/skills/experience` enrichment.

## Local Setup
1. Install dependencies:
```sh
npm install
```
2. Configure environment variables:
- Root and server vars in `.env`
- See `server/env.example`
3. Run required migrations (at minimum):
- `server/migrations/20250919_create_linkedin_posts_table.sql`
4. Start apps:
```sh
# backend
npm --prefix server run dev

# frontend
npm --prefix client run dev
```

## Docs and Support
- Backend details: `server/README.md`
- Frontend details: `client/README.md`
- Strategy Builder technical file map: `docs/STRATEGY_BUILDER_REFERENCE.md`
- CORS and cookie setup: `server/CORS_COOKIE_GUIDE.md`
- User/support playbook: `SUPPORT.md`
