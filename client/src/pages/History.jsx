import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, MessageCircle, Heart, Share2, Calendar, Filter, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { posts, scheduling } from '../utils/api';
import LoadingSpinner from '../components/LoadingSpinner';

const History = () => {
  const [postedPosts, setPostedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [deletingId, setDeletingId] = useState(null);
  const handleDelete = async (postId, isScheduled) => {
      if (!window.confirm('Are you sure you want to delete this post? This cannot be undone.')) return;
      console.log('[DELETE] Attempting to delete post:', { postId, isScheduled });
      setDeletingId(postId);
      try {
        if (isScheduled) {
          await scheduling.cancel(postId);
        } else {
          console.log('Before axios delete', postId);
          await posts.delete(postId);
        }
        setPostedPosts((prev) => prev.filter((p) => p.id !== postId && p.linkedin_post_id !== postId));
      } catch (err) {
        window.alert('Failed to delete post.');
        console.error('Delete error:', err);
      } finally {
        setDeletingId(null);
      }
  };

  useEffect(() => {
    fetchPostedPosts();
  }, [filter, sortBy, statusFilter]);

  const fetchPostedPosts = async () => {
    try {
      setLoading(true);
      const params = { limit: 50, sort: sortBy };
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
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }
      // Fetch normal posts
      const response = await api.get('/api/posts', { params });
      let posts = response.data.posts || [];
      // Fetch completed scheduled posts
      const scheduledRes = await api.get('/api/schedule?status=completed');
      const scheduledPosts = (scheduledRes.data.posts || []).map(sp => ({
        ...sp,
        linkedin_post_id: sp.id,
        views: sp.views || '',
        likes: sp.likes || '',
        shares: sp.shares || '',
        created_at: sp.posted_at || sp.created_at
      }));
      // Merge and sort
      posts = [...posts, ...scheduledPosts];
      posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setPostedPosts(posts);
    } catch (error) {
      // Optionally handle error
    } finally {
      setLoading(false);
    }
  };

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Post History</h1>
          <p className="mt-2 text-gray-600">View your posted LinkedIn content</p>
        </div>
      </div>
      <div className="flex gap-2 mb-4">
        <button className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('all')}>All</button>
        <button className={`btn ${filter === 'today' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('today')}>Today</button>
        <button className={`btn ${filter === 'week' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('week')}>This Week</button>
        <button className={`btn ${filter === 'month' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('month')}>This Month</button>
      </div>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Posted Content</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Content</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Views</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Likes</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Shares</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Delete</th>
              </tr>
            </thead>
            <tbody>
              {(postedPosts || []).map(post => {
                  // Heuristic: scheduled posts have 'scheduled_time' or status 'completed', normal posts do not
                  const isScheduled = !!post.scheduled_time || post.status === 'completed';
                  // Use post.id if available, else linkedin_post_id
                  const deleteId = post.id || post.linkedin_post_id;
                  return (
                    <tr key={deleteId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 max-w-xs truncate" title={post.post_content}>{post.post_content}</td>
                      <td className="px-4 py-2">{post.views}</td>
                      <td className="px-4 py-2">{post.likes}</td>
                      <td className="px-4 py-2">{post.shares}</td>
                      <td className="px-4 py-2">{new Date(post.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2">
                        <button
                          className={`btn btn-sm btn-danger flex items-center gap-1 ${deletingId === deleteId ? 'opacity-50 cursor-not-allowed' : ''}`}
                          onClick={() => {
                            console.log('[DELETE BUTTON] post.id:', post.id, 'linkedin_post_id:', post.linkedin_post_id, 'isScheduled:', isScheduled);
                            handleDelete(deleteId, isScheduled);
                          }}
                          disabled={deletingId === deleteId}
                          title="Delete post"
                        >
                          <Trash2 size={16} />
                          {deletingId === deleteId ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default History;
