import React from 'react';
import { Wand2, ArrowRight } from 'lucide-react';

const LinkedInAIImageGenerator = ({
  showImagePrompt,
  imagePrompt,
  setImagePrompt,
  imageStyle,
  setImageStyle,
  isGeneratingImage,
  onGenerate,
  onCancel
}) => {
  if (!showImagePrompt) return null;

  return (
    <div className="border border-blue-200 rounded-lg p-4 mb-4 bg-blue-50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <Wand2 className="h-5 w-5 text-[#0077B5] mr-2" />
          <h3 className="font-medium text-[#0077B5]">AI LinkedIn Image Generator</h3>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-[#0077B5] mb-1">
            Describe the image you want to generate
          </label>
          <textarea
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            placeholder="e.g., A professional team meeting, A modern office workspace..."
            className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0077B5]"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#0077B5] mb-1">
            Style
          </label>
          <select
            value={imageStyle}
            onChange={(e) => setImageStyle(e.target.value)}
            className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0077B5]"
          >
            <option value="professional">Professional</option>
            <option value="modern">Modern</option>
            <option value="corporate">Corporate</option>
            <option value="minimal">Minimal</option>
            <option value="creative">Creative</option>
          </select>
        </div>
        <button
          onClick={onGenerate}
          disabled={!imagePrompt.trim() || isGeneratingImage}
          className="flex items-center px-4 py-2 bg-[#0077B5] text-white rounded-md hover:bg-[#005983] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGeneratingImage ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Generating...
            </>
          ) : (
            <>
              <ArrowRight className="h-4 w-4 mr-2" />
              Generate Image
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default LinkedInAIImageGenerator;
