import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutGrid,
  List,
  Pause,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import { useAccountAwareAPI } from '../hooks/useAccountAwareAPI';

const TIMEZONE_ALIAS_MAP = {
  'Asia/Calcutta': 'Asia/Kolkata',
};

const VIEW_MODES = [
  { key: 'list', label: 'List', icon: List },
  { key: 'week', label: 'Week', icon: CalendarDays },
  { key: 'month', label: 'Month', icon: LayoutGrid },
];

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

const startOfWeek = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
};

const addDays = (date, count) => {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
};

const formatDateKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const isToday = (date) => {
  const now = new Date();
  return now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
};

const getMonthDays = (year, month) => {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
};

const truncate = (value = '', max = 72) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
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

const statusToListFilter = (status = '') => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed' || normalized === 'posted') return 'completed';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'scheduled';
};

const Scheduling = () => {
  const { fetchForCurrentAccount, accountId } = useAccountAwareAPI();
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [calendarPosts, setCalendarPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('scheduled');
  const [viewMode, setViewMode] = useState('list');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState(null);
  const [schedulerInfo, setSchedulerInfo] = useState(null);

  useEffect(() => {
    fetchScheduledPosts();
  }, [filter, accountId]);

  const fetchScheduledPosts = async () => {
    try {
      setLoading(true);
      const [listResponse, calendarResponse, schedulerResponse] = await Promise.all([
        fetchForCurrentAccount(`/api/schedule?status=${encodeURIComponent(filter)}`),
        fetchForCurrentAccount('/api/schedule'),
        fetchForCurrentAccount('/api/schedule/status').catch(() => null),
      ]);

      if (!listResponse.ok) {
        const errData = await listResponse.json().catch(() => ({}));
        throw new Error(errData?.error || 'Failed to load scheduled posts');
      }

      const listData = await listResponse.json();
      setScheduledPosts(Array.isArray(listData?.posts) ? listData.posts : []);

      if (calendarResponse?.ok) {
        const allData = await calendarResponse.json();
        setCalendarPosts(Array.isArray(allData?.posts) ? allData.posts : []);
      } else {
        setCalendarPosts(Array.isArray(listData?.posts) ? listData.posts : []);
      }

      if (schedulerResponse?.ok) {
        const schedulerData = await schedulerResponse.json();
        setSchedulerInfo(schedulerData);
      } else {
        setSchedulerInfo(null);
      }
    } catch (err) {
      setScheduledPosts([]);
      setCalendarPosts([]);
      toast.error(err?.message || 'Failed to load scheduled posts');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (scheduleId) => {
    try {
      const response = await fetchForCurrentAccount('/api/schedule/cancel', {
        method: 'POST',
        body: JSON.stringify({ id: scheduleId })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || 'Failed to cancel post');
      }
      toast.success('Scheduled post cancelled');
      fetchScheduledPosts();
    } catch (err) {
      toast.error(err?.message || 'Failed to cancel scheduled post');
    }
  };

  const handleDelete = async (scheduleId) => {
    if (!window.confirm('Are you sure you want to delete this scheduled post?')) return;
    try {
      const response = await fetchForCurrentAccount(`/api/schedule/${scheduleId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || 'Failed to delete post');
      }
      toast.success('Scheduled post deleted');
      fetchScheduledPosts();
    } catch (err) {
      toast.error(err?.message || 'Failed to delete scheduled post');
    }
  };

  const handleRetry = async (scheduleId) => {
    try {
      const response = await fetchForCurrentAccount('/api/schedule/retry', {
        method: 'POST',
        body: JSON.stringify({ id: scheduleId })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || 'Failed to retry post');
      }
      toast.success('Retry queued');
      fetchScheduledPosts();
    } catch (err) {
      toast.error(err?.message || 'Failed to retry scheduled post');
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      scheduled: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Clock, label: 'Scheduled' },
      completed: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle, label: 'Posted' },
      posted: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle, label: 'Posted' },
      failed: { bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle, label: 'Failed' },
      cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', icon: XCircle, label: 'Cancelled' }
    };
    const badge = badges[String(status || '').toLowerCase()] || badges.scheduled;
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

  const activeFilterClasses = {
    blue: 'bg-blue-100 text-blue-700 ring-2 ring-blue-500 ring-offset-1',
    green: 'bg-green-100 text-green-700 ring-2 ring-green-500 ring-offset-1',
    red: 'bg-red-100 text-red-700 ring-2 ring-red-500 ring-offset-1',
    gray: 'bg-gray-200 text-gray-700 ring-2 ring-gray-400 ring-offset-1'
  };

  const calendarMap = useMemo(() => {
    const map = {};
    for (const post of calendarPosts) {
      const parsed = parseUtcDate(post?.scheduled_time);
      if (!parsed) continue;
      const key = formatDateKey(parsed);
      if (!map[key]) map[key] = [];
      map[key].push(post);
    }

    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const left = new Date(a.scheduled_time).getTime();
        const right = new Date(b.scheduled_time).getTime();
        return left - right;
      });
    }

    return map;
  }, [calendarPosts]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [currentDate]);

  const monthDays = useMemo(() => getMonthDays(currentDate.getFullYear(), currentDate.getMonth()), [currentDate]);
  const calendarDays = viewMode === 'week' ? weekDays : monthDays;

  const navigateCalendar = (delta) => {
    setCurrentDate((current) => {
      const next = new Date(current);
      if (viewMode === 'week') {
        next.setDate(next.getDate() + (delta * 7));
      } else {
        next.setMonth(next.getMonth() + delta);
      }
      return next;
    });
  };

  const calendarTitle = viewMode === 'week'
    ? `${formatDatePart(weekDays[0], userTimezone)} - ${formatDatePart(weekDays[6], userTimezone)}`
    : `${currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })}`;

  const statusColorClasses = {
    scheduled: 'bg-blue-50 border-blue-200 text-blue-800',
    completed: 'bg-green-50 border-green-200 text-green-800',
    posted: 'bg-green-50 border-green-200 text-green-800',
    failed: 'bg-red-50 border-red-200 text-red-800',
    cancelled: 'bg-gray-50 border-gray-200 text-gray-700',
  };

  const selectedPostTimezone = isValidTimezone(selectedPost?.timezone)
    ? normalizeTimezone(selectedPost?.timezone)
    : userTimezone;

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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scheduled Posts</h1>
          <p className="mt-2 text-gray-600">Manage your scheduled LinkedIn posts</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-1">
            {VIEW_MODES.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setViewMode(key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === key ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchScheduledPosts}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} />
          </button>
        </div>
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

      {viewMode === 'list' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {scheduledPosts.length === 0 ? (
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
                          <div className="space-y-1">
                            {getStatusBadge(post.status)}
                            {post.status === 'failed' && post.error_message && (
                              <p className="text-xs text-red-600 max-w-xs truncate" title={post.error_message}>
                                {post.error_message}
                              </p>
                            )}
                          </div>
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
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigateCalendar(-1)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <p className="text-sm font-semibold text-gray-900">{calendarTitle}</p>
            <button
              type="button"
              onClick={() => navigateCalendar(1)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="hidden md:grid grid-cols-7 border-b border-gray-200">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50 border-r border-gray-100 last:border-r-0">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-7">
              {calendarDays.map((day) => {
                const key = formatDateKey(day);
                const items = calendarMap[key] || [];
                const isCurrentMonth = viewMode === 'week' || day.getMonth() === currentDate.getMonth();
                const displayItems = items.slice(0, 3);
                const overflow = items.length - displayItems.length;

                return (
                  <div
                    key={key}
                    className={`min-h-[130px] border-b md:border-r border-gray-100 last:border-r-0 p-2 ${
                      isToday(day) ? 'bg-blue-50/40' : (!isCurrentMonth ? 'bg-gray-50/50' : 'bg-white')
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-semibold ${isCurrentMonth ? 'text-gray-700' : 'text-gray-400'}`}>
                        {day.getDate()}
                      </span>
                      {isToday(day) && <span className="text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">Today</span>}
                    </div>
                    <div className="space-y-1.5">
                      {displayItems.map((item) => {
                        const itemStatus = String(item?.status || 'scheduled').toLowerCase();
                        const statusClass = statusColorClasses[itemStatus] || statusColorClasses.scheduled;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedPost(item)}
                            className={`w-full text-left rounded-lg border px-2 py-1.5 text-[11px] transition-colors hover:shadow-sm ${statusClass}`}
                          >
                            <div className="font-medium">{formatTimePart(item.scheduled_time, item.timezone || userTimezone)}</div>
                            <div className="opacity-90 leading-snug">{truncate(item.post_content, 56)}</div>
                          </button>
                        );
                      })}
                      {overflow > 0 && (
                        <p className="text-[10px] text-gray-500 text-center">+{overflow} more</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedPost && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Selected post</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {formatDatePart(selectedPost.scheduled_time, selectedPostTimezone)} at {formatTimePart(selectedPost.scheduled_time, selectedPostTimezone)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedPost.status)}
                  <button
                    type="button"
                    onClick={() => setSelectedPost(null)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Close
                  </button>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-gray-800">{selectedPost.post_content}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {String(selectedPost.status || '').toLowerCase() === 'scheduled' && (
                  <button
                    type="button"
                    onClick={() => handleCancel(selectedPost.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-200"
                  >
                    <Pause size={14} />
                    Cancel
                  </button>
                )}
                {String(selectedPost.status || '').toLowerCase() === 'failed' && (
                  <button
                    type="button"
                    onClick={() => handleRetry(selectedPost.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-200"
                  >
                    <RotateCcw size={14} />
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(selectedPost.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-200"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('list');
                    setFilter(statusToListFilter(selectedPost.status));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Open in list
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Scheduling;
