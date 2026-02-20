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
import { useAccount } from '../contexts/AccountContext';
import AccountSelector from '../components/AccountSelector';
import { byok } from '../utils/api';

const LinkedInPostComposer = () => {
  const { accounts, loading: accountsLoading, selectedAccount } = useAccount();
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [apiKeyMode, setApiKeyMode] = useState('platform');
  const [apiKeyPreference, setApiKeyPreference] = useState(null);

  useEffect(() => {
    let mounted = true;
    const fetchPreference = async () => {
      try {
        const response = await byok.getPreference();
        if (mounted) {
          setApiKeyPreference(response.data);
          setApiKeyMode(response.data.api_key_preference || 'platform');
        }
      } catch (error) {
        console.error('Failed to fetch API key preference:', error);
        if (mounted) setApiKeyMode('platform');
      }
    };
    fetchPreference();
    return () => { mounted = false; };
  }, []);
  const {
    content,
    setContent,
    isPosting,
    isScheduling,
    scheduledFor,
    setScheduledFor,
  // linkedInAccounts, // No longer needed - use accounts from AccountContext
  // isLoadingLinkedInAccounts, // No longer needed
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

  if (accountsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-gray-600">Loading your LinkedIn accounts...</p>
        </div>
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* BYOK/platform mode indicator & Account Selector */}
      <div className="w-full flex flex-col items-center pt-6 pb-4 gap-3">
        <span className={`inline-block px-5 py-2.5 rounded-full text-sm font-semibold shadow-md transition-all hover:shadow-lg ${
          apiKeyMode === 'byok' ? 'bg-gradient-to-r from-green-100 to-emerald-100 text-green-700' : 'bg-gradient-to-r from-blue-100 to-cyan-100 text-[#0077B5]'
        }`}>
          {apiKeyMode === 'byok' ? '🔑 Using Your Own API Key (BYOK)' : '🏢 Using Platform API Key'}
        </span>
        {apiKeyPreference?.locked && apiKeyPreference?.byok_locked_until && (
          <span className="text-xs text-yellow-700 bg-yellow-100 px-3 py-1.5 rounded-full shadow-sm">
            🔒 Locked until {new Date(apiKeyPreference.byok_locked_until).toLocaleDateString()}
          </span>
        )}
      </div>
      
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* LinkedIn Account Info */}
        <div className="mb-6">
          <LinkedInAccountInfo />
        </div>

        {/* Composer Card - Modern UI */}
        <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8 md:p-12 border border-gray-200 backdrop-blur-sm">
          {/* Card Header */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
            <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-[#0077B5] to-blue-600 bg-clip-text text-transparent">
              Compose LinkedIn Post
            </h2>
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#0077B5] to-blue-600 flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-lg">in</span>
              </div>
            </div>
          </div>

          {/* Content Editor */}
          <div className="mb-6">
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
