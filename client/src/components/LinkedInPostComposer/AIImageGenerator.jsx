import React from "react";

// Placeholder for AIImageGenerator component
const AIImageGenerator = ({ onImageGenerated }) => {
  return (
    <div className="p-4 border rounded bg-gray-50">
      <h3 className="font-semibold mb-2">AI Image Generator</h3>
      <button
        className="px-4 py-2 bg-green-600 text-white rounded"
        onClick={() => onImageGenerated && onImageGenerated("https://placehold.co/600x400")}
      >
        Generate Image
      </button>
    </div>
  );
};

export default AIImageGenerator;
