import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Trash2, Pause, CalendarCheck, AlertCircle, CheckCircle, XCircle, RefreshCw, RotateCcw } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAccountAwareAPI } from '../hooks/useAccountAwareAPI';

const TIMEZONE_ALIAS_MAP = {
  'Asia/Calcutta': 'Asia/Kolkata',
};

const normalizeTimezone = (timezone) => {
  if (!timezone) return null;
  return TIMEZONE_ALIAS_MAP[timezone] || timezone;
};

const hasExplicitTimezone = (value) => /(?:[zZ]|[+\-]\d{2}:?\d{2})$/.test(value);

const parseUtcDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = hasExplicitTimezone(raw)
    ? raw
    : `${raw.replace(' ', 'T')}Z`;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isValidTimezone = (timezone) => {
  if (!timezone) return false;
  const normalized = normalizeTimezone(timezone);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const formatDatePart = (dateValue, timezone) => {
  const parsed = parseUtcDate(dateValue);
  if (!parsed) return '--';

  const options = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  };

  const normalized = normalizeTimezone(timezone);
  if (isValidTimezone(normalized)) {
    options.timeZone = normalized;
  }

  return new Intl.DateTimeFormat('en-US', options).format(parsed);
};

const formatTimePart = (dateValue, timezone) => {
  const parsed = parseUtcDate(dateValue);
  if (!parsed) return '--';

  const options = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };

  const normalized = normalizeTimezone(timezone);
  if (isValidTimezone(normalized)) {
    options.timeZone = normalized;
  }

  return new Intl.DateTimeFormat('en-US', options).format(parsed);
};

const Scheduling = () => {
  const { fetchForCurrentAccount, accountId } = useAccountAwareAPI();
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('scheduled');
  const [schedulerInfo, setSchedulerInfo] = useState(null);

  useEffect(() => {
    fetchScheduledPosts();
  }, [filter, accountId]);

  const fetchScheduledPosts = async () => {
    try {
      setLoading(true);
      const response = await fetchForCurrentAccount(`/api/schedule?status=${encodeURIComponent(filter)}`);
      const data = response.ok ? await response.json() : { posts: [] };
      setScheduledPosts(data.posts || []);

      try {
        const schedulerResponse = await fetchForCurrentAccount('/api/schedule/status');
        const schedulerData = schedulerResponse.ok ? await schedulerResponse.json() : null;
        setSchedulerInfo(schedulerData);
      } catch {
        setSchedulerInfo(null);
      }
    } catch {
      setScheduledPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (scheduleId) => {
    try {
      await fetchForCurrentAccount('/api/schedule/cancel', {
        method: 'POST',
        body: JSON.stringify({ id: scheduleId })
      });
      fetchScheduledPosts();
    } catch {
      // Keep page responsive even when cancel request fails.
    }
  };

  const handleDelete = async (scheduleId) => {
    if (!window.confirm('Are you sure you want to delete this scheduled post?')) return;
    try {
      await fetchForCurrentAccount(`/api/schedule/${scheduleId}`, {
        method: 'DELETE'
      });
      fetchScheduledPosts();
    } catch {
      // Keep page responsive even when delete request fails.
    }
  };

  const handleRetry = async (scheduleId) => {
    try {
      await fetchForCurrentAccount('/api/schedule/retry', {
        method: 'POST',
        body: JSON.stringify({ id: scheduleId })
      });
      fetchScheduledPosts();
    } catch {
      // Keep page responsive even when retry request fails.
    }
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

  const getMediaCount = (mediaUrls) => {
    if (Array.isArray(mediaUrls)) {
      return mediaUrls.length;
    }
    if (typeof mediaUrls === 'string' && mediaUrls.trim()) {
      try {
        const parsed = JSON.parse(mediaUrls);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    }
    return 0;
  };

  const filterButtons = [
    { key: 'scheduled', label: 'Scheduled', icon: Clock, color: 'blue' },
    { key: 'completed', label: 'Posted', icon: CheckCircle, color: 'green' },
    { key: 'failed', label: 'Failed', icon: AlertCircle, color: 'red' },
    { key: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'gray' }
  ];

  const activeFilterClasses = {
    blue: 'bg-blue-100 text-blue-700 ring-2 ring-blue-500 ring-offset-1',
    green: 'bg-green-100 text-green-700 ring-2 ring-green-500 ring-offset-1',
    red: 'bg-red-100 text-red-700 ring-2 ring-red-500 ring-offset-1',
    gray: 'bg-gray-200 text-gray-700 ring-2 ring-gray-400 ring-offset-1'
  };

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

      {schedulerInfo?.scheduler && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
          <span className="font-medium">Scheduler:</span>{' '}
          {schedulerInfo.scheduler.started ? 'running' : 'stopped'}
          {' - '}
          <span>Last tick: {schedulerInfo.scheduler.lastTick?.status || 'unknown'}</span>
          {' - '}
          <span>Due now: {schedulerInfo.userQueue?.dueNowCount ?? 0}</span>
          {schedulerInfo.scheduler.nextRunInMs !== null && (
            <>
              {' - '}
              <span>Next run in {Math.ceil((schedulerInfo.scheduler.nextRunInMs || 0) / 1000)}s</span>
            </>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {filterButtons.map(({ key, label, icon: Icon, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all
              ${filter === key 
                ? activeFilterClasses[color]
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
                {scheduledPosts.map((post) => {
                  const mediaCount = getMediaCount(post.media_urls);
                  const isExternal = Boolean(post.is_external_cross_post || post.external_read_only);
                  const externalSourceLabel =
                    post.external_source === 'social-genie'
                      ? 'Threads Genie'
                      : post.external_source === 'tweet-genie'
                        ? 'Tweet Genie'
                        : 'External';
                  const timezoneLabel = isValidTimezone(post.timezone)
                    ? normalizeTimezone(post.timezone)
                    : null;
                  const displayTimezone = timezoneLabel || userTimezone;
                  return (
                  <tr key={post.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="max-w-md">
                        <p className="text-sm text-gray-900 line-clamp-2" title={post.post_content}>
                          {post.post_content}
                        </p>
                        {isExternal && (
                          <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200">
                            {`External - ${externalSourceLabel} cross-post (read-only)`}
                          </span>
                        )}
                        {mediaCount > 0 && (
                          <span className="inline-flex items-center gap-1 mt-1 text-xs text-gray-500">
                            {mediaCount} media
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900">
                          {formatDatePart(post.scheduled_time, displayTimezone)}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatTimePart(post.scheduled_time, displayTimezone)}
                          {timezoneLabel ? ` (${timezoneLabel})` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(post.status)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {isExternal ? (
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            Managed in {externalSourceLabel}
                          </span>
                        ) : post.status === 'scheduled' && (
                          <button 
                            onClick={() => handleCancel(post.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                          >
                            <Pause size={14} />
                            Cancel
                          </button>
                        )}
                        {!isExternal && post.status === 'failed' && (
                          <button
                            onClick={() => handleRetry(post.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                          >
                            <RotateCcw size={14} />
                            Retry
                          </button>
                        )}
                        {!isExternal && (
                          <button 
                            onClick={() => handleDelete(post.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scheduling;

