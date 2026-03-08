import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, RefreshCw, Clock3, BarChart3, Lightbulb } from 'lucide-react';
import toast from 'react-hot-toast';
import { analytics, strategy as strategyApi } from '../../utils/api';

const formatDateTime = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString();
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const TopicChips = ({ items = [], tone = 'blue' }) => {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-blue-50 text-blue-700 border-blue-200';

  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-sm text-gray-500">No signals yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-medium ${toneClass}`}>
          {item}
        </span>
      ))}
    </div>
  );
};

export default function ContextVault({ strategy, onStrategyUpdated }) {
  const [vault, setVault] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [syncingAnalytics, setSyncingAnalytics] = useState(false);

  const loadVault = useCallback(
    async ({ forceRefresh = false, silent = false } = {}) => {
      if (!strategy?.id) return;
      if (!silent) setLoading(true);
      try {
        const response = forceRefresh
          ? await strategyApi.getContextVault(strategy.id, { refresh: 'true' })
          : await strategyApi.getContextVault(strategy.id);
        setVault(response?.data?.vault || null);
      } catch (error) {
        toast.error(error?.response?.data?.error || 'Failed to load context vault');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [strategy?.id]
  );

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  const handleRefresh = async () => {
    if (!strategy?.id) return;
    try {
      setRefreshing(true);
      const response = await strategyApi.refreshContextVault(strategy.id, {
        reason: 'manual_refresh_from_ui',
      });
      setVault(response?.data?.vault || null);
      toast.success('Context vault refreshed');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Failed to refresh context vault');
    } finally {
      setRefreshing(false);
    }
  };

  const handleApplyInsights = async () => {
    if (!strategy?.id) return;
    try {
      setApplying(true);
      const response = await strategyApi.applyContextVault(strategy.id, {
        mode: 'merge',
        useWinningOnly: true,
      });
      const updatedStrategy = response?.data?.strategy;
      const appliedTopics = Array.isArray(response?.data?.applied?.topicsAdded)
        ? response.data.applied.topicsAdded
        : [];
      if (updatedStrategy && typeof onStrategyUpdated === 'function') {
        onStrategyUpdated(updatedStrategy);
      }
      toast.success(
        appliedTopics.length > 0
          ? `Applied ${appliedTopics.length} vault topics to strategy`
          : 'Context vault insights applied'
      );
      await loadVault({ forceRefresh: true, silent: true });
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Failed to apply context vault insights');
    } finally {
      setApplying(false);
    }
  };

  const handleSyncAnalyticsAndRefresh = async () => {
    try {
      setSyncingAnalytics(true);
      await analytics.sync({});
      await loadVault({ forceRefresh: true, silent: true });
      toast.success('Analytics synced and context vault refreshed');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Failed to sync analytics for context vault');
    } finally {
      setSyncingAnalytics(false);
    }
  };

  const snapshot = useMemo(
    () => (vault && typeof vault.snapshot === 'object' ? vault.snapshot : {}),
    [vault]
  );
  const metadata = useMemo(
    () => (vault && typeof vault.metadata === 'object' ? vault.metadata : {}),
    [vault]
  );
  const context = snapshot?.context && typeof snapshot.context === 'object' ? snapshot.context : {};
  const sources = snapshot?.sources && typeof snapshot.sources === 'object' ? snapshot.sources : {};
  const usage = snapshot?.usage && typeof snapshot.usage === 'object' ? snapshot.usage : {};
  const discoveries =
    snapshot?.discoveries && typeof snapshot.discoveries === 'object' ? snapshot.discoveries : {};
  const recommendations =
    snapshot?.recommendations && typeof snapshot.recommendations === 'object'
      ? snapshot.recommendations
      : {};
  const feedback =
    snapshot?.feedback && typeof snapshot.feedback === 'object'
      ? snapshot.feedback
      : {};
  const reviewFeedback =
    feedback?.reviews && typeof feedback.reviews === 'object'
      ? feedback.reviews
      : {};
  const analyticsLearning =
    feedback?.analyticsLearning && typeof feedback.analyticsLearning === 'object'
      ? feedback.analyticsLearning
      : {};

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Loading context vault...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-6 h-6 text-indigo-600" />
              Context Vault
            </h2>
            <p className="mt-2 text-sm text-gray-700">
              Persistent strategy memory built from posts, profile context, PDF, and usage signals.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Vault'}
          </button>
          <button
            type="button"
            onClick={handleSyncAnalyticsAndRefresh}
            disabled={syncingAnalytics}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {syncingAnalytics ? 'Syncing...' : 'Sync Analytics + Refresh'}
          </button>
          <button
            type="button"
            onClick={handleApplyInsights}
            disabled={applying}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {applying ? 'Applying...' : 'Apply Winning Topics'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-indigo-900">
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1">
            <Clock3 className="h-3.5 w-3.5" />
            Last refresh: {formatDateTime(vault?.lastRefreshedAt)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1">
            Status: {vault?.status || 'not_ready'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1">
            Snapshot size: {formatBytes(metadata?.snapshotBytes)}
          </span>
        </div>
      </section>

      {!vault ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
          No context vault snapshot exists yet. Click <strong>Refresh Vault</strong> to build one.
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Core context</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Niche</p>
                <p className="text-sm font-semibold text-gray-900">{context.niche || 'Not set'}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Audience</p>
                <p className="text-sm font-semibold text-gray-900">{context.audience || 'Not set'}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Tone</p>
                <p className="text-sm font-semibold text-gray-900">{context.tone || 'Not set'}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Posting frequency</p>
                <p className="text-sm font-semibold text-gray-900">
                  {context.postingFrequency || 'Not set'}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Top skills</p>
                <TopicChips items={context.topSkills || []} tone="green" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Top topics</p>
                <TopicChips items={context.topics || []} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Source health</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">LinkedIn posts</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(sources?.posts?.count || 0)} posts
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Avg engagement: {Number(sources?.posts?.averageEngagement || 0)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Portfolio</p>
                <p className="text-sm font-semibold text-gray-900">
                  {sources?.portfolio?.active ? 'Available' : 'Missing'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Skills: {Number(sources?.portfolio?.skillsCount || 0)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">LinkedIn profile/PDF</p>
                <p className="text-sm font-semibold text-gray-900">
                  {sources?.linkedinProfile?.hasPdf ? 'PDF linked' : 'No PDF'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Skills: {Number(sources?.linkedinProfile?.skillsCount || 0)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Reference accounts</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(sources?.references?.count || 0)} connected
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Usage state</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Prompt Pack usage</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(usage?.prompts?.usedPrompts || 0)} / {Number(usage?.prompts?.totalPrompts || 0)} used
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Recommendation: {usage?.prompts?.refreshRecommendation || 'none'}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Content plan queue</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(usage?.contentPlan?.queueCount || 0)} items
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Status: {usage?.contentPlan?.status || 'not_generated'}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Learning loop</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Queue reviews</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(reviewFeedback.reviewedCount || 0)} reviewed
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Approval rate: {Math.round(Number(reviewFeedback.approvalRate || 0) * 100)}%
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Rejections</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(reviewFeedback.rejectedCount || 0)} rejected
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Rejection rate: {Math.round(Number(reviewFeedback.rejectionRate || 0) * 100)}%
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Posted queue analytics</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(analyticsLearning.matchedPublishedItems || 0)} matched posts
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Avg engagement: {Number(analyticsLearning.avgEngagement || 0)}
                </p>
              </div>
            </div>

            {Array.isArray(reviewFeedback.topRejectionReasons) && reviewFeedback.topRejectionReasons.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-gray-500 mb-1">Top rejection reasons</p>
                <div className="flex flex-wrap gap-2">
                  {reviewFeedback.topRejectionReasons.map((item, idx) => (
                    <span
                      key={`${item.reason || 'reason'}-${idx}`}
                      className="inline-flex px-2.5 py-1 rounded-full border text-xs font-medium bg-rose-50 text-rose-700 border-rose-200"
                    >
                      {item.reason} ({Number(item.count || 0)})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(analyticsLearning.bestTopics) && analyticsLearning.bestTopics.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-gray-500 mb-1">Best performing queue topics</p>
                <TopicChips items={analyticsLearning.bestTopics} tone="green" />
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Action recommendations</h3>
            {Array.isArray(recommendations?.reasons) && recommendations.reasons.length > 0 ? (
              <ul className="space-y-1 text-sm text-gray-700">
                {recommendations.reasons.map((reason) => (
                  <li key={reason} className="list-disc ml-5">
                    {reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">No immediate action required right now.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {recommendations?.applyWinningTopics && (
                <span className="inline-flex px-2.5 py-1 rounded-full border text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                  Apply winning topics
                </span>
              )}
              {recommendations?.regeneratePrompts && (
                <span className="inline-flex px-2.5 py-1 rounded-full border text-xs font-medium bg-amber-50 text-amber-700 border-amber-200">
                  Regenerate prompt pack
                </span>
              )}
              {recommendations?.regenerateContentPlan && (
                <span className="inline-flex px-2.5 py-1 rounded-full border text-xs font-medium bg-blue-50 text-blue-700 border-blue-200">
                  Regenerate content plan
                </span>
              )}
            </div>
            {Array.isArray(recommendations?.suggestedTopics) && recommendations.suggestedTopics.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Suggested topics to merge</p>
                <TopicChips items={recommendations.suggestedTopics} tone="green" />
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Performance insights
            </h3>
            <div>
              <p className="text-xs text-gray-500 mb-1">Winning topics</p>
              <TopicChips items={discoveries.winningTopics || []} tone="green" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Underused topics</p>
              <TopicChips items={discoveries.underusedTopics || []} tone="amber" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Voice signals</p>
              <TopicChips items={discoveries.voiceSignals || []} />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-amber-600" />
              Next angles and top post samples
            </h3>
            <div>
              <p className="text-xs text-gray-500 mb-1">Next angles</p>
              <TopicChips items={discoveries.nextAngles || []} />
            </div>
            {Array.isArray(sources?.posts?.topPosts) && sources.posts.topPosts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Top posts by engagement</p>
                {sources.posts.topPosts.slice(0, 3).map((post) => (
                  <div key={post.id} className="rounded-lg border border-gray-200 p-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{post.snippet}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Engagement: {Number(post.engagement || 0)} | {formatDateTime(post.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
