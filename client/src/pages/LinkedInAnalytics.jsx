import React, { useState, useEffect } from 'react';
import { 
  BarChart3, TrendingUp, Users, Heart, MessageCircle, Share2, Eye, Calendar,
  RefreshCw, Target, Award, Activity, Hash, Clock, Brain, Lightbulb, AlertCircle,
  CheckCircle, Sparkles, Megaphone, BookOpen, Sunrise, Sun, Moon, Star
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { analytics } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const LinkedInAnalytics = () => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [timeframe, setTimeframe] = useState('30');
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [updatedPostIds, setUpdatedPostIds] = useState(new Set());

  const fetchAnalytics = async () => {
    try {
      setError(null);
      const response = await analytics.getOverview({ days: timeframe });
      console.log('Analytics data:', response.data);
      setAnalyticsData(response.data);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      setError('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const syncAnalytics = async () => {
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
        toast.success(` Analytics synced! Updated ${updated}/${total} post${total !== 1 ? 's' : ''}`);
        
        if (response.data.updatedPostIds) {
          setUpdatedPostIds(new Set(response.data.updatedPostIds));
        }
        
        await fetchAnalytics();
      }
    } catch (error) {
      console.error('Failed to sync analytics:', error);
      toast.dismiss();
      toast.error(error.response?.data?.error || 'Failed to sync analytics');
      setError('Failed to sync analytics data');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [timeframe]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const overview = analyticsData?.overview || {};
  const dailyMetrics = analyticsData?.daily || [];
  const topPosts = analyticsData?.topPosts || [];

  const calculateEngagementRate = () => {
    const totalEngagement = (parseInt(overview.total_likes) || 0) + 
                           (parseInt(overview.total_comments) || 0) + 
                           (parseInt(overview.total_shares) || 0);
    const totalViews = parseInt(overview.total_views) || 0;
    return totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(1) : '0.0';
  };

  const engagementRate = calculateEngagementRate();

  const enhancedStats = [
    { name: 'Total Posts', value: overview.total_posts || 0, icon: MessageCircle, color: 'text-blue-600', bgColor: 'bg-blue-50', subtitle: 'Published posts' },
    { name: 'Total Views', value: overview.total_views || 0, icon: Eye, color: 'text-green-600', bgColor: 'bg-green-50', subtitle: 'Total reach' },
    { name: 'Total Engagement', value: (parseInt(overview.total_likes) || 0) + (parseInt(overview.total_comments) || 0) + (parseInt(overview.total_shares) || 0), icon: Activity, color: 'text-purple-600', bgColor: 'bg-purple-50', subtitle: 'Likes + Comments + Shares' },
    { name: 'Engagement Rate', value: `${engagementRate}%`, icon: Target, color: 'text-orange-600', bgColor: 'bg-orange-50', subtitle: 'Avg engagement rate' },
    { name: 'Avg Views', value: Math.round(overview.avg_views || 0), icon: TrendingUp, color: 'text-indigo-600', bgColor: 'bg-indigo-50', subtitle: 'Per post' },
    { name: 'Avg Likes', value: Math.round(overview.avg_likes || 0), icon: Heart, color: 'text-pink-600', bgColor: 'bg-pink-50', subtitle: 'Per post' }
  ];

  const chartData = dailyMetrics.map(day => ({
    ...day,
    date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    total_engagement: (parseInt(day.likes) || 0) + (parseInt(day.comments) || 0) + (parseInt(day.shares) || 0)
  })).reverse();

  const engagementData = [
    { name: 'Likes', value: parseInt(overview.total_likes) || 0, fill: '#E1306C' },
    { name: 'Comments', value: parseInt(overview.total_comments) || 0, fill: '#F7B801' },
    { name: 'Shares', value: parseInt(overview.total_shares) || 0, fill: '#6C47FF' }
  ];

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'insights', label: 'AI Insights', icon: Brain },
    { id: 'content', label: 'Content Strategy', icon: Lightbulb },
    { id: 'timing', label: 'Optimal Timing', icon: Clock },
    { id: 'recommendations', label: 'Recommendations', icon: Target }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">LinkedIn Analytics</h1>
          <p className="mt-2 text-gray-600">Comprehensive insights into your LinkedIn performance</p>
        </div>
        <div className="flex items-center space-x-4">
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="input w-auto border rounded px-3 py-2">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button onClick={syncAnalytics} disabled={syncing} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Latest'}
          </button>
        </div>
      </div>

      {/* LinkedIn API Warning */}
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
        <div className="flex">
          <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0" />
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              <strong>Note:</strong> Metrics are captured at posting time. Click "Sync Latest" to fetch updated engagement data from LinkedIn.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap flex items-center ${activeTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                <Icon className="h-4 w-4 mr-2" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <p className="ml-3 text-sm text-red-800">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-500"></button>
          </div>
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Enhanced Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {enhancedStats.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.name} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                        <Icon className={`h-6 w-6 ${stat.color}`} />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                        <p className="text-2xl font-bold text-gray-900">{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</p>
                        <p className="text-xs text-gray-500">{stat.subtitle}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Performance Trends */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Performance Trends</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="views" stackId="1" stroke="#0077B5" fill="#0077B5" fillOpacity={0.6} />
                  <Area type="monotone" dataKey="total_engagement" stackId="2" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Engagement Breakdown</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={engagementData} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} outerRadius={80} fill="#8884d8" dataKey="value">
                    {engagementData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-l-4 border-blue-500">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <div className="p-3 bg-blue-100 rounded-full"><Brain className="h-8 w-8 text-blue-600" /></div>
                <div className="ml-4">
                  <h3 className="text-xl font-bold text-gray-900">AI Performance Score</h3>
                  <p className="text-gray-600">Based on your content and engagement patterns</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">{Math.min(100, Math.max(0, Math.round((parseFloat(engagementRate) || 0) * 10 + 40)))}</div>
                <p className="text-sm text-gray-500">Performance Rating</p>
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
                    <Eye className="h-4 w-4 text-blue-500 mr-2" />
                    <span className="text-sm font-medium">Avg Views per Post</span>
                  </div>
                  <span className="text-sm text-gray-600">{Math.round(overview.avg_views || 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Heart className="h-4 w-4 text-pink-500 mr-2" />
                    <span className="text-sm font-medium">Avg Likes per Post</span>
                  </div>
                  <span className="text-sm text-gray-600">{Math.round(overview.avg_likes || 0)}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Target className="h-4 w-4 text-red-500 mr-2" />
                    <span className="text-sm font-medium">Engagement Rate</span>
                  </div>
                  <span className="text-sm text-gray-600">{engagementRate}%</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center mb-4">
                <Sparkles className="h-5 w-5 text-yellow-500 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">Content Insights</h3>
              </div>
              <div className="space-y-3">
                {parseFloat(engagementRate) > 5 && (
                  <div className="p-3 bg-green-50 rounded-lg border-l-4 border-green-400">
                    <div className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 mr-3" />
                      <div>
                        <h4 className="font-medium text-green-900">Strong Engagement</h4>
                        <p className="text-sm text-green-700 mt-1">Your {engagementRate}% engagement rate is excellent for LinkedIn</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                  <div className="flex items-start">
                    <Lightbulb className="h-5 w-5 text-blue-500 mt-0.5 mr-3" />
                    <div>
                      <h4 className="font-medium text-blue-900">Content Strategy</h4>
                      <p className="text-sm text-blue-700 mt-1">Share industry insights and professional content for better reach</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'content' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Engagement Trends</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="views" stroke="#0077B5" name="Views" strokeWidth={2} />
                <Line type="monotone" dataKey="likes" stroke="#E1306C" name="Likes" strokeWidth={2} />
                <Line type="monotone" dataKey="comments" stroke="#F7B801" name="Comments" strokeWidth={2} />
                <Line type="monotone" dataKey="shares" stroke="#6C47FF" name="Shares" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'timing' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg shadow-md p-6 bg-gradient-to-br from-yellow-50 to-orange-50">
              <div className="flex items-center mb-4">
                <Sunrise className="h-6 w-6 text-yellow-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Morning (7-9 AM)</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Best for</span>
                  <span className="text-sm font-medium">Professional content</span>
                </div>
                <div className="mt-4 p-3 bg-yellow-100 rounded-lg">
                  <p className="text-xs text-yellow-800"> Best for industry insights and news</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6 bg-gradient-to-br from-orange-50 to-red-50">
              <div className="flex items-center mb-4">
                <Sun className="h-6 w-6 text-orange-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Midday (12-1 PM)</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Best for</span>
                  <span className="text-sm font-medium">Engagement posts</span>
                </div>
                <div className="mt-4 p-3 bg-orange-100 rounded-lg">
                  <p className="text-xs text-orange-800"> Highest engagement window</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6 bg-gradient-to-br from-blue-50 to-purple-50">
              <div className="flex items-center mb-4">
                <Clock className="h-6 w-6 text-blue-600 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">Evening (5-6 PM)</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Best for</span>
                  <span className="text-sm font-medium">Thought leadership</span>
                </div>
                <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                  <p className="text-xs text-blue-800"> Good for reflective content</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'recommendations' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center mb-6">
                <Target className="h-6 w-6 text-red-500 mr-3" />
                <h3 className="text-xl font-semibold text-gray-900">Immediate Actions</h3>
              </div>
              <div className="space-y-4">
                {parseFloat(engagementRate) < 3 && (
                  <div className="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-400">
                    <div className="flex items-start">
                      <Hash className="h-5 w-5 text-yellow-500 mt-0.5 mr-3" />
                      <div className="flex-1">
                        <h4 className="font-medium text-yellow-900">Boost Engagement</h4>
                        <p className="text-sm text-yellow-700 mt-1">Your {engagementRate}% engagement rate can be improved with better content strategy</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-4 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                  <div className="flex items-start">
                    <Lightbulb className="h-5 w-5 text-blue-500 mt-0.5 mr-3" />
                    <div className="flex-1">
                      <h4 className="font-medium text-blue-900">Content Strategy</h4>
                      <p className="text-sm text-blue-700 mt-1">Share more industry insights and thought leadership content</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center mb-6">
                <Brain className="h-6 w-6 text-purple-500 mr-3" />
                <h3 className="text-xl font-semibold text-gray-900">AI Success Tips</h3>
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-purple-50 rounded-lg">
                  <div className="flex items-start">
                    <Star className="h-4 w-4 text-purple-500 mt-1 mr-2" />
                    <div>
                      <div className="font-medium text-purple-900">Be Consistent</div>
                      <div className="text-sm text-purple-700">Post 3-5 times per week for optimal growth</div>
                    </div>
                  </div>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-start">
                    <Star className="h-4 w-4 text-blue-500 mt-1 mr-2" />
                    <div>
                      <div className="font-medium text-blue-900">Add Value First</div>
                      <div className="text-sm text-blue-700">Share knowledge before promoting products</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Performing Posts */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Top Performing Posts</h3>
          <span className="text-sm text-gray-500">Last {timeframe} days</span>
        </div>

        {topPosts.length > 0 ? (
          <div className="space-y-4">
            {topPosts.map((post, index) => {
              const badge = updatedPostIds.has(post.id) ? (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-green-200 text-green-800 text-xs font-semibold">Synced</span>
              ) : null;
              
              const totalEngagement = (parseInt(post.likes) || 0) + (parseInt(post.comments) || 0) + (parseInt(post.shares) || 0);
              const postEngagementRate = post.views > 0 ? ((totalEngagement / post.views) * 100).toFixed(1) : '0.0';
              
              return (
                <div key={post.id} className="p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-500 text-white text-xs font-bold rounded-full">{index + 1}</span>
                        <span className="text-xs text-gray-500">{new Date(post.created_at).toLocaleDateString()}</span>
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">{postEngagementRate}% engagement</span>
                        {badge}
                      </div>
                      <p className="text-gray-700 mb-3 line-clamp-3">{post.post_content?.substring(0, 200)}{post.post_content?.length > 200 ? '...' : ''}</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="flex items-center text-gray-600">
                          <Eye className="h-4 w-4 mr-1" />
                          <span className="font-medium">{(post.views || 0).toLocaleString()}</span>
                          <span className="ml-1">views</span>
                        </div>
                        <div className="flex items-center text-pink-600">
                          <Heart className="h-4 w-4 mr-1" />
                          <span className="font-medium">{post.likes || 0}</span>
                          <span className="ml-1">likes</span>
                        </div>
                        <div className="flex items-center text-yellow-600">
                          <MessageCircle className="h-4 w-4 mr-1" />
                          <span className="font-medium">{post.comments || 0}</span>
                          <span className="ml-1">comments</span>
                        </div>
                        <div className="flex items-center text-purple-600">
                          <Share2 className="h-4 w-4 mr-1" />
                          <span className="font-medium">{post.shares || 0}</span>
                          <span className="ml-1">shares</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No post performance data available</p>
            <p className="text-sm text-gray-500 mt-2">Post some content and sync data to see analytics here</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkedInAnalytics;
