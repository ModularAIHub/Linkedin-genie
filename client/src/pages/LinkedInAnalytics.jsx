import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, Heart, MessageCircle, Share2, Eye, Calendar, RefreshCw, Award, Activity, Clock, Lightbulb, TrendingDown, ChevronRight, Star, AlertCircle, CheckCircle, ArrowUp, ArrowDown, Sparkles, Megaphone, BarChart2, LineChart as LineChartIcon, Calendar as CalendarIcon, Search, Filter, Download, BookOpen, Coffee, Sunrise, Sun, Moon } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';


import { analytics } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const LINKEDIN_ANALYTICS_WARNING = `
  Live analytics are not available due to LinkedIn API restrictions. Only LinkedIn-approved partners can access analytics data.\n
  You will only see stats that were stored at the time of posting.\n
  Learn more: https://developer.linkedin.com/`;

const LinkedInAnalytics = () => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState('30');
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchAnalytics = async () => {
    try {
      setError(null);
      const response = await analytics.getOverview({ days: timeframe });
      console.log('Analytics API response:', response.data); // Debug log
      setAnalyticsData(response.data);
    } catch (err) {
      setError('Failed to fetch analytics');
      console.error('Analytics API error:', err); // Debug log
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchAnalytics();
    // eslint-disable-next-line
  }, [timeframe]);



  const handleSyncAnalytics = async () => {
    setSyncing(true);
    setError(null);
    try {
      await analytics.sync();
      await fetchAnalytics();
      toast.success('Analytics synced!');
    } catch (err) {
      setError('Failed to sync analytics');
      toast.error('Failed to sync analytics');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-600 text-center py-8">{error}</div>;
  }

  const stats = [
    {
      name: 'Total Posts',
      value: analyticsData?.overview?.total_posts ?? '—',
      icon: MessageCircle,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      name: 'Total Views',
      value: analyticsData?.overview?.total_views ?? '—',
      icon: Eye,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      name: 'Total Likes',
      value: analyticsData?.overview?.total_likes ?? '—',
      icon: Heart,
      color: 'text-pink-600',
      bgColor: 'bg-pink-50',
    },
    {
      name: 'Total Comments',
      value: analyticsData?.overview?.total_comments ?? '—',
      icon: MessageCircle,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
    },
    {
      name: 'Total Shares',
      value: analyticsData?.overview?.total_shares ?? '—',
      icon: Share2,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">LinkedIn Analytics</h1>
          <p className="mt-2 text-gray-600">Track your LinkedIn post performance and engagement</p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="border rounded px-2 py-1">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button
            className="ml-2 px-3 py-1 rounded bg-blue-600 text-white font-semibold flex items-center gap-2 disabled:opacity-50"
            onClick={handleSyncAnalytics}
            disabled={syncing}
            title="Sync latest analytics from LinkedIn"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Analytics'}
          </button>
        </div>
      </div>

      {/* LinkedIn API analytics warning */}
      <div className="my-4 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 rounded">
        <strong>Note:</strong> <span style={{ whiteSpace: 'pre-line' }}>{LINKEDIN_ANALYTICS_WARNING}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, idx) => (
          <div key={stat.name} className={`rounded-lg shadow p-6 flex items-center gap-4 ${stat.bgColor}`}>
            <stat.icon className={`w-8 h-8 ${stat.color}`} />
            <div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-gray-600">{stat.name}</div>
            </div>
          </div>
        ))}
      </div>
      {/* Daily Metrics Chart */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Daily Performance</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={analyticsData?.daily || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="views" stroke="#0077B5" name="Views" />
            <Line type="monotone" dataKey="likes" stroke="#E1306C" name="Likes" />
            <Line type="monotone" dataKey="comments" stroke="#F7B801" name="Comments" />
            <Line type="monotone" dataKey="shares" stroke="#6C47FF" name="Shares" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Top Posts */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Top Posts</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Content</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Views</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Likes</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Comments</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Shares</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {(analyticsData?.topPosts || []).map(post => (
                <tr key={post.linkedin_post_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 max-w-xs truncate" title={post.post_content}>{post.post_content}</td>
                  <td className="px-4 py-2">{post.views}</td>
                  <td className="px-4 py-2">{post.likes}</td>
                  <td className="px-4 py-2">{post.comments}</td>
                  <td className="px-4 py-2">{post.shares}</td>
                  <td className="px-4 py-2">{new Date(post.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LinkedInAnalytics;
