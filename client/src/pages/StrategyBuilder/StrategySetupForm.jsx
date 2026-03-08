import React from 'react';
import {
  Loader2,
  Wand2,
  X,
  PencilLine,
  Sparkles,
  Rocket,
} from 'lucide-react';
import { STRATEGY_TEMPLATES } from './strategyBuilderConfig';

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

export default function StrategySetupForm({
  error,
  strategy,
  hasCompletedBasicProfile,
  isAdvancedEditMode,
  creatingTeam,
  teamName,
  setTeamName,
  teamDescription,
  setTeamDescription,
  editGoals,
  setEditGoals,
  editTopics,
  setEditTopics,
  goalInput,
  setGoalInput,
  topicInput,
  setTopicInput,
  onSaveStrategy,
  onStartAnalysisFlow,
  onCancel,
}) {
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
              Strategy Name <span className="text-red-500">*</span>
            </label>
            <p className="text-sm text-gray-600 mb-3">
              Give this strategy a clear name so you can manage multiple playbooks without confusion.
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
            <p className="text-sm font-semibold text-blue-900 mb-2">Choose your setup path</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-blue-800">
                <span className="font-semibold">Manual Setup</span>
                <p className="text-blue-700 mt-1">Answer guided questions and control each field.</p>
              </div>
              <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-indigo-800">
                <span className="font-semibold">Auto Analyze</span>
                <p className="text-indigo-700 mt-1">Fetch account signals and prefill strategy automatically.</p>
              </div>
            </div>
          </div>

          {isAdvancedEditMode ? (
            <button
              onClick={() => onSaveStrategy({ nextView: 'overview' })}
              disabled={!teamName.trim() || creatingTeam}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {creatingTeam ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Updating...
                </>
              ) : (
                <>Update Strategy</>
              )}
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => onSaveStrategy({ nextView: 'chat' })}
                disabled={!teamName.trim() || creatingTeam}
                className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {creatingTeam ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <PencilLine size={18} />
                    Continue with Manual Setup
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onStartAnalysisFlow}
                disabled={creatingTeam}
                className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Sparkles size={20} />
                Auto Analyze + Build
              </button>
            </div>
          )}

          {strategy && hasCompletedBasicProfile && (
            <button
              type="button"
              onClick={onCancel}
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
