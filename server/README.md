# LinkedIn Genie Backend

Node.js backend for LinkedIn Genie.

## Core Capabilities
- LinkedIn OAuth and account scope handling (personal/team/org)
- Post create/schedule/publish flows
- Analytics sync and reporting
- Strategy Builder analysis pipeline
- AI-assisted strategy and prompt generation
- Context Vault (strategy-scoped persisted context/performance memory)

Related technical map:
- `../docs/STRATEGY_BUILDER_REFERENCE.md`

## Strategy Builder Data Sources
`/api/strategy/init-analysis` and related flows can use:
- LinkedIn posts (`linkedin_posts`)
- Connected account snapshot (`social_connected_accounts`, fallback auth tables)
- Optional portfolio URL metadata
- Optional user context
- Optional LinkedIn profile PDF upload
- Prompt usage and content-plan usage state

## Strategy Reliability Notes (Mar 2026)
- Google strategy generation requests strict JSON schema and aggregates all returned text parts before parse.
- Strategy prompt content guidance is tuned to keep queue item size bounded and reduce truncation.
- Niche persistence avoids stale/junk values by clearing invalid derived role niche during init-analysis.
- LinkedIn API version fallback now defaults to rolling month retries, reducing `me.GET.NO_VERSION`.

## LinkedIn Profile PDF Upload API
Endpoint:
- `POST /api/strategy/upload-linkedin-profile-pdf`

Request fields:
- `strategyId` (required)
- `base64` (required, PDF bytes)
- `filename` (optional)
- `mimetype` (optional)

Behavior:
- Validates PDF signature and size (`<= 8MB`).
- Sends PDF to Gemini with profile context and recent post snippets.
- Attempts strict JSON extraction: `about`, `skills`, `experience`, `confidence`, `notes`.
- Falls back to local parser if Gemini extraction fails.
- Stores merged profile discoveries in strategy metadata and automation profile context.

## Context Vault APIs
Endpoints:
- `GET /api/strategy/:id/context-vault`
- `POST /api/strategy/:id/context-vault/refresh`
- `PATCH /api/automation-linkedin/queue/:id` (approve/reject/schedule) -> triggers vault refresh when queue item is strategy-linked

Behavior:
- Context Vault is strategy-scoped (`user_id + strategy_id`).
- Snapshot aggregates context from posts, profile metadata, portfolio, PDF discoveries, usage state, and queue review feedback.
- Auto-refresh runs after:
  - `init-analysis`
  - `generate-analysis-prompts`
  - `generate-prompts`
  - `content-plan/generate`
  - `upload-linkedin-profile-pdf`
  - `queue approve/reject/schedule` actions
- All `/api/automation/linkedin/*` endpoints are Pro-protected at backend middleware level (not just UI-gated).

Response fields:
- `success`
- `warning` (nullable, user-facing guidance)
- `discoveries.about`
- `discoveries.skills`
- `discoveries.experience`
- `discoveries.filename`
- `discoveries.textLength`
- `discoveries.extractionSource` (`gemini` or `local_fallback`)
- `feedback.reviews` (approval/rejection/posted signals + top rejection reasons)
- `feedback.analyticsLearning` (posted queue analytics coverage + best/weak queue topics)

## Cron Endpoints
Protected by `Authorization: Bearer <CRON_SECRET>`:
- `POST /api/cron/scheduler`
  - Runs the LinkedIn scheduler tick (publishing due scheduled posts).
- `POST /api/cron/daily-content-plan`
  - Generates daily content-plan queue items for eligible strategies.
  - Defaults: 1 strategy/user (latest active), `queueTarget=2`, skip if already generated today, skip if pending queue still >= target.
  - Eligibility is server-filtered to Pro plans (`pro`, `enterprise`, plus aliases `premium`, `business`) from user/team plan metadata.
  - Triggers ready-post email notifier tick after generation.
  - Controlled by env flag `LINKEDIN_DAILY_CONTENT_CRON_ENABLED` (default `true`).
  - Optional query/body params: `force`, `notify`, `userLimit`, `queueTarget`, `tickId`.

## Important Logs
Useful log tags for support/debug:
- `[Strategy] linkedin profile pdf uploaded`
- `[Strategy] Gemini PDF extraction failed, falling back to local parser`
- `[AI Service] Gemini PDF raw parts count:`
- `[Strategy] init-analysis request`
- `[StrategyAnalysis] ...`

## Known Platform Constraint
LinkedIn personal profile endpoint may return:
- `403 ACCESS_DENIED`
- `me.GET.NO_VERSION`

This is a LinkedIn permission/scope limitation, not an app crash. PDF upload exists to bridge this gap.

## Setup
1. Install:
```sh
npm install
```
2. Configure `.env` using `env.example`.
3. Run migrations (minimum):
- `migrations/20250919_create_linkedin_posts_table.sql`
4. Start API:
```sh
npm run dev
```

## Troubleshooting Quick Checks
- If PDF extraction is noisy, confirm PDF is text-selectable and not image-only scan.
- If extraction source is `local_fallback`, inspect Gemini error field in logs.
- If strategy confidence is low, user likely has very few posts and/or no competitors configured.
- If `portfolio_url` fails, validate URL format (protocol + valid host).
