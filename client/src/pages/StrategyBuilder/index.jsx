import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Layout,
  Library,
  ArrowLeft,
  Loader2,
  Edit2,
  Trash2,
  Plus,
  AlertCircle,
  Wand2,
  Lock,
  X,
} from 'lucide-react';
import ChatInterface from './ChatInterface';
import StrategyOverview from './StrategyOverview';
import PromptLibrary from './PromptLibrary';
import { strategy as strategyApi } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { hasProPlanAccess } from '../../utils/planAccess';
import { getSuiteGenieProUpgradeUrl } from '../../utils/upgradeUrl';

const isReconnectRequiredError = (error) =>
  error?.response?.data?.code === 'LINKEDIN_RECONNECT_REQUIRED' ||
  error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
  error?.response?.data?.reconnect === true;

const STRATEGY_TEMPLATES = [
  {
    name: 'Founder Build in Public',
    description: 'Share product progress, lessons, and customer wins every week.',
  },
  {
    name: 'Niche Expert Growth',
    description: 'Teach one topic deeply and build authority with practical LinkedIn posts.',
  },
  {
    name: 'Creator Audience Engine',
    description: 'Use storytelling plus educational hooks to grow followers.',
  },
];

const StrategyBuilder = () => {
  const { user } = useAuth();
  const hasProAccess = hasProPlanAccess(user);
  const upgradeUrl = getSuiteGenieProUpgradeUrl();
  const [currentView, setCurrentView] = useState('chat');
  const [strategy, setStrategy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [editGoals, setEditGoals] = useState([]);
  const [editTopics, setEditTopics] = useState([]);
  const [goalInput, setGoalInput] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [strategyOptions, setStrategyOptions] = useState([]);
  const [switchingStrategyId, setSwitchingStrategyId] = useState('');

  const normalizeListItem = (value) => value.trim().replace(/\s+/g, ' ').slice(0, 80);

  const addListItem = (inputValue, currentItems, setItems, setInput) => {
    const candidates = String(inputValue || '')
      .split(',')
      .map((value) => normalizeListItem(value))
      .filter(Boolean);

    if (candidates.length === 0) {
      setInput('');
      return;
    }

    const nextItems = [...currentItems];
    const seen = new Set(nextItems.map((item) => item.toLowerCase()));

    for (const candidate of candidates) {
      if (seen.has(candidate.toLowerCase()) || nextItems.length >= 20) {
        continue;
      }

      nextItems.push(candidate);
      seen.add(candidate.toLowerCase());
    }

    setItems(nextItems);
    setInput('');
  };

  const removeListItem = (index, currentItems, setItems) => {
    setItems(currentItems.filter((_, idx) => idx !== index));
  };

  const openCreateStrategyForm = () => {
    setTeamName('');
    setTeamDescription('');
    setEditGoals([]);
    setEditTopics([]);
    setGoalInput('');
    setTopicInput('');
    setFormMode('create');
    setShowCreateForm(true);
    setCurrentView('chat');
  };

  const applyLoadedStrategy = (loadedStrategy) => {
    setStrategy(loadedStrategy);
    setSwitchingStrategyId(loadedStrategy?.id || '');

    const basicProfileCompleted = Boolean(loadedStrategy?.metadata?.basic_profile_completed);
    const needsBasicSetup = loadedStrategy.status !== 'active' && !basicProfileCompleted;

    if (needsBasicSetup) {
      setTeamName(loadedStrategy.niche || '');
      setTeamDescription(loadedStrategy.target_audience || '');
      setEditGoals(Array.isArray(loadedStrategy.content_goals) ? loadedStrategy.content_goals : []);
      setEditTopics(Array.isArray(loadedStrategy.topics) ? loadedStrategy.topics : []);
      setGoalInput('');
      setTopicInput('');
      setFormMode('edit');
      setShowCreateForm(true);
      setCurrentView('chat');
      return;
    }

    setShowCreateForm(false);
    setCurrentView(loadedStrategy.status === 'active' ? 'overview' : 'chat');
  };

  const fetchStrategyList = async (preferredStrategyId = null) => {
    const response = await strategyApi.list();
    const list = Array.isArray(response?.data) ? response.data : [];
    setStrategyOptions(list);

    if (!list.length) {
      setSwitchingStrategyId('');
      return list;
    }

    const hasPreferred = preferredStrategyId && list.some((item) => item.id === preferredStrategyId);
    const fallbackId = list[0]?.id || '';
    setSwitchingStrategyId(hasPreferred ? preferredStrategyId : fallbackId);

    return list;
  };

  useEffect(() => {
    if (!hasProAccess) {
      setLoading(false);
      return;
    }

    loadStrategy();
  }, [hasProAccess]);

  const loadStrategy = async () => {
    try {
      setLoading(true);
      setError(null);
      setIsDisconnected(false);

      const response = await strategyApi.getCurrent();
      const loadedStrategy = response?.data?.strategy;

      if (!loadedStrategy) {
        throw new Error('Strategy payload missing');
      }

      applyLoadedStrategy(loadedStrategy);
      await fetchStrategyList(loadedStrategy.id);
    } catch (loadError) {
      if (isReconnectRequiredError(loadError)) {
        setIsDisconnected(true);
        setStrategy(null);
        setShowCreateForm(false);
        setStrategyOptions([]);
        setSwitchingStrategyId('');
        return;
      }

      if (loadError?.response?.status === 404) {
        setStrategy(null);
        setStrategyOptions([]);
        setSwitchingStrategyId('');
        setEditGoals([]);
        setEditTopics([]);
        setGoalInput('');
        setTopicInput('');
        openCreateStrategyForm();
        return;
      }

      const backendMessage =
        loadError?.response?.data?.error ||
        loadError?.response?.data?.details ||
        loadError?.response?.data?.message ||
        loadError?.message ||
        null;
      setError(backendMessage ? `Failed to load Strategy Builder: ${backendMessage}` : 'Failed to load Strategy Builder. Please try again.');
      setShowCreateForm(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStrategy = async () => {
    if (!teamName.trim()) {
      setError('Strategy name is required');
      return;
    }

    try {
      setCreatingTeam(true);
      setError(null);
      const basicProfileMetadata = {
        ...(strategy?.metadata || {}),
        basic_profile_completed: true,
        basic_profile_completed_at: new Date().toISOString(),
      };

      let savedStrategy;
      if (formMode === 'edit' && strategy?.id) {
        const updatePayload = {
          niche: teamName.trim(),
          target_audience: teamDescription.trim(),
          metadata: basicProfileMetadata,
        };

        if (isAdvancedEditMode) {
          updatePayload.content_goals = editGoals;
          updatePayload.topics = editTopics;
        }

        const response = await strategyApi.update(strategy.id, updatePayload);
        savedStrategy = response.data;
      } else {
        const response = await strategyApi.create({
          niche: teamName.trim(),
          target_audience: teamDescription.trim(),
          posting_frequency: '',
          status: 'draft',
          metadata: basicProfileMetadata,
        });
        savedStrategy = response.data;
      }

      applyLoadedStrategy(savedStrategy);
      await fetchStrategyList(savedStrategy.id);
    } catch (saveError) {
      if (isReconnectRequiredError(saveError)) {
        setIsDisconnected(true);
        setShowCreateForm(false);
        setError(null);
        return;
      }
      setError(saveError.response?.data?.error || saveError.message || 'Failed to save strategy. Please try again.');
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleChatComplete = (completedStrategy) => {
    setStrategy(completedStrategy);
    setCurrentView('overview');
    setSwitchingStrategyId(completedStrategy?.id || '');
    setStrategyOptions((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const index = current.findIndex((item) => item.id === completedStrategy?.id);
      if (index === -1) {
        return completedStrategy ? [completedStrategy, ...current] : current;
      }
      const next = [...current];
      next[index] = { ...next[index], ...completedStrategy };
      return next;
    });
  };

  const handleStrategyUpdated = (updatedStrategy) => {
    if (!updatedStrategy) {
      return;
    }

    setStrategy(updatedStrategy);
    setSwitchingStrategyId(updatedStrategy.id || '');
    setStrategyOptions((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const index = current.findIndex((item) => item.id === updatedStrategy.id);
      if (index === -1) {
        return [updatedStrategy, ...current];
      }
      const next = [...current];
      next[index] = { ...next[index], ...updatedStrategy };
      return next;
    });
  };

  const handleEditStrategy = () => {
    setTeamName(strategy?.niche || '');
    setTeamDescription(strategy?.target_audience || '');
    setEditGoals(Array.isArray(strategy?.content_goals) ? strategy.content_goals : []);
    setEditTopics(Array.isArray(strategy?.topics) ? strategy.topics : []);
    setGoalInput('');
    setTopicInput('');
    setFormMode('edit');
    setShowCreateForm(true);
  };

  const handleDeleteStrategy = async () => {
    if (!window.confirm('Are you sure you want to delete this strategy? This action cannot be undone.')) {
      return;
    }

    try {
      await strategyApi.delete(strategy.id);
      const remainingStrategies = await fetchStrategyList();

      if (remainingStrategies.length > 0) {
        const nextStrategyId = remainingStrategies[0].id;
        const response = await strategyApi.getById(nextStrategyId);
        const nextStrategy = response?.data?.strategy;

        if (nextStrategy) {
          applyLoadedStrategy(nextStrategy);
          return;
        }
      }

      setStrategy(null);
      openCreateStrategyForm();
    } catch (deleteError) {
      if (isReconnectRequiredError(deleteError)) {
        setIsDisconnected(true);
        setShowCreateForm(false);
        setError(null);
        return;
      }
      setError('Failed to delete strategy');
    }
  };

  const handleCreateNew = () => {
    openCreateStrategyForm();
  };

  const handleGeneratePrompts = () => {
    setCurrentView('prompts');
  };

  const handleSwitchStrategy = async (event) => {
    const nextStrategyId = event.target.value;
    setSwitchingStrategyId(nextStrategyId);

    if (!nextStrategyId || nextStrategyId === strategy?.id) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await strategyApi.getById(nextStrategyId);
      const nextStrategy = response?.data?.strategy;

      if (!nextStrategy) {
        throw new Error('Strategy not found');
      }

      applyLoadedStrategy(nextStrategy);
      await fetchStrategyList(nextStrategy.id);
    } catch (switchError) {
      if (isReconnectRequiredError(switchError)) {
        setIsDisconnected(true);
        setShowCreateForm(false);
        setError(null);
        return;
      }

      setError(
        switchError?.response?.data?.error ||
          switchError.message ||
          'Failed to switch strategy. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const hasCompletedBasicProfile =
    Boolean(strategy?.metadata?.basic_profile_completed) || strategy?.status === 'active';
  const isAdvancedEditMode = formMode === 'edit' && hasCompletedBasicProfile;

  const tabs = [
    {
      id: 'chat',
      label: 'Setup',
      icon: MessageSquare,
      visible: strategy?.status !== 'active',
    },
    {
      id: 'overview',
      label: 'Overview',
      icon: Layout,
      visible: strategy !== null,
    },
    {
      id: 'prompts',
      label: 'Prompts',
      icon: Library,
      visible: strategy !== null,
    },
  ].filter((tab) => tab.visible);

  if (!hasProAccess) {
    return (
      <div className="min-h-[70vh] max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <Lock className="h-6 w-6 text-amber-700 mt-0.5" />
            <div>
              <h1 className="text-2xl font-bold text-amber-900">Strategy Builder is a Pro feature</h1>
              <p className="mt-2 text-sm text-amber-800">
                The page is visible on Free, but creating and managing AI strategy workflows requires Pro.
              </p>
              <a
                href={upgradeUrl}
                className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Upgrade to Pro
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">What you will unlock</h2>
          <ul className="mt-3 text-sm text-gray-700 space-y-2">
            <li>Guided AI setup for audience, goals, and strategy direction.</li>
            <li>Prompt library generation tied to your strategy profile.</li>
            <li>One-click handoff into Bulk Generation for faster execution.</li>
          </ul>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading Strategy Builder...</p>
        </div>
      </div>
    );
  }

  if (isDisconnected) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-xl w-full p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">LinkedIn Connection Required</h2>
          <p className="text-gray-600 mb-6">
            Reconnect your LinkedIn account in Settings to use Strategy Builder.
          </p>
          <a
            href="/settings"
            className="inline-flex items-center justify-center px-5 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  if (showCreateForm) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-5 sm:p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2">
              {isAdvancedEditMode ? 'Edit Strategy' : 'Create Your Strategy'}
            </h1>
            <p className="text-gray-600 text-sm sm:text-lg">
              {isAdvancedEditMode ? 'Update your strategy details' : 'Set up your LinkedIn content strategy in under a minute'}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                Team / Strategy Name <span className="text-red-500">*</span>
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Enter your team or strategy name. This is required before setup questions.
              </p>
              <input
                type="text"
                placeholder="e.g., B2B SaaS Growth"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                disabled={creatingTeam}
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">Quick Start Templates (Optional)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {STRATEGY_TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => {
                      setTeamName(template.name);
                      setTeamDescription(template.description);
                    }}
                    className="text-left p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1 text-gray-900 font-medium">
                      <Wand2 className="w-4 h-4 text-blue-600" />
                      <span>{template.name}</span>
                    </div>
                    <p className="text-xs text-gray-600">{template.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                Description <span className="text-gray-400">(Optional)</span>
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Describe what this strategy is about.
              </p>
              <textarea
                placeholder="e.g., Helping founders grow with clear marketing playbooks"
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={creatingTeam}
              />
            </div>

            {isAdvancedEditMode && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    Content Goals <span className="text-gray-400">(Optional)</span>
                  </label>
                  <p className="text-sm text-gray-600 mb-3">
                    Add up to 20 goals. Press Enter or click Add.
                  </p>
                  {editGoals.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {editGoals.map((goal, index) => (
                        <span
                          key={`${goal}-${index}`}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-sm"
                        >
                          {goal}
                          <button
                            type="button"
                            onClick={() => removeListItem(index, editGoals, setEditGoals)}
                            className="text-blue-500 hover:text-blue-700"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={goalInput}
                      onChange={(e) => setGoalInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addListItem(goalInput, editGoals, setEditGoals, setGoalInput);
                        }
                      }}
                      placeholder="e.g., Grow followers organically"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={creatingTeam}
                    />
                    <button
                      type="button"
                      onClick={() => addListItem(goalInput, editGoals, setEditGoals, setGoalInput)}
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                      disabled={creatingTeam}
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    Content Topics <span className="text-gray-400">(Optional)</span>
                  </label>
                  <p className="text-sm text-gray-600 mb-3">
                    Add up to 20 topics. Press Enter or click Add.
                  </p>
                  {editTopics.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {editTopics.map((topic, index) => (
                        <span
                          key={`${topic}-${index}`}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-sm"
                        >
                          {topic}
                          <button
                            type="button"
                            onClick={() => removeListItem(index, editTopics, setEditTopics)}
                            className="text-indigo-500 hover:text-indigo-700"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={topicInput}
                      onChange={(e) => setTopicInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addListItem(topicInput, editTopics, setEditTopics, setTopicInput);
                        }
                      }}
                      placeholder="e.g., Growth tactics"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={creatingTeam}
                    />
                    <button
                      type="button"
                      onClick={() => addListItem(topicInput, editTopics, setEditTopics, setTopicInput)}
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                      disabled={creatingTeam}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                <strong>Next:</strong> You can answer 7 guided questions or use AI quick setup from chat to auto-complete faster.
              </p>
            </div>

            <button
              onClick={handleSaveStrategy}
              disabled={!teamName.trim() || creatingTeam}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {creatingTeam ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {isAdvancedEditMode ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                <>{isAdvancedEditMode ? 'Update Strategy' : 'Continue to Setup Questions'}</>
              )}
            </button>

            {strategy && hasCompletedBasicProfile && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setCurrentView(strategy.status === 'active' ? 'overview' : 'chat');
                }}
                className="w-full py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Failed to Load</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => {
                setError(null);
                loadStrategy();
              }}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                window.location.href = '/dashboard';
              }}
              className="ml-3 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3 sm:gap-4 w-full lg:w-auto">
              <button
                onClick={() => {
                  window.location.href = '/dashboard';
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">Strategy Builder</h1>
                <p className="text-sm text-gray-600">
                  {strategy ? strategy.niche : 'Build your personalized LinkedIn content strategy'}
                </p>
              </div>
            </div>

            {strategy && (
              <div className="flex flex-wrap items-center gap-2">
                {strategyOptions.length > 1 && (
                  <select
                    value={switchingStrategyId || strategy.id}
                    onChange={handleSwitchStrategy}
                    className="max-w-[260px] w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title="Switch strategy"
                  >
                    {strategyOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {(item.niche || 'Untitled strategy')} ({item.status || 'draft'})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handleEditStrategy}
                  title="Edit strategy"
                  className="p-2 text-gray-600 hover:bg-blue-100 hover:text-blue-600 rounded-lg transition-colors"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  onClick={handleCreateNew}
                  title="Create new strategy"
                  className="p-2 text-gray-600 hover:bg-green-100 hover:text-green-600 rounded-lg transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  onClick={handleDeleteStrategy}
                  title="Delete strategy"
                  className="p-2 text-gray-600 hover:bg-red-100 hover:text-red-600 rounded-lg transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            )}

            <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg lg:ml-4">
              <span className="text-sm text-gray-600">Chat: 0.5 credits</span>
              <span className="text-gray-400">|</span>
              <span className="text-sm text-gray-600">Generate Prompts: 10 credits</span>
            </div>
          </div>

          {tabs.length > 1 && (
            <div className="flex gap-1 mt-4 border-b border-gray-200 overflow-x-auto scrollbar-thin">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = currentView === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setCurrentView(tab.id)}
                    className={`flex items-center gap-2 px-4 sm:px-6 py-3 font-medium transition-colors relative whitespace-nowrap ${
                      isActive ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                    {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {!strategy && (
          <div className="flex items-center justify-center h-[calc(100vh-300px)]">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Initializing your strategy...</p>
            </div>
          </div>
        )}

        {currentView === 'chat' && strategy && (
          <div className="max-w-4xl mx-auto h-[calc(100dvh-170px)] min-h-[540px] sm:h-[calc(100vh-200px)]">
            <ChatInterface strategyId={strategy.id} onComplete={handleChatComplete} />
          </div>
        )}

        {currentView === 'overview' && strategy && (
          <StrategyOverview
            strategy={strategy}
            onGeneratePrompts={handleGeneratePrompts}
            onStrategyUpdated={handleStrategyUpdated}
          />
        )}

        {currentView === 'prompts' && strategy && <PromptLibrary strategyId={strategy.id} />}
      </div>
    </div>
  );
};

export default StrategyBuilder;
