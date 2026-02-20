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
      {/* Image/PDF Upload Button */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="flex items-center px-3 py-2 border border-blue-300 rounded-md hover:bg-blue-50 cursor-pointer">
          <Image className="h-4 w-4 mr-2 text-[#0077B5]" />
          Add Images or PDF
          <input
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={onImageUpload}
            className="hidden"
          />
        </label>
        <span className="text-sm text-gray-600">
          {selectedImages.length > 0 && (
            <span className="font-medium text-blue-600">
              {selectedImages.length} file{selectedImages.length !== 1 ? 's' : ''} selected
              {selectedImages.length >= 2 && ' (Carousel)'}
            </span>
          )}
          {selectedImages.length === 0 && 'Images (max 9, 5MB each) or PDF (max 100MB)'}
        </span>
      </div>
      
      {/* Carousel Info */}
      {selectedImages.length >= 2 && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">📱 Carousel Mode:</span> Your post will appear as a swipeable carousel on LinkedIn with {selectedImages.length} slides.
          </p>
        </div>
      )}
      
      {/* PDF Carousel Tip */}
      {selectedImages.length === 0 && (
        <div className="bg-purple-50 border-l-4 border-purple-400 p-3 rounded">
          <p className="text-sm text-purple-800">
            <span className="font-semibold">💡 Pro Tip:</span> Upload a multi-page PDF to create a document carousel. Each page becomes a swipeable slide on LinkedIn.
          </p>
        </div>
      )}
      
      {/* Image/PDF Previews */}
      {selectedImages.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {selectedImages.map((image, index) => (
            <div key={image.id || index} className="relative group">
              <div className="absolute top-2 left-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded-full font-semibold z-10">
                {index + 1}
              </div>
              {image.type === 'application/pdf' ? (
                <div className="w-full aspect-square flex items-center justify-center bg-gray-100 rounded-lg border">
                  <div className="text-center">
                    <div className="text-4xl mb-2">📄</div>
                    <div className="text-xs text-gray-600 px-2">PDF Document</div>
                    <div className="text-xs text-gray-500 mt-1">{image.name}</div>
                  </div>
                </div>
              ) : (
                <img
                  src={image.preview || image.url}
                  alt={`Preview ${index + 1}`}
                  className="w-full aspect-square object-cover rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onImagePreview && onImagePreview(image)}
                />
              )}
              <button
                onClick={() => onImageRemove(index)}
                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                <X className="h-3 w-3" />
              </button>
              {image.isAIGenerated && (
                <div className="absolute bottom-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">
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
          <span className="text-sm">Uploading files...</span>
        </div>
      )}
    </div>
  );
};

export default LinkedInImageUploader;
