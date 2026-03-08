# LinkedIn Genie Frontend

React frontend for LinkedIn Genie.

## Main Features
- Compose, schedule, and manage LinkedIn posts
- LinkedIn analytics dashboard
- Strategy Builder with guided confirmation flow
- Strategy Builder simplified navigation with compact step pills + "Next best step" CTA
- Optional reference-account deepening
- PDF upload fallback for profile enrichment
- Context Vault tab (strategy memory + source health + usage insights)

Related technical map:
- `../docs/STRATEGY_BUILDER_REFERENCE.md`

## Strategy Builder UX Notes
In the welcome step users can provide:
- Portfolio URL (optional)
- Extra context (optional)
- LinkedIn profile PDF (optional)

The analysis flow now surfaces stronger backend-derived profile context:
- Cleaner niche suggestions (junk phrase artifacts filtered server-side)
- More stable strategy generation results when AI JSON output is valid
- Existing fallback behavior remains when provider output is malformed

After PDF upload, UI displays:
- About/skills/experience discovery status
- Preview snippets (when available)
- Extraction warning (if low confidence)
- Extraction source (`gemini` or `local_fallback`)

Context Vault tab displays:
- Last snapshot refresh time and snapshot size
- Source health (posts/portfolio/profile-PDF/reference)
- Prompt/content-plan usage state
- Winning topics, underused topics, and voice-pattern discoveries
- Learning loop signals from review + analytics:
  - queue approval/rejection trends
  - top rejection reasons
  - posted queue analytics coverage and best topics

## User-Facing Warning Behavior
The UI surfaces backend warning text directly, including cases like:
- Gemini extraction failure
- Local fallback usage
- Unreadable/non-text-selectable PDF guidance

## Setup
1. Install:
```sh
npm install
```
2. Configure `.env` (API URL + platform URL).
3. Start dev server:
```sh
npm run dev
```

## Build
```sh
npm run build
```

## Notes for Support Team
If users report wrong niche/profile context:
- Ask for screenshot of Strategy Builder welcome card after PDF upload.
- Confirm extraction source in the card.
- Ask user to retry with a text-selectable PDF export.
- Check backend log block: `[Strategy] linkedin profile pdf uploaded`.
- If users report stale recommendations after approving/rejecting queue items:
  - verify queue action succeeded
  - reload Context Vault tab and check Learning Loop section
  - confirm backend returned `contextVaultRefresh` in queue action response.
