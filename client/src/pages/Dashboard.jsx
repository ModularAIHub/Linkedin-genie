import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Edit3,
  Calendar,
  BarChart3,
  Plus,
  TrendingUp,
  MessageCircle,
  Heart,
  Share2,
  Eye,
  CreditCard,
  Zap,
  Clock,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import { analytics, credits, byok } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [creditBalance, setCreditBalance] = useState(null);
  const [byokLoading, setByokLoading] = useState(true);
  const [apiKeyPreference, setApiKeyPreference] = useState(null);

  useEffect(() => {
    analytics.getOverview({ days: 30 })
      .then(res => setAnalyticsData(res.data))
      .catch(err => {
        toast.error('Failed to load analytics');
        console.error('Analytics error:', err);
      })
      .finally(() => setAnalyticsLoading(false));

    credits.getBalance()
      .then(res => setCreditBalance(res.data))
      .catch(err => {
        toast.error('Failed to load credits');
        console.error('Credits error:', err);
      })
      .finally(() => setCreditsLoading(false));

    byok.getPreference()
      .then(res => setApiKeyPreference(res.data))
      .catch(err => {
        console.error('BYOK error:', err);
      })
      .finally(() => setByokLoading(false));
  }, []);

  if (analyticsLoading && creditsLoading && byokLoading) {
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
      value: analyticsData?.overview?.total_posts || 0,
      icon: MessageCircle,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      change: null,
    },
    {
      name: 'Total Likes',
      value: analyticsData?.overview?.total_likes || 0,
      icon: Heart,
      color: 'text-pink-600',
      bgColor: 'bg-pink-50',
      change: null,
    },
    {
      name: 'Total Comments',
      value: analyticsData?.overview?.total_comments || 0,
      icon: MessageCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      change: null,
    },
    {
      name: 'Total Shares',
      value: analyticsData?.overview?.total_shares || 0,
      icon: Share2,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      change: null,
    },
  ];

  const quickActions = [
    {
      name: 'Compose Post',
      description: 'Create engaging LinkedIn content',
      href: '/compose',
      icon: Edit3,
      gradient: 'from-blue-500 to-blue-600',
    },
    {
      name: 'Schedule Posts',
      description: 'Plan your content calendar',
      href: '/scheduling',
      icon: Calendar,
      gradient: 'from-green-500 to-green-600',
    },
    {
      name: 'View Analytics',
      description: 'Track your performance',
      href: '/analytics',
      icon: BarChart3,
      gradient: 'from-purple-500 to-purple-600',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Welcome back! 👋
              </h1>
              <p className="text-gray-600">
                Here's what's happening with your LinkedIn presence
              </p>
            </div>
            <Link
              to="/compose"
              className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
            >
              <Plus className="h-5 w-5 mr-2" />
              Create Post
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {analyticsLoading
            ? Array(4).fill(0).map((_, i) => (
                <div key={i} className="bg-white rounded-xl shadow-sm p-6 animate-pulse">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-12 w-12 bg-gray-200 rounded-lg" />
                  </div>
                  <div className="h-4 w-20 bg-gray-200 rounded mb-2" />
                  <div className="h-8 w-16 bg-gray-300 rounded" />
                </div>
              ))
            : stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.name}
                    className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 border border-gray-100"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                        <Icon className={`h-6 w-6 ${stat.color}`} />
                      </div>
                    </div>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      {stat.name}
                    </p>
                    <p className="text-3xl font-bold text-gray-900">
                      {stat.value.toLocaleString()}
                    </p>
                  </div>
                );
              })}
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.name}
                  to={action.href}
                  className="group bg-white rounded-xl shadow-sm hover:shadow-lg transition-all p-6 border border-gray-100"
                >
                  <div className={`inline-flex p-3 rounded-lg bg-gradient-to-r ${action.gradient} mb-4 group-hover:scale-110 transition-transform`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                    {action.name}
                  </h3>
                  <p className="text-sm text-gray-600 mb-3">
                    {action.description}
                  </p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    Get started
                    <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Credits & Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                <CreditCard className="h-6 w-6" />
              </div>
              <Zap className="h-8 w-8 opacity-50" />
            </div>
            <p className="text-blue-100 text-sm font-medium mb-2">
              Credit Balance
            </p>
            {creditsLoading ? (
              <div className="h-10 w-32 bg-white/20 rounded animate-pulse" />
            ) : (
              <p className="text-4xl font-bold mb-2">
                {creditBalance && typeof creditBalance === 'object'
                  ? creditBalance.balance ?? '—'
                  : creditBalance ?? '—'}
              </p>
            )}
            {creditBalance?.creditsRemaining && (
              <p className="text-blue-100 text-sm">
                {creditBalance.creditsRemaining} credits remaining
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-50 rounded-lg">
                <CheckCircle className="h-6 w-6 text-purple-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm font-medium mb-2">
              API Configuration
            </p>
            {byokLoading ? (
              <div className="h-8 w-24 bg-gray-200 rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold text-gray-900 mb-2">
                {apiKeyPreference?.mode || 'Platform'}
              </p>
            )}
            <Link
              to="/settings"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium inline-flex items-center"
            >
              Manage settings
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
