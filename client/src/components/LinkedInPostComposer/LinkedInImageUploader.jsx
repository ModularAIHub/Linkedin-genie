import React from 'react';
import { Image, X } from 'lucide-react';

const LinkedInImageUploader = ({
  selectedImages,
  onImageUpload,
  onImageRemove,
  isUploadingImages,
  onImagePreview
}) => {
  return (
    <div className="space-y-4">
      {/* Image Upload Button */}
      <div className="flex items-center space-x-2">
        <label className="flex items-center px-3 py-2 border border-blue-300 rounded-md hover:bg-blue-50 cursor-pointer">
          <Image className="h-4 w-4 mr-2 text-[#0077B5]" />
          Add Images
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={onImageUpload}
            className="hidden"
          />
        </label>
        <span className="text-sm text-blue-500">
          Max 9 images, 5MB each
        </span>
      </div>
      {/* Image Previews */}
      {selectedImages.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {selectedImages.map((image, index) => (
            <div key={image.id || index} className="relative group">
              <img
                src={image.preview || image.url}
                alt={`Preview ${index + 1}`}
                className="w-full aspect-square object-cover rounded-lg border cursor-pointer"
                onClick={() => onImagePreview && onImagePreview(image)}
              />
              <button
                onClick={() => onImageRemove(index)}
                className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
              {image.isAIGenerated && (
                <div className="absolute bottom-1 left-1 bg-blue-600 text-white text-xs px-2 py-1 rounded">
                  AI Generated
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Upload Progress */}
      {isUploadingImages && (
        <div className="flex items-center space-x-2 text-[#0077B5]">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#0077B5]"></div>
          <span className="text-sm">Uploading images...</span>
        </div>
      )}
    </div>
  );
};

export default LinkedInImageUploader;
