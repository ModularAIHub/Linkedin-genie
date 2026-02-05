import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Edit3, Trash2, Play, Pause, CalendarCheck, AlertCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';

const Scheduling = () => {
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('scheduled');

  useEffect(() => {
    fetchScheduledPosts();
  }, [filter]);

  const fetchScheduledPosts = async () => {
    try {
      setLoading(true);
  const response = await api.get(`/api/schedule?status=${filter}`);
  setScheduledPosts(response.data.posts || []);
    } catch (error) {
      // Optionally handle error
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (scheduleId) => {
    try {
      await api.post(`/api/schedule/cancel`, { id: scheduleId });
      fetchScheduledPosts();
    } catch (error) {
      // Optionally handle error
    }
  };

  const handleDelete = async (scheduleId) => {
    if (!window.confirm('Are you sure you want to delete this scheduled post?')) return;
    try {
      await api.delete(`/api/schedule/${scheduleId}`);
      fetchScheduledPosts();
    } catch (error) {
      // Optionally handle error
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
  };

  const getStatusBadge = (status) => {
    const badges = {
      scheduled: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Clock, label: 'Scheduled' },
      completed: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle, label: 'Posted' },
      failed: { bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle, label: 'Failed' },
      cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', icon: XCircle, label: 'Cancelled' }
    };
    const badge = badges[status] || badges.scheduled;
    const Icon = badge.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        <Icon size={12} />
        {badge.label}
      </span>
    );
  };

  const filterButtons = [
    { key: 'scheduled', label: 'Scheduled', icon: Clock, color: 'blue' },
    { key: 'completed', label: 'Posted', icon: CheckCircle, color: 'green' },
    { key: 'failed', label: 'Failed', icon: AlertCircle, color: 'red' },
    { key: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'gray' }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading scheduled posts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scheduled Posts</h1>
          <p className="mt-2 text-gray-600">Manage your scheduled LinkedIn posts</p>
        </div>
        <button 
          onClick={fetchScheduledPosts}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {filterButtons.map(({ key, label, icon: Icon, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all
              ${filter === key 
                ? `bg-${color}-100 text-${color}-700 ring-2 ring-${color}-500 ring-offset-1` 
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
              }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Posts List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {scheduledPosts.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <CalendarCheck className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No {filter} posts</h3>
            <p className="text-gray-500 text-center max-w-sm">
              {filter === 'scheduled' 
                ? "You don't have any scheduled posts. Create a post and schedule it to see it here."
                : `No ${filter} posts found.`
              }
            </p>
            {filter === 'scheduled' && (
              <a 
                href="/compose" 
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Calendar size={16} />
                Schedule a Post
              </a>
            )}
          </div>
        ) : (
          /* Posts Table */
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Content</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Scheduled For</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scheduledPosts.map(post => (
                  <tr key={post.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="max-w-md">
                        <p className="text-sm text-gray-900 line-clamp-2" title={post.post_content}>
                          {post.post_content}
                        </p>
                        {post.media_urls && post.media_urls.length > 0 && (
                          <span className="inline-flex items-center gap-1 mt-1 text-xs text-gray-500">
                            📷 {post.media_urls.length} media
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900">{formatDate(post.scheduled_time)}</span>
                        <span className="text-xs text-gray-500">{formatTime(post.scheduled_time)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(post.status)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {post.status === 'scheduled' && (
                          <button 
                            onClick={() => handleCancel(post.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                          >
                            <Pause size={14} />
                            Cancel
                          </button>
                        )}
                        <button 
                          onClick={() => handleDelete(post.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scheduling;
