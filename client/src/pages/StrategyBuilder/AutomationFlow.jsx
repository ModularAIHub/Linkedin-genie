import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  XCircle,
} from 'lucide-react';
import { automationLinkedin } from '../../utils/api';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  needs_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  scheduled: 'bg-blue-100 text-blue-800',
  posted: 'bg-green-100 text-green-800',
  rejected: 'bg-rose-100 text-rose-800',
};

const DEFAULT_QUEUE_TARGET = 7;

const getBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const buildDefaultScheduleTime = () => {
  const local = new Date();
  local.setDate(local.getDate() + 1);
  local.setHours(9, 0, 0, 0);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  const hours = String(local.getHours()).padStart(2, '0');
  const minutes = String(local.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const formatDateTime = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
};

const textToLines = (value) =>
  String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const linesToText = (items = []) => (Array.isArray(items) ? items.join('\n') : '');

export default function AutomationFlow({ strategy, onOpenPrompts }) {
  const [loading, setLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [savingCompetitors, setSavingCompetitors] = useState(false);
  const [runningAnalyze, setRunningAnalyze] = useState(false);
  const [runningDeepDive, setRunningDeepDive] = useState(false);
  const [queueItems, setQueueItems] = useState([]);
  const [queueStatusFilter, setQueueStatusFilter] = useState('');
  const [scheduleInputs, setScheduleInputs] = useState({});
  const [lastManualFetchAt, setLastManualFetchAt] = useState(null);
  const [consents, setConsents] = useState({
    consent_use_posts: false,
    consent_store_profile: false,
  });
  const [quickContext, setQuickContext] = useState({
    role_niche: '',
    target_audience: '',
    website_url: '',
    additional_context: '',
  });
  const [competitorConfig, setCompetitorConfig] = useState({
    competitor_profiles_text: '',
    competitor_examples_text: '',
    win_angle: 'authority',
  });

  const timezone = useMemo(() => getBrowserTimezone(), []);

  const loadQueue = useCallback(async (status = queueStatusFilter) => {
    try {
      setQueueLoading(true);
      const response = await automationLinkedin.getQueue(status ? { status } : undefined);
      const queue = Array.isArray(response?.data?.queue) ? response.data.queue : [];
      setQueueItems(queue);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Failed to load automation queue');
    } finally {
      setQueueLoading(false);
    }
  }, [queueStatusFilter]);

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true);
      const [profileRes, queueRes] = await Promise.all([
        automationLinkedin.getProfileContext(),
        automationLinkedin.getQueue(),
      ]);
      const profile = profileRes?.data?.profileContext || {};
      const competitors = profileRes?.data?.competitors || {};
      const metadata = profile?.metadata && typeof profile.metadata === 'object' ? profile.metadata : {};

      setConsents({
        consent_use_posts: Boolean(profile?.consent_use_posts),
        consent_store_profile: Boolean(profile?.consent_store_profile),
      });
      setQuickContext({
        role_niche: profile?.role_niche || strategy?.niche || '',
        target_audience: profile?.target_audience || strategy?.target_audience || '',
        website_url: metadata.website_url || '',
        additional_context: metadata.additional_context || profile?.proof_points || '',
      });
      setCompetitorConfig({
        competitor_profiles_text: linesToText(competitors?.competitor_profiles),
        competitor_examples_text: linesToText(competitors?.competitor_examples),
        win_angle: competitors?.win_angle || 'authority',
      });
      setLastManualFetchAt(profile?.last_manual_fetch_at || null);

      const queue = Array.isArray(queueRes?.data?.queue) ? queueRes.data.queue : [];
      setQueueItems(queue);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Failed to load strategy automation');
    } finally {
      setLoading(false);
      setQueueLoading(false);
    }
  }, [strategy?.niche, strategy?.target_audience]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const updateScheduleInput = (queueId, key, value) => {
    setScheduleInputs((current) => ({
      ...current,
      [queueId]: {
        scheduled_time: current[queueId]?.scheduled_time || buildDefaultScheduleTime(),
        timezone: current[queueId]?.timezone || timezone,
        ...current[queueId],
        [key]: value,
      },
    }));
  };

  const persistProfileContext = async () => {
    const payload = {
      role_niche: String(quickContext.role_niche || strategy?.niche || '').trim(),
      target_audience: String(quickContext.target_audience || strategy?.target_audience || '').trim(),
      proof_points: String(quickContext.additional_context || '').trim(),
      consent_use_posts: consents.consent_use_posts,
      consent_store_profile: consents.consent_store_profile,
      metadata: {
        website_url: String(quickContext.website_url || '').trim(),
        additional_context: String(quickContext.additional_context || '').trim(),
        strategy_id: strategy?.id || null,
      },
    };

    const response = await automationLinkedin.saveProfileContext(payload);
    const profile = response?.data?.profileContext || null;
    if (profile) {
      setLastManualFetchAt(profile.last_manual_fetch_at || null);
    }
    return profile;
  };

  const persistCompetitors = async () => {
    const payload = {
      competitor_profiles: textToLines(competitorConfig.competitor_profiles_text),
      competitor_examples: textToLines(competitorConfig.competitor_examples_text),
      win_angle: competitorConfig.win_angle || 'authority',
    };
    const response = await automationLinkedin.saveCompetitors(payload);
    const competitors = response?.data?.competitors || payload;
    setCompetitorConfig((prev) => ({
      ...prev,
      competitor_profiles_text: linesToText(competitors.competitor_profiles),
      competitor_examples_text: linesToText(competitors.competitor_examples),
      win_angle: competitors.win_angle || 'authority',
    }));
  };

  const ensureRunConsent = () => {
    if (!consents.consent_use_posts || !consents.consent_store_profile) {
      toast.error('Enable both consent checkboxes before analysis.');
      return false;
    }
    return true;
  };

  const runPipeline = async () => {
    const response = await automationLinkedin.run({
      queueTarget: DEFAULT_QUEUE_TARGET,
      confirmed: true,
    });
    const generatedCount = Array.isArray(response?.data?.queue) ? response.data.queue.length : 0;
    await loadQueue(queueStatusFilter);
    return generatedCount;
  };

  const handleAnalyzeAccount = async () => {
    if (!ensureRunConsent()) return;

    try {
      setRunningAnalyze(true);
      await persistProfileContext();
      await automationLinkedin.fetchLatest({ confirmed: true });
      const generatedCount = await runPipeline();
      const profileRes = await automationLinkedin.getProfileContext();
      setLastManualFetchAt(profileRes?.data?.profileContext?.last_manual_fetch_at || null);
      toast.success(`Analysis done. Generated ${generatedCount} queue item(s).`);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Failed to analyze account and generate queue');
    } finally {
      setRunningAnalyze(false);
    }
  };

  const handleSaveCompetitors = async () => {
    try {
      setSavingCompetitors(true);
      await persistCompetitors();
      toast.success('Competitor deep-dive saved');
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Failed to save competitors');
    } finally {
      setSavingCompetitors(false);
    }
  };

  const handleDeepDiveRegenerate = async () => {
    if (!ensureRunConsent()) return;

    try {
      setRunningDeepDive(true);
      await persistProfileContext();
      await persistCompetitors();
      const generatedCount = await runPipeline();
      toast.success(`Deep-dive applied. Generated ${generatedCount} refreshed queue item(s).`);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Failed to regenerate queue');
    } finally {
      setRunningDeepDive(false);
    }
  };

  const handleQueueAction = async (itemId, action) => {
    try {
      if (action === 'reject') {
        const reason = window.prompt('Reason for rejection (optional):', '') || '';
        await automationLinkedin.patchQueueItem(itemId, { action, reason });
      } else if (action === 'schedule') {
        const scheduleState = scheduleInputs[itemId] || {
          scheduled_time: buildDefaultScheduleTime(),
          timezone,
        };
        await automationLinkedin.patchQueueItem(itemId, {
          action,
          scheduled_time: scheduleState.scheduled_time,
          timezone: scheduleState.timezone,
        });
      } else {
        await automationLinkedin.patchQueueItem(itemId, { action });
      }
      toast.success(`Queue item ${action}d`);
      await loadQueue(queueStatusFilter);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || `Failed to ${action} queue item`);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Loading strategy automation...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-cyan-50 p-6">
        <h2 className="text-2xl font-bold text-gray-900">Auto Analyze + Queue</h2>
        <p className="mt-2 text-sm text-gray-700">
          Works like Tweet Genie: fetch account insights, apply light context, then generate approval-ready LinkedIn queue.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">Step 1: Analyze account</h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">What do you do? (auto-filled from strategy)</span>
            <input
              type="text"
              value={quickContext.role_niche}
              onChange={(event) => setQuickContext((prev) => ({ ...prev, role_niche: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Founder helping B2B teams with LinkedIn growth"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Who are you trying to reach? (optional)</span>
            <input
              type="text"
              value={quickContext.target_audience}
              onChange={(event) => setQuickContext((prev) => ({ ...prev, target_audience: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Founders, marketers, or creators"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Website or portfolio (optional)</span>
            <input
              type="text"
              value={quickContext.website_url}
              onChange={(event) => setQuickContext((prev) => ({ ...prev, website_url: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="https://yoursite.com"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="text-sm font-medium text-gray-700">Anything else we should know? (optional)</span>
            <textarea
              rows={3}
              value={quickContext.additional_context}
              onChange={(event) => setQuickContext((prev) => ({ ...prev, additional_context: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Proof points, case studies, positioning, constraints, words to avoid..."
            />
          </label>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <label className="flex items-start gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={consents.consent_use_posts}
              onChange={(event) =>
                setConsents((prev) => ({ ...prev, consent_use_posts: event.target.checked }))
              }
              className="mt-1"
            />
            Use my stored LinkedIn posts/metrics for analysis
          </label>
          <label className="flex items-start gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={consents.consent_store_profile}
              onChange={(event) =>
                setConsents((prev) => ({ ...prev, consent_store_profile: event.target.checked }))
              }
              className="mt-1"
            />
            Store my profile context to improve generation
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={handleAnalyzeAccount}
            disabled={runningAnalyze}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${runningAnalyze ? 'animate-spin' : ''}`} />
            {runningAnalyze ? 'Analyzing...' : 'Analyze my account'}
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Last account fetch: {formatDateTime(lastManualFetchAt)}
        </p>
      </section>

      <details className="rounded-xl border border-gray-200 bg-white p-5">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-600" />
            <h3 className="text-lg font-semibold text-gray-900">Step 2 (Optional): Deep dive competitor mode</h3>
          </div>
        </summary>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Competitor profiles (1 per line, max 5)</span>
            <textarea
              value={competitorConfig.competitor_profiles_text}
              onChange={(event) =>
                setCompetitorConfig((prev) => ({ ...prev, competitor_profiles_text: event.target.value }))
              }
              rows={4}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="linkedin.com/in/example-1"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Optional benchmark links/text (1 per line)</span>
            <textarea
              value={competitorConfig.competitor_examples_text}
              onChange={(event) =>
                setCompetitorConfig((prev) => ({ ...prev, competitor_examples_text: event.target.value }))
              }
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block max-w-xs">
            <span className="text-sm font-medium text-gray-700">Win angle</span>
            <select
              value={competitorConfig.win_angle}
              onChange={(event) =>
                setCompetitorConfig((prev) => ({ ...prev, win_angle: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="authority">Authority</option>
              <option value="clarity">Clarity</option>
              <option value="originality">Originality</option>
              <option value="consistency">Consistency</option>
            </select>
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSaveCompetitors}
              disabled={savingCompetitors}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {savingCompetitors ? 'Saving...' : 'Save deep-dive setup'}
            </button>
            <button
              type="button"
              onClick={handleDeepDiveRegenerate}
              disabled={runningDeepDive}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60"
            >
              <Target className="h-4 w-4" />
              {runningDeepDive ? 'Regenerating...' : 'Regenerate queue with deep-dive'}
            </button>
          </div>
        </div>
      </details>

      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-900">Step 3: Approval queue</h3>
          <div className="flex items-center gap-2">
            {queueItems.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (typeof onOpenPrompts === 'function') {
                    onOpenPrompts();
                  }
                }}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                Open prompt library
              </button>
            )}
            <select
              value={queueStatusFilter}
              onChange={async (event) => {
                const nextStatus = event.target.value;
                setQueueStatusFilter(nextStatus);
                await loadQueue(nextStatus);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">All statuses</option>
              <option value="needs_approval">Needs approval</option>
              <option value="approved">Approved</option>
              <option value="scheduled">Scheduled</option>
              <option value="posted">Posted</option>
              <option value="rejected">Rejected</option>
            </select>
            <button
              type="button"
              onClick={() => loadQueue(queueStatusFilter)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {queueLoading ? (
          <div className="text-sm text-gray-500">Loading queue...</div>
        ) : queueItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
            No queue items yet. Start with "Analyze my account".
          </div>
        ) : (
          <div className="space-y-4">
            {queueItems.map((item) => {
              const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
              const scheduleState = scheduleInputs[item.id] || {
                scheduled_time: buildDefaultScheduleTime(),
                timezone,
              };

              return (
                <div key={item.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{item.title || 'Untitled queue item'}</h4>
                      <p className="text-xs text-gray-500">Created {formatDateTime(item.created_at)}</p>
                    </div>
                    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[item.status] || STATUS_STYLES.draft}`}>
                      {item.status}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-gray-700">{item.content}</p>

                  {Array.isArray(item.hashtags) && item.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {item.hashtags.map((tag) => (
                        <span key={`${item.id}-${tag}`} className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {metadata?.reason && (
                    <p className="text-xs text-gray-500">
                      <strong>Reason:</strong> {metadata.reason}
                    </p>
                  )}

                  {item.rejection_reason && (
                    <p className="text-xs text-rose-700">
                      <strong>Rejected:</strong> {item.rejection_reason}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {(item.status === 'needs_approval' || item.status === 'draft' || item.status === 'rejected') && (
                      <button
                        type="button"
                        onClick={() => handleQueueAction(item.id, 'approve')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </button>
                    )}
                    {(item.status === 'needs_approval' || item.status === 'draft' || item.status === 'approved') && (
                      <button
                        type="button"
                        onClick={() => handleQueueAction(item.id, 'reject')}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </button>
                    )}
                  </div>

                  {item.status === 'approved' && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
                        <CalendarClock className="h-4 w-4" />
                        Schedule approved item
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="datetime-local"
                          value={scheduleState.scheduled_time}
                          onChange={(event) => updateScheduleInput(item.id, 'scheduled_time', event.target.value)}
                          className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                        />
                        <input
                          type="text"
                          value={scheduleState.timezone}
                          onChange={(event) => updateScheduleInput(item.id, 'timezone', event.target.value)}
                          className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                          placeholder="Timezone (e.g. Asia/Kolkata)"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleQueueAction(item.id, 'schedule')}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Schedule for publish
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
