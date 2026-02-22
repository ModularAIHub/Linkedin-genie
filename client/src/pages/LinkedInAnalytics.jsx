import React, { useState, useEffect, useCallback } from 'react';
import { 
  BarChart3, TrendingUp, Users, Heart, MessageCircle, Share2, Eye, Calendar,
  RefreshCw, Target, Award, Activity, Hash, Clock, Brain, Lightbulb, AlertCircle,
  CheckCircle, Sparkles, Megaphone, BookOpen, Sunrise, Sun, Moon, Star, Lock
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { analytics } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import AccountSelector from '../components/AccountSelector';
import { useAuth } from '../contexts/AuthContext';
import { hasProPlanAccess } from '../utils/planAccess';
import { getSuiteGenieProUpgradeUrl } from '../utils/upgradeUrl';
import toast from 'react-hot-toast';
import { saveFilters, loadFilters, showError } from '../utils/filterUtils';

const FREE_DAYS = 7;
const DEFAULT_DAYS = 30;
const PRO_TIMEFRAME_OPTIONS = ['7', '30', '90', '365'];
const TIMEFRAME_OPTIONS = [
  { value: '7', label: 'Last 7 days', proOnly: false },
  { value: '30', label: 'Last 30 days', proOnly: true },
  { value: '90', label: 'Last 90 days', proOnly: true },
  { value: '365', label: 'Last year', proOnly: true },
];


const LinkedInAnalytics = () => {
  const { user } = useAuth();
  const hasUserProPlan = hasProPlanAccess(user);
  const upgradeUrl = getSuiteGenieProUpgradeUrl();

  // Account selector context
  const { accounts, selectedAccount } = typeof window !== 'undefined' && window.AccountContext 
    ? window.AccountContext 
    : { accounts: [], selectedAccount: null };

  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [timeframe, setTimeframe] = useState(String(hasUserProPlan ? DEFAULT_DAYS : FREE_DAYS));
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [updatedPostIds, setUpdatedPostIds] = useState(new Set());
  const hasServerProPlan = analyticsData?.plan?.pro === true;
  const isProPlan = hasUserProPlan || hasServerProPlan;

  // Unified filter persistence for timeframe
  useEffect(() => {
    if (!selectedAccount?.id) return;
    const loaded = loadFilters('analyticsFilters', selectedAccount.id, {
      timeframe: String(hasUserProPlan ? DEFAULT_DAYS : FREE_DAYS),
    });
    const savedTimeframe = String(loaded?.timeframe || '');
    const normalizedTimeframe = hasUserProPlan
      ? (PRO_TIMEFRAME_OPTIONS.includes(savedTimeframe) ? savedTimeframe : String(DEFAULT_DAYS))
      : String(FREE_DAYS);
    setTimeframe(normalizedTimeframe);
  }, [selectedAccount?.id, hasUserProPlan]);

  useEffect(() => {
    if (!selectedAccount?.id) return;
    saveFilters('analyticsFilters', selectedAccount.id, { timeframe });
  }, [timeframe, selectedAccount?.id]);

  useEffect(() => {
    if (!isProPlan && timeframe !== String(FREE_DAYS)) {
      setTimeframe(String(FREE_DAYS));
    }
  }, [isProPlan, timeframe]);

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Build params — selectedAccount is optional filter, not required
      const requestedDays = isProPlan && PRO_TIMEFRAME_OPTIONS.includes(String(timeframe))
        ? String(timeframe)
        : String(FREE_DAYS);
      const params = { days: requestedDays };
      if (selectedAccount?.id && selectedAccount?.account_type) {
        params.account_id = selectedAccount.id;
        params.account_type = selectedAccount.account_type;
      }

      const response = await analytics.getOverview(params);
      console.log('Analytics data:', response.data);
      setAnalyticsData(response.data);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError('Failed to load analytics data. Please try again.');
      showError('Failed to load analytics data', toast);
    } finally {
      setLoading(false);
    }
  }, [timeframe, selectedAccount?.id, selectedAccount?.account_type, isProPlan]);

  const syncAnalytics = async () => {
    if (!isProPlan) {
      const upgradeMessage = 'Sync Latest is available on Pro. Upgrade to enable real-time LinkedIn sync.';
      setError(upgradeMessage);
      toast.error(upgradeMessage);
      return;
    }

    try {
      setSyncing(true);
      setError(null);
      const loadingToast = toast.loading('Syncing analytics from LinkedIn...');
      
      const response = await analytics.sync();
      console.log('Sync response:', response.data);
      
      toast.dismiss(loadingToast);
      
      if (response.data.success) {
        const updated = response.data.updated || 0;
        const total = response.data.total || 0;
        toast.success(`Analytics synced! Updated ${updated}/${total} post${total !== 1 ? 's' : ''}`);
        
        if (response.data.updatedPostIds) {
          setUpdatedPostIds(new Set(response.data.updatedPostIds));
        }
        
        await fetchAnalytics();
      }
    } catch (err) {
      console.error('Failed to sync analytics:', err);
      toast.dismiss();
      if (err?.response?.status === 403 && err?.response?.data?.code === 'PRO_PLAN_REQUIRED') {
        const upgradeMessage = 'Sync Latest is available on Pro. Upgrade to continue.';
        setError(upgradeMessage);
        toast.error(upgradeMessage);
      } else {
        toast.error(err.response?.data?.error || 'Failed to sync analytics');
      }
    } finally {
      setSyncing(false);
    }
  };

  // Fetch on mount and when timeframe or account changes
  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-500 text-sm">Loading analytics...</p>
        </div>
      </div>
    );
  }

  const overview = analyticsData?.overview || {};
  const dailyMetrics = analyticsData?.daily || [];
  const topPosts = analyticsData?.topPosts || [];
  const timingData = analyticsData?.timing || { byDayOfWeek: [], byHour: [] };

  // Calculate key metrics
  const totalPosts = parseInt(overview.total_posts) || 0;
  const totalLikes = parseInt(overview.total_likes) || 0;
  const totalComments = parseInt(overview.total_comments) || 0;
  const totalShares = parseInt(overview.total_shares) || 0;
  const totalEngagement = totalLikes + totalComments + totalShares;
  const avgEngagement = totalPosts > 0 ? (totalEngagement / totalPosts).toFixed(1) : '0.0';
  const avgLikes = totalPosts > 0 ? (totalLikes / totalPosts).toFixed(1) : '0.0';
  const avgComments = totalPosts > 0 ? (totalComments / totalPosts).toFixed(1) : '0.0';
  const selectedDays = isProPlan && PRO_TIMEFRAME_OPTIONS.includes(String(timeframe))
    ? Number.parseInt(timeframe, 10)
    : FREE_DAYS;
  
  // Calculate engagement quality score (0-100)
  const engagementScore = Math.min(100, Math.max(0, Math.round((parseFloat(avgEngagement) || 0) * 5 + 50)));
  
  // Determine performance level
  const getPerformanceLevel = () => {
    const avg = parseFloat(avgEngagement);
    if (avg >= 15) return { level: 'excellent', color: 'green', message: 'Outstanding engagement!' };
    if (avg >= 10) return { level: 'good', color: 'blue', message: 'Strong performance' };
    if (avg >= 5) return { level: 'moderate', color: 'yellow', message: 'Room for improvement' };
    return { level: 'low', color: 'red', message: 'Needs attention' };
  };
  
  const performance = getPerformanceLevel();

  // Generate smart recommendations based on actual data
  const generateRecommendations = () => {
    const recommendations = [];
    const daysInPeriod = Math.max(selectedDays, 1);
    const postsPerWeek = totalPosts > 0 ? (totalPosts / daysInPeriod * 7).toFixed(1) : 0;
    const commentsRatio = totalEngagement > 0 ? (totalComments / totalEngagement * 100).toFixed(0) : 0;
    const sharesRatio = totalEngagement > 0 ? (totalShares / totalEngagement * 100).toFixed(0) : 0;
    const bestPost = topPosts[0];

    console.log('Recommendation Debug:', {
      totalPosts,
      daysInPeriod,
      postsPerWeek,
      avgEngagement,
      totalComments,
      totalShares,
      commentsRatio,
      sharesRatio,
      dailyMetricsLength: dailyMetrics.length,
      topPostsLength: topPosts.length
    });

    // 1. Posting Frequency
    if (totalPosts === 0) {
      recommendations.push({
        icon: MessageCircle,
        title: 'Start Posting',
        message: 'Begin with 2-3 posts per week to build momentum.',
        color: 'red'
      });
    } else if (postsPerWeek < 2) {
      recommendations.push({
        icon: Calendar,
        title: 'Increase Frequency',
        message: `You're posting ${postsPerWeek}x/week. Aim for 3-5 posts weekly.`,
        color: 'yellow'
      });
    } else if (postsPerWeek >= 7) {
      recommendations.push({
        icon: CheckCircle,
        title: 'Daily Posting Streak!',
        message: `${postsPerWeek} posts/week - you're posting daily! Excellent consistency.`,
        color: 'green'
      });
    } else if (postsPerWeek >= 5) {
      recommendations.push({
        icon: TrendingUp,
        title: 'Strong Cadence',
        message: `${postsPerWeek} posts/week is great. Almost daily!`,
        color: 'green'
      });
    } else if (postsPerWeek >= 3) {
      recommendations.push({
        icon: CheckCircle,
        title: 'Good Cadence',
        message: `${postsPerWeek} posts/week is solid. Keep it up!`,
        color: 'blue'
      });
    } else if (postsPerWeek > 10) {
      recommendations.push({
        icon: Clock,
        title: 'Very High Volume',
        message: `${postsPerWeek} posts/week is very high. Ensure quality stays strong.`,
        color: 'blue'
      });
    }

    // 2. Engagement Quality
    if (totalPosts > 0 && parseFloat(avgEngagement) < 3) {
      recommendations.push({
        icon: Target,
        title: 'Boost Engagement',
        message: `${avgEngagement} avg engagement is low. Try questions and personal stories.`,
        color: 'orange'
      });
    } else if (totalPosts > 0 && parseFloat(avgEngagement) >= 15) {
      recommendations.push({
        icon: Award,
        title: 'Outstanding!',
        message: `${avgEngagement} avg engagement is excellent!`,
        color: 'green'
      });
    } else if (totalPosts > 0 && parseFloat(avgEngagement) >= 5) {
      recommendations.push({
        icon: TrendingUp,
        title: 'Good Engagement',
        message: `${avgEngagement} avg engagement is solid. Keep creating valuable content!`,
        color: 'blue'
      });
    }

    // 3. Comments
    if (totalPosts > 0 && totalComments === 0) {
      recommendations.push({
        icon: MessageCircle,
        title: 'Spark Conversations',
        message: 'End posts with questions to encourage discussions.',
        color: 'orange'
      });
    } else if (totalPosts > 0 && commentsRatio >= 20) {
      recommendations.push({
        icon: MessageCircle,
        title: 'Great Discussions!',
        message: `${commentsRatio}% of engagement is comments!`,
        color: 'green'
      });
    } else if (totalPosts > 0 && totalComments > 0 && commentsRatio < 10) {
      recommendations.push({
        icon: MessageCircle,
        title: 'Increase Discussion',
        message: `Only ${commentsRatio}% of engagement is comments. Ask more questions!`,
        color: 'blue'
      });
    }

    // 4. Shares
    if (totalPosts > 0 && totalShares === 0) {
      recommendations.push({
        icon: Share2,
        title: 'Make Content Shareable',
        message: 'Create data-driven insights people want to share.',
        color: 'purple'
      });
    } else if (totalPosts > 0 && sharesRatio >= 15) {
      recommendations.push({
        icon: Share2,
        title: 'Highly Shareable!',
        message: `${sharesRatio}% of engagement is shares!`,
        color: 'green'
      });
    }

    // 5. Best Post
    if (bestPost && totalPosts > 1) {
      const bestEng = (parseInt(bestPost.likes) || 0) + (parseInt(bestPost.comments) || 0) + (parseInt(bestPost.shares) || 0);
      if (bestEng > avgEngagement * 2) {
        recommendations.push({
          icon: Lightbulb,
          title: 'Replicate Success',
          message: `Your top post got ${bestEng} engagements (${(bestEng / avgEngagement).toFixed(1)}x average).`,
          color: 'blue',
          preview: bestPost.post_content?.substring(0, 80)
        });
      }
    }

    // 6. Consistency
    if (dailyMetrics.length >= 7) {
      const recentWeek = dailyMetrics.slice(0, 7);
      const daysWithPosts = recentWeek.filter(d => d.posts_count > 0).length;
      if (daysWithPosts === 0) {
        recommendations.push({
          icon: AlertCircle,
          title: 'Post Regularly',
          message: 'No posts in 7 days. Consistency is key.',
          color: 'red'
        });
      } else if (daysWithPosts === 7) {
        recommendations.push({
          icon: CheckCircle,
          title: 'Perfect Consistency!',
          message: `Posted every single day this week! Outstanding dedication.`,
          color: 'green'
        });
      } else if (daysWithPosts >= 5) {
        recommendations.push({
          icon: CheckCircle,
          title: 'Great Consistency!',
          message: `Posted ${daysWithPosts} out of 7 days. Nearly daily!`,
          color: 'green'
        });
      } else if (daysWithPosts >= 3) {
        recommendations.push({
          icon: Clock,
          title: 'Good Consistency',
          message: `Posted ${daysWithPosts} out of 7 days. Try for more regular posting.`,
          color: 'blue'
        });
      }
    }

    // 7. Trend
    if (dailyMetrics.length >= 14) {
      const mid = Math.floor(dailyMetrics.length / 2);
      const recentAvg = dailyMetrics.slice(0, mid).reduce((sum, d) => sum + (parseInt(d.likes) || 0) + (parseInt(d.comments) || 0) + (parseInt(d.shares) || 0), 0) / mid;
      const olderAvg = dailyMetrics.slice(mid).reduce((sum, d) => sum + (parseInt(d.likes) || 0) + (parseInt(d.comments) || 0) + (parseInt(d.shares) || 0), 0) / (dailyMetrics.length - mid);
      
      if (recentAvg > olderAvg * 1.3) {
        recommendations.push({
          icon: TrendingUp,
          title: 'Growing!',
          message: `Recent posts: +${((recentAvg / olderAvg - 1) * 100).toFixed(0)}% engagement.`,
          color: 'green'
        });
      } else if (recentAvg < olderAvg * 0.7 && olderAvg > 0) {
        recommendations.push({
          icon: TrendingUp,
          title: 'Declining',
          message: `Recent engagement: -${((1 - recentAvg / olderAvg) * 100).toFixed(0)}%. Refresh strategy.`,
          color: 'yellow'
        });
      }
    }

    console.log('Generated recommendations:', recommendations.length);

    // Only add defaults if we have very few recommendations
    if (recommendations.length === 0) {
      recommendations.push({
        icon: AlertCircle,
        title: 'No Data Yet',
        message: 'Post content and sync analytics to get personalized recommendations.',
        color: 'blue'
      });
    }

    return recommendations.slice(0, 6);
  };

  const smartRecommendations = generateRecommendations();

  const enhancedStats = isProPlan
    ? [
        {
          name: 'Total Posts',
          value: totalPosts,
          icon: MessageCircle,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          subtitle: 'Published posts',
          trend: null,
        },
        {
          name: 'Total Engagement',
          value: totalEngagement,
          icon: Activity,
          color: 'text-purple-600',
          bgColor: 'bg-purple-50',
          subtitle: 'All interactions',
          trend: null,
        },
        {
          name: 'Avg Engagement',
          value: avgEngagement,
          icon: Target,
          color: 'text-orange-600',
          bgColor: 'bg-orange-50',
          subtitle: 'Per post',
          trend: performance.level,
        },
        {
          name: 'Total Likes',
          value: totalLikes,
          icon: Heart,
          color: 'text-pink-600',
          bgColor: 'bg-pink-50',
          subtitle: `Avg ${avgLikes}/post`,
          trend: null,
        },
        {
          name: 'Total Comments',
          value: totalComments,
          icon: MessageCircle,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          subtitle: `Avg ${avgComments}/post`,
          trend: null,
        },
        {
          name: 'Total Shares',
          value: totalShares,
          icon: Share2,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          subtitle: totalShares > 0 ? 'Great reach!' : 'Encourage sharing',
          trend: null,
        },
      ]
    : [
        {
          name: 'Total Posts',
          value: totalPosts,
          icon: MessageCircle,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          subtitle: 'Last 7 days',
          trend: null,
        },
        {
          name: 'Total Likes',
          value: totalLikes,
          icon: Heart,
          color: 'text-pink-600',
          bgColor: 'bg-pink-50',
          subtitle: 'Last 7 days',
          trend: null,
        },
        {
          name: 'Total Comments',
          value: totalComments,
          icon: MessageCircle,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          subtitle: 'Last 7 days',
          trend: null,
        },
        {
          name: 'Total Shares',
          value: totalShares,
          icon: Share2,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          subtitle: 'Last 7 days',
          trend: null,
        },
      ];

  const chartData = dailyMetrics.map(day => ({
    ...day,
    date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    views: parseInt(day.views) || 0,
    likes: parseInt(day.likes) || 0,
    comments: parseInt(day.comments) || 0,
    shares: parseInt(day.shares) || 0,
    total_engagement: (parseInt(day.likes) || 0) + (parseInt(day.comments) || 0) + (parseInt(day.shares) || 0)
  })).reverse();

  const engagementData = [
    { name: 'Likes', value: parseInt(overview.total_likes) || 0, fill: '#E1306C' },
    { name: 'Comments', value: parseInt(overview.total_comments) || 0, fill: '#F7B801' },
    { name: 'Shares', value: parseInt(overview.total_shares) || 0, fill: '#6C47FF' }
  ];

  const totalEngagementForPie = engagementData.reduce((sum, d) => sum + d.value, 0);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3, proOnly: false },
    { id: 'insights', label: 'AI Insights', icon: Brain, proOnly: true },
    { id: 'content', label: 'Content Strategy', icon: Lightbulb, proOnly: true },
    { id: 'timing', label: 'Optimal Timing', icon: Clock, proOnly: true },
    { id: 'recommendations', label: 'Recommendations', icon: Target, proOnly: true }
  ];
  const activeTabConfig = tabs.find((tab) => tab.id === activeTab) || tabs[0];
  const isActiveTabLocked = Boolean(activeTabConfig?.proOnly && !isProPlan);
  const displayedDays = String(selectedDays);
  const handleUpgradeClick = () => {
    window.location.href = upgradeUrl || '/pricing';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-[#0077B5] to-blue-600 bg-clip-text text-transparent">
            LinkedIn Analytics
          </h1>
          <p className="mt-2 text-gray-600 text-lg">Comprehensive insights into your LinkedIn performance</p>
        </div>
        <div className="flex items-center space-x-4 flex-wrap gap-2">
          <AccountSelector
            accounts={accounts || []}
            selectedAccount={selectedAccount}
            onSelect={account => {
              if (typeof window !== 'undefined' && window.setSelectedAccount) {
                window.setSelectedAccount(account);
              } else {
                window.location.reload();
              }
            }}
            label="Account"
          />
          <select
            value={timeframe}
            onChange={(event) => setTimeframe(String(event.target.value))}
            className="border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm hover:shadow-md transition-all"
          >
            {TIMEFRAME_OPTIONS.map((option) => {
              const locked = option.proOnly && !isProPlan;
              return (
                <option key={option.value} value={option.value} disabled={locked}>
                  {option.label}
                  {locked ? ' (Pro)' : ''}
                </option>
              );
            })}
          </select>
          <button
            onClick={isProPlan ? syncAnalytics : handleUpgradeClick}
            disabled={isProPlan && syncing}
            className={`px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm font-semibold shadow-lg transition-all ${
              isProPlan
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 hover:shadow-xl transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed'
                : 'bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200'
            }`}
          >
            {isProPlan ? (
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {isProPlan ? (syncing ? 'Syncing...' : 'Sync Latest') : 'Sync Latest (Pro)'}
          </button>
        </div>
      </div>

      {/* Info note */}
      <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border-l-4 border-blue-400 p-5 rounded-xl shadow-sm">
        <div className="flex">
          <AlertCircle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="ml-3">
            <p className="text-sm text-blue-800 leading-relaxed">
              <strong className="font-semibold">Note:</strong> LinkedIn's API provides engagement metrics (likes, comments, shares) but does not provide view/impression counts for personal profiles. Views are only available for organization pages.
            </p>
          </div>
        </div>
      </div>

      {!isProPlan && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start">
              <Lock className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="ml-3">
                <h3 className="text-sm font-semibold text-amber-900">Free Plan: Basic analytics only</h3>
                <p className="text-sm text-amber-800 mt-1">
                  You are seeing last 7 days and top 5 posts. AI insights, timing, recommendations, full ranges, and Sync Latest unlock on Pro.
                </p>
              </div>
            </div>
            <button
              onClick={handleUpgradeClick}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors"
            >
              Upgrade on SuiteGenie
            </button>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="border-b-2 border-gray-200 bg-white rounded-t-xl shadow-sm">
        <nav className="-mb-0.5 flex space-x-8 overflow-x-auto px-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isLocked = tab.proOnly && !isProPlan;
            return (
              <button 
                key={tab.id} 
                onClick={() => {
                  setActiveTab(tab.id);
                  if (isLocked) {
                    toast.error(`${tab.label} is available on Pro. Upgrade to unlock.`);
                  }
                }}
                className={`py-4 px-2 border-b-2 font-semibold text-sm whitespace-nowrap flex items-center transition-all ${
                  activeTab === tab.id 
                    ? 'border-blue-600 text-blue-600'
                    : isLocked
                      ? 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-4 w-4 mr-2" />
                {tab.label}
                {isLocked && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    <Lock className="h-3 w-3" />
                    Pro
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <p className="ml-3 text-sm text-red-800">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-500 text-lg leading-none">&times;</button>
          </div>
        </div>
      )}

      {/* No data state */}
      {!loading && parseInt(overview.total_posts) === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <BarChart3 className="h-12 w-12 text-blue-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-blue-900 mb-1">No data yet</h3>
          <p className="text-sm text-blue-700">
            {isProPlan
              ? 'Post some content and click "Sync Latest" to see your analytics here.'
              : 'Post some content to see your free analytics. Upgrade to Pro to use Sync Latest and advanced insights.'}
          </p>
        </div>
      )}

      {isActiveTabLocked && (
        <div className="bg-white border border-amber-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <Lock className="h-7 w-7 text-amber-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900">{activeTabConfig.label} is a Pro feature</h3>
          <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
            Keep exploring with free analytics, then upgrade on SuiteGenie to unlock AI insights, timing intelligence, recommendations, and advanced ranges.
          </p>
          <button
            onClick={handleUpgradeClick}
            className="mt-5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold hover:from-blue-700 hover:to-blue-800 transition-all"
          >
            Upgrade on SuiteGenie
          </button>
        </div>
      )}

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {enhancedStats.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.name} className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all transform hover:scale-105 p-6 border border-gray-100">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <div className={`p-4 rounded-xl ${stat.bgColor} shadow-md`}>
                        <Icon className={`h-7 w-7 ${stat.color}`} />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">{stat.name}</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">
                          {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{stat.subtitle}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Charts */}
          {isProPlan ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2 text-blue-600" />
                  Daily Engagement Trends
                </h3>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                      <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e5e7eb',
                          borderRadius: '12px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="total_engagement" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="Total Engagement" strokeWidth={2} />
                      <Area type="monotone" dataKey="likes" stroke="#E1306C" fill="#E1306C" fillOpacity={0.2} name="Likes" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-400">
                    <p className="text-sm">No daily data available</p>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <Activity className="h-5 w-5 mr-2 text-purple-600" />
                  Engagement Breakdown
                </h3>
                {totalEngagementForPie > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={engagementData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={90}
                        dataKey="value"
                      >
                        {engagementData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e5e7eb',
                          borderRadius: '12px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-400">
                    <p className="text-sm">No engagement data yet - sync to update</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-amber-200 p-6 shadow-sm">
              <div className="flex items-start justify-between flex-col sm:flex-row gap-4">
                <div className="flex items-start">
                  <Lock className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="ml-3">
                    <h3 className="text-lg font-semibold text-gray-900">Advanced charts are Pro-only</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Upgrade to unlock daily trend charts and engagement breakdown visualization.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleUpgradeClick}
                  className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors"
                >
                  Upgrade on SuiteGenie
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* INSIGHTS TAB */}
      {!isActiveTabLocked && activeTab === 'insights' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-l-4 border-blue-500">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <div className="p-3 bg-blue-100 rounded-full">
                  <Brain className="h-8 w-8 text-blue-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-xl font-bold text-gray-900">AI Performance Score</h3>
                  <p className="text-gray-600">Based on your content and engagement patterns</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">
                  {engagementScore}
                </div>
                <p className="text-sm text-gray-500">out of 100</p>
                <p className="text-xs text-gray-400 mt-1">{performance.message}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center mb-4">
                <TrendingUp className="h-5 w-5 text-green-500 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">Performance Patterns</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Activity className="h-4 w-4 text-purple-500 mr-2" />
                    <span className="text-sm font-medium">Total Engagement</span>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{totalEngagement}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Heart className="h-4 w-4 text-pink-500 mr-2" />
                    <span className="text-sm font-medium">Avg Likes per Post</span>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{avgLikes}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Target className="h-4 w-4 text-orange-500 mr-2" />
                    <span className="text-sm font-medium">Avg Engagement</span>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{avgEngagement}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <MessageCircle className="h-4 w-4 text-blue-500 mr-2" />
                    <span className="text-sm font-medium">Avg Comments</span>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{avgComments}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center mb-4">
                <Sparkles className="h-5 w-5 text-yellow-500 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">Content Insights</h3>
              </div>
              <div className="space-y-3">
                {performance.level === 'excellent' && (
                  <div className="p-3 bg-green-50 rounded-lg border-l-4 border-green-400">
                    <div className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 mr-3" />
                      <div>
                        <h4 className="font-medium text-green-900">Excellent Engagement!</h4>
                        <p className="text-sm text-green-700 mt-1">Your {avgEngagement} avg engagements per post is outstanding for LinkedIn. Keep up the great work!</p>
                      </div>
                    </div>
                  </div>
                )}
                {performance.level === 'good' && (
                  <div className="p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                    <div className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-blue-500 mt-0.5 mr-3" />
                      <div>
                        <h4 className="font-medium text-blue-900">Strong Performance</h4>
                        <p className="text-sm text-blue-700 mt-1">Your {avgEngagement} avg engagements per post shows good audience connection</p>
                      </div>
                    </div>
                  </div>
                )}
                {performance.level === 'moderate' && (
                  <div className="p-3 bg-yellow-50 rounded-lg border-l-4 border-yellow-400">
                    <div className="flex items-start">
                      <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5 mr-3" />
                      <div>
                        <h4 className="font-medium text-yellow-900">Room to Grow</h4>
                        <p className="text-sm text-yellow-700 mt-1">Your {avgEngagement} avg engagements can improve with more targeted, valuable content</p>
                      </div>
                    </div>
                  </div>
                )}
                {performance.level === 'low' && totalPosts > 0 && (
                  <div className="p-3 bg-red-50 rounded-lg border-l-4 border-red-400">
                    <div className="flex items-start">
                      <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 mr-3" />
                      <div>
                        <h4 className="font-medium text-red-900">Needs Attention</h4>
                        <p className="text-sm text-red-700 mt-1">Focus on creating more engaging, valuable content for your audience</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-3 bg-purple-50 rounded-lg border-l-4 border-purple-400">
                  <div className="flex items-start">
                    <Lightbulb className="h-5 w-5 text-purple-500 mt-0.5 mr-3" />
                    <div>
                      <h4 className="font-medium text-purple-900">Pro Tip</h4>
                      <p className="text-sm text-purple-700 mt-1">Posts with questions, personal stories, or actionable insights get 2-3x more engagement</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONTENT TAB */}
      {!isActiveTabLocked && activeTab === 'content' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Engagement Trends</h3>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="total_engagement" stroke="#10b981" name="Total Engagement" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="likes" stroke="#E1306C" name="Likes" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="comments" stroke="#F7B801" name="Comments" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="shares" stroke="#6C47FF" name="Shares" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <p className="text-sm">No trend data available yet</p>
              </div>
            )}
          </div>

          {/* Posts per day bar chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Posts Per Day</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="posts_count" fill="#0077B5" name="Posts" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* TIMING TAB */}
      {!isActiveTabLocked && activeTab === 'timing' && (
        <div className="space-y-6">
          {timingData.byDayOfWeek.length > 0 || timingData.byHour.length > 0 ? (
            <>
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-md p-6 border-l-4 border-blue-500">
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Your Best Posting Times</h3>
                <p className="text-sm text-gray-600">Based on your actual posting history and engagement over the last {displayedDays} days</p>
              </div>

              {/* Best Days */}
              {timingData.byDayOfWeek.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Best Days to Post</h3>
                  <div className="grid grid-cols-7 gap-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, dayIndex) => {
                      const dayData = timingData.byDayOfWeek.find(d => parseInt(d.day_of_week) === dayIndex);
                      const avgEng = dayData ? parseFloat(dayData.avg_engagement) : 0;
                      const postsCount = dayData ? parseInt(dayData.posts_count) : 0;
                      
                      const maxEng = Math.max(...timingData.byDayOfWeek.map(d => parseFloat(d.avg_engagement)));
                      const isBest = avgEng > 0 && avgEng >= maxEng * 0.9;
                      const isGood = avgEng > 0 && avgEng >= maxEng * 0.6;
                      
                      return (
                        <div key={day} className={`p-3 rounded-lg text-center text-sm font-medium transition-all ${
                          isBest ? 'bg-blue-600 text-white shadow-lg' : isGood ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'
                        }`}>
                          <div className="font-bold">{day}</div>
                          {postsCount > 0 && (
                            <>
                              <div className="text-xs mt-1">{postsCount} post{postsCount !== 1 ? 's' : ''}</div>
                              <div className="text-xs">{avgEng.toFixed(1)} avg</div>
                            </>
                          )}
                          {isBest && <div className="text-xs mt-1 font-bold">⭐ Best</div>}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-4">
                    Days ranked by your average engagement per post. Focus on your best-performing days.
                  </p>
                </div>
              )}

              {/* Best Hours */}
              {timingData.byHour.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Best Hours to Post</h3>
                  <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
                    {Array.from({ length: 24 }, (_, hour) => {
                      const hourData = timingData.byHour.find(h => parseInt(h.hour_of_day) === hour);
                      const avgEng = hourData ? parseFloat(hourData.avg_engagement) : 0;
                      const postsCount = hourData ? parseInt(hourData.posts_count) : 0;
                      
                      const maxEng = Math.max(...timingData.byHour.map(h => parseFloat(h.avg_engagement)));
                      const isBest = avgEng > 0 && avgEng >= maxEng * 0.9;
                      const isGood = avgEng > 0 && avgEng >= maxEng * 0.6;
                      
                      const hourLabel = hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
                      
                      return (
                        <div
                          key={hour}
                          className={`p-2 rounded-lg text-center text-xs font-medium transition-all ${
                            isBest ? 'bg-green-600 text-white shadow-lg' : isGood ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                          }`}
                          title={postsCount > 0 ? `${postsCount} posts, ${avgEng.toFixed(1)} avg engagement` : 'No posts'}
                        >
                          <div className="font-bold">{hourLabel}</div>
                          {postsCount > 0 && (
                            <div className="text-xs mt-1">{postsCount}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-4">
                    Hours ranked by your average engagement. Green = best times, gray = no data.
                  </p>
                </div>
              )}

              {/* Posting Stats */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Posting Patterns</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(() => {
                    const daysInPeriod = selectedDays;
                    const postsPerWeek = totalPosts > 0 ? (totalPosts / daysInPeriod * 7).toFixed(1) : 0;
                    const daysWithPosts = dailyMetrics.filter(d => d.posts_count > 0).length;
                    const avgPostsPerDay = daysWithPosts > 0 ? (totalPosts / daysWithPosts).toFixed(1) : 0;
                    
                    return (
                      <>
                        <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
                          <div>
                            <p className="text-sm text-gray-600">Posts per week</p>
                            <p className="text-2xl font-bold text-blue-600">{postsPerWeek}</p>
                          </div>
                          <Calendar className="h-8 w-8 text-blue-400" />
                        </div>
                        <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                          <div>
                            <p className="text-sm text-gray-600">Active days</p>
                            <p className="text-2xl font-bold text-green-600">{daysWithPosts} / {daysInPeriod}</p>
                          </div>
                          <Clock className="h-8 w-8 text-green-400" />
                        </div>
                        <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
                          <div>
                            <p className="text-sm text-gray-600">Avg per active day</p>
                            <p className="text-2xl font-bold text-purple-600">{avgPostsPerDay}</p>
                          </div>
                          <TrendingUp className="h-8 w-8 text-purple-400" />
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Timing Data Yet</h3>
              <p className="text-gray-600 mb-4">
                Post content and sync analytics to see your best posting times and patterns.
x``              </p>
              <button
                onClick={syncAnalytics}
                disabled={syncing}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-semibold shadow-lg hover:shadow-xl transition-all mx-auto"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync Analytics'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* RECOMMENDATIONS TAB */}
      {!isActiveTabLocked && activeTab === 'recommendations' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-md p-6 border-l-4 border-blue-500">
            <div className="flex items-center mb-2">
              <Brain className="h-6 w-6 text-blue-600 mr-3" />
              <h3 className="text-xl font-semibold text-gray-900">Smart Recommendations</h3>
            </div>
            <p className="text-sm text-gray-600">Personalized insights based on your {displayedDays}-day performance</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {smartRecommendations.map((rec, idx) => {
              const Icon = rec.icon;
              const colors = {
                red: { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-900', sub: 'text-red-700', icon: 'text-red-500' },
                yellow: { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-900', sub: 'text-yellow-700', icon: 'text-yellow-500' },
                orange: { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-900', sub: 'text-orange-700', icon: 'text-orange-500' },
                blue: { bg: 'bg-blue-50', border: 'border-blue-400', text: 'text-blue-900', sub: 'text-blue-700', icon: 'text-blue-500' },
                green: { bg: 'bg-green-50', border: 'border-green-400', text: 'text-green-900', sub: 'text-green-700', icon: 'text-green-500' },
                purple: { bg: 'bg-purple-50', border: 'border-purple-400', text: 'text-purple-900', sub: 'text-purple-700', icon: 'text-purple-500' }
              };
              const c = colors[rec.color] || colors.blue;

              return (
                <div key={idx} className={`${c.bg} rounded-lg border-l-4 ${c.border} p-5 shadow-sm hover:shadow-md transition-shadow`}>
                  <div className="flex items-start">
                    <Icon className={`h-6 w-6 ${c.icon} mt-0.5 mr-3 flex-shrink-0`} />
                    <div className="flex-1">
                      <h4 className={`font-semibold ${c.text} mb-1`}>{rec.title}</h4>
                      <p className={`text-sm ${c.sub} leading-relaxed`}>{rec.message}</p>
                      {rec.preview && (
                        <p className="text-xs text-gray-500 mt-2 italic border-l-2 border-gray-300 pl-2">
                          "{rec.preview}..."
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center mb-6">
              <Star className="h-6 w-6 text-yellow-500 mr-3" />
              <h3 className="text-xl font-semibold text-gray-900">LinkedIn Best Practices</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-start">
                  <Star className="h-4 w-4 text-purple-500 mt-1 mr-2 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-purple-900">Be Authentic</div>
                    <div className="text-sm text-purple-700">Share personal experiences and lessons</div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-start">
                  <Star className="h-4 w-4 text-blue-500 mt-1 mr-2 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-blue-900">Add Value First</div>
                    <div className="text-sm text-blue-700">Share knowledge before promoting</div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-start">
                  <Star className="h-4 w-4 text-green-500 mt-1 mr-2 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-green-900">Use Native Documents</div>
                    <div className="text-sm text-green-700">PDFs get 3x more impressions</div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <div className="flex items-start">
                  <Star className="h-4 w-4 text-orange-500 mt-1 mr-2 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-orange-900">Engage Back</div>
                    <div className="text-sm text-orange-700">Reply within 2 hours to boost reach</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Performing Posts — shown on all tabs */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">Top Performing Posts</h3>
            {!isProPlan && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                Top 5 on Free
              </span>
            )}
          </div>
          <span className="text-sm text-gray-500">Last {displayedDays} days</span>
        </div>

        {topPosts.length > 0 ? (
          <div className="space-y-4">
            {topPosts.map((post, index) => {
              const isUpdated = updatedPostIds.has(post.id);
              const totalEngagement = (parseInt(post.likes) || 0) + (parseInt(post.comments) || 0) + (parseInt(post.shares) || 0);

              return (
                <div key={post.id} className="p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500 hover:bg-gray-100 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2 flex-wrap gap-1">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-500 text-white text-xs font-bold rounded-full flex-shrink-0">
                          {index + 1}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(post.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                          {totalEngagement} total engagements
                        </span>
                        {isUpdated && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                            ✓ Just synced
                          </span>
                        )}
                      </div>
                      <p className="text-gray-700 mb-3 text-sm line-clamp-3">
                        {post.post_content?.substring(0, 200)}{post.post_content?.length > 200 ? '...' : ''}
                      </p>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div className="flex items-center text-pink-600">
                          <Heart className="h-4 w-4 mr-1 flex-shrink-0" />
                          <span className="font-medium">{parseInt(post.likes) || 0}</span>
                          <span className="ml-1 text-xs">likes</span>
                        </div>
                        <div className="flex items-center text-yellow-600">
                          <MessageCircle className="h-4 w-4 mr-1 flex-shrink-0" />
                          <span className="font-medium">{parseInt(post.comments) || 0}</span>
                          <span className="ml-1 text-xs">comments</span>
                        </div>
                        <div className="flex items-center text-purple-600">
                          <Share2 className="h-4 w-4 mr-1 flex-shrink-0" />
                          <span className="font-medium">{parseInt(post.shares) || 0}</span>
                          <span className="ml-1 text-xs">shares</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">No post data available</p>
            <p className="text-sm text-gray-400 mt-1">
              {isProPlan
                ? 'Click "Sync Latest" above to fetch your latest engagement data from LinkedIn'
                : 'Free plan shows top posts from your available analytics window. Upgrade to Pro for Sync Latest.'}
            </p>
            <button
              onClick={isProPlan ? syncAnalytics : handleUpgradeClick}
              disabled={isProPlan && syncing}
              className={`mt-4 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 mx-auto ${
                isProPlan
                  ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                  : 'bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200'
              }`}
            >
              {isProPlan ? (
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {isProPlan ? (syncing ? 'Syncing...' : 'Sync Now') : 'Upgrade on SuiteGenie'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkedInAnalytics;
