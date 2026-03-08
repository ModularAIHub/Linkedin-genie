import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Lock,
  Sparkles,
  Rocket,
  PencilLine,
  BookOpen,
  Database,
  ArrowRight,
} from 'lucide-react';
import ChatInterface from './ChatInterface';
import StrategyOverview from './StrategyOverview';
import PromptLibrary from './PromptLibrary';
import AnalysisFlow from './AnalysisFlow';
import AutomationFlow from './AutomationFlow';
import ContextVault from './ContextVault';
import StrategySetupForm from './StrategySetupForm';
import {
  VIEW_META,
  compactStrategyLabel,
  isReconnectRequiredError,
} from './strategyBuilderConfig';
import { strategy as strategyApi } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { hasProPlanAccess } from '../../utils/planAccess';
import { getSuiteGenieProUpgradeUrl } from '../../utils/upgradeUrl';

const StrategyBuilder = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasProAccess = hasProPlanAccess(user);
  const upgradeUrl = getSuiteGenieProUpgradeUrl();
  const [currentView, setCurrentView] = useState('chat');
  const [strategy, setStrategy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
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
  const [showAnalysisFlow, setShowAnalysisFlow] = useState(false);
  const [setupMode, setSetupMode] = useState('auto');

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
    setSetupMode('auto');
  };

  const applyLoadedStrategy = (loadedStrategy, preferredView = null) => {
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
    const defaultView = loadedStrategy.status === 'active' ? 'overview' : 'chat';
    const nextView =
      preferredView && ['chat', 'overview', 'prompts', 'content', 'vault'].includes(preferredView)
        ? preferredView
        : defaultView;
    setCurrentView(nextView);
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

  const handleSaveStrategy = async ({ nextView = null } = {}) => {
    if (!teamName.trim()) {
      setError('Strategy name is required');
      return null;
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

      applyLoadedStrategy(savedStrategy, nextView);
      if (nextView) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('tab', nextView);
        setSearchParams(nextParams, { replace: true });
      }
      await fetchStrategyList(savedStrategy.id);
      return savedStrategy;
    } catch (saveError) {
      if (isReconnectRequiredError(saveError)) {
        setIsDisconnected(true);
        setShowCreateForm(false);
        setError(null);
        return null;
      }
      setError(saveError.response?.data?.error || saveError.message || 'Failed to save strategy. Please try again.');
      return null;
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
    setIsGeneratingPrompts(true);
    setCurrentView('prompts');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'prompts');
    setSearchParams(nextParams, { replace: true });
  };

  const handleStartAnalysisFlow = async () => {
    let activeStrategy = strategy;

    if (!activeStrategy?.id || showCreateForm) {
      const saved = await handleSaveStrategy({ nextView: 'chat' });
      if (!saved?.id) return;
      activeStrategy = saved;
    }

    setShowCreateForm(false);
    setShowAnalysisFlow(true);
    setCurrentView('chat');
    setSetupMode('auto');
  };

  const handleAnalysisComplete = async (result = {}) => {
    const requestedNext = String(result?.next || '').trim().toLowerCase();
    const nextView = requestedNext === 'overview' ? 'overview' : 'prompts';

    setShowAnalysisFlow(false);
    setIsGeneratingPrompts(nextView === 'prompts');
    setCurrentView(nextView);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', nextView);
    setSearchParams(nextParams, { replace: true });

    if (strategy?.id) {
      try {
        const response = await strategyApi.getById(strategy.id);
        const updatedStrategy = response?.data?.strategy;
        if (updatedStrategy) {
          setStrategy(updatedStrategy);
          fetchStrategyList(updatedStrategy.id).catch(() => {});
        }
      } catch {}
    }
  };

  const handleAnalysisCancel = () => {
    setShowAnalysisFlow(false);
    setCurrentView(strategy?.status === 'active' ? 'overview' : 'chat');
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
      description: 'Capture strategy inputs',
      visible: strategy !== null,
    },
    {
      id: 'overview',
      label: 'Review',
      icon: Layout,
      description: 'Review strategy quality',
      visible: strategy !== null,
    },
    {
      id: 'prompts',
      label: 'Prompt Pack',
      icon: Library,
      description: 'Generate and use prompts',
      visible: strategy !== null,
    },
    {
      id: 'content',
      label: 'Content Plan',
      icon: Sparkles,
      description: 'Publish-ready posts and approvals',
      visible: strategy !== null,
    },
    {
      id: 'vault',
      label: 'Context Vault',
      icon: Database,
      description: 'Persistent memory and signal health',
      visible: strategy !== null,
    },
  ].filter((tab) => tab.visible);

  const strategyIsActive = strategy?.status === 'active';
  const strategyLabel = compactStrategyLabel(strategy?.niche || '');
  const contentPlanStatus = String(strategy?.metadata?.content_plan_status || '').trim().toLowerCase();
  const contentPlanQueueCount = Number(strategy?.metadata?.content_plan_queue_count || 0);
  const hasReadyContentPlan = contentPlanStatus === 'ready' && contentPlanQueueCount > 0;
  const tabCompletion = {
    chat: Boolean(hasCompletedBasicProfile),
    overview: Boolean(strategyIsActive),
    prompts: Boolean(strategy?.metadata?.prompts_last_generated_at),
    content: Boolean(hasReadyContentPlan),
    vault: Boolean(strategy?.metadata?.context_vault?.last_refreshed_at),
  };

  const primaryAction = useMemo(() => {
    if (!strategy) {
      return {
        type: 'chat',
        label: 'Start setup',
        description: 'Begin by setting your niche and audience.',
      };
    }

    if (!tabCompletion.chat) {
      return {
        type: 'chat',
        label: 'Complete setup',
        description: 'Set your basic profile details to unlock strategy analysis.',
      };
    }

    if (!tabCompletion.overview) {
      return {
        type: 'analysis',
        label: 'Run auto analysis',
        description: 'Analyze your current signals and confirm your strategy.',
      };
    }

    if (!tabCompletion.prompts) {
      return {
        type: 'prompts',
        label: 'Generate prompt pack',
        description: 'Create your high-quality prompt library from the confirmed strategy.',
      };
    }

    if (!tabCompletion.content) {
      return {
        type: 'content',
        label: 'Generate content plan',
        description: 'Create publish-ready posts you can approve and schedule.',
      };
    }

    return {
      type: 'content',
      label: 'Review content plan',
      description: 'Approve, schedule, or send posts to Compose.',
    };
  }, [strategy, tabCompletion]);

  useEffect(() => {
    const requestedTab = (searchParams.get('tab') || '').trim().toLowerCase();
    if (!requestedTab || !strategy) return;

    const normalizedRequestedTab = requestedTab === 'automation' ? 'chat' : requestedTab;
    if (requestedTab === 'automation') {
      if (!showAnalysisFlow && strategy) {
        setShowCreateForm(false);
        setCurrentView('chat');
        setShowAnalysisFlow(true);
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('tab', 'chat');
      setSearchParams(nextParams, { replace: true });
      return;
    }

    const available = new Set(tabs.map((tab) => tab.id));
    if (!available.has(normalizedRequestedTab)) return;
    if (normalizedRequestedTab === currentView) return;

    setCurrentView(normalizedRequestedTab);
  }, [searchParams, strategy, tabs, currentView, setSearchParams, showAnalysisFlow]);

  const switchToTab = (tabId) => {
    setCurrentView(tabId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tabId);
    setSearchParams(nextParams, { replace: true });
  };

  const handlePrimaryAction = async () => {
    switch (primaryAction.type) {
      case 'analysis':
        await handleStartAnalysisFlow();
        return;
      case 'prompts':
        handleGeneratePrompts();
        return;
      case 'chat':
      case 'overview':
      case 'content':
      case 'vault':
        switchToTab(primaryAction.type);
        return;
      default:
        switchToTab('chat');
    }
  };

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
      <StrategySetupForm
        error={error}
        strategy={strategy}
        hasCompletedBasicProfile={hasCompletedBasicProfile}
        isAdvancedEditMode={isAdvancedEditMode}
        creatingTeam={creatingTeam}
        teamName={teamName}
        setTeamName={setTeamName}
        teamDescription={teamDescription}
        setTeamDescription={setTeamDescription}
        editGoals={editGoals}
        setEditGoals={setEditGoals}
        editTopics={editTopics}
        setEditTopics={setEditTopics}
        goalInput={goalInput}
        setGoalInput={setGoalInput}
        topicInput={topicInput}
        setTopicInput={setTopicInput}
        onSaveStrategy={handleSaveStrategy}
        onStartAnalysisFlow={handleStartAnalysisFlow}
        onCancel={() => {
          setShowCreateForm(false);
          setCurrentView(strategy?.status === 'active' ? 'overview' : 'chat');
        }}
      />
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3 sm:gap-4">
              <button
                onClick={() => {
                  window.location.href = '/dashboard';
                }}
                className="mt-1 p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">Strategy Builder</h1>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-200">
                    {VIEW_META[currentView]?.title || 'Setup'}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  {strategy ? strategyLabel : 'Build your personalized LinkedIn content strategy'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Clear flow: Setup to Review to Prompt Pack to Content Plan to Context Vault
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              {strategyOptions.length > 1 && strategy && (
                <select
                  value={switchingStrategyId || strategy.id}
                  onChange={handleSwitchStrategy}
                  className="max-w-[280px] w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title="Switch strategy"
                >
                  {strategyOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {compactStrategyLabel(item.niche || 'Untitled strategy')} ({item.status || 'draft'})
                    </option>
                  ))}
                </select>
              )}

              {strategy && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEditStrategy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={handleCreateNew}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    <Plus className="w-4 h-4" />
                    New
                  </button>
                  <button
                    onClick={handleDeleteStrategy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>

          {tabs.length > 1 && (
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap gap-2">
                {tabs.map((tab, index) => {
                  const Icon = tab.icon;
                  const isActiveTab = currentView === tab.id;
                  const done = tabCompletion[tab.id];
                  return (
                    <button
                      key={tab.id}
                      onClick={() => switchToTab(tab.id)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        isActiveTab
                          ? 'border-blue-300 bg-blue-50 text-blue-800'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{`Step ${index + 1}: ${tab.label}`}</span>
                      {done && (
                        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Follow this order for the fastest result: Setup, Review, Prompt Pack, Content Plan, then Context Vault.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-900">Next best step: {primaryAction.label}</p>
              <p className="text-xs text-emerald-800">{primaryAction.description}</p>
            </div>
            <button
              type="button"
              onClick={handlePrimaryAction}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {primaryAction.label}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
            <span className="inline-flex items-center gap-1 text-xs text-blue-900 font-semibold">
              <BookOpen className="w-3.5 h-3.5" />
              Credits
            </span>
            <span className="text-xs text-blue-800">Chat: 0.5</span>
            <span className="text-blue-400">|</span>
            <span className="text-xs text-blue-800">Analyze: 5</span>
            <span className="text-blue-400">|</span>
            <span className="text-xs text-blue-800">Prompt Pack + Content Plan: 10</span>
          </div>
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

        {showAnalysisFlow && strategy && (
          <AnalysisFlow
            strategyId={strategy.id}
            onComplete={handleAnalysisComplete}
            onCancel={handleAnalysisCancel}
          />
        )}

        {currentView === 'chat' && strategy && !showAnalysisFlow && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900 mb-3">Setup mode</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSetupMode('auto')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    setupMode === 'auto'
                      ? 'border-indigo-200 bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                      : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Rocket className="h-4 w-4" />
                    Auto Analyze + Build
                  </span>
                  <p className={`text-xs mt-1 ${setupMode === 'auto' ? 'text-blue-100' : 'text-gray-600'}`}>
                    Recommended. Fastest path to strategy + prompt pack.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode('manual')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    setupMode === 'manual'
                      ? 'border-blue-300 bg-blue-50 text-blue-900'
                      : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold">
                    <PencilLine className="h-4 w-4" />
                    Manual Setup
                  </span>
                  <p className={`text-xs mt-1 ${setupMode === 'manual' ? 'text-blue-700' : 'text-gray-600'}`}>
                    Full control over each strategy input.
                  </p>
                </button>
              </div>
            </div>

            {setupMode === 'auto' ? (
              <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-blue-50 to-white p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Auto Analyze path</h3>
                <p className="text-sm text-gray-700 mb-4">
                  We fetch account signals, ask you to confirm key assumptions, then build your prompt pack.
                </p>
                <ul className="text-sm text-gray-700 space-y-1 mb-5">
                  <li>1. Pull recent posting patterns</li>
                  <li>2. Review niche, audience, goals, and topics</li>
                  <li>3. Generate prompt pack ready for Compose/Bulk</li>
                </ul>
                <button
                  type="button"
                  onClick={handleStartAnalysisFlow}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Rocket className="h-4 w-4" />
                  Start auto analyze
                </button>
              </div>
            ) : (
              <div className="h-[calc(100dvh-220px)] min-h-[540px] sm:h-[calc(100vh-250px)]">
                <ChatInterface strategyId={strategy.id} onComplete={handleChatComplete} />
              </div>
            )}
          </div>
        )}

        {currentView === 'overview' && strategy && !showAnalysisFlow && (
          <StrategyOverview
            strategy={strategy}
            onGeneratePrompts={handleGeneratePrompts}
            onStrategyUpdated={handleStrategyUpdated}
          />
        )}

        {currentView === 'prompts' && strategy && !showAnalysisFlow && (
          <PromptLibrary
            strategyId={strategy.id}
            strategyExtraContext={strategy?.metadata?.extra_context || ''}
            contentPlanPromptIds={
              Array.isArray(strategy?.metadata?.content_plan_prompt_ids)
                ? strategy.metadata.content_plan_prompt_ids
                : []
            }
            fromAnalysis={isGeneratingPrompts}
            onPromptUsageUpdated={async () => {
              try {
                const response = await strategyApi.getById(strategy.id);
                const updatedStrategy = response?.data?.strategy;
                if (updatedStrategy) {
                  setStrategy(updatedStrategy);
                  fetchStrategyList(updatedStrategy.id).catch(() => {});
                }
              } catch {
                // keep prompt library usable even if strategy refresh fails
              }
            }}
            onPromptsLoaded={async () => {
              setIsGeneratingPrompts(false);
              try {
                const response = await strategyApi.getById(strategy.id);
                const updatedStrategy = response?.data?.strategy;
                if (updatedStrategy) {
                  setStrategy(updatedStrategy);
                  fetchStrategyList(updatedStrategy.id).catch(() => {});
                }
              } catch {
                // keep UI usable even if refresh fails
              }
            }}
          />
        )}

        {currentView === 'content' && strategy && !showAnalysisFlow && (
          <AutomationFlow
            strategy={strategy}
            onOpenPrompts={() => switchToTab('prompts')}
            onOpenVault={() => switchToTab('vault')}
            onContentPlanGenerated={async () => {
              try {
                const response = await strategyApi.getById(strategy.id);
                const updatedStrategy = response?.data?.strategy;
                if (updatedStrategy) {
                  setStrategy(updatedStrategy);
                  fetchStrategyList(updatedStrategy.id).catch(() => {});
                }
              } catch {
                // keep content tab usable even if strategy refresh fails
              }
            }}
          />
        )}

        {currentView === 'vault' && strategy && !showAnalysisFlow && (
          <ContextVault strategy={strategy} onStrategyUpdated={handleStrategyUpdated} />
        )}
      </div>
    </div>
  );
};

export default StrategyBuilder;
