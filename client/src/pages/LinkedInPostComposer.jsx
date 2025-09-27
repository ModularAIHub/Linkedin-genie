import React, { useState, useEffect } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import LinkedInConnect from '../components/LinkedInConnect';
import {
  LinkedInAccountInfo,
  LinkedInPostContentEditor,
  AIContentGenerator,
  AIImageGenerator,
  LinkedInImageUploader,
  LinkedInPostActions,
  SchedulingPanel
} from '../components/LinkedInPostComposer';
import { useLinkedInPostComposer } from '../hooks/useLinkedInPostComposer';
import { fetchApiKeyPreference } from '../utils/byok-platform';

const LinkedInPostComposer = () => {
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [apiKeyMode, setApiKeyMode] = useState('platform');

  useEffect(() => {
    let mounted = true;
    fetchApiKeyPreference().then(mode => {
      if (mounted) setApiKeyMode(mode);
    });
    return () => { mounted = false; };
  }, []);
  const {
    content,
    setContent,
    isPosting,
    isScheduling,
    scheduledFor,
    setScheduledFor,
    linkedInAccounts,
    isLoadingLinkedInAccounts,
  // carouselSlides,
  // carouselImages,
  // isCarousel,
  // setIsCarousel,
    showAIPrompt,
    aiPrompt,
    setAiPrompt,
    aiStyle,
    setAiStyle,
    isGenerating,
    showImagePrompt,
    imagePrompt,
    setImagePrompt,
    imageStyle,
    setImageStyle,
    isGeneratingImage,
    selectedImages,
    isUploadingImages,
    scheduledPosts,
    isLoadingScheduled,
    characterCount,
    handleImageUpload,
    handleImageRemove,
    handlePost,
    handleSchedule,
    handleAIGenerate,
    handleImageGenerate,
    handleCancelScheduled,
  // handleCarouselSlideChange,
  // handleCarouselImageUpload,
  // handleCarouselImageRemove,
  // handleAddSlide,
  // handleRemoveSlide,
    handleAIButtonClick,
    handleImageButtonClick,
    fetchScheduledPosts
  } = useLinkedInPostComposer();

  if (isLoadingLinkedInAccounts) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-gray-600">Loading your LinkedIn account...</p>
        </div>
      </div>
    );
  }

  if (!linkedInAccounts || linkedInAccounts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto">
          <div className="bg-white rounded-lg shadow-md p-8">
            <LinkedInConnect />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* BYOK/platform mode indicator - always visible at top */}
      <div className="w-full flex justify-center pt-4 pb-2">
        <span className="inline-block px-4 py-2 rounded-full text-sm font-semibold bg-blue-100 text-[#0077B5] shadow">
          {apiKeyMode === 'byok' ? 'Using Your Own API Key (BYOK)' : 'Using Platform API Key'}
        </span>
      </div>
  <div className="max-w-4xl mx-auto px-2 sm:px-8 lg:px-16 py-8">
        {/* LinkedIn Account Info */}
        <LinkedInAccountInfo linkedInAccounts={linkedInAccounts} />

        {/* Composer Card - Modern UI */}
  <div className="bg-white rounded-2xl shadow-xl p-6 md:p-10 border border-gray-100 mt-6 max-w-3xl mx-auto">
          {/* Card Header */}
          <div className="flex items-center mb-4">
            <svg className="h-7 w-7 text-[#0077B5] mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 01.88 7.9M12 3v1m0 16v1m8.66-13.66l-.7.7M4.34 19.66l-.7.7M21 12h-1M4 12H3m16.66 7.66l-.7-.7M4.34 4.34l-.7-.7" /></svg>
            <h2 className="text-xl md:text-2xl font-bold text-gray-900">Compose LinkedIn Post</h2>
          </div>

          {/* Content Editor */}
          <div className="mb-4">
            <LinkedInPostContentEditor
              content={content}
              setContent={setContent}
              characterCount={characterCount}
              onAIButtonClick={handleAIButtonClick}
              onImageButtonClick={handleImageButtonClick}
              showAIPrompt={showAIPrompt}
              showImagePrompt={showImagePrompt}
            />
          </div>

          {/* AI Content Generator (inline) */}
          {showAIPrompt && (
            <div className="mb-4">
              <AIContentGenerator
                showAIPrompt={showAIPrompt}
                aiPrompt={aiPrompt}
                setAiPrompt={setAiPrompt}
                aiStyle={aiStyle}
                setAiStyle={setAiStyle}
                isGenerating={isGenerating}
                onGenerate={handleAIGenerate}
                onCancel={handleAIButtonClick}
              />
            </div>
          )}

          {/* AI Image Generator (inline) */}
          {showImagePrompt && (
            <div className="mb-4">
              <AIImageGenerator
                showImagePrompt={showImagePrompt}
                imagePrompt={imagePrompt}
                setImagePrompt={setImagePrompt}
                imageStyle={imageStyle}
                setImageStyle={setImageStyle}
                isGeneratingImage={isGeneratingImage}
                onGenerate={handleImageGenerate}
                onCancel={() => setShowImagePrompt(false)}
              />
            </div>
          )}

          {/* Image Uploader */}
          <div className="mb-6">
            <LinkedInImageUploader
              selectedImages={selectedImages}
              onImageUpload={handleImageUpload}
              onImageRemove={handleImageRemove}
              isUploadingImages={isUploadingImages}
              onImagePreview={img => setImageModal({ open: true, src: img.preview || img.url })}
            />
            {/* Image Modal for full preview */}
            {imageModal.open && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70" onClick={() => setImageModal({ open: false, src: null })}>
                <div className="relative max-w-3xl w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
                  <img src={imageModal.src} alt="Full preview" className="max-h-[80vh] max-w-full rounded shadow-lg border-4 border-white" />
                  <button className="mt-4 px-6 py-2 bg-white text-black rounded shadow font-semibold" onClick={() => setImageModal({ open: false, src: null })}>Close</button>
                </div>
              </div>
            )}
          </div>

          {/* Post Actions */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <LinkedInPostActions
              content={content}
              isPosting={isPosting}
              onPost={handlePost}
              selectedImages={selectedImages}
              isUploadingImages={isUploadingImages}
              onSchedule={handleSchedule}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LinkedInPostComposer;
