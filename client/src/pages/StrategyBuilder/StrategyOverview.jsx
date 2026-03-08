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

const LONG_TEXT_MARKERS = ['what we do', 'key features', 'why suitegenie', 'perfect for'];

const cleanText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const truncateText = (value = '', max = 80) => {
  const text = cleanText(value);
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
};

const normalizeHeadline = (value = '') => {
  let text = cleanText(value);
  if (!text) return 'LinkedIn Growth Strategy';
  const lower = text.toLowerCase();
  for (const marker of LONG_TEXT_MARKERS) {
    const index = lower.indexOf(marker);
    if (index > 0) {
      text = text.slice(0, index).trim();
      break;
    }
  }
  text = text.replace(/\s*[|:-]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return truncateText(text || 'LinkedIn Growth Strategy', 72);
};

const sanitizeTags = (items = [], max = 18) => {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const item = cleanText(raw);
    if (!item) continue;
    if (/https?:\/\//i.test(item)) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(truncateText(item, 48));
    if (result.length >= max) break;
  }
  return result;
};

const TOPIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with', 'your',
  'social', 'platform', 'post', 'posts', 'team', 'one', 'now', 'hashtag', 'hashtags'
]);

const splitTopicCandidates = (value = '') =>
  String(value || '')
    .split(/\r?\n|,|;|\||\/|\u2022|\u25CF|\u25E6/g)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeTopic = (value = '') => {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/^#+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const words = cleaned
    .split(' ')
    .filter((word) => word.length >= 3 && !TOPIC_STOP_WORDS.has(word));

  if (words.length === 0 || words.length > 4) return '';
  const phrase = words.join(' ').trim();
  if (phrase.length < 3 || phrase.length > 36) return '';
  return phrase;
};

const sanitizeTopics = (items = [], max = 20) => {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const candidates = splitTopicCandidates(raw);
    for (const candidate of candidates) {
      const topic = normalizeTopic(candidate);
      if (!topic) continue;
      const key = topic.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(topic);
      if (result.length >= max) break;
    }
    if (result.length >= max) break;
  }
  return result;
};

const InfoCard = ({ icon: Icon, label, value, tone = 'blue' }) => {
  const style = CARD_STYLE[tone] || CARD_STYLE.blue;

  return (
    <div className="bg-white rounded-xl p-5 border border-gray-200 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-10 h-10 rounded-lg ${style.iconBg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${style.iconText}`} />
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-1">{label}</p>
          <p
            className="text-base font-semibold text-gray-900 break-words"
            style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {value}
          </p>
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
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);

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
  const promptRefreshRecommendation = String(
    strategy?.metadata?.prompts_refresh_recommendation || ''
  ).trim().toLowerCase();
  const hasPromptUsageRecommendation =
    promptRefreshRecommendation === 'partial' || promptRefreshRecommendation === 'full';
  const promptUsageSnapshot =
    strategy?.metadata?.prompts_usage_snapshot &&
    typeof strategy.metadata.prompts_usage_snapshot === 'object'
      ? strategy.metadata.prompts_usage_snapshot
      : {};
  const usedPromptCount = Number(promptUsageSnapshot.used_prompts || 0);
  const promptStatusTone =
    promptRefreshRecommendation === 'full'
      ? 'rose'
      : (promptsStale || promptRefreshRecommendation === 'partial')
        ? 'amber'
        : 'blue';
  const nicheDisplay = useMemo(() => normalizeHeadline(strategy?.niche || ''), [strategy?.niche]);
  const audienceDisplay = useMemo(() => truncateText(strategy?.target_audience || '', 88), [strategy?.target_audience]);
  const postingFrequencyDisplay = useMemo(
    () => truncateText(strategy?.posting_frequency || '', 56) || 'Not set',
    [strategy?.posting_frequency]
  );
  const toneDisplay = useMemo(() => truncateText(strategy?.tone_style || '', 56) || 'Not set', [strategy?.tone_style]);
  const displayGoals = useMemo(() => sanitizeTags(strategy?.content_goals || [], 16), [strategy?.content_goals]);
  const displayTopics = useMemo(() => sanitizeTopics(strategy?.topics || [], 24), [strategy?.topics]);
  const hiddenTopicCount = Math.max(0, (Array.isArray(strategy?.topics) ? strategy.topics.length : 0) - displayTopics.length);

  const checklistItems = useMemo(
    () => [
      {
        label: 'Niche is defined clearly',
        done: Boolean(cleanText(strategy?.niche || '').length >= 3),
      },
      {
        label: 'Target audience is defined',
        done: Boolean(cleanText(strategy?.target_audience || '').length >= 6),
      },
      {
        label: 'At least 3 content goals',
        done: displayGoals.length >= 3,
      },
      {
        label: 'At least 3 content topics',
        done: displayTopics.length >= 3,
      },
      {
        label: 'Posting frequency is set',
        done: Boolean(cleanText(strategy?.posting_frequency || '').length > 0),
      },
      {
        label: 'Prompt library generated',
        done: promptCount > 0 && !promptsStale,
      },
    ],
    [strategy, promptCount, promptsStale, displayGoals.length, displayTopics.length]
  );

  const completedChecklistCount = checklistItems.filter((item) => item.done).length;

  return (
    <div className="space-y-6">
      {(hasPromptUsageRecommendation || promptsStale) && (
        <div
          className={`border rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${
            promptRefreshRecommendation === 'full'
              ? 'bg-rose-50 border-rose-200'
              : 'bg-amber-50 border-amber-200'
          }`}
        >
          <p
            className={`text-sm ${
              promptRefreshRecommendation === 'full' ? 'text-rose-900' : 'text-amber-900'
            }`}
          >
            {promptRefreshRecommendation === 'full'
              ? 'Most prompts are already used and this pack is now stale. Regenerate a fresh set before your next sprint.'
              : hasPromptUsageRecommendation
                ? 'Several prompts are already used. Top up the prompt pack to keep quality high.'
                : (promptCount > 0
                    ? 'Prompt library is out of date after strategy updates. Regenerate prompts to match your latest goals/topics.'
                    : 'Strategy updated. Generate prompts to match your latest goals/topics.')}
          </p>
          <button
            onClick={handleGeneratePrompts}
            disabled={isGenerating}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white disabled:opacity-50 ${
              promptRefreshRecommendation === 'full'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            <RefreshCw className="w-4 h-4" />
            {isGenerating ? 'Generating...' : promptCount > 0 ? 'Regenerate Prompts' : 'Generate Prompts'}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                Strategy Snapshot
              </span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{nicheDisplay}</h2>
            <p className="text-sm text-gray-600 mt-1">
              Built for {audienceDisplay || 'your target audience'}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`rounded-lg px-4 py-2 text-center min-w-[140px] ${
                promptStatusTone === 'rose'
                  ? 'border border-rose-200 bg-rose-50'
                  : promptStatusTone === 'amber'
                    ? 'border border-amber-200 bg-amber-50'
                    : 'border border-blue-200 bg-blue-50'
              }`}
            >
              <div
                className={`text-2xl font-bold ${
                  promptStatusTone === 'rose'
                    ? 'text-rose-700'
                    : promptStatusTone === 'amber'
                      ? 'text-amber-700'
                      : 'text-blue-700'
                }`}
              >
                {promptCount}
              </div>
              <div
                className={`text-xs ${
                  promptStatusTone === 'rose'
                    ? 'text-rose-700'
                    : promptStatusTone === 'amber'
                      ? 'text-amber-700'
                      : 'text-blue-700'
                }`}
              >
                {usedPromptCount > 0 ? `${usedPromptCount} used` : (promptsStale ? 'Needs refresh' : 'Ready')}
              </div>
            </div>
            <button
              onClick={handleGeneratePrompts}
              disabled={isGenerating}
              className="px-4 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {isGenerating ? 'Generating...' : promptCount > 0 ? 'Regenerate prompts' : 'Generate prompts'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoCard icon={Target} label="Niche" value={nicheDisplay || 'Not set'} tone="blue" />
        <InfoCard
          icon={Users}
          label="Target Audience"
          value={audienceDisplay || 'Not set'}
          tone="indigo"
        />
        <InfoCard
          icon={Calendar}
          label="Posting Frequency"
          value={postingFrequencyDisplay}
          tone="emerald"
        />
        <InfoCard
          icon={MessageSquare}
          label="Tone and Style"
          value={toneDisplay}
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
        <ArrayDisplay items={displayGoals} icon={Star} emptyText="No goals defined yet" />
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-600" />
          Content Topics
        </h3>
        <ArrayDisplay items={displayTopics} emptyText="No topics defined yet" />
        {hiddenTopicCount > 0 && (
          <p className="text-xs text-gray-500 mt-3">
            Hidden {hiddenTopicCount} low-quality topic entr{hiddenTopicCount === 1 ? 'y' : 'ies'} from display.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Advanced controls</p>
          <p className="text-xs text-gray-600">
            Use this only when you want to manually add goals/topics or ask AI to expand your strategy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdvancedControls((prev) => !prev)}
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          {showAdvancedControls ? 'Hide advanced' : 'Show advanced'}
        </button>
      </div>

      {showAdvancedControls && (
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
      )}

      {promptCount > 0 && (
        <div className="bg-white rounded-xl p-6 border border-green-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
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
              className="px-4 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              View Prompts
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                window.location.href = '/bulk-generation';
              }}
              className="px-4 py-2.5 bg-white text-green-700 border border-green-300 rounded-lg font-semibold hover:bg-green-50 transition-colors"
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
