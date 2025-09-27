import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { fetchApiKeyPreference } from '../../utils/byok-platform';

const LinkedInAIContentGenerator = ({
  showAIPrompt,
  aiPrompt,
  setAiPrompt,
  aiStyle,
  setAiStyle,
  isGenerating,
  onGenerate,
  onCancel
}) => {
  // Local state for unrestricted input
  const [localPrompt, setLocalPrompt] = useState(aiPrompt || '');
  // State for BYOK/platform mode
  const [apiKeyMode, setApiKeyMode] = useState('platform');

  // Fetch BYOK/platform mode on mount
  useEffect(() => {
    let mounted = true;
    fetchApiKeyPreference().then(mode => {
      if (mounted) setApiKeyMode(mode);
    });
    return () => { mounted = false; };
  }, []);

  // Sync with parent state when it changes externally
  useEffect(() => {
    setLocalPrompt(aiPrompt || '');
  }, [aiPrompt]);

  // Handle local input changes without sanitization
  const handlePromptChange = (e) => {
    const value = e.target.value;
    setLocalPrompt(value);
  };

  // Handle blur to sync with parent (this applies sanitization)
  const handlePromptBlur = () => {
    setAiPrompt(localPrompt);
  };

  // Handle generate button click
  const handleGenerate = () => {
    setAiPrompt(localPrompt); // Ensure latest value is synced
    onGenerate();
  };

  if (!showAIPrompt) return null;

  return (
    <div className="shadow-lg border border-blue-100 rounded-2xl p-6 mb-6 bg-gradient-to-br from-blue-50 via-white to-blue-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Sparkles className="h-6 w-6 text-[#0077B5] mr-2 animate-pulse" />
          <h3 className="font-semibold text-[#0077B5] text-lg tracking-tight">AI LinkedIn Content Generator</h3>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600 text-2xl font-bold px-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
          title="Close"
        >
          ×
        </button>
      </div>
      {/* BYOK/platform mode indicator */}
      <div className="mb-3">
        <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-[#0077B5]">
          {apiKeyMode === 'byok' ? 'Using Your Own API Key (BYOK)' : 'Using Platform API Key'}
        </span>
      </div>
      <div className="space-y-5">
        <div>
          <label className="block text-base font-semibold text-[#0077B5] mb-2">
            What would you like to post about?
          </label>
          <textarea
            value={localPrompt}
            onChange={handlePromptChange}
            onBlur={handlePromptBlur}
            placeholder="e.g., Generate 5 posts about leadership, Create 3 carousels on networking, Share 4 tips for job seekers..."
            className="w-full px-4 py-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0077B5] text-base bg-white/80 transition-all resize-none min-h-[60px]"
            rows={Math.max(3, localPrompt.split('\n').length)}
            style={{ minHeight: '60px', height: 'auto', overflow: 'hidden' }}
            onInput={e => {
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
          />
          <div className="mt-2 text-xs text-[#0077B5]">
            💡 For bulk, try: <span className="font-medium">"Generate 5 posts about LinkedIn growth"</span> or <span className="font-medium">"Create 3 carousels about leadership"</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            � <span className="font-medium">Credit cost:</span> 1.2 credits per post generated
          </div>
        </div>
        <div>
          <label className="block text-base font-semibold text-[#0077B5] mb-2">
            Style
          </label>
          <select
            value={aiStyle}
            onChange={(e) => setAiStyle(e.target.value)}
            className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0077B5] text-base bg-white/80"
          >
            <option value="professional">Professional</option>
            <option value="casual">Casual</option>
            <option value="inspirational">Inspirational</option>
            <option value="informative">Informative</option>
            <option value="industry">Industry-specific</option>
          </select>
        </div>
        <button
          onClick={handleGenerate}
          disabled={!localPrompt.trim() || isGenerating}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-[#0077B5] to-blue-700 text-white rounded-xl shadow-lg font-semibold text-base hover:from-[#005983] hover:to-blue-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></span>
              Generating...
            </>
          ) : (
            <>
              <ArrowRight className="h-5 w-5 mr-1" />
              Generate Content
            </>
          )}
        </button>
        {/* Progress bar for loading */}
        {isGenerating && (
          <div className="mt-4 w-full">
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-2 bg-[#0077B5] animate-pulse rounded-full w-2/3 transition-all"></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkedInAIContentGenerator;
