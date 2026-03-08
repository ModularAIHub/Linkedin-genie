# Strategy Builder Technical Reference

Last updated: 2026-03-08

## Scope
This document maps Strategy Builder, Content Plan, and Context Vault behavior to concrete files for faster maintenance.

## Frontend File Map
- Strategy Builder shell and step navigation:
  - `client/src/pages/StrategyBuilder/index.jsx`
- Setup form:
  - `client/src/pages/StrategyBuilder/StrategySetupForm.jsx`
- Analysis flow:
  - `client/src/pages/StrategyBuilder/AnalysisFlow.jsx`
- Review tab:
  - `client/src/pages/StrategyBuilder/StrategyOverview.jsx`
- Prompt Pack tab:
  - `client/src/pages/StrategyBuilder/PromptLibrary.jsx`
- Content Plan tab:
  - `client/src/pages/StrategyBuilder/AutomationFlow.jsx`
  - `client/src/pages/StrategyBuilder/contentPlan/ContentPlanContextCard.jsx`
  - `client/src/pages/StrategyBuilder/contentPlan/ContentPlanQueueSection.jsx`
  - `client/src/pages/StrategyBuilder/contentPlan/contentPlanUtils.js`
- Context Vault tab:
  - `client/src/pages/StrategyBuilder/ContextVault.jsx`
- Strategy constants/view metadata:
  - `client/src/pages/StrategyBuilder/strategyBuilderConfig.js`
- Strategy and automation API bindings:
  - `client/src/utils/api.js`

## Backend File Map
- Strategy Builder routes (analysis, prompt pack, content plan, context vault):
  - `server/routes/strategyBuilder.js`
- Automation queue actions (approve/reject/schedule) and queue-action vault refresh:
  - `server/controllers/automationController.js`
- Analytics sync and vault refresh-on-sync:
  - `server/controllers/analyticsController.js`
- Strategy CRUD/prompts/usage metadata:
  - `server/services/strategyService.js`
- Content generation pipeline, fallback queue logic, signal filtering:
  - `server/services/linkedinAutomationService.js`
- Context Vault aggregation and recommendation logic:
  - `server/services/contextVaultService.js`
- PDF extraction and normalization:
  - `server/services/aiService.js`

## Database/Migrations
- Context Vault storage:
  - `server/migrations/20260308_create_linkedin_context_vault.sql`
- User preferences (selected account memory):
  - `server/migrations/20260308_create_linkedin_user_preferences.sql`
- Automation runs and queue:
  - `server/migrations/20260306_create_linkedin_automation_tables.sql`

## Primary APIs
- `POST /api/strategy/generate-analysis-prompts`
  - Generates prompt pack and attempts content plan generation.
- `POST /api/strategy/:id/content-plan/generate`
  - Regenerates content plan queue for one strategy.
- `GET /api/strategy/:id/content-plan`
  - Returns strategy-scoped queue + compact context.
- `GET /api/strategy/:id/context-vault`
  - Returns context vault snapshot.
- `POST /api/strategy/:id/context-vault/refresh`
  - Forces snapshot recompute.
- `POST /api/strategy/:id/context-vault/apply`
  - Applies winning topics from vault to strategy.
- `PATCH /api/automation-linkedin/queue/:id`
  - Queue actions (`approve`, `reject`, `schedule`) and context-vault refresh feedback.

## Current Learning Loop
1. User reviews content queue (`approve` / `reject` / `schedule`).
2. Queue action refreshes strategy-scoped context vault.
3. Analytics sync refreshes vault again with latest performance.
4. Vault recommendations feed prompt/content regeneration decisions.

## Related Docs
- `README.md`
- `server/README.md`
- `client/README.md`
- `SUPPORT.md`
