# LinkedIn Genie Support Playbook

This file contains user-facing explanations and support responses for the current Strategy Builder context.

## What Changed (User-Facing)
- Strategy Builder UI is now simplified for first-time users:
  - compact step pills instead of large cards
  - a single **Next best step** CTA that drives the user through setup -> review -> prompts -> content plan.
- Strategy Builder now supports LinkedIn profile PDF upload.
- PDF extraction is Gemini-first and context-aware.
- Extraction uses recent LinkedIn posts plus known profile context to improve accuracy.
- API can return extraction source: `gemini` or `local_fallback`.
- Strategy generation now requests strict JSON schema from Gemini to reduce truncated/invalid output.
- Niche derivation now rejects junk phrases like pronoun/focus artifacts and prefers signal from topics.
- LinkedIn API version retry is enabled by default in strategy snapshot fetches to reduce `me.GET.NO_VERSION`.
- Strategy Builder now includes a **Content Plan** tab with 2 high-quality publish-ready posts generated automatically after Prompt Pack generation.
- Content Plan can also be generated directly from the **Content Plan** tab via a dedicated generate button.
- Content Plan queue is strategy-scoped (bound to `content_plan_run_id`) and supports approve/reject/schedule actions.
- Content Plan can send a queue item directly to Compose via `composerDraftContent` (prefills editor content directly).
- Prompt Pack is now quality-first for LinkedIn: target is 12 prompts (bounded strategy target range 11-14).
- Prompt usage is now tracked when a prompt is opened in Compose (`mark-used`), and strategy metadata stores usage snapshots.
- Content Plan-generated prompts are now marked as used in DB and persisted in strategy metadata (`content_plan_prompt_ids`), so refresh still shows used ticks.
- Prompt refresh recommendations are now usage-aware:
  - `partial` recommendation when prompt usage crosses refill threshold.
  - `full` recommendation when prompt usage is high and pack should be fully regenerated.
- Strategy Builder now includes a **Context Vault** tab (strategy-scoped persistent memory snapshot).
- Context Vault stores compact signals from:
  - LinkedIn posts/performance
  - LinkedIn profile context + uploaded PDF discoveries
  - Portfolio discoveries
  - Prompt usage + content plan usage state
- Context Vault now also learns from queue review outcomes and analytics:
  - approval/rejection/schedule/posted counts
  - top rejection reasons
  - queue-to-post analytics coverage and best/weak topics
- Context Vault auto-refreshes after major generation flows:
  - `init-analysis`
  - `generate-analysis-prompts`
  - `generate-prompts`
  - `content-plan/generate`
  - `upload-linkedin-profile-pdf`
- Context Vault now auto-refreshes after Content Plan queue review actions:
  - approve
  - reject
  - schedule
- Compose now normalizes incoming plain text to editor-safe HTML to avoid visual cut-off/truncation when prompts contain symbols like `<` `>` or multiline content.
- AI generation in Compose now uses the exact typed prompt value (no stale state lag), and provider output token limits were increased to reduce mid-sentence cut-offs.

## What Users Should Know
- If LinkedIn API blocks personal profile fields (`403 ACCESS_DENIED`, `me.GET.NO_VERSION`), PDF upload is the fallback.
- Best results require a text-selectable PDF (not scanned image-only PDF).
- PDF size limit is 8MB.
- Users can continue strategy flow even if extraction is partial.
- If a niche looks wrong, users can click `Edit` in Step 1 and select a better niche; backend now avoids persisting stale/junk niche text on re-run.
- Content Plan generation does not consume additional credits beyond analysis + prompt generation.
- If Prompt Pack generation succeeds but Content Plan fails, the user still receives prompts and sees a warning (partial success).
- Prompt library can be refreshed based on usage signals even when strategy fields are unchanged.

## API Notes (Current)
- `POST /api/strategy/generate-analysis-prompts`
  - Still returns prompt payload.
  - Now also returns:
    - `contentPlan.runId`
    - `contentPlan.queueCount`
    - `contentPlan.status`
    - `contentPlan.warning` (optional)
- `GET /api/strategy/:id/content-plan`
  - Returns strategy-scoped queue and compact context card:
    - `runId`, `generatedAt`, `status`, `warning`, `queueCount`
    - `context` (niche, audience, tone, top topics, about/skills/experience previews, source badges)
    - `queue` (items tied to content plan run ID)
- `POST /api/strategy/:id/content-plan/generate`
  - Generates/regenerates a strategy-scoped content plan queue (quality-first fixed queue target).
  - Uses latest strategy analysis context and saves:
    - `content_plan_run_id`
    - `content_plan_generated_at`
    - `content_plan_queue_count`
    - `content_plan_status`
    - `content_plan_prompt_ids`
    - `content_plan_prompt_used_at`
- `POST /api/strategy/prompts/:promptId/mark-used`
  - Marks one prompt usage event for the current user.
  - Updates prompt `usage_count` and `last_used_at`.
  - Updates strategy metadata with:
    - `prompts_last_used_at`
    - `prompts_refresh_recommendation` (`partial` or `full`)
    - `prompts_usage_snapshot` (used/unused counts, thresholds, updated_at)
- `GET /api/strategy/:id/context-vault`
  - Returns strategy-scoped context vault snapshot.
  - Query param `refresh=true` forces rebuild before return.
- `POST /api/strategy/:id/context-vault/refresh`
  - Force-refreshes strategy-scoped context vault snapshot.
  - Optional body: `{ reason: string }`
- `POST /api/strategy/:id/context-vault/apply`
  - Applies vault insights (winning topics) to strategy topics.
  - Marks prompts as stale (`prompts_stale=true`) so user can regenerate prompt pack with fresh signals.
- `PATCH /api/automation-linkedin/queue/:id`
  - Supports `approve`, `reject`, `schedule`.
  - Now triggers strategy-scoped Context Vault refresh when queue item maps to a strategy run.
  - Response includes optional `contextVaultRefresh` payload when refresh succeeds.

## Copy-Paste Support Replies

### 1) PDF worked
Your LinkedIn profile PDF was processed successfully. We extracted your profile signals and included them in Strategy Builder. You can proceed with analysis and confirm/edit the suggested niche, audience, and topics.

### 2) Gemini failed, local fallback used
We could not parse structured output from Gemini for this upload, so we used a local fallback parser. If the extracted text looks noisy, please upload a clearer text-selectable PDF export.

### 3) Extraction unreadable
We received your PDF, but it does not contain reliably readable text for profile extraction. Please upload a text-selectable PDF export from your LinkedIn profile and retry.

### 4) LinkedIn API permission issue
Your LinkedIn connection is active, but LinkedIn denied access to deep personal profile fields for this token/app scope (`ACCESS_DENIED`). This is a LinkedIn permission limitation. Use the PDF upload fallback to continue.

### 5) Strategy output fell back to template queue
If AI returns malformed or truncated JSON, the system uses a safe fallback queue so the flow can continue. We now enforce strict JSON schema and multi-part parsing to reduce this scenario.

### 6) Prompt Pack worked but Content Plan warning shown
Prompt generation completed successfully, and your Prompt Pack is ready to use. We also tried generating your Content Plan (publish-ready queue), but that step returned a warning. You can continue using Prompt Pack immediately, then retry Content Plan from the Content Plan tab.

### 7) Use in Compose expected behavior
When you click **Use in Compose** from Content Plan, the selected post is inserted directly into the Compose editor content (not as an AI prompt). You can post or schedule it immediately.

### 8) Compose appears to cut off generated text
This is now handled by converting incoming AI/plain text into safe editor HTML before rendering. If you still see truncation:
- refresh once to load the latest frontend build,
- confirm character counter (3000 LinkedIn publish limit),
- check whether content includes raw HTML-like fragments copied from external tools.

### 9) Why does Prompt Pack ask me to regenerate?
Prompt refresh recommendations are now usage-driven. If you used several prompts, the app may suggest:
- partial refresh: top-up soon for fresher angles,
- full refresh: most prompts consumed, regenerate before next sprint.
This improves quality without forcing unnecessary regeneration.

### 10) What is Context Vault?
Context Vault is the strategy memory layer. It combines your profile data, post performance, and usage signals into one compact snapshot so prompt/content generation can adapt to what is actually working.

### 11) What does "Apply Winning Topics" do?
It merges top-performing vault topics into strategy topics and marks prompts stale for refresh. This is the performance feedback loop from analytics -> vault -> strategy -> better prompt pack/content plan.

### 12) What does "Sync Analytics + Refresh" do?
It runs analytics sync first, then rebuilds Context Vault so latest performance is reflected immediately in recommendations and topic signals.

### 13) Why do I see "Used in Content Plan" on prompts?
When Content Plan is generated, the backend marks the prompts it used in DB and stores those IDs in strategy metadata. So after refresh, Prompt Pack still shows the usage tick/badge.

### 14) How does Context Vault learn from my approvals/rejections?
Each Content Plan review action updates queue status, then Vault refreshes for that strategy. Vault tracks rejection reasons, approval rates, and posted-queue performance signals so recommendations become less generic over time.

## Internal Triage Steps
1. Check backend logs for:
- `[Strategy] linkedin profile pdf uploaded`
- `extractionSource`
- `aiError`
- `aiNormalizationPassUsed`
2. For Content Plan issues, also check:
- `[Strategy] content plan generation warning`
- strategy metadata keys: `content_plan_run_id`, `content_plan_generated_at`, `content_plan_queue_count`, `content_plan_status`
- `GET /api/strategy/:id/content-plan` response shape
3. Confirm UI card shows extraction source and warning.
4. If `local_fallback` with noisy text, ask user for a text-selectable PDF.
5. If repeated Gemini parse failures, capture `Gemini PDF raw parts count` log and escalate with sample payload metadata (no raw private content).
6. For queue review learning checks:
- verify `PATCH /api/automation-linkedin/queue/:id` response contains `contextVaultRefresh` (when queue item has strategy-linked run).
- verify `GET /api/strategy/:id/context-vault` includes:
  - `snapshot.feedback.reviews`
  - `snapshot.feedback.analyticsLearning`
  - updated `snapshot.recommendations.reasons`.

## Data Notes
- Extracted fields can be saved into strategy metadata and automation profile context.
- Fields include `linkedin_about`, `linkedin_skills`, `linkedin_experience`, plus PDF extraction metadata.
