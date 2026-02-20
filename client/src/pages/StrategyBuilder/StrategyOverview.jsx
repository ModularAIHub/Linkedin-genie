import React, { useEffect, useMemo, useState } from 'react';
import {
  Target,
  TrendingUp,
  Users,
  Calendar,
  MessageSquare,
  Star,
  ArrowRight,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Circle,
  Rocket,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { strategy as strategyApi } from '../../utils/api';

const CARD_STYLE = {
  blue: { iconBg: 'bg-blue-100', iconText: 'text-blue-600' },
  indigo: { iconBg: 'bg-indigo-100', iconText: 'text-indigo-600' },
  emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600' },
  amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-600' },
};

const InfoCard = ({ icon: Icon, label, value, tone = 'blue' }) => {
  const style = CARD_STYLE[tone] || CARD_STYLE.blue;

  return (
    <div className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-10 h-10 rounded-lg ${style.iconBg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${style.iconText}`} />
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-1">{label}</p>
          <p className="text-lg font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
};

const ArrayDisplay = ({ items, icon: Icon, emptyText }) => (
  <div className="flex flex-wrap gap-2">
    {items && items.length > 0 ? (
      items.map((item, idx) => (
        <span
          key={idx}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-lg text-sm font-medium border border-blue-200"
        >
          {Icon && <Icon className="w-3.5 h-3.5" />}
          {item}
        </span>
      ))
    ) : (
      <span className="text-gray-400 text-sm italic">{emptyText}</span>
    )}
  </div>
);

const parseCsvInput = (value = '') =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const StrategyOverview = ({ strategy, onGeneratePrompts, onStrategyUpdated }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptCount, setPromptCount] = useState(0);
  const [addMode, setAddMode] = useState('manual');
  const [manualGoalsInput, setManualGoalsInput] = useState('');
  const [manualTopicsInput, setManualTopicsInput] = useState('');
  const [aiPromptInput, setAiPromptInput] = useState('');
  const [isApplyingAddOn, setIsApplyingAddOn] = useState(false);

  useEffect(() => {
    loadPromptCount();
  }, [strategy?.id]);

  const loadPromptCount = async () => {
    if (!strategy?.id) return;

    try {
      const response = await strategyApi.getPrompts(strategy.id);
      setPromptCount(Array.isArray(response?.data) ? response.data.length : 0);
    } catch (error) {
      setPromptCount(0);
    }
  };

  const handleGeneratePrompts = async () => {
    setIsGenerating(true);
    try {
      const response = await strategyApi.generatePrompts(strategy.id);
      setPromptCount(response?.data?.count || 0);
      toast.success('Prompt library generated successfully.');
      try {
        const latestStrategy = await strategyApi.getById(strategy.id);
        if (onStrategyUpdated && latestStrategy?.data?.strategy) {
          onStrategyUpdated(latestStrategy.data.strategy);
        }
      } catch (refreshError) {
        console.error('Failed to refresh strategy after prompt generation:', refreshError);
      }
      if (onGeneratePrompts) {
        onGeneratePrompts(response.data);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to generate prompts');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleManualAddOn = async () => {
    const goals = parseCsvInput(manualGoalsInput);
    const topics = parseCsvInput(manualTopicsInput);

    if (goals.length === 0 && topics.length === 0) {
      toast.error('Add at least one goal or topic.');
      return;
    }

    setIsApplyingAddOn(true);
    try {
      const response = await strategyApi.addOn(strategy.id, {
        source: 'manual',
        content_goals: goals,
        topics,
      });

      const payload = response?.data || {};
      const addedGoals = payload?.added?.content_goals?.length || 0;
      const addedTopics = payload?.added?.topics?.length || 0;
      const ignoredGoals = payload?.ignoredDuplicates?.content_goals?.length || 0;
      const ignoredTopics = payload?.ignoredDuplicates?.topics?.length || 0;

      if (onStrategyUpdated && payload.strategy) {
        onStrategyUpdated(payload.strategy);
      }

      setManualGoalsInput('');
      setManualTopicsInput('');

      toast.success(
        `Added ${addedGoals + addedTopics} item(s). Ignored duplicates: ${ignoredGoals + ignoredTopics}.`
      );
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add to strategy');
    } finally {
      setIsApplyingAddOn(false);
    }
  };

  const handleAiAddOn = async () => {
    if (!aiPromptInput.trim()) {
      toast.error('Add a prompt for AI-assisted add-on.');
      return;
    }

    setIsApplyingAddOn(true);
    try {
      const response = await strategyApi.addOn(strategy.id, {
        source: 'ai',
        prompt: aiPromptInput.trim(),
      });

      const payload = response?.data || {};
      const addedGoals = payload?.added?.content_goals?.length || 0;
      const addedTopics = payload?.added?.topics?.length || 0;
      const ignoredGoals = payload?.ignoredDuplicates?.content_goals?.length || 0;
      const ignoredTopics = payload?.ignoredDuplicates?.topics?.length || 0;

      if (onStrategyUpdated && payload.strategy) {
        onStrategyUpdated(payload.strategy);
      }

      setAiPromptInput('');
      toast.success(
        `AI added ${addedGoals + addedTopics} item(s). Ignored duplicates: ${ignoredGoals + ignoredTopics}.`
      );
    } catch (error) {
      if (error?.response?.status === 402) {
        toast.error('Insufficient credits for AI add-on (0.5 required).');
      } else {
        toast.error(error.response?.data?.error || 'Failed to apply AI add-on');
      }
    } finally {
      setIsApplyingAddOn(false);
    }
  };

  const promptsStale = Boolean(strategy?.metadata?.prompts_stale);

  const checklistItems = useMemo(
    () => [
      {
        label: 'Niche is defined clearly',
        done: Boolean(strategy?.niche && strategy.niche.trim().length >= 3),
      },
      {
        label: 'Target audience is defined',
        done: Boolean(strategy?.target_audience && strategy.target_audience.trim().length >= 6),
      },
      {
        label: 'At least 3 content goals',
        done: Array.isArray(strategy?.content_goals) && strategy.content_goals.length >= 3,
      },
      {
        label: 'At least 3 content topics',
        done: Array.isArray(strategy?.topics) && strategy.topics.length >= 3,
      },
      {
        label: 'Posting frequency is set',
        done: Boolean(strategy?.posting_frequency && strategy.posting_frequency.trim().length > 0),
      },
      {
        label: 'Prompt library generated',
        done: promptCount > 0 && !promptsStale,
      },
    ],
    [strategy, promptCount, promptsStale]
  );

  const completedChecklistCount = checklistItems.filter((item) => item.done).length;

  return (
    <div className="space-y-6">
      {promptsStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <p className="text-sm text-amber-900">
            {promptCount > 0
              ? 'Prompt library is out of date after strategy updates. Regenerate prompts to match your latest goals/topics.'
              : 'Strategy updated. Generate prompts to match your latest goals/topics.'}
          </p>
          <button
            onClick={handleGeneratePrompts}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            {isGenerating ? 'Generating...' : promptCount > 0 ? 'Regenerate Prompts' : 'Generate Prompts'}
          </button>
        </div>
      )}

      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 text-white shadow-xl">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-6 h-6" />
              <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium">Active Strategy</span>
            </div>
            <h2 className="text-3xl font-bold mb-2">{strategy.niche || 'Your LinkedIn Strategy'}</h2>
            <p className="text-blue-100 text-lg">
              Tailored content strategy for {strategy.target_audience || 'your audience'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            {promptCount === 0 || promptsStale ? (
              <button
                onClick={handleGeneratePrompts}
                disabled={isGenerating}
                className="px-6 py-3 bg-white text-blue-600 rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    {promptCount === 0 ? 'Generate Prompts' : 'Regenerate Prompts'}
                  </>
                )}
              </button>
            ) : (
              <div className="text-center">
                <div className="text-4xl font-bold">{promptCount}</div>
                <div className="text-sm text-blue-100">Prompts Ready</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoCard icon={Target} label="Niche" value={strategy.niche || 'Not set'} tone="blue" />
        <InfoCard
          icon={Users}
          label="Target Audience"
          value={strategy.target_audience || 'Not set'}
          tone="indigo"
        />
        <InfoCard
          icon={Calendar}
          label="Posting Frequency"
          value={strategy.posting_frequency || 'Not set'}
          tone="emerald"
        />
        <InfoCard
          icon={MessageSquare}
          label="Tone and Style"
          value={strategy.tone_style || 'Not set'}
          tone="amber"
        />
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Rocket className="w-5 h-5 text-blue-600" />
            Beginner Playbook
          </h3>
          <span className="text-sm font-medium text-gray-700">
            {completedChecklistCount}/{checklistItems.length} complete
          </span>
        </div>
        <div className="space-y-2">
          {checklistItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm">
              {item.done ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <Circle className="w-4 h-4 text-gray-400" />
              )}
              <span className={item.done ? 'text-gray-900' : 'text-gray-600'}>{item.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {promptCount === 0 || promptsStale ? (
            <button
              type="button"
              onClick={handleGeneratePrompts}
              disabled={isGenerating}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isGenerating ? 'Generating prompts...' : 'Generate Prompt Library'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onGeneratePrompts}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Open Prompt Library
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              window.location.href = '/bulk-generation';
            }}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Open Bulk Generation
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          Content Goals
        </h3>
        <ArrayDisplay items={strategy.content_goals} icon={Star} emptyText="No goals defined yet" />
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-600" />
          Content Topics
        </h3>
        <ArrayDisplay items={strategy.topics} emptyText="No topics defined yet" />
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Add to Strategy</h3>
          <div className="inline-flex p-1 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => setAddMode('manual')}
              className={`px-3 py-1.5 rounded-md text-sm ${
                addMode === 'manual' ? 'bg-white shadow text-gray-900' : 'text-gray-600'
              }`}
            >
              Manual Add
            </button>
            <button
              type="button"
              onClick={() => setAddMode('ai')}
              className={`px-3 py-1.5 rounded-md text-sm ${
                addMode === 'ai' ? 'bg-white shadow text-gray-900' : 'text-gray-600'
              }`}
            >
              AI Add (0.5 credits)
            </button>
          </div>
        </div>

        {addMode === 'manual' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Add Goals (comma-separated)
              </label>
              <textarea
                value={manualGoalsInput}
                onChange={(e) => setManualGoalsInput(e.target.value)}
                rows={2}
                placeholder="e.g., Improve engagement, Grow qualified followers"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Add Topics (comma-separated)
              </label>
              <textarea
                value={manualTopicsInput}
                onChange={(e) => setManualTopicsInput(e.target.value)}
                rows={2}
                placeholder="e.g., GTM breakdowns, Founder lessons"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleManualAddOn}
              disabled={isApplyingAddOn}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isApplyingAddOn ? 'Applying...' : 'Apply Add-On'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tell AI what to add
              </label>
              <textarea
                value={aiPromptInput}
                onChange={(e) => setAiPromptInput(e.target.value)}
                rows={3}
                placeholder='e.g., Add advanced B2B SaaS goals and topics focused on conversion and authority.'
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleAiAddOn}
              disabled={isApplyingAddOn}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isApplyingAddOn ? 'Applying...' : 'Apply AI Add-On'}
            </button>
          </div>
        )}
      </div>

      {promptCount > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-green-600" />
                Ready to Create Content
              </h3>
              <p className="text-gray-600">
                Your prompt library is ready. Start generating LinkedIn posts from these prompts.
              </p>
            </div>
            <button
              onClick={onGeneratePrompts}
              className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              View Prompts
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                window.location.href = '/bulk-generation';
              }}
              className="px-6 py-3 bg-white text-green-700 border border-green-300 rounded-xl font-semibold hover:bg-green-50 transition-colors"
            >
              Bulk Generate & Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyOverview;
