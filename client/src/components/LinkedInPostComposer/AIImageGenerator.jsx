
import React from "react";

const AIImageGenerator = ({
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
    <div className="p-4 bg-green-50 rounded shadow mb-4">
      <h4 className="font-semibold mb-2">AI Image Generator</h4>
      <input
        className="w-full border rounded p-2 mb-2"
        value={imagePrompt}
        onChange={e => setImagePrompt(e.target.value)}
        placeholder="Enter image prompt..."
      />
      <input
        className="w-full border rounded p-2 mb-2"
        value={imageStyle}
        onChange={e => setImageStyle(e.target.value)}
        placeholder="Style (optional)"
      />
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-green-600 text-white rounded" onClick={onGenerate} disabled={isGeneratingImage}>
          {isGeneratingImage ? 'Generating...' : 'Generate'}
        </button>
        <button className="px-4 py-2 bg-gray-300 text-black rounded" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

export default AIImageGenerator;
