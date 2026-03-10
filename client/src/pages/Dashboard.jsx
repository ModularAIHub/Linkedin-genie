import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock3,
  CreditCard,
  Edit3,
  Heart,
  Lock,
  MessageCircle,
  Plus,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAccount } from '../contexts/AccountContext';
import { useAuth } from '../contexts/AuthContext';
import { hasProPlanAccess } from '../utils/planAccess';
import { analytics, byok, credits, strategy as strategyApi } from '../utils/api';

const GUIDE_STYLE = {
  done: {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Done',
  },
  next: {
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
    label: 'Next',
  },
  pending: {
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    label: 'Pending',
  },
  blocked: {
    badge: 'bg-gray-100 text-gray-600 border-gray-200',
    dot: 'bg-gray-400',
    label: 'Blocked',
  },
  locked: {
    badge: 'bg-purple-100 text-purple-700 border-purple-200',
    dot: 'bg-purple-500',
    label: 'Pro',
  },
};

const parseJsonObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatInt = (value) => toNumber(value, 0).toLocaleString();

const getDateKey = (value) => {
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return '';
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const truncateText = (value = '', max = 150) => {
  const safe = String(value || '').trim();
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max - 1)}...`;
};

const normalizeContentPlanPayload = (payload = {}) => ({
  runId: payload?.runId || null,
  generatedAt: payload?.generatedAt || null,
  status: String(payload?.status || 'not_generated').toLowerCase(),
  queueCount: toNumber(payload?.queueCount || 0),
  queue: Array.isArray(payload?.queue) ? payload.queue : [],
});

const Dashboard = () => {
  const { user } = useAuth();
  const { accounts } = useAccount();
  const hasProAccess = hasProPlanAccess(user);

  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [creditBalance, setCreditBalance] = useState(null);
  const [byokLoading, setByokLoading] = useState(true);
  const [apiKeyPreference, setApiKeyPreference] = useState(null);
  const [strategyLoading, setStrategyLoading] = useState(true);
  const [strategyAccessState, setStrategyAccessState] = useState('unknown');
  const [currentStrategy, setCurrentStrategy] = useState(null);
  const [contentPlan, setContentPlan] = useState(normalizeContentPlanPayload());

  useEffect(() => {
    let isMounted = true;

    analytics.getOverview({ days: 30 })
      .then((res) => {
        if (isMounted) setAnalyticsData(res.data || null);
      })
      .catch((err) => {
        toast.error('Failed to load analytics');
        console.error('Analytics error:', err);
      })
      .finally(() => {
        if (isMounted) setAnalyticsLoading(false);
      });

    credits.getBalance()
      .then((res) => {
        if (isMounted) setCreditBalance(res.data || null);
      })
      .catch((err) => {
        toast.error('Failed to load credits');
        console.error('Credits error:', err);
      })
      .finally(() => {
        if (isMounted) setCreditsLoading(false);
      });

    byok.getPreference()
      .then((res) => {
        if (isMounted) setApiKeyPreference(res.data || null);
      })
      .catch((err) => {
        console.error('BYOK error:', err);
      })
      .finally(() => {
        if (isMounted) setByokLoading(false);
      });

    (async () => {
      try {
        const strategyRes = await strategyApi.getCurrent();
        const strategyRow = strategyRes?.data?.strategy || null;
        if (!isMounted) return;

        setCurrentStrategy(strategyRow);
        setStrategyAccessState('available');

        if (strategyRow?.id) {
          try {
            const contentPlanRes = await strategyApi.getContentPlan(strategyRow.id);
            if (!isMounted) return;
            setContentPlan(normalizeContentPlanPayload(contentPlanRes?.data || {}));
          } catch (contentPlanError) {
            if (contentPlanError?.response?.status !== 404) {
              console.error('Content plan load error:', contentPlanError);
            }
            if (isMounted) setContentPlan(normalizeContentPlanPayload());
          }
        }
      } catch (strategyError) {
        const status = strategyError?.response?.status;
        if (status === 403) {
          if (isMounted) {
            setStrategyAccessState('locked');
            setCurrentStrategy(null);
            setContentPlan(normalizeContentPlanPayload());
          }
          return;
        }
        if (status !== 404) {
          console.error('Strategy load error:', strategyError);
        }
        if (isMounted) {
          setStrategyAccessState('error');
          setCurrentStrategy(null);
          setContentPlan(normalizeContentPlanPayload());
        }
      } finally {
        if (isMounted) setStrategyLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const overview = analyticsData?.overview || {};
  const topPosts = Array.isArray(analyticsData?.topPosts) ? analyticsData.topPosts : [];
  const topPost = topPosts[0] || null;
  const accountConnected = Array.isArray(accounts) && accounts.length > 0;

  const queueCounts = useMemo(() => {
    const counts = {
      draft: 0,
      needs_approval: 0,
      approved: 0,
      scheduled: 0,
      posted: 0,
      completed: 0,
      rejected: 0,
      total: 0,
    };

    for (const item of Array.isArray(contentPlan.queue) ? contentPlan.queue : []) {
      const status = String(item?.status || '').toLowerCase();
      counts.total += 1;
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    }
    return counts;
  }, [contentPlan.queue]);

  const postedOrCompletedCount = queueCounts.posted + queueCounts.completed;
  const pendingQueueCount = Math.max(0, queueCounts.total - (postedOrCompletedCount + queueCounts.rejected));
  const reviewQueueCount = queueCounts.draft + queueCounts.needs_approval + queueCounts.approved;
  const todayKey = getDateKey(new Date());
  const strategyMetadata = parseJsonObject(currentStrategy?.metadata, {});
  const generatedAt = contentPlan.generatedAt || strategyMetadata.content_plan_generated_at || null;
  const generatedToday = getDateKey(generatedAt) === todayKey;
  const strategyStatus = String(currentStrategy?.status || '').toLowerCase();
  const strategyReady = Boolean(currentStrategy?.id) && (strategyStatus === 'active' || strategyStatus === 'draft');

  const guidedSteps = useMemo(() => {
    const steps = [];
    const strategyAvailable = strategyAccessState === 'available';

    steps.push({
      id: 'connect',
      title: 'Connect LinkedIn account',
      description: accountConnected
        ? 'Account connection is healthy. You can compose, schedule, and analyse from one place.'
        : 'Connect your LinkedIn account first so posting, scheduling, and analytics can work.',
      status: accountConnected ? 'done' : 'next',
      ctaHref: '/settings',
      ctaLabel: accountConnected ? 'Manage account' : 'Connect now',
    });

    if (!accountConnected) {
      steps.push({
        id: 'strategy',
        title: 'Set strategy context',
        description: 'Strategy setup unlocks persona signals, niche guidance, and grounded content.',
        status: 'blocked',
        ctaHref: '/strategy',
        ctaLabel: 'Open Strategy Builder',
      });
    } else if (!hasProAccess || strategyAccessState === 'locked') {
      steps.push({
        id: 'strategy',
        title: 'Set strategy context',
        description: 'Strategy Builder is a Pro feature. Upgrade to enable persona and queue automation.',
        status: 'locked',
        ctaHref: '/settings',
        ctaLabel: 'View plan',
      });
    } else {
      steps.push({
        id: 'strategy',
        title: 'Set strategy context',
        description: strategyReady
          ? `Strategy "${currentStrategy?.niche || 'Current strategy'}" is ready.`
          : 'Finish your strategy setup so generation has clear niche and audience signals.',
        status: strategyReady ? 'done' : (strategyAvailable ? 'next' : 'pending'),
        ctaHref: '/strategy',
        ctaLabel: strategyReady ? 'Review strategy' : 'Complete setup',
      });
    }

    if (!hasProAccess || strategyAccessState === 'locked') {
      steps.push({
        id: 'queue',
        title: 'Generate daily content queue',
        description: 'Daily content plan generation is available on Pro.',
        status: 'locked',
        ctaHref: '/settings',
        ctaLabel: 'View plan',
      });
    } else if (!strategyReady) {
      steps.push({
        id: 'queue',
        title: 'Generate daily content queue',
        description: 'Complete strategy setup first, then generate today\'s 2 post ideas.',
        status: 'blocked',
        ctaHref: '/strategy',
        ctaLabel: 'Go to strategy',
      });
    } else {
      steps.push({
        id: 'queue',
        title: 'Generate daily content queue',
        description: generatedToday
          ? `${pendingQueueCount} pending queue item(s) are available for review.`
          : 'Run daily generation to add 2 fresh post ideas to your queue.',
        status: generatedToday ? 'done' : 'next',
        ctaHref: '/strategy?tab=content',
        ctaLabel: generatedToday ? 'Open queue' : 'Generate now',
      });
    }

    if (!hasProAccess || strategyAccessState === 'locked') {
      steps.push({
        id: 'review',
        title: 'Review and schedule',
        description: 'Queue approval and scheduling are part of Pro automation flow.',
        status: 'locked',
        ctaHref: '/settings',
        ctaLabel: 'View plan',
      });
    } else if (reviewQueueCount > 0 || queueCounts.scheduled > 0) {
      steps.push({
        id: 'review',
        title: 'Review and schedule',
        description: `${reviewQueueCount} item(s) still need review. ${queueCounts.scheduled} item(s) are already scheduled.`,
        status: 'next',
        ctaHref: '/strategy?tab=content',
        ctaLabel: 'Review queue',
      });
    } else if (postedOrCompletedCount > 0) {
      steps.push({
        id: 'review',
        title: 'Review and schedule',
        description: `${postedOrCompletedCount} queue item(s) have already been posted.`,
        status: 'done',
        ctaHref: '/history',
        ctaLabel: 'Open history',
      });
    } else {
      steps.push({
        id: 'review',
        title: 'Review and schedule',
        description: 'Once queue items are generated, approve and schedule them here.',
        status: 'pending',
        ctaHref: '/strategy?tab=content',
        ctaLabel: 'Open queue',
      });
    }

    steps.push({
      id: 'engage',
      title: 'Engage comments and improve loop',
      description: hasProAccess
        ? 'Use Engagement Assistant to respond quickly and feed better context back into strategy.'
        : 'Engagement Assistant and adaptive learning are available on Pro.',
      status: hasProAccess ? 'pending' : 'locked',
      ctaHref: hasProAccess ? '/engagement' : '/settings',
      ctaLabel: hasProAccess ? 'Open engagement' : 'View plan',
    });

    return steps;
  }, [
    accountConnected,
    currentStrategy?.niche,
    generatedToday,
    hasProAccess,
    pendingQueueCount,
    postedOrCompletedCount,
    queueCounts.scheduled,
    reviewQueueCount,
    strategyAccessState,
    strategyReady,
  ]);

  const progressSummary = useMemo(() => {
    const actionable = guidedSteps.filter((step) => !['locked', 'blocked'].includes(step.status));
    const done = actionable.filter((step) => step.status === 'done').length;
    const progress = actionable.length > 0 ? Math.round((done / actionable.length) * 100) : 0;
    const next = guidedSteps.find((step) => step.status === 'next') || null;
    return { actionableCount: actionable.length, doneCount: done, progress, next };
  }, [guidedSteps]);

  const stats = [
    {
      name: 'Posts (30d)',
      value: formatInt(overview.total_posts),
      icon: MessageCircle,
      accent: 'bg-blue-50 text-blue-700',
    },
    {
      name: 'Likes (30d)',
      value: formatInt(overview.total_likes),
      icon: Heart,
      accent: 'bg-pink-50 text-pink-700',
    },
    {
      name: 'Comments (30d)',
      value: formatInt(overview.total_comments),
      icon: MessageCircle,
      accent: 'bg-emerald-50 text-emerald-700',
    },
    {
      name: 'Shares (30d)',
      value: formatInt(overview.total_shares),
      icon: Share2,
      accent: 'bg-violet-50 text-violet-700',
    },
  ];

  const quickActions = [
    {
      name: 'Compose',
      description: 'Write and publish a post right away.',
      href: '/compose',
      icon: Edit3,
      iconStyle: 'bg-blue-600 text-white',
    },
    {
      name: 'Strategy Builder',
      description: 'Tune niche, persona signals, and content plan.',
      href: '/strategy',
      icon: Sparkles,
      iconStyle: 'bg-indigo-600 text-white',
    },
    {
      name: 'Scheduling',
      description: 'Plan approved posts across your week.',
      href: '/scheduling',
      icon: Calendar,
      iconStyle: 'bg-emerald-600 text-white',
    },
    {
      name: 'Analytics',
      description: 'Track performance and learn from winners.',
      href: '/analytics',
      icon: BarChart3,
      iconStyle: 'bg-violet-600 text-white',
    },
  ];

  const balanceValue = creditBalance && typeof creditBalance === 'object'
    ? creditBalance.balance
    : creditBalance;

  if (analyticsLoading && creditsLoading && byokLoading && strategyLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-cyan-50 to-indigo-50 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700">
              <Target className="h-3.5 w-3.5" />
              Daily Command Center
            </p>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-gray-900">
              Clear workflow, fewer clicks
            </h1>
            <p className="mt-2 text-sm text-gray-700 max-w-2xl">
              Follow the guided steps below to generate today\'s posts, review queue status, and keep publishing consistent.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={progressSummary?.next?.ctaHref || '/compose'}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {progressSummary?.next?.ctaLabel || 'Create post'}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/strategy"
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              <Sparkles className="h-4 w-4" />
              Open Strategy
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-white via-indigo-50/30 to-blue-50/40 p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Pro Workspace</h2>
            <p className="text-sm text-gray-600">Quick Actions + Workspace Snapshot for daily execution.</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-indigo-200 bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
            <Sparkles className="h-3.5 w-3.5" />
            Pro feature
          </span>
        </div>

        {!hasProAccess ? (
          <div className="mt-4 rounded-xl border border-dashed border-indigo-300 bg-white p-5 text-sm text-gray-700">
            <div className="flex items-center gap-2 text-indigo-700 font-semibold">
              <Lock className="h-4 w-4" />
              Upgrade required
            </div>
            <p className="mt-2">
              Unlock this Pro workspace to manage Strategy Builder, queue snapshots, and guided quick actions in one section.
            </p>
            <Link
              to="/settings"
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              View plan
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
              <p className="text-sm text-gray-600 mt-1">Jump directly into high-impact tasks.</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      key={action.name}
                      to={action.href}
                      className="rounded-xl border border-gray-200 p-4 hover:border-blue-200 hover:bg-blue-50/40 transition-colors"
                    >
                      <div className={`inline-flex rounded-lg p-2 ${action.iconStyle}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="mt-3 font-semibold text-gray-900">{action.name}</p>
                      <p className="mt-1 text-sm text-gray-600">{action.description}</p>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Workspace Snapshot</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 p-4 text-white">
                  <div className="flex items-center justify-between">
                    <CreditCard className="h-4 w-4 text-blue-100" />
                    <Zap className="h-4 w-4 text-blue-200" />
                  </div>
                  <p className="mt-3 text-xs text-blue-100 uppercase tracking-wide">Credits</p>
                  <p className="mt-1 text-2xl font-bold">
                    {creditsLoading ? '--' : formatInt(balanceValue || 0)}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <Clock3 className="h-4 w-4 text-gray-500" />
                  </div>
                  <p className="mt-3 text-xs text-gray-500 uppercase tracking-wide">Queue Pending</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{formatInt(pendingQueueCount)}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Generated today: {generatedToday ? 'yes' : 'no'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-700">API Mode</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">
                  {byokLoading ? 'Loading...' : (apiKeyPreference?.mode || 'Platform')}
                </p>
                <Link to="/settings" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800">
                  Manage settings
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">Top Post (30d)</p>
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
                {topPost ? (
                  <>
                    <p className="mt-2 text-sm text-gray-800">{truncateText(topPost.post_content, 180) || 'No content preview available.'}</p>
                    <p className="mt-2 text-xs text-gray-600">
                      Engagement: {formatInt(topPost.total_engagement || 0)} (likes {formatInt(topPost.likes || 0)}, comments {formatInt(topPost.comments || 0)}, shares {formatInt(topPost.shares || 0)})
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">No posted content in the selected window yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Guided Daily Flow</h2>
            <p className="text-sm text-gray-600">
              Progress {progressSummary.doneCount}/{progressSummary.actionableCount} actionable steps
            </p>
          </div>
          <div className="w-full sm:w-72">
            <div className="h-2 rounded-full bg-gray-100">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all"
                style={{ width: `${progressSummary.progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          {guidedSteps.map((step) => {
            const style = GUIDE_STYLE[step.status] || GUIDE_STYLE.pending;
            return (
              <div
                key={step.id}
                className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                    <p className="font-medium text-gray-900">{step.title}</p>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                </div>
                <Link
                  to={step.ctaHref}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 sm:ml-4"
                >
                  {step.ctaLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {analyticsLoading
          ? Array(4).fill(0).map((_, index) => (
            <div key={`stat-skeleton-${index}`} className="rounded-xl border border-gray-200 bg-white p-5 animate-pulse">
              <div className="h-8 w-8 rounded bg-gray-200" />
              <div className="mt-4 h-4 w-24 rounded bg-gray-200" />
              <div className="mt-2 h-7 w-20 rounded bg-gray-300" />
            </div>
          ))
          : stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.name} className="rounded-xl border border-gray-200 bg-white p-5">
                <span className={`inline-flex rounded-lg p-2.5 ${stat.accent}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-3 text-sm text-gray-600">{stat.name}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{stat.value}</p>
              </div>
            );
          })}
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-blue-900">Need a fast start?</p>
          <p className="text-sm text-blue-700">
            Use Strategy Builder to generate today\'s 2 posts, approve them, then schedule from one queue.
          </p>
        </div>
        <Link
          to="/strategy"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Open Strategy Builder
        </Link>
      </section>
    </div>
  );
};

export default Dashboard;
