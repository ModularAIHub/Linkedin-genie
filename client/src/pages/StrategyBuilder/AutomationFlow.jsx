import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  Clock3,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import { automationLinkedin, strategy as strategyApi } from '../../utils/api';
import ContentPlanContextCard from './contentPlan/ContentPlanContextCard';
import ContentPlanQueueSection from './contentPlan/ContentPlanQueueSection';
import {
  CONFIDENCE_STYLES,
  getBrowserTimezone,
  normalizeQueue,
  formatDateTime,
  buildDefaultScheduleTime,
} from './contentPlan/contentPlanUtils';

export default function AutomationFlow({
  strategy,
  onOpenPrompts,
  onOpenVault,
  onContentPlanGenerated,
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingContentPlan, setGeneratingContentPlan] = useState(false);
  const [queueStatusFilter, setQueueStatusFilter] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [scheduleInputs, setScheduleInputs] = useState({});
  const [contentPlan, setContentPlan] = useState({
    runId: null,
    generatedAt: null,
    status: 'not_generated',
    warning: null,
    queueCount: 0,
    context: null,
    queue: [],
  });

  const timezone = useMemo(() => getBrowserTimezone(), []);

  const loadContentPlan = useCallback(async ({ silent = false } = {}) => {
    if (!strategy?.id) return;

    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await strategyApi.getContentPlan(strategy.id);
      const payload = response?.data || {};
      setContentPlan({
        runId: payload.runId || null,
        generatedAt: payload.generatedAt || null,
        status: String(payload.status || 'not_generated').toLowerCase(),
        warning: payload.warning ? String(payload.warning) : null,
        queueCount: Number(payload.queueCount || 0),
        context: payload.context && typeof payload.context === 'object' ? payload.context : {},
        queue: normalizeQueue(payload.queue),
      });
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Failed to load content plan');
      setContentPlan((prev) => ({
        ...prev,
        status: 'failed',
      }));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [strategy?.id]);

  useEffect(() => {
    loadContentPlan();
  }, [loadContentPlan]);

  const refreshContentPlan = async () => {
    try {
      setRefreshing(true);
      await loadContentPlan({ silent: true });
      toast.success('Content plan refreshed');
    } catch {
      // handled in loadContentPlan
    } finally {
      setRefreshing(false);
    }
  };

  const handleGenerateContentPlan = async (options = {}) => {
    if (!strategy?.id) return;
    const normalizedMode = ['replace', 'append', 'regenerate_selected'].includes(
      String(options?.mode || 'replace').toLowerCase()
    )
      ? String(options.mode || 'replace').toLowerCase()
      : 'replace';
    const selectedQueueIds = Array.isArray(options?.selectedQueueIds)
      ? options.selectedQueueIds
        .map((value) => String(value || '').trim())
        .filter(Boolean)
      : [];
    const queueTarget = Number.parseInt(String(options?.queueTarget || ''), 10);
    const payload = {
      mode: normalizedMode,
    };
    if (Number.isFinite(queueTarget) && queueTarget > 0) {
      payload.queueTarget = queueTarget;
    }
    if (selectedQueueIds.length > 0) {
      payload.selectedQueueIds = selectedQueueIds;
    }

    if (normalizedMode === 'replace' && contentPlan.runId && !options?.skipConfirm) {
      const confirmed = window.confirm(
        'Replace current queue with a fresh generation? Existing unscheduled items will be replaced.'
      );
      if (!confirmed) return;
    }
    if (normalizedMode === 'regenerate_selected' && selectedQueueIds.length === 0) {
      toast.error('Select at least one queue item to regenerate.');
      return;
    }

    try {
      setGeneratingContentPlan(true);
      const response = await strategyApi.generateContentPlan(strategy.id, payload);
      const generated = response?.data?.contentPlan || {};
      await loadContentPlan({ silent: true });
      await onContentPlanGenerated?.();
      const queueCount = Number(generated.queueCount || 0);
      const addedCount = Number(generated.addedCount || 0);
      const regeneratedCount = Number(generated.regeneratedCount || 0);

      if (normalizedMode === 'append') {
        toast.success(
          addedCount > 0
            ? `Generated ${addedCount} more post${addedCount === 1 ? '' : 's'}`
            : 'Generated more content'
        );
      } else if (normalizedMode === 'regenerate_selected') {
        toast.success(
          regeneratedCount > 0
            ? `Regenerated ${regeneratedCount} selected item${regeneratedCount === 1 ? '' : 's'}`
            : 'Selected queue regenerated'
        );
      } else {
        toast.success(
          queueCount > 0
            ? `Content plan generated (${queueCount} posts)`
            : 'Content plan generated'
        );
      }
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Failed to run content plan generation');
    } finally {
      setGeneratingContentPlan(false);
    }
  };

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

  const handleQueueAction = async (item, action, actionPayload = {}) => {
    if (!item?.id) return;

    try {
      setActionLoadingId(item.id);

      if (action === 'reject') {
        const reason = window.prompt('Reason for rejection (optional):', '') || '';
        await automationLinkedin.patchQueueItem(item.id, { action, reason });
      } else if (action === 'schedule') {
        const scheduleState = scheduleInputs[item.id] || {
          scheduled_time: buildDefaultScheduleTime(),
          timezone,
        };
        await automationLinkedin.patchQueueItem(item.id, {
          action,
          scheduled_time: scheduleState.scheduled_time,
          timezone: scheduleState.timezone,
        });
      } else if (action === 'update') {
        await automationLinkedin.patchQueueItem(item.id, {
          action,
          title: actionPayload?.title || item?.title || '',
          content: actionPayload?.content || item?.content || '',
          hashtags: Array.isArray(actionPayload?.hashtags) ? actionPayload.hashtags : (item?.hashtags || []),
          reason: actionPayload?.reason || item?.reason || '',
        });
      } else {
        await automationLinkedin.patchQueueItem(item.id, { action });
      }

      await loadContentPlan({ silent: true });
      toast.success(`Queue item ${action}d`);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || `Failed to ${action} queue item`);
    } finally {
      setActionLoadingId('');
    }
  };

  const handleUseInCompose = (item) => {
    const content = String(item?.content || '').trim();
    if (!content) {
      toast.error('This queue item has no content to send to Compose.');
      return;
    }

    const payload = {
      content,
      queueId: item.id,
      runId: contentPlan.runId,
      source: 'strategy_content_plan',
      generatedAt: new Date().toISOString(),
    };

    localStorage.setItem('composerDraftContent', JSON.stringify(payload));
    navigate('/compose', {
      state: {
        composerDraftContent: payload,
      },
    });
  };

  const filteredQueue = useMemo(() => {
    if (!queueStatusFilter) return contentPlan.queue;
    if (queueStatusFilter === 'done') {
      return contentPlan.queue.filter((item) => ['scheduled', 'posted', 'completed'].includes(String(item?.status || '').toLowerCase()));
    }
    return contentPlan.queue.filter((item) => item.status === queueStatusFilter);
  }, [contentPlan.queue, queueStatusFilter]);

  const queueStatusCounts = useMemo(
    () =>
      (Array.isArray(contentPlan.queue) ? contentPlan.queue : []).reduce((acc, item) => {
        const status = String(item?.status || 'draft').toLowerCase();
        acc[status] = Number(acc[status] || 0) + 1;
        return acc;
      }, {}),
    [contentPlan.queue]
  );
  const postedCount = Number(queueStatusCounts.posted || 0);
  const doneCount =
    postedCount +
    Number(queueStatusCounts.scheduled || 0) +
    Number(queueStatusCounts.completed || 0);
  const pendingCount =
    Number(queueStatusCounts.draft || 0) +
    Number(queueStatusCounts.needs_approval || 0) +
    Number(queueStatusCounts.approved || 0);

  const nextBestStep = useMemo(() => {
    const pendingCount = Number(queueStatusCounts.needs_approval || 0) + Number(queueStatusCounts.draft || 0);
    const approvedCount = Number(queueStatusCounts.approved || 0);
    const rejectedCount = Number(queueStatusCounts.rejected || 0);
    const scheduledCount = Number(queueStatusCounts.scheduled || 0);
    const postedCount = Number(queueStatusCounts.posted || 0);
    const completedCount = Number(queueStatusCounts.completed || 0);
    const publishedDoneCount = postedCount + completedCount;

    if (!contentPlan.runId || Number(contentPlan.queueCount || contentPlan.queue.length || 0) <= 0) {
      return {
        label: 'Generate content plan',
        description: 'Create your publish-ready queue from your confirmed strategy and context signals.',
        actionLabel: 'Generate now',
        onAction: handleGenerateContentPlan,
        tone: 'blue',
      };
    }

    if (pendingCount > 0) {
      return {
        label: 'Review pending queue',
        description: `${pendingCount} item(s) need approval or rejection before scheduling.`,
        actionLabel: 'Show pending',
        onAction: () => setQueueStatusFilter('needs_approval'),
        tone: 'amber',
      };
    }

    if (approvedCount > 0) {
      return {
        label: 'Schedule approved posts',
        description: `${approvedCount} approved item(s) are ready to schedule.`,
        actionLabel: 'Show approved',
        onAction: () => setQueueStatusFilter('approved'),
        tone: 'emerald',
      };
    }

    if (scheduledCount > 0 && publishedDoneCount === 0) {
      return {
        label: 'Monitor scheduled posts',
        description: `${scheduledCount} item(s) are scheduled. Check publish outcomes in History/Analytics.`,
        actionLabel: 'Open history',
        onAction: () => navigate('/history'),
        tone: 'blue',
      };
    }

    if (publishedDoneCount > 0 || rejectedCount > 0) {
      return {
        label: 'Apply learning in Context Vault',
        description: 'Use review and analytics signals to improve your next prompt pack and content plan.',
        actionLabel: 'Open Context Vault',
        onAction: () => onOpenVault?.(),
        tone: 'indigo',
      };
    }

    return {
      label: 'Refresh content plan',
      description: 'Regenerate to get a fresh queue based on latest context.',
      actionLabel: 'Regenerate',
      onAction: handleGenerateContentPlan,
      tone: 'blue',
    };
  }, [
    contentPlan.runId,
    contentPlan.queue,
    contentPlan.queueCount,
    handleGenerateContentPlan,
    navigate,
    onOpenVault,
    setQueueStatusFilter,
    queueStatusCounts,
  ]);

  const nextBestStepTone = {
    blue: {
      card: 'border-blue-200 bg-blue-50 text-blue-900',
      button: 'bg-blue-600 hover:bg-blue-700',
    },
    amber: {
      card: 'border-amber-200 bg-amber-50 text-amber-900',
      button: 'bg-amber-600 hover:bg-amber-700',
    },
    emerald: {
      card: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      button: 'bg-emerald-600 hover:bg-emerald-700',
    },
    indigo: {
      card: 'border-indigo-200 bg-indigo-50 text-indigo-900',
      button: 'bg-indigo-600 hover:bg-indigo-700',
    },
  };
  const nextBestStepStyle = nextBestStepTone[nextBestStep.tone] || nextBestStepTone.blue;

  const confidenceState = String(contentPlan?.context?.confidence || '').toLowerCase();
  const confidenceStyle = CONFIDENCE_STYLES[confidenceState] || {
    dot: 'bg-gray-400',
    text: 'text-gray-600',
    label: 'Unknown confidence',
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Loading content plan...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-cyan-50 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Content Plan</h2>
            <p className="mt-2 text-sm text-gray-700">
              Publish-ready posts generated from confirmed strategy analysis and profile context.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleGenerateContentPlan({ mode: 'replace' })}
              disabled={generatingContentPlan}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Sparkles className={`h-4 w-4 ${generatingContentPlan ? 'animate-pulse' : ''}`} />
              {generatingContentPlan
                ? 'Generating...'
                : contentPlan.runId
                  ? 'Replace Queue'
                  : 'Generate Content Plan'}
            </button>
            <button
              type="button"
              onClick={refreshContentPlan}
              disabled={refreshing || generatingContentPlan}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-blue-900">
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Status: {contentPlan.status || 'not_generated'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1">
            <Clock3 className="h-3.5 w-3.5" />
            Generated: {formatDateTime(contentPlan.generatedAt)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1">
            <Target className="h-3.5 w-3.5" />
            Queue items: {contentPlan.queueCount || contentPlan.queue.length || 0}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1">
            Done: {doneCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1">
            Posted: {postedCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1">
            Pending: {pendingCount}
          </span>
        </div>
        {contentPlan.warning && (
          <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {contentPlan.warning}
          </p>
        )}
      </section>

      <section className={`rounded-xl border p-4 ${nextBestStepStyle.card}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Next best step: {nextBestStep.label}</p>
            <p className="text-xs opacity-90">{nextBestStep.description}</p>
          </div>
          <button
            type="button"
            onClick={nextBestStep.onAction}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white ${nextBestStepStyle.button}`}
          >
            {nextBestStep.actionLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      <ContentPlanContextCard
        context={contentPlan.context}
        confidenceStyle={confidenceStyle}
        onOpenVault={onOpenVault}
      />

      <ContentPlanQueueSection
        queueItems={contentPlan.queue}
        filteredQueue={filteredQueue}
        contentPlanRunId={contentPlan.runId}
        queueStatusFilter={queueStatusFilter}
        onQueueStatusFilterChange={setQueueStatusFilter}
        onOpenPrompts={() => onOpenPrompts?.()}
        onGenerateContentPlan={handleGenerateContentPlan}
        generatingContentPlan={generatingContentPlan}
        scheduleInputs={scheduleInputs}
        timezone={timezone}
        actionLoadingId={actionLoadingId}
        onUpdateScheduleInput={updateScheduleInput}
        onQueueAction={handleQueueAction}
        onUseInCompose={handleUseInCompose}
      />
    </div>
  );
}
