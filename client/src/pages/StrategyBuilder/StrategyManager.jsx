import React, { useState, useEffect } from 'react';
import { Trash2, Edit2, Plus, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { strategy as strategyApi } from '../../utils/api';

export default function StrategyManager({ onStrategiesChanged, autoCreate = false }) {
  const [strategies, setStrategies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(autoCreate);
  const [editData, setEditData] = useState({});
  const [createData, setCreateData] = useState({
    niche: '',
    target_audience: '',
    posting_frequency: '',
    content_goals: '',
    topics: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchStrategies();
  }, []);

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      console.log('🔍 Fetching strategies...');
      
      const result = await strategyApi.list();
      console.log('✅ Strategies loaded:', result.data);
      
      // API returns array directly
      const list = Array.isArray(result.data) ? result.data : (result.data.strategies || []);
      setStrategies(list);
      setCurrentIndex(0);
      setIsEditing(false);
      setError('');
    } catch (err) {
      console.error('❌ Error fetching strategies:', err);
      setError(err.message || 'Failed to fetch strategies');
    } finally {
      setLoading(false);
    }
  };

  const currentStrategy = strategies[currentIndex];

  const handleNextStrategy = () => {
    if (currentIndex < strategies.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsEditing(false);
    }
  };

  const handlePrevStrategy = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setIsEditing(false);
    }
  };

  const handleSelectStrategy = (index) => {
    setCurrentIndex(index);
    setIsEditing(false);
  };

  const handleEdit = () => {
    setEditData({ ...currentStrategy });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({});
  };

  const handleSaveEdit = async () => {
    try {
      console.log('💾 Saving strategy changes...');
      
      await strategyApi.update(currentStrategy.id, {
        niche: editData.niche,
        target_audience: editData.target_audience,
        posting_frequency: editData.posting_frequency,
        status: editData.status
      });

      console.log('✅ Strategy updated');
      setSuccess('Strategy updated successfully!');
      setIsEditing(false);
      fetchStrategies();
      onStrategiesChanged?.();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('❌ Error saving strategy:', err);
      setError(err.message || 'Failed to update strategy');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this strategy?')) {
      return;
    }

    try {
      console.log('🗑️ Deleting strategy:', currentStrategy.id);
      
      await strategyApi.delete(currentStrategy.id);

      console.log('✅ Strategy deleted');
      setSuccess('Strategy deleted successfully!');
      
      // Remove the deleted strategy from the list
      const newStrategies = strategies.filter(s => s.id !== currentStrategy.id);
      setStrategies(newStrategies);
      
      // Adjust current index
      if (currentIndex >= newStrategies.length) {
        setCurrentIndex(Math.max(0, newStrategies.length - 1));
      }
      
      setIsEditing(false);
      onStrategiesChanged?.();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('❌ Error deleting strategy:', err);
      setError(err.message || 'Failed to delete strategy');
    }
  };

  const handleCreateNew = () => {
    window.location.href = '/strategy?new=true';
  };

  const handleOpenCreateForm = () => {
    setCreateData({
      niche: '',
      target_audience: '',
      posting_frequency: '',
      content_goals: '',
      topics: ''
    });
    setIsCreating(true);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setCreateData({
      niche: '',
      target_audience: '',
      posting_frequency: '',
      content_goals: '',
      topics: ''
    });
    setError('');
  };

  const handleSubmitCreate = async () => {
    try {
      if (!createData.niche.trim()) {
        setError('Strategy name/niche is required');
        return;
      }

      console.log('📝 Creating new strategy:', createData);

      const response = await strategyApi.create({
        niche: createData.niche,
        target_audience: createData.target_audience,
        posting_frequency: createData.posting_frequency,
        content_goals: createData.content_goals ? createData.content_goals.split(',').map(g => g.trim()) : [],
        topics: createData.topics ? createData.topics.split(',').map(t => t.trim()) : [],
        status: 'draft'
      });

      console.log('✅ Strategy created:', response.data);
      setSuccess('Strategy created successfully!');
      setIsCreating(false);
      
      // Reload strategies and show the new one
      await fetchStrategies();
      onStrategiesChanged?.();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('❌ Error creating strategy:', err);
      setError(err.message || 'Failed to create strategy');
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      draft: 'bg-gray-100 text-gray-800',
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      archived: 'bg-red-100 text-red-800'
    };
    return styles[status] || styles.draft;
  };

  // Show creation form if creating
  if (isCreating) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 bg-white rounded-lg border border-gray-200 p-8 flex flex-col max-w-3xl mx-auto w-full overflow-y-auto">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Create New Strategy</h2>
            <p className="text-gray-600">Fill in the details about your LinkedIn strategy. You'll refine these further in the next step.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <div className="space-y-8 flex-1">
            {/* Strategy Name / Niche */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Strategy Name / Niche <span className="text-red-500">*</span>
              </label>
              <p className="text-sm text-gray-600 mb-3">
                What's your main content niche? Be specific - the more targeted, the better your AI recommendations.
              </p>
              <input
                type="text"
                placeholder="e.g., B2B SaaS, AI Tools, Fitness Coaching, Personal Finance"
                value={createData.niche}
                onChange={(e) => setCreateData({ ...createData, niche: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">💡 Tip: Instead of generic "Tech", try "AI SaaS for Startups"</p>
            </div>

            {/* Target Audience */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Target Audience</label>
              <p className="text-sm text-gray-600 mb-3">
                Who do you want to reach? Describe their role, pain points, or what they're interested in.
              </p>
              <input
                type="text"
                placeholder="e.g., First-time founders, Senior developers, Indie hackers, Marketing managers"
                value={createData.target_audience}
                onChange={(e) => setCreateData({ ...createData, target_audience: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">💡 Tip: Be specific about who benefits most from your content</p>
            </div>

            {/* Posting Frequency */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Posting Frequency</label>
              <p className="text-sm text-gray-600 mb-3">
                How often do you plan to post? This helps us suggest optimal posting times and content volume.
              </p>
              <input
                type="text"
                placeholder="e.g., Daily, 3-4x per week, 2x daily, Weekly"
                value={createData.posting_frequency}
                onChange={(e) => setCreateData({ ...createData, posting_frequency: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">💡 Tip: Consistency matters more than frequency. Choose what you can sustain.</p>
            </div>

            {/* Content Goals */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Content Goals</label>
              <p className="text-sm text-gray-600 mb-3">
                What do you want to achieve with your content? List your primary goals (separate with commas).
              </p>
              <textarea
                placeholder="e.g., Educate & provide value, Build community, Establish authority, Drive traffic"
                value={createData.content_goals}
                onChange={(e) => setCreateData({ ...createData, content_goals: e.target.value })}
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">
                💡 Common goals: Educate, Build community, Establish authority, Drive traffic, Generate leads, Inspire
              </p>
            </div>

            {/* Topics */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Main Topics</label>
              <p className="text-sm text-gray-600 mb-3">
                What topics will you cover? List the main themes you'll discuss (separate with commas).
              </p>
              <textarea
                placeholder="e.g., AI trends, Startup lessons, Productivity hacks, Marketing strategies, Design thinking"
                value={createData.topics}
                onChange={(e) => setCreateData({ ...createData, topics: e.target.value })}
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">
                💡 Listing specific topics helps us generate more relevant content ideas for your audience
              </p>
            </div>

            {/* Helper Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">📋 Example Strategy</h3>
              <div className="text-sm text-blue-800 space-y-1">
                <p><strong>Niche:</strong> B2B SaaS for Founders</p>
                <p><strong>Audience:</strong> First-time founders building their first SaaS</p>
                <p><strong>Frequency:</strong> 3-4x per week</p>
                <p><strong>Goals:</strong> Educate, Build community, Establish authority</p>
                <p><strong>Topics:</strong> Product development, User research, Growth hacking, Fundraising</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-8 border-t border-gray-200 mt-8">
            <button
              onClick={handleCancelCreate}
              className="px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitCreate}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!createData.niche.trim()}
            >
              <Check size={18} />
              Create Strategy
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading strategies...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
          {success}
        </div>
      )}

      {/* Instructions Box */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex gap-3">
          <div className="text-2xl">📚</div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">How to use Strategies</h3>
            <p className="text-sm text-gray-700">
              Each strategy represents a distinct LinkedIn content approach. You can have multiple strategies for different audiences or niches. 
              Use the navigation buttons below to browse your strategies, or create a new one to get started.
            </p>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {strategies.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-lg border-2 border-dashed border-gray-200">
          <p className="text-gray-500 mb-6 text-lg">No strategies yet. Create your first one!</p>
          <button
            onClick={handleOpenCreateForm}
            className="flex items-center gap-2 bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition"
          >
            <Plus size={20} />
            Create Strategy
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Strategy Navigation */}
          <div className="flex items-center justify-between mb-6 bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-4">
              <button
                onClick={handlePrevStrategy}
                disabled={currentIndex === 0}
                className="p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
              >
                <ChevronLeft size={20} />
              </button>

              <select
                value={currentIndex}
                onChange={(e) => handleSelectStrategy(parseInt(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {strategies.map((s, idx) => (
                  <option key={s.id} value={idx}>
                    {s.niche} ({idx + 1} of {strategies.length})
                  </option>
                ))}
              </select>

              <button
                onClick={handleNextStrategy}
                disabled={currentIndex === strategies.length - 1}
                className="p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <button
              onClick={handleOpenCreateForm}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              <Plus size={18} />
              New Strategy
            </button>
          </div>

          {/* Strategy Card */}
          <div className="flex-1 bg-white rounded-lg border border-gray-200 p-8 flex flex-col">
            {isEditing ? (
              // Edit Mode
              <div className="space-y-6 flex-1">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Niche</label>
                  <input
                    type="text"
                    value={editData.niche || ''}
                    onChange={(e) => setEditData({ ...editData, niche: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Target Audience</label>
                  <input
                    type="text"
                    value={editData.target_audience || ''}
                    onChange={(e) => setEditData({ ...editData, target_audience: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Posting Frequency</label>
                  <input
                    type="text"
                    value={editData.posting_frequency || ''}
                    onChange={(e) => setEditData({ ...editData, posting_frequency: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={editData.status || ''}
                    onChange={(e) => setEditData({ ...editData, status: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div className="flex gap-3 justify-end mt-8">
                  <button
                    onClick={handleCancelEdit}
                    className="flex items-center gap-2 px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition font-medium"
                  >
                    <X size={18} />
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition font-medium"
                  >
                    <Check size={18} />
                    Save Changes
                  </button>
                </div>
              </div>
            ) : (
              // View Mode
              <div className="flex flex-col h-full">
                {/* Quick Actions Guide */}
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6 text-sm text-indigo-900">
                  <p>✨ <strong>Pro Tip:</strong> Go to the <strong>Setup tab</strong> to refine this strategy with our AI assistant, or use <strong>Overview</strong> when ready to start creating content.</p>
                </div>

                <div className="flex-1">
                  <div className="flex items-start justify-between mb-8">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-4">
                        <h2 className="text-4xl font-bold text-gray-900">{currentStrategy.niche}</h2>
                        <span className={`px-4 py-2 rounded-full text-sm font-semibold ${getStatusBadge(currentStrategy.status)}`}>
                          {currentStrategy.status}
                        </span>
                      </div>
                      <p className="text-gray-600 text-lg">
                        <strong>Target Audience:</strong> {currentStrategy.target_audience || 'Not specified'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">POSTING FREQUENCY</label>
                      <p className="text-lg font-semibold text-gray-900">{currentStrategy.posting_frequency || 'Not specified'}</p>
                    </div>

                    {currentStrategy.content_goals && currentStrategy.content_goals.length > 0 && (
                      <div className="bg-blue-50 rounded-lg p-4">
                        <label className="block text-sm font-medium text-gray-700 mb-3">CONTENT GOALS</label>
                        <div className="flex flex-wrap gap-2">
                          {currentStrategy.content_goals.map((goal, idx) => (
                            <span key={idx} className="px-3 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                              🎯 {goal}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentStrategy.topics && currentStrategy.topics.length > 0 && (
                      <div className="bg-purple-50 rounded-lg p-4">
                        <label className="block text-sm font-medium text-gray-700 mb-3">MAIN TOPICS</label>
                        <div className="flex flex-wrap gap-2">
                          {currentStrategy.topics.map((topic, idx) => (
                            <span key={idx} className="px-3 py-2 bg-purple-100 text-purple-800 rounded-full text-sm font-medium">
                              📌 {topic}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-gray-500 pt-4">
                      Created: {new Date(currentStrategy.created_at).toLocaleDateString()} at {new Date(currentStrategy.created_at).toLocaleTimeString()}
                    </div>
                  </div>

                  {/* What to do next */}
                  <div className="mt-6 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                    <h3 className="font-semibold text-green-900 mb-2">📖 What's Next?</h3>
                    <ul className="text-sm text-green-850 space-y-1">
                      <li>✏️ <strong>Need to adjust?</strong> Click "Edit" to modify strategy details</li>
                      <li>🚀 <strong>Ready to build?</strong> Go to Setup tab to refine with AI</li>
                      <li>⚡ <strong>Have multiple niches?</strong> Create another strategy above</li>
                    </ul>
                  </div>
                </div>

                <div className="flex gap-3 justify-end pt-8 border-t border-gray-200 mt-8">
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-2 px-6 py-3 text-red-600 hover:bg-red-50 rounded-lg transition font-medium"
                  >
                    <Trash2 size={18} />
                    Delete
                  </button>
                  <button
                    onClick={handleEdit}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition font-medium"
                  >
                    <Edit2 size={18} />
                    Edit
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

