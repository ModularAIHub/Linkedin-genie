import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Edit3, Trash2, Play, Pause } from 'lucide-react';
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
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scheduled Posts</h1>
          <p className="mt-2 text-gray-600">Manage your scheduled LinkedIn posts</p>
        </div>
      </div>
      <div className="flex gap-2 mb-4">
  <button className={`btn ${filter === 'scheduled' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('scheduled')}>Scheduled</button>
  <button className={`btn ${filter === 'completed' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('completed')}>Posted</button>
        <button className={`btn ${filter === 'failed' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('failed')}>Failed</button>
        <button className={`btn ${filter === 'cancelled' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('cancelled')}>Cancelled</button>
      </div>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Scheduled Posts</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Content</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Scheduled For</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(scheduledPosts || []).map(post => (
                <tr key={post.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 max-w-xs truncate" title={post.post_content}>{post.post_content}</td>
                  <td className="px-4 py-2">{formatDate(post.scheduled_time)}</td>
                  <td className="px-4 py-2">{post.status}</td>
                  <td className="px-4 py-2 flex gap-2">
                    {post.status === 'scheduled' && (
                      <button className="btn btn-warning btn-sm" onClick={() => handleCancel(post.id)}>Cancel</button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(post.id)} title="Delete scheduled post">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Scheduling;
