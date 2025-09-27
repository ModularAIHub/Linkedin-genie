import React from 'react';
import { Clock, RefreshCw } from 'lucide-react';

const SchedulingPanel = ({
  scheduledFor,
  setScheduledFor,
  scheduledPosts,
  isLoadingScheduled,
  onRefreshScheduled,
  onCancelScheduled
}) => {
  // Use user's local timezone for display
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatDateTime = (dateTime, timezone) => {
    try {
      // If backend provides timezone, use it for conversion
      const date = timezone && window?.luxon
        ? window.luxon.DateTime.fromISO(dateTime, { zone: 'utc' }).setZone(timezone)
        : new Date(dateTime);
      return date.toLocaleString(window?.luxon
        ? window.luxon.DateTime.DATETIME_MED
        : {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
    } catch {
      return new Date(dateTime).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <Clock className="h-5 w-5 mr-2" />
          Scheduled Posts
        </h3>
        <button
          onClick={onRefreshScheduled}
          disabled={isLoadingScheduled}
          className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoadingScheduled ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {!scheduledPosts || !Array.isArray(scheduledPosts) || scheduledPosts.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            No scheduled posts
          </p>
        ) : (
          scheduledPosts.map((post) => (
            <div
              key={post.id}
              className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <p className="text-sm text-gray-800 mb-2 line-clamp-2">
                {post.content}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {formatDateTime(post.scheduled_for, post.timezone || userTimezone)}
                </span>
                <button
                  onClick={() => onCancelScheduled(post.id)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SchedulingPanel;
