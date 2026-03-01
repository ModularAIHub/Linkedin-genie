import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, MessageCircle, Calendar, Filter, Trash2, ExternalLink } from 'lucide-react';
import { scheduling } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import { saveFilters, loadFilters, showError } from '../utils/filterUtils';
import { useAccountAwareAPI } from '../hooks/useAccountAwareAPI';
import AccountSelector from '../components/AccountSelector';

const History = () => {
  const { fetchForCurrentAccount, selectedAccount, accountId, accounts } = useAccountAwareAPI();
  const [postedPosts, setPostedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [deletingPosts, setDeletingPosts] = useState(new Set());

  // Unified filter persistence
  useEffect(() => {
    if (!selectedAccount?.id) return;
    const defaults = { filter: 'all', sourceFilter: 'all', statusFilter: 'all', sortBy: 'newest' };
    const loaded = loadFilters('historyFilters', selectedAccount.id, defaults);
    setFilter(loaded.filter);
    setSourceFilter(loaded.sourceFilter);
    setStatusFilter(loaded.statusFilter);
    setSortBy(loaded.sortBy);
  }, [selectedAccount]);

  useEffect(() => {
    if (!selectedAccount?.id) return;
    saveFilters('historyFilters', selectedAccount.id, { filter, sourceFilter, statusFilter, sortBy });
  }, [filter, sourceFilter, statusFilter, sortBy, selectedAccount]);

  const handleDeletePost = async (post) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this post?\n\n"${post.post_content?.substring(0, 100)}${post.post_content?.length > 100 ? '...' : ''}"\n\nThis will remove the post from your history.`
    );
    
    if (!confirmed) return;

    const postId = post.id || post.linkedin_post_id;
    const isScheduled = !!post.scheduled_time || post.status === 'completed' || post.status === 'scheduled';

    try {
      setDeletingPosts(prev => new Set([...prev, postId]));
      
      if (isScheduled) {
        await scheduling.cancel(postId);
      } else {
        // Use fetch with account_id header for delete
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3004'}/api/posts/${postId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(accountId ? { 'X-Selected-Account-Id': accountId } : {})
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to delete post');
        }
      }
      
      setPostedPosts(prev => prev.filter(p => (p.id || p.linkedin_post_id) !== postId));
      toast.success('Post deleted successfully');
    } catch (err) {
      console.error('Delete error:', err);
      if (err.response?.status === 404 || err.message?.includes('not found')) {
        // Post not found, remove from UI anyway
        setPostedPosts(prev => prev.filter(p => (p.id || p.linkedin_post_id) !== postId));
        toast.success('Post removed from history');
      } else {
        toast.error('Failed to delete post: ' + (err.response?.data?.message || err.message));
      }
    } finally {
      setDeletingPosts(prev => {
        const newSet = new Set(prev);
        newSet.delete(postId);
        return newSet;
      });
    }
  };

  useEffect(() => {
    fetchPostedPosts();
  }, [filter, sortBy, sourceFilter, statusFilter, accountId]); // Re-fetch when account changes

  const fetchPostedPosts = async () => {
    try {
      setLoading(true);
      
      const params = {
        limit: 50,
        sort: sortBy === 'newest' ? 'created_at_desc' : 
              sortBy === 'oldest' ? 'created_at_asc' :
              sortBy === 'most_likes' ? 'likes_desc' : 'shares_desc'
      };

      if (filter !== 'all') {
        const now = new Date();
        let startDate;
        
        switch (filter) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          default:
            startDate = null;
        }
        
        if (startDate) {
          params.start_date = startDate.toISOString();
        }
      }

      // Use account-aware API to fetch history for selected account only
      const response = await fetchForCurrentAccount('/api/posts?' + new URLSearchParams(params));
      const data = await response.json();
      let fetchedPosts = data.posts || [];
      
      // Only fetch and merge completed/posted scheduled posts
      const scheduledRes = await fetchForCurrentAccount('/api/schedule?status=completed');
      const scheduledData = scheduledRes.ok ? await scheduledRes.json() : { posts: [] };
      const scheduledPosts = (scheduledData.posts || [])
        .filter(sp => sp.status === 'posted' || sp.status === 'completed')
        .map(sp => ({
          ...sp,
          linkedin_post_id: sp.id,
          views: sp.views || 0,
          likes: sp.likes || 0,
          shares: sp.shares || 0,
          comments: sp.comments || 0,
          created_at: sp.posted_at || sp.created_at,
          source: sp.source || 'platform',
          status: sp.status || 'posted'
        }));
      // Avoid duplicates: filter out posts already in fetchedPosts by linkedin_post_id
      const fetchedIds = new Set(fetchedPosts.map(p => p.linkedin_post_id || p.id));
      const uniqueScheduledPosts = scheduledPosts.filter(sp => !fetchedIds.has(sp.linkedin_post_id));
      fetchedPosts = [...fetchedPosts, ...uniqueScheduledPosts];
      
      // Apply source filter
      if (sourceFilter !== 'all') {
        fetchedPosts = fetchedPosts.filter(post => 
          post.source === sourceFilter || 
          (sourceFilter === 'platform' && !post.source)
        );
      }
      
      // Apply status filter
      if (statusFilter !== 'all') {
        fetchedPosts = fetchedPosts.filter(post => post.status === statusFilter);
      }
      
      fetchedPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      setPostedPosts(fetchedPosts);
    } catch (error) {
      console.error('[HISTORY] Fetch error:', error);
      showError('Failed to load post history', toast);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown time';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffMs / (1000 * 60));
    const diffInHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    
    if (diffInMinutes < 1) {
      return 'just now';
    }

    if (diffInMinutes < 60) {
      return rtf.format(-diffInMinutes, 'minute');
    }

    if (diffInHours < 24) {
      return rtf.format(-diffInHours, 'hour');
    }

    if (diffInDays < 7) {
      return rtf.format(-diffInDays, 'day');
    }

    return date.toLocaleString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: userTimezone
    });
  };

  const getMediaCount = (mediaUrls) => {
    let values = [];

    if (Array.isArray(mediaUrls)) {
      values = mediaUrls;
    } else if (typeof mediaUrls === 'string') {
      const trimmed = mediaUrls.trim();
      if (!trimmed) return 0;

      try {
        const parsed = JSON.parse(trimmed);
        values = Array.isArray(parsed) ? parsed : [];
      } catch {
        values = trimmed.includes(',') ? trimmed.split(',') : [trimmed];
      }
    }

    return values.filter((value) => {
      if (value === null || value === undefined) return false;
      const normalized = String(value).trim();
      return normalized !== '' && normalized.toLowerCase() !== 'null';
    }).length;
  };

  const getEngagementRate = (post) => {
    const totalEngagement = (post.likes || 0) + (post.shares || 0) + (post.comments || 0);
    const impressions = post.views || 1;
    return ((totalEngagement / impressions) * 100).toFixed(1);
  };

  const getPostUrl = (post) => {
    if (post.linkedin_post_id && post.post_url) {
      return post.post_url;
    }
    return null;
  };


  // Improved: Only show disconnected if selectedAccount is not found by id or account_id in accounts
  // Improved: Match by id, account_id, or username for all account types
  // TEMP WORKAROUND: Always show history if a selected account exists, regardless of accounts list
  // Remove this workaround when backend /api/team/accounts is fixed
  // const isAccountDisconnected = ...
  // if (isAccountDisconnected) { ... }
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading post history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header & Account Selector */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2.5 bg-blue-700 rounded-lg">
                <HistoryIcon className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-2xl font-semibold text-gray-900">
                LinkedIn Post History
              </h1>
            </div>
            <p className="text-gray-600 text-sm ml-12">
              View and analyze your posted LinkedIn content
            </p>
          </div>
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
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="space-y-6">
          {/* First Row: Time Filter and Sort */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Time Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Time Period</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Time' },
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: 'This Week' },
                  { value: 'month', label: 'This Month' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      filter === option.value
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort Options */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Sort by</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white cursor-pointer hover:border-gray-400 transition-colors"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="most_likes">Most Likes</option>
                <option value="most_shares">Most Shares</option>
              </select>
            </div>
          </div>

          {/* Second Row: Source and Status Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-4 border-t border-gray-100">
            {/* Source Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center space-x-2">
                <ExternalLink className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Source</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Posts' },
                  { value: 'platform', label: 'Platform' },
                  { value: 'external', label: 'LinkedIn' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSourceFilter(option.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      sourceFilter === option.value
                        ? 'bg-green-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Status</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All Status' },
                  { value: 'posted', label: 'Live' },
                  { value: 'deleted', label: 'Deleted' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setStatusFilter(option.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      statusFilter === option.value
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      {postedPosts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-semibold text-gray-900">
                  {postedPosts.length}
                </div>
                <div className="text-sm text-gray-600 mt-1">Total Posts</div>
              </div>
              <MessageCircle className="h-8 w-8 text-blue-700" />
            </div>
          </div>
        </div>
      )}

      {/* Post History List */}
      <div className="space-y-4">
        {postedPosts.length > 0 ? (
          postedPosts.map((post, idx) => {
            const postId = post.id || post.linkedin_post_id;
            const mediaCount = getMediaCount(post.media_urls);

            return (
              <div
                key={postId}
                className="bg-white rounded-lg border border-gray-200 hover:shadow-md transition-all p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Post Header */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <div className="flex items-center space-x-2">
                        <div className="h-9 w-9 bg-blue-700 rounded flex items-center justify-center">
                          <span className="text-white text-sm font-semibold">in</span>
                        </div>
                      </div>
                      
                      {/* Badges Row */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Source Badge */}
                        <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                          post.source === 'external' 
                            ? 'bg-green-100 text-green-700 border border-green-200' 
                            : 'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>
                          {post.source === 'external' ? 'LinkedIn' : 'Platform'}
                        </span>
                        
                        {/* Status Badge */}
                        {post.status === 'deleted' && (
                          <span className="px-2.5 py-1 bg-red-100 text-red-700 border border-red-200 rounded-md text-xs font-medium">
                            Deleted
                          </span>
                        )}
                        {post.status === 'posted' && (
                          <span className="px-2.5 py-1 bg-green-100 text-green-700 border border-green-200 rounded-md text-xs font-medium">
                            Live
                          </span>
                        )}
                        
                        {/* AI Generated Badge */}
                        {post.ai_generated && (
                          <span className="px-2.5 py-1 bg-purple-100 text-purple-700 border border-purple-200 rounded-md text-xs font-medium">
                            AI Generated
                          </span>
                        )}
                        
                        {/* Scheduled Badge */}
                        {post.scheduled_for && (
                          <span className="px-2.5 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-md text-xs font-medium">
                            Scheduled
                          </span>
                        )}
                      </div>
                      
                      {/* Time and Link */}
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-gray-500 font-medium">
                          {formatDate(post.display_created_at || post.posted_at || post.created_at)}
                        </span>
                        {getPostUrl(post) && (
                          <a
                            href={getPostUrl(post)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                            title="View on LinkedIn"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                    
                    {/* Post Content */}
                    <p className="text-gray-900 mb-4 whitespace-pre-wrap leading-relaxed break-words">
                      {post.post_content}
                    </p>

                    {/* Media Indicators */}
                    {mediaCount > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-md border border-blue-200 w-fit">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="font-medium">{mediaCount} media file(s)</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col items-end space-y-2">
                    {/* Delete Button - Only for platform posts */}
                    {post.source !== 'external' && (
                      <button
                        onClick={() => handleDeletePost(post)}
                        disabled={deletingPosts.has(postId)}
                        className="flex items-center gap-2 px-3 py-2 text-red-600 hover:text-white hover:bg-red-600 rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border border-red-200 hover:border-red-600 font-medium"
                        title="Delete post from history"
                      >
                        {deletingPosts.has(postId) ? (
                          <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        <span className="text-xs font-medium">Delete</span>
                      </button>
                    )}

                    {/* External Post Info */}
                    {post.source === 'external' && (
                      <div className="text-xs text-gray-600 bg-gray-100 px-3 py-2 rounded-md font-medium border border-gray-200">
                        Posted via LinkedIn
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 text-center py-12 px-6">
            <HistoryIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No posted content found
            </h3>
            <p className="text-gray-600 mb-6">
              {filter === 'all' 
                ? "You haven't posted any LinkedIn content yet"
                : `No posts found for the selected time period`
              }
            </p>
            <a
              href="/compose"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer font-medium"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Create Your First Post
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default History;
