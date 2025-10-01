import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Edit3,
  Calendar,
  BarChart3,
  Plus,
  TrendingUp,
  Users,
  MessageCircle,
  Heart,
  Share2,
  Eye,
  CreditCard,
} from 'lucide-react';
import { analytics, posts, credits, byok } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
// import LinkedInConnect from '../components/LinkedInConnect';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [recentPosts, setRecentPosts] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [apiKeyPreference, setApiKeyPreference] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [analyticsRes, postsRes, creditsRes, byokRes] = await Promise.allSettled([
        analytics.getOverview({ days: 30 }),
        posts.list({ limit: 5 }),
        credits.getBalance(),
        byok.getPreference(),
      ]);

      if (analyticsRes.status === 'fulfilled') {
        console.log('Analytics API response:', analyticsRes.value.data); // Debug log
        setAnalyticsData(analyticsRes.value.data);
      } else {
        console.error('Analytics API error:', analyticsRes.reason); // Debug log
        toast.error('Failed to load analytics data');
      }
      if (postsRes.status === 'fulfilled') {
        setRecentPosts(postsRes.value.data.posts || []);
      }
      if (creditsRes.status === 'fulfilled') {
        setCreditBalance(creditsRes.value.data);
      }
      if (byokRes.status === 'fulfilled') {
        setApiKeyPreference(byokRes.value.data);
      }
    } catch (error) {
      toast.error('Failed to load dashboard data');
      console.error('Dashboard fetch error:', error); // Debug log
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
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
      name: 'Total Shares',
      value: analyticsData?.overview?.total_shares ?? '—',
      icon: Share2,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  const quickActions = [
    {
      name: 'Compose Post',
      description: 'Create and post a new LinkedIn post',
      href: '/compose',
      icon: Edit3,
      color: 'bg-primary-600 hover:bg-primary-700',
    },
    {
      name: 'Schedule Post',
      description: 'Plan your content ahead',
      href: '/scheduling',
      icon: Calendar,
      color: 'bg-green-600 hover:bg-green-700',
    },
    {
      name: 'View Analytics',
      description: 'Check your performance',
      href: '/analytics',
      icon: BarChart3,
      color: 'bg-purple-600 hover:bg-purple-700',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-2 text-gray-600">
            Welcome back! Here's an overview of your LinkedIn activity.
          </p>
        </div>
        <Link
          to="/compose"
          className="btn btn-primary btn-lg"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Post
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="card">
              <div className="flex items-center">
                <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                  <Icon className={`h-6 w-6 ${stat.color}`} />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Credits Balance & Mode */}
      {(creditBalance || apiKeyPreference) && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Credit Balance</h3>
                <p className="text-3xl font-bold text-primary-600 mt-2">
                  {creditBalance?.balance}
                </p>
                <p className="text-sm text-gray-600">
                  Credits available for posting and AI generation
                </p>
                {apiKeyPreference?.api_key_preference && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-neutral-600">Current mode:</span>
                      <span className={`font-semibold px-2 py-1 rounded-md text-sm ${
                        apiKeyPreference.api_key_preference === 'byok' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {apiKeyPreference.api_key_preference === 'byok' ? '🔑 BYOK' : '🏢 Platform'}
                      </span>
                    </div>
                    {apiKeyPreference.api_key_preference === 'byok' && apiKeyPreference.byok_locked_until && (
                      <div className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded-md inline-block">
                        🔒 Locked until {new Date(apiKeyPreference.byok_locked_until).toLocaleDateString()}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-2">
                      {apiKeyPreference.api_key_preference === 'byok' 
                        ? 'Using your own API keys for AI content generation'
                        : 'Using platform-provided API keys'
                      }
                    </div>
                  </div>
                )}
              </div>
            
            </div>
          </div>
          {/* LinkedIn Connect Button */}
          {/* <LinkedInConnect /> */}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.name}
              to={action.href}
              className="card hover:shadow-lg transition-shadow cursor-pointer group"
            >
              <div className="text-center">
                <div className={`inline-flex p-4 rounded-lg ${action.color} group-hover:scale-110 transition-transform`}>
                  <Icon className="h-8 w-8 text-white" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">
                  {action.name}
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  {action.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Recent Posts */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Recent Posts</h3>
          <Link
            to="/compose"
            className="text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            View all
          </Link>
        </div>

        {recentPosts.length > 0 ? (
          <div className="space-y-4">
            {recentPosts.map((post) => (
              <div
                key={post.linkedin_post_id}
                className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex-shrink-0">
                  <div className="h-10 w-10 bg-blue-500 rounded-full flex items-center justify-center">
                    <MessageCircle className="h-5 w-5 text-white" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium text-gray-900">
                      {post.author_name || 'You'}
                    </p>
                    <span className={`badge ${
                      post.status === 'posted' ? 'badge-success' :
                      post.status === 'scheduled' ? 'badge-info' :
                      'badge-warning'
                    }`}>
                      {post.status}
                    </span>
                  </div>
                  <p className="mt-1 text-gray-700 line-clamp-2">
                    {post.post_content}
                  </p>
                  <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                    <span className="flex items-center">
                      <Heart className="h-4 w-4 mr-1" />
                      {post.likes || 0}
                    </span>
                    <span className="flex items-center">
                      <Share2 className="h-4 w-4 mr-1" />
                      {post.shares || 0}
                    </span>
                    <span className="flex items-center">
                      <Eye className="h-4 w-4 mr-1" />
                      {post.views || 0}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Edit3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No posts yet</p>
            <p className="text-sm text-gray-500 mt-2">
              Start creating content to see your posts here
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
// ...existing code for new Tweet Genie parity version only...
// ...existing code for new Tweet Genie parity version only...
