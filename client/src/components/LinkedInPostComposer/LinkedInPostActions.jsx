import React from 'react';
import { Send } from 'lucide-react';

const LinkedInPostActions = ({
  isCarousel,
  content,
  carouselSlides,
  selectedImages,
  isPosting,
  onPost
}) => {
  const hasContent = isCarousel 
    ? carouselSlides.some(slide => slide.trim().length > 0)
    : content.trim().length > 0;
  const canPost = hasContent || selectedImages.length > 0;

  return (
    <div className="flex w-full">
      <button
        onClick={onPost}
        disabled={!canPost || isPosting}
        className="w-full flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md font-semibold text-base transition-all"
      >
        {isPosting ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
            Posting...
          </>
        ) : (
          <>
            <Send className="h-5 w-5 mr-2" />
            {isCarousel ? 'Post Carousel Now' : 'Post Now'}
          </>
        )}
      </button>
    </div>
  );
};

export default LinkedInPostActions;
