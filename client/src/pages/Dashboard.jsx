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
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [creditBalance, setCreditBalance] = useState(null);
  const [byokLoading, setByokLoading] = useState(true);
  const [apiKeyPreference, setApiKeyPreference] = useState(null);

  useEffect(() => {
    analytics.getOverview({ days: 30 })
      .then(res => {
        setAnalyticsData(res.data);
      })
      .catch(err => {
        toast.error('Failed to load analytics data');
        console.error('Analytics API error:', err);
      })
      .finally(() => setAnalyticsLoading(false));

    credits.getBalance()
      .then(res => {
        setCreditBalance(res.data);
      })
      .catch(err => {
        toast.error('Failed to load credit balance');
        console.error('Credits API error:', err);
      })
      .finally(() => setCreditsLoading(false));

    byok.getPreference()
      .then(res => {
        setApiKeyPreference(res.data);
      })
      .catch(err => {
        toast.error('Failed to load BYOK preference');
        console.error('BYOK API error:', err);
      })
      .finally(() => setByokLoading(false));
  }, []);


  // Optionally, show a global spinner if all are loading (first load)
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

  // Use real analytics data
  const analyticsUnavailable = false;
  const stats = [
    {
      name: 'Total Posts',
      value: analyticsData?.overview?.total_posts || 0,
      icon: MessageCircle,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      name: 'Total Views',
      value: analyticsData?.overview?.total_views || 0,
      icon: Eye,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      name: 'Total Likes',
      value: analyticsData?.overview?.total_likes || 0,
      icon: Heart,
      color: 'text-pink-600',
      bgColor: 'bg-pink-50',
    },
    {
      name: 'Total Shares',
      value: analyticsData?.overview?.total_shares || 0,
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
    <div className="space-y-8 px-2 sm:px-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-[#0077B5] to-blue-600 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="mt-2 text-gray-600 text-lg">
            Welcome back! Here's an overview of your LinkedIn activity.
          </p>
        </div>
        <Link
          to="/compose"
          className="btn btn-primary btn-lg w-full sm:w-auto shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Post
        </Link>
      </div>


      {/* Stats Grid */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {analyticsLoading
            ? Array(4).fill(0).map((_, i) => (
                <div key={i} className="card animate-pulse">
                  <div className="flex items-center">
                    <div className="p-3 rounded-lg bg-gray-100 h-12 w-12" />
                    <div className="ml-4">
                      <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
                      <div className="h-6 w-16 bg-gray-300 rounded" />
                    </div>
                  </div>
                </div>
              ))
            : stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.name} className="card hover:shadow-xl transition-all transform hover:scale-105">
                    <div className="flex items-center">
                      <div className={`p-3 rounded-xl ${stat.bgColor} shadow-md`}>
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
      </div>

      {/* Credits Balance & Mode */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Credit Balance</h3>
                <p className="text-3xl font-bold text-primary-600 mt-2">
                  {creditsLoading ? (
                    <span className="animate-pulse bg-gray-200 h-8 w-24 inline-block rounded" />
                  ) : creditBalance && typeof creditBalance === 'object' ? (
                    <>
                      {creditBalance.balance ?? '—'}
                      <span className="block text-sm text-gray-500 mt-1">
                        {typeof creditBalance.creditsRemaining !== 'undefined' && `(${creditBalance.creditsRemaining} credits remaining)`}
                      </span>
                    </>
                  ) : (
                    creditBalance ?? '—'
                  )}
                </p>
              </div>
              <CreditCard className="h-8 w-8 text-primary-400" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">API Key Preference</h3>
                <p className="text-lg mt-2">
                  {byokLoading ? <span className="animate-pulse bg-gray-200 h-6 w-32 inline-block rounded" /> : (apiKeyPreference?.mode ?? '—')}
                </p>
              </div>
              <BarChart3 className="h-8 w-8 text-purple-400" />
            </div>
          </div>
        </div>
      </div>


      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
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
    </div>
  );
};

export default Dashboard;
