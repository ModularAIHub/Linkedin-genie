import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
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
import api, { byok } from '../utils/api';

const normalizeCrossPostTargetAccounts = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const id = item?.id !== undefined && item?.id !== null ? String(item.id).trim() : '';
      if (!id) return null;
      return {
        id,
        username: item?.username ? String(item.username).trim() : null,
        displayName: item?.displayName ? String(item.displayName).trim() : null,
        supportsMediaUpload:
          item?.supportsMediaUpload === undefined || item?.supportsMediaUpload === null
            ? null
            : Boolean(item.supportsMediaUpload),
      };
    })
    .filter(Boolean);
};

const formatCrossPostTargetLabel = (account) => {
  const displayName = String(account?.displayName || '').trim();
  const username = String(account?.username || '').trim().replace(/^@/, '');

  if (displayName && username && !displayName.toLowerCase().includes(username.toLowerCase())) {
    return `${displayName} (@${username})`;
  }

  if (displayName) return displayName;
  if (username) return `@${username}`;
  return 'Connected account';
};

const LinkedInPostComposer = () => {
  const { accounts, loading: accountsLoading, selectedAccount } = useAccount();
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [apiKeyMode, setApiKeyMode] = useState('platform');
  const [apiKeyPreference, setApiKeyPreference] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [postToX, setPostToX] = useState(false);
  const [postToThreads, setPostToThreads] = useState(false);
  const [xConnected, setXConnected] = useState(null);
  const [threadsConnected, setThreadsConnected] = useState(null);
  const [xConnectionReason, setXConnectionReason] = useState('');
  const [threadsConnectionReason, setThreadsConnectionReason] = useState('');
  const [xTargetAccounts, setXTargetAccounts] = useState([]);
  const [threadsTargetAccounts, setThreadsTargetAccounts] = useState([]);
  const [selectedCrossPostTargetIds, setSelectedCrossPostTargetIds] = useState({ x: '', threads: '' });
  const [optimizeCrossPost, setOptimizeCrossPost] = useState(true);

  const fetchCrossPostStatuses = async () => {
    const teamId = selectedAccount?.team_id || selectedAccount?.teamId || null;
    const headers = teamId ? { 'x-team-id': String(teamId) } : {};

    try {
      const res = await api.get('/api/twitter/targets', { headers });
      const data = res?.data || { connected: false, reason: 'service_unreachable', accounts: [] };
      const accounts = normalizeCrossPostTargetAccounts(data.accounts);
      setXTargetAccounts(accounts);
      const isConnected = data.connected === true || accounts.length > 0;
      setXConnected(isConnected);
      setXConnectionReason(isConnected ? '' : (typeof data.reason === 'string' ? data.reason : ''));
    } catch (error) {
      console.error('Failed to fetch X status:', error);
      setXTargetAccounts([]);
      setXConnected(false);
      setXConnectionReason('service_unreachable');
    }

    try {
      const res = await api.get('/api/threads/targets', { headers });
      const data = res?.data || { connected: false, reason: 'service_unreachable', accounts: [] };
      const accounts = normalizeCrossPostTargetAccounts(data.accounts);
      setThreadsTargetAccounts(accounts);
      const isConnected = data.connected === true || accounts.length > 0;
      setThreadsConnected(isConnected);
      setThreadsConnectionReason(isConnected ? '' : (typeof data.reason === 'string' ? data.reason : ''));
    } catch (error) {
      console.error('Failed to fetch Threads status:', error);
      setThreadsTargetAccounts([]);
      setThreadsConnected(false);
      setThreadsConnectionReason('service_unreachable');
    }
  };

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

  useEffect(() => {
    let mounted = true;
    const safeFetch = async () => {
      if (!mounted) return;
      await fetchCrossPostStatuses();
    };

    safeFetch();

    const handleFocus = () => {
      safeFetch();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        safeFetch();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mounted = false;
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [selectedAccount?.id, selectedAccount?.team_id, selectedAccount?.teamId]);

  const handleScheduleClick = () => {
    if (!content.trim() && selectedImages.length === 0) {
      toast.error('Please enter some content or add images');
      return;
    }
    setShowScheduleModal(true);
  };

  const handleScheduleSubmit = async () => {
    if (!scheduleDate || !scheduleTime) {
      toast.error('Please select both date and time');
      return;
    }

    if (!ensureCrossPostTargetsSelected()) {
      return;
    }
    
    const scheduledDateTime = `${scheduleDate}T${scheduleTime}`;
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const crossPostTargetAccountIds = {
      ...(postToX && selectedCrossPostTargetIds.x ? { x: selectedCrossPostTargetIds.x } : {}),
      ...(postToThreads && selectedCrossPostTargetIds.threads
        ? { threads: selectedCrossPostTargetIds.threads }
        : {}),
    };
    const crossPostTargetAccountLabels = {
      ...(postToX && selectedCrossPostTargetIds.x
        ? { x: getCrossPostTargetLabel('x', selectedCrossPostTargetIds.x) }
        : {}),
      ...(postToThreads && selectedCrossPostTargetIds.threads
        ? { threads: getCrossPostTargetLabel('threads', selectedCrossPostTargetIds.threads) }
        : {}),
    };
    
    await handleSchedule(scheduledDateTime, userTimezone, {
      x: postToX,
      threads: postToThreads,
      optimizeCrossPost,
      crossPostTargetAccountIds,
      crossPostTargetAccountLabels,
    });
    setShowScheduleModal(false);
    setScheduleDate('');
    setScheduleTime('');
  };
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

  useEffect(() => {
    if (accountsLoading || !Array.isArray(accounts) || accounts.length === 0) {
      if (xTargetAccounts.length > 0) {
        setXTargetAccounts([]);
      }
      if (threadsTargetAccounts.length > 0) {
        setThreadsTargetAccounts([]);
      }
      if (xConnected !== null) {
        setXConnected(null);
      }
      if (threadsConnected !== null) {
        setThreadsConnected(null);
      }
      if (xConnectionReason) {
        setXConnectionReason('');
      }
      if (threadsConnectionReason) {
        setThreadsConnectionReason('');
      }
      return undefined;
    }

    setSelectedCrossPostTargetIds((previous) => {
      const next = { ...previous };

      const resolveSelectedId = (currentId, enabled, accounts) => {
        if (!enabled) return '';
        if (!Array.isArray(accounts) || accounts.length === 0) return '';
        const normalizedCurrent = String(currentId || '').trim();
        const hasCurrent = accounts.some((account) => account.id === normalizedCurrent);
        if (hasCurrent) return normalizedCurrent;
        return String(accounts[0].id || '').trim();
      };

      next.x = resolveSelectedId(previous.x, postToX && xConnected === true, xTargetAccounts);
      next.threads = resolveSelectedId(
        previous.threads,
        postToThreads && threadsConnected === true,
        threadsTargetAccounts
      );

      if (next.x === previous.x && next.threads === previous.threads) {
        return previous;
      }

      return next;
    });
  }, [
    accounts,
    accountsLoading,
    postToX,
    postToThreads,
    xConnected,
    xConnectionReason,
    threadsConnected,
    threadsConnectionReason,
    xTargetAccounts,
    threadsTargetAccounts,
  ]);

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

  const crossPostSelected = Boolean(postToX || postToThreads);
  const hasAnyImagesForCurrentDraft = Array.isArray(selectedImages) && selectedImages.length > 0;
  const xToggleDisabled = xConnected !== true;
  const threadsToggleDisabled = threadsConnected !== true;
  const selectedXTargetAccount = xTargetAccounts.find(
    (account) => account.id === String(selectedCrossPostTargetIds.x || '')
  ) || null;
  const xTargetSupportsMediaUpload = selectedXTargetAccount?.supportsMediaUpload;
  const getConnectionStatusText = (connected, reason) => {
    if (connected === null) return 'Checking...';
    if (connected === true) return 'Connected';

    const normalizedReason = String(reason || '').toLowerCase();
    if (normalizedReason === 'token_expired') return 'Token expired';
    if (normalizedReason === 'integration_auth') return 'Integration auth issue';
    if (normalizedReason === 'internal_error') return 'Service error';
    if (normalizedReason === 'timeout') return 'Timed out';
    if (normalizedReason === 'service_unreachable') return 'Service unavailable';
    if (normalizedReason === 'not_configured') return 'Unavailable';
    if (normalizedReason === 'unauthorized') return 'Session issue';
    return 'Not connected';
  };

  const getPlatformDisabledTitle = ({ platform, reason }) => {
    const normalizedReason = String(reason || '').toLowerCase();
    if (platform === 'x' && normalizedReason === 'token_expired') {
      return 'Reconnect X in Tweet Genie (token expired)';
    }
    if (platform === 'threads' && normalizedReason === 'token_expired') {
      return 'Reconnect Threads in Social Genie (token expired)';
    }
    if (normalizedReason === 'integration_auth') {
      return 'Internal integration key mismatch between apps (check INTERNAL_API_KEY)';
    }
    if (normalizedReason === 'service_unreachable') {
      return platform === 'x'
        ? 'Tweet Genie backend is unreachable from Linkedin Genie'
        : 'Social Genie backend is unreachable from Linkedin Genie';
    }
    if (normalizedReason === 'not_configured') {
      return platform === 'x'
        ? 'Configure TWEET_GENIE_URL / INTERNAL_API_KEY in Linkedin Genie'
        : 'Configure SOCIAL_GENIE_URL / INTERNAL_API_KEY in Linkedin Genie';
    }
    if (platform === 'x') return 'Connect X in Tweet Genie first';
    return 'Connect Threads in Social Genie first';
  };

  const getCrossPostTargetLabel = (platform, accountId) => {
    const normalizedId = String(accountId || '').trim();
    if (!normalizedId) return null;

    const source = platform === 'x' ? xTargetAccounts : threadsTargetAccounts;
    const account = source.find((item) => item.id === normalizedId);
    if (!account) return null;
    return account.displayName || account.username || null;
  };

  const ensureCrossPostTargetsSelected = () => {
    if (postToX && !String(selectedCrossPostTargetIds.x || '').trim()) {
      toast.error('Select an X account for cross-post.');
      return false;
    }
    if (postToThreads && !String(selectedCrossPostTargetIds.threads || '').trim()) {
      toast.error('Select a Threads account for cross-post.');
      return false;
    }
    return true;
  };

  const crossPostCard = (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-4 sm:p-5 space-y-3">
      <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Post to</div>

      {[
        {
          key: 'x',
          label: 'X',
          iconBg: 'bg-black',
          iconText: 'X',
          connected: xConnected === true,
          enabled: postToX,
          disabled: xToggleDisabled,
          statusText:
            getConnectionStatusText(xConnected, xConnectionReason),
          accounts: xTargetAccounts,
          selectedId: selectedCrossPostTargetIds.x,
          onSelect: (value) => setSelectedCrossPostTargetIds((previous) => ({ ...previous, x: value })),
          onToggle: () =>
            setPostToX((value) => {
              const next = !value;
              if (next && !selectedCrossPostTargetIds.x && xTargetAccounts.length > 0) {
                setSelectedCrossPostTargetIds((previous) => ({
                  ...previous,
                  x: String(xTargetAccounts[0]?.id || ''),
                }));
              }
              return next;
            }),
          disabledTitle: getPlatformDisabledTitle({ platform: 'x', reason: xConnectionReason }),
        },
        {
          key: 'threads',
          label: 'Threads',
          iconBg: 'bg-neutral-900',
          iconText: '@',
          connected: threadsConnected === true,
          enabled: postToThreads,
          disabled: threadsToggleDisabled,
          statusText:
            getConnectionStatusText(threadsConnected, threadsConnectionReason),
          accounts: threadsTargetAccounts,
          selectedId: selectedCrossPostTargetIds.threads,
          onSelect: (value) =>
            setSelectedCrossPostTargetIds((previous) => ({ ...previous, threads: value })),
          onToggle: () =>
            setPostToThreads((value) => {
              const next = !value;
              if (next && !selectedCrossPostTargetIds.threads && threadsTargetAccounts.length > 0) {
                setSelectedCrossPostTargetIds((previous) => ({
                  ...previous,
                  threads: String(threadsTargetAccounts[0]?.id || ''),
                }));
              }
              return next;
            }),
          disabledTitle: getPlatformDisabledTitle({ platform: 'threads', reason: threadsConnectionReason }),
        },
      ].map(platform => (
        <div
          key={platform.key}
          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
            !platform.connected ? 'border-red-200 bg-red-50/40' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="w-full space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-9 w-9 rounded-lg ${platform.iconBg} text-white flex items-center justify-center font-bold text-sm shrink-0`}>
                  {platform.iconText}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{platform.label}</div>
                  <div className={`text-xs truncate ${!platform.connected ? 'text-red-500' : 'text-gray-500'}`}>
                    {platform.statusText}
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-label={`Post to ${platform.label}`}
                role="switch"
                aria-checked={platform.enabled && !platform.disabled}
                aria-disabled={platform.disabled}
                title={platform.disabled ? platform.disabledTitle : ''}
                onClick={() => { if (!platform.disabled) platform.onToggle(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!platform.disabled) platform.onToggle();
                  }
                }}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  platform.disabled
                    ? 'bg-gray-200 cursor-not-allowed'
                    : platform.enabled
                      ? 'bg-blue-600'
                      : 'bg-gray-300'
                }`}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                  style={{ left: platform.enabled && !platform.disabled ? '22px' : '2px' }}
                />
              </button>
            </div>

            {platform.enabled && platform.connected && Array.isArray(platform.accounts) && platform.accounts.length > 0 && (
              <div className="pl-12">
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Post using this account
                </label>
                <select
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
                  value={platform.selectedId}
                  onChange={(event) => platform.onSelect(String(event.target.value || ''))}
                >
                  {platform.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {formatCrossPostTargetLabel(account)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Optimize formatting per platform</div>
          <div className="text-xs text-gray-500">Format-only optimization. No wording changes.</div>
        </div>
        <button
          type="button"
          aria-label="Optimize formatting per platform"
          role="switch"
          aria-checked={optimizeCrossPost}
          onClick={() => setOptimizeCrossPost(v => !v)}
          className={`relative h-6 w-11 rounded-full transition-colors ${optimizeCrossPost ? 'bg-blue-600' : 'bg-gray-300'}`}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
            style={{ left: optimizeCrossPost ? '22px' : '2px' }}
          />
        </button>
      </div>
      {crossPostSelected && hasAnyImagesForCurrentDraft && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-900">
          {postToX && xTargetSupportsMediaUpload === false
            ? 'The selected X account does not have Tweet Genie media permissions yet. Reconnect that X account with OAuth1/media permissions to attach images.'
            : 'Images are sent to selected cross-post targets when supported. X image cross-post requires Tweet Genie media permissions on the selected X account.'}
        </div>
      )}
    </div>
  );

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
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* LinkedIn Account Info */}
        <div className="mb-6">
          <LinkedInAccountInfo />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {/* Composer Card - Modern UI */}
            <div className="bg-white rounded-3xl shadow-2xl p-4 sm:p-6 md:p-8 border border-gray-200 backdrop-blur-sm">
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
              onPost={() => {
                if (!ensureCrossPostTargetsSelected()) {
                  return;
                }

                const crossPostTargetAccountIds = {
                  ...(postToX && selectedCrossPostTargetIds.x ? { x: selectedCrossPostTargetIds.x } : {}),
                  ...(postToThreads && selectedCrossPostTargetIds.threads
                    ? { threads: selectedCrossPostTargetIds.threads }
                    : {}),
                };
                const crossPostTargetAccountLabels = {
                  ...(postToX && selectedCrossPostTargetIds.x
                    ? { x: getCrossPostTargetLabel('x', selectedCrossPostTargetIds.x) }
                    : {}),
                  ...(postToThreads && selectedCrossPostTargetIds.threads
                    ? { threads: getCrossPostTargetLabel('threads', selectedCrossPostTargetIds.threads) }
                    : {}),
                };

                handlePost({
                  x: postToX,
                  threads: postToThreads,
                  optimizeCrossPost,
                  crossPostTargetAccountIds,
                  crossPostTargetAccountLabels,
                });
              }}
              selectedImages={selectedImages}
              isUploadingImages={isUploadingImages}
              onSchedule={handleScheduleClick}
            />
          </div>

            </div>
          </div>
          <div className="space-y-6">
            {crossPostCard}
          </div>
        </div>

        {/* Schedule Modal */}
        {showScheduleModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setShowScheduleModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">Schedule Post</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Time</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowScheduleModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleScheduleSubmit}
                  disabled={!scheduleDate || !scheduleTime}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all"
                >
                  Schedule
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkedInPostComposer;
