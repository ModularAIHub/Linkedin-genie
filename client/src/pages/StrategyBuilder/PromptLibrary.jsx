import React, { useEffect, useMemo, useState } from 'react';
import {
  Star,
  Search,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  CheckCircle2,
  Square,
  CheckSquare,
  Send,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { strategy as strategyApi } from '../../utils/api';

const CATEGORY_STYLE = {
  educational: 'bg-blue-100 text-blue-700',
  engagement: 'bg-indigo-100 text-indigo-700',
  storytelling: 'bg-pink-100 text-pink-700',
  'tips & tricks': 'bg-green-100 text-green-700',
  promotional: 'bg-amber-100 text-amber-700',
  inspirational: 'bg-violet-100 text-violet-700',
};

const CATEGORY_ICON = {
  educational: 'Book',
  engagement: 'Chat',
  storytelling: 'Story',
  'tips & tricks': 'Tips',
  promotional: 'Promo',
  inspirational: 'Inspire',
};

const STRATEGY_GENERATED_PROMPTS_KEY_PREFIX = 'strategyGeneratedPrompts:';
const BULK_GENERATION_SEED_KEY = 'bulkGenerationSeed';

const parseVariables = (variables) => {
  if (!variables) return {};
  if (typeof variables === 'object') return variables;
  if (typeof variables === 'string') {
    try {
      const parsed = JSON.parse(variables);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const cleanPromptText = (value = '') =>
  String(value || '')
    .replace(/`{1,3}/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\(\d+\)(?=\s|$)/g, '')
    .replace(/^prompt\s+[^:]{1,50}\s+prompt:\s*/i, '')
    .replace(/^(educational|engagement|storytelling|tips(?:\s*&\s*|\s+and\s+)tricks|promotional|inspirational)\s*prompt:\s*/i, '')
    .replace(/^prompt\s*:\s*/i, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const PromptLibrary = ({ strategyId }) => {
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [copiedId, setCopiedId] = useState(null);
  const [selectedPromptIds, setSelectedPromptIds] = useState([]);
  const [generatedPromptIds, setGeneratedPromptIds] = useState([]);

  useEffect(() => {
    loadPrompts();
  }, [strategyId]);

  useEffect(() => {
    if (!strategyId) return;
    try {
      const raw = localStorage.getItem(`${STRATEGY_GENERATED_PROMPTS_KEY_PREFIX}${strategyId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      setGeneratedPromptIds(Array.isArray(parsed) ? parsed : []);
    } catch {
      setGeneratedPromptIds([]);
    }
  }, [strategyId]);

  useEffect(() => {
    setSelectedPromptIds((prev) => {
      const validIds = new Set(prompts.map((prompt) => prompt.id));
      return prev.filter((id) => validIds.has(id));
    });
  }, [prompts]);

  const loadPrompts = async () => {
    try {
      setLoading(true);
      const response = await strategyApi.getPrompts(strategyId);
      setPrompts(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      toast.error('Failed to load prompts');
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (promptId) => {
    try {
      await strategyApi.toggleFavorite(promptId);
      setPrompts((prev) =>
        prev.map((prompt) =>
          prompt.id === promptId ? { ...prompt, is_favorite: !prompt.is_favorite } : prompt
        )
      );
    } catch (error) {
      toast.error('Failed to update favorite');
    }
  };

  const copyPrompt = async (promptText, promptId) => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedId(promptId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) {
      toast.error('Copy failed. Please copy manually.');
    }
  };

  const categories = useMemo(
    () => ['all', ...new Set(prompts.map((prompt) => prompt.category).filter(Boolean))],
    [prompts]
  );

  const categoryCounts = useMemo(
    () =>
      prompts.reduce((acc, prompt) => {
        const key = prompt.category || 'general';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    [prompts]
  );

  const promptStats = useMemo(() => {
    const usedCount = prompts.filter((prompt) => Number(prompt.usage_count) > 0).length;
    const favoriteCount = prompts.filter((prompt) => Boolean(prompt.is_favorite)).length;
    const generatedCount = prompts.filter((prompt) => generatedPromptIds.includes(prompt.id)).length;
    return {
      total: prompts.length,
      used: usedCount,
      favorites: favoriteCount,
      generated: generatedCount,
    };
  }, [prompts, generatedPromptIds]);

  const filteredPrompts = useMemo(
    () =>
      prompts.filter((prompt) => {
        const searchableText = cleanPromptText(prompt.prompt_text);
        const matchesSearch = searchableText
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesCategory =
          selectedCategory === 'all' || prompt.category === selectedCategory;
        return matchesSearch && matchesCategory;
      }),
    [prompts, searchTerm, selectedCategory]
  );

  const starterPromptIds = useMemo(() => {
    const preferredOrder = [
      'educational',
      'engagement',
      'storytelling',
      'tips & tricks',
      'promotional',
      'inspirational',
    ];

    const picked = [];
    const usedIds = new Set();

    for (const category of preferredOrder) {
      const match = prompts.find((prompt) => prompt.category === category);
      if (match && !usedIds.has(match.id)) {
        picked.push(match.id);
        usedIds.add(match.id);
      }
    }

    if (picked.length < 6) {
      for (const prompt of prompts) {
        if (usedIds.has(prompt.id)) {
          continue;
        }
        picked.push(prompt.id);
        usedIds.add(prompt.id);
        if (picked.length >= 6) {
          break;
        }
      }
    }

    return picked;
  }, [prompts]);

  const persistGeneratedIds = (ids) => {
    if (!strategyId) return;
    localStorage.setItem(
      `${STRATEGY_GENERATED_PROMPTS_KEY_PREFIX}${strategyId}`,
      JSON.stringify(ids)
    );
  };

  const markPromptGenerated = (promptId) => {
    setGeneratedPromptIds((prev) => {
      if (prev.includes(promptId)) return prev;
      const next = [...prev, promptId];
      persistGeneratedIds(next);
      return next;
    });
  };

  const togglePromptSelection = (promptId) => {
    setSelectedPromptIds((prev) =>
      prev.includes(promptId) ? prev.filter((id) => id !== promptId) : [...prev, promptId]
    );
  };

  const selectedPromptCount = selectedPromptIds.length;

  const handleSelectVisible = () => {
    setSelectedPromptIds((prev) => {
      const merged = new Set(prev);
      for (const prompt of filteredPrompts) {
        merged.add(prompt.id);
      }
      return Array.from(merged);
    });
  };

  const handleClearSelection = () => {
    setSelectedPromptIds([]);
  };

  const handleSelectStarterSet = () => {
    if (starterPromptIds.length === 0) {
      toast.error('No prompts available to select.');
      return;
    }

    setSelectedPromptIds(starterPromptIds);
    toast.success(`Selected ${starterPromptIds.length} starter prompts.`);
  };

  const handleSendSelectedToBulk = () => {
    const selectedPrompts = prompts.filter((prompt) => selectedPromptIds.includes(prompt.id));
    if (selectedPrompts.length === 0) {
      toast.error('Select at least one prompt first.');
      return;
    }

    const seed = {
      strategyId,
      source: 'strategy_library',
      generatedAt: new Date().toISOString(),
      items: selectedPrompts.map((prompt) => {
        const variables = parseVariables(prompt.variables);
        const instruction =
          typeof variables.instruction === 'string' ? cleanPromptText(variables.instruction) : '';
        const cleanedPrompt = cleanPromptText(prompt.prompt_text);
        const recommendedFormat =
          typeof variables.recommended_format === 'string'
            ? variables.recommended_format.trim().toLowerCase()
            : 'single_post';
        const mergedPrompt = instruction
          ? `${cleanedPrompt}\n\nInstruction: ${instruction}`
          : cleanedPrompt;

        return {
          id: prompt.id,
          prompt: mergedPrompt,
          isThread: false,
          category: prompt.category || 'general',
        };
      }),
    };

    localStorage.setItem(BULK_GENERATION_SEED_KEY, JSON.stringify(seed));
    navigate('/bulk-generation', {
      state: {
        bulkGenerationSeed: seed,
      },
    });
  };

  const handleGeneratePrompt = (prompt) => {
    const variables = parseVariables(prompt.variables);
    const instruction =
      typeof variables.instruction === 'string' ? cleanPromptText(variables.instruction) : '';
    const cleanedPrompt = cleanPromptText(prompt.prompt_text);
    const recommendedFormat =
      typeof variables.recommended_format === 'string'
        ? variables.recommended_format.trim().toLowerCase()
        : 'single_post';
    const mergedPrompt = instruction
      ? `${cleanedPrompt}\n\nInstruction: ${instruction}`
      : cleanedPrompt;

    const payload = {
      id: prompt.id,
      text: mergedPrompt,
      category: prompt.category || 'general',
      source: 'strategy_library',
      recommendedFormat,
      generatedAt: new Date().toISOString(),
    };

    // Backward compatible fallback for older compose flows
    localStorage.setItem('composerPrompt', mergedPrompt);
    localStorage.setItem('composerPromptPayload', JSON.stringify(payload));
    markPromptGenerated(prompt.id);

    navigate('/compose', {
      state: {
        composerPromptPayload: payload,
        autoOpenAIPanel: true,
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600">Loading prompts...</p>
        </div>
      </div>
    );
  }

  if (prompts.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-10 h-10 text-gray-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No prompts yet</h3>
        <p className="text-gray-600 mb-6">
          Generate your prompt library from Strategy Overview to start creating content faster.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-indigo-600" />
              Prompt Library
            </h2>
            <p className="text-gray-600 mt-1">
              Browse, filter, and send ideas to Composer instantly.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-gray-900">{promptStats.total}</span> total
            </div>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-green-700">{promptStats.used}</span> used
            </div>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-amber-700">{promptStats.favorites}</span> favorites
            </div>
            <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-emerald-700">{promptStats.generated}</span> generated
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        Beginner flow: 1) Select Starter Set 2) Send To Bulk 3) Generate all drafts 4) Schedule in one batch.
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900">{selectedPromptCount}</span> selected for bulk workflow
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleSelectStarterSet}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100"
          >
            <Sparkles className="w-4 h-4" />
            Select Starter Set
          </button>
          <button
            type="button"
            onClick={handleSelectVisible}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <CheckSquare className="w-4 h-4" />
            Select Visible
          </button>
          <button
            type="button"
            onClick={handleClearSelection}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Square className="w-4 h-4" />
            Clear
          </button>
          <button
            type="button"
            onClick={handleSendSelectedToBulk}
            disabled={selectedPromptCount === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Send To Bulk
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-wrap items-start">
        <div className="flex-1 min-w-[280px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search prompts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                selectedCategory === category
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {category === 'all' ? 'All' : `${CATEGORY_ICON[category] || 'Prompt'} ${category.charAt(0).toUpperCase() + category.slice(1)}`}
              {category !== 'all' && (
                <span className="ml-2 text-xs opacity-80">({categoryCounts[category] || 0})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="text-sm text-gray-600">
        Showing <span className="font-semibold text-gray-900">{filteredPrompts.length}</span> prompt
        {filteredPrompts.length === 1 ? '' : 's'}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPrompts.map((prompt) => {
          const categoryClass = CATEGORY_STYLE[prompt.category] || 'bg-gray-100 text-gray-700';
          const variables = parseVariables(prompt.variables);
          const cleanedPrompt = cleanPromptText(prompt.prompt_text);
          const instructionRaw =
            typeof variables.instruction === 'string' ? cleanPromptText(variables.instruction) : '';
          const instruction =
            instructionRaw && instructionRaw.toLowerCase() !== cleanedPrompt.toLowerCase()
              ? instructionRaw
              : '';
          const hasGenerated = generatedPromptIds.includes(prompt.id) || Number(prompt.usage_count) > 0;
          const isSelected = selectedPromptIds.includes(prompt.id);

          return (
            <div
              key={prompt.id}
              className={`bg-white rounded-2xl p-5 border hover:border-blue-200 hover:shadow-lg transition-all group relative ${
                isSelected ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200'
              }`}
            >
              {hasGenerated && (
                <div className="absolute -top-3 -right-3 bg-green-500 rounded-full p-2 shadow-lg border-4 border-white">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
              )}

              <button
                type="button"
                onClick={() => togglePromptSelection(prompt.id)}
                className="absolute top-4 left-4 text-gray-500 hover:text-blue-600"
                title={isSelected ? 'Unselect prompt' : 'Select prompt'}
              >
                {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5" />}
              </button>

              <button
                onClick={() => toggleFavorite(prompt.id)}
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Star
                  className={`w-5 h-5 ${
                    prompt.is_favorite
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-gray-400 hover:text-yellow-400'
                  }`}
                />
              </button>

              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold mb-3 mt-6 ${categoryClass}`}
              >
                <span>{CATEGORY_ICON[prompt.category] || 'Prompt'}</span>
                <span className="capitalize">{prompt.category || 'general'}</span>
              </div>

              <p className="text-gray-800 leading-relaxed mb-4 min-h-[96px] line-clamp-4">{cleanedPrompt}</p>

              {instruction && (
                <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-700 mb-1">Instruction</p>
                  <p className="text-xs text-blue-900 line-clamp-3">{instruction}</p>
                </div>
              )}

              {prompt.usage_count > 0 && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-lg font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Used {prompt.usage_count} {prompt.usage_count === 1 ? 'time' : 'times'}
                  </div>
                  {prompt.performance_score > 0 && (
                    <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-lg">
                      {prompt.performance_score}% performance
                    </span>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => copyPrompt(cleanedPrompt, prompt.id)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {copiedId === prompt.id ? (
                    <>
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-green-600">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleGeneratePrompt(prompt)}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Generate</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredPrompts.length === 0 && prompts.length > 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600">No prompts match your search criteria</p>
          <button
            onClick={() => {
              setSearchTerm('');
              setSelectedCategory('all');
            }}
            className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
};

export default PromptLibrary;
