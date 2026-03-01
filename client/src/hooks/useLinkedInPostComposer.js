import { useState, useEffect } from 'react';
import api, { linkedin } from '../utils/api';
import { sanitizeAIContent, sanitizeImagePrompt } from '../utils/sanitization';
import { htmlToUnicode } from '../components/LinkedInPostComposer/LinkedInPostContentEditor';
import toast from 'react-hot-toast';
import { useAccountAwareAPI } from './useAccountAwareAPI';

const useLinkedInPostComposer = () => {
  const { accountId, selectedAccount, postForCurrentAccount, getScheduledPosts } = useAccountAwareAPI();
  // State
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStyle, setAiStyle] = useState('casual');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState('natural');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [isLoadingScheduled, setIsLoadingScheduled] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);
  const MAX_CROSSPOST_IMAGE_COUNT = 4;
  const MAX_CROSSPOST_MEDIA_TOTAL_BYTES = 6 * 1024 * 1024;

  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const estimateDataUrlBytes = (value) => {
    const raw = String(value || '');
    const match = raw.match(/^data:[^;,]+;base64,(.+)$/i);
    if (!match) return 0;
    return Math.floor((match[1].length * 3) / 4);
  };

  const buildCrossPostMediaPayload = async () => {
    const payload = [];
    let totalBytes = 0;

    for (const image of selectedImages) {
      if (payload.length >= MAX_CROSSPOST_IMAGE_COUNT) break;
      if (image?.isPDF || String(image?.type || '').toLowerCase() === 'application/pdf') {
        continue;
      }

      let mediaValue = '';
      if (typeof image?.url === 'string' && image.url.startsWith('data:image/')) {
        mediaValue = image.url;
      } else if (image?.file && String(image.file.type || '').startsWith('image/')) {
        try {
          mediaValue = await fileToDataUrl(image.file);
        } catch (error) {
          console.warn('[LinkedIn Composer] Failed to serialize one image for cross-post', error);
          continue;
        }
      } else if (typeof image?.url === 'string' && /^https?:\/\//i.test(image.url)) {
        mediaValue = image.url;
      }

      if (!mediaValue) continue;

      if (mediaValue.startsWith('data:')) {
        const nextBytes = estimateDataUrlBytes(mediaValue);
        if (nextBytes <= 0) continue;
        if (totalBytes + nextBytes > MAX_CROSSPOST_MEDIA_TOTAL_BYTES) {
          break;
        }
        totalBytes += nextBytes;
      }

      payload.push(mediaValue);
    }

    return payload;
  };

  const normalizeTargetAccountId = (value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  };

  const normalizeCrossPostInput = (crossPostInput = false) => {
    const raw =
      crossPostInput && typeof crossPostInput === 'object' && !Array.isArray(crossPostInput)
        ? crossPostInput
        : {};

    const rawTargetIds =
      raw.crossPostTargetAccountIds &&
      typeof raw.crossPostTargetAccountIds === 'object' &&
      !Array.isArray(raw.crossPostTargetAccountIds)
        ? raw.crossPostTargetAccountIds
        : {};
    const rawTargetLabels =
      raw.crossPostTargetAccountLabels &&
      typeof raw.crossPostTargetAccountLabels === 'object' &&
      !Array.isArray(raw.crossPostTargetAccountLabels)
        ? raw.crossPostTargetAccountLabels
        : {};

    return {
      x: Boolean(raw.x),
      threads: Boolean(raw.threads),
      optimizeCrossPost: raw.optimizeCrossPost !== false,
      targetAccountIds: {
        x: normalizeTargetAccountId(rawTargetIds.x ?? rawTargetIds.twitter),
        threads: normalizeTargetAccountId(rawTargetIds.threads),
      },
      targetAccountLabels: {
        x: normalizeTargetAccountId(rawTargetLabels.x ?? rawTargetLabels.twitter),
        threads: normalizeTargetAccountId(rawTargetLabels.threads),
      },
    };
  };

  const getCrossPostMediaNotice = (platformLabel, result = {}) => {
    const mediaStatus = String(result?.mediaStatus || '').trim();
    const mediaDetected = Boolean(result?.mediaDetected);

    if (!mediaDetected || !mediaStatus || mediaStatus === 'posted' || mediaStatus === 'none') {
      return null;
    }

    const messages = {
      posted_partial: `${platformLabel} attached only some images. Check the target post for partial media upload.`,
      text_only_requires_oauth1: `${platformLabel} posted without images because the selected X account is missing Tweet Genie media permissions (OAuth1).`,
      text_only_upload_failed: `${platformLabel} posted without images because media upload to the target platform failed.`,
      text_only_unsupported: `${platformLabel} posted without images because the selected media could not be reused for that platform.`,
      text_only_phase1: `${platformLabel} posted without images.`,
    };

    return messages[mediaStatus] || `${platformLabel} posted without all images (${mediaStatus}).`;
  };

  // Image/PDF upload for single post (uploads as base64 to backend, stores LinkedIn URL)
  const handleImageUpload = async (event) => {
    const files = Array.from(event.target.files);
    console.log('[PDF UPLOAD] Files selected:', files.map(f => ({ name: f.name, type: f.type, size: f.size })));
    
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/');
      const isPDF = file.type === 'application/pdf';
      const sizeLimit = isPDF ? 100 * 1024 * 1024 : 5 * 1024 * 1024; // 100MB for PDF, 5MB for images
      const isValid = (isImage || isPDF) && file.size <= sizeLimit;
      console.log('[PDF UPLOAD] File validation:', { 
        name: file.name, 
        type: file.type, 
        isImage, 
        isPDF, 
        size: file.size, 
        sizeLimit, 
        isValid 
      });
      return isValid;
    });
    
    if (validFiles.length < files.length) {
      const rejected = files.length - validFiles.length;
      toast.error(`${rejected} file(s) rejected. Images max 5MB, PDFs max 100MB.`);
    }
    
    if (selectedImages.length + validFiles.length > 9) {
      toast.error('Maximum 9 files allowed per post');
      return;
    }
    
    setIsUploadingImages(true);
    try {
      const uploadedImages = [];
      for (const file of validFiles) {
        const isPDF = file.type === 'application/pdf';
        console.log('[PDF UPLOAD] Processing file:', { name: file.name, isPDF, type: file.type });
        
        // Read file as base64
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        console.log('[PDF UPLOAD] Base64 encoded, length:', base64.length);
        
        // Upload to backend using account-aware API
        let data;
        try {
          const endpoint = isPDF ? '/api/linkedin/upload-document-base64' : '/api/linkedin/upload-image-base64';
          console.log('[PDF UPLOAD] Uploading to endpoint:', endpoint);
          
          const res = await postForCurrentAccount(endpoint, {
            base64,
            mimetype: file.type,
            filename: file.name
          });
          
          console.log('[PDF UPLOAD] Response status:', res.status, res.ok);
          
          if (!res.ok) {
            const errorData = await res.json();
            console.error('[PDF UPLOAD] Upload failed:', errorData);
            throw new Error(errorData.error || 'Upload failed');
          }
          
          data = await res.json();
          console.log('[PDF UPLOAD] Upload successful:', data);
        } catch (uploadErr) {
          console.error('[PDF UPLOAD] File upload error:', uploadErr);
          toast.error(`${isPDF ? 'PDF' : 'Image'} upload failed: ` + uploadErr.message);
          continue;
        }
        
        uploadedImages.push({
          file,
          preview: isPDF ? null : URL.createObjectURL(file),
          url: data.url,
          id: Math.random().toString(36).substr(2, 9),
          type: file.type,
          name: file.name,
          isPDF
        });
      }
      setSelectedImages(prev => [...prev, ...uploadedImages]);
      toast.success(`${uploadedImages.length} file(s) uploaded successfully!`);
    } catch (err) {
      console.error('[PDF UPLOAD] File upload unexpected error:', err);
      toast.error('Failed to upload file(s): ' + (err?.message || 'Unknown error'));
    } finally {
      setIsUploadingImages(false);
    }
  };

  const handleImageRemove = (index) => {
    const imageToRemove = selectedImages[index];
    if (imageToRemove.preview && imageToRemove.preview.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove.preview);
    }
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  // AI Content Generation Handler
  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Please enter a prompt for AI generation');
      return;
    }
    setIsGenerating(true);
    try {
      const res = await api.post('/api/ai/generate', {
        prompt: aiPrompt,
        style: aiStyle
      });
      if (res.data && res.data.content) {
        // If multiple posts are returned, split and use the first one by default
        const posts = res.data.content.split(/\n?---+\n?/).map(p => p.trim()).filter(Boolean);
        // Sanitize to remove markdown (**bold**, *italic*, etc.)
        const clean = sanitizeAIContent(posts[0] || res.data.content, { allowMarkdown: false });
        setContent(clean);
        setShowAIPrompt(false);
        toast.success('AI content generated!');
      } else {
        toast.error('AI did not return any content');
      }
    } catch (err) {
      toast.error('Failed to generate AI content');
    } finally {
      setIsGenerating(false);
    }
  };

  // Show/hide AI prompt modal
  const handleAIButtonClick = () => setShowAIPrompt(v => !v);

  // Post handler (single post only)
  const handlePost = async (crossPostInput = false) => {
    const normalizedCrossPost = normalizeCrossPostInput(crossPostInput);
    const hasAnyCrossPostTarget = normalizedCrossPost.x || normalizedCrossPost.threads;

    if (!content.trim() && selectedImages.length === 0) {
      toast.error('Please enter some content or add images');
      return;
    }
    setIsPosting(true);
    try {
      // Convert HTML to Unicode-formatted plain text for LinkedIn
      const unicodeContent = htmlToUnicode(content);
      // Prepare media as array of URLs or base64 (assume .url exists, fallback to file name)
      const media_urls = selectedImages.map(img => img.url || img.file?.name || '');
      const crossPostMedia = hasAnyCrossPostTarget ? await buildCrossPostMediaPayload() : [];
      const crossPostTargetAccountIds = {
        ...(normalizedCrossPost.x && normalizedCrossPost.targetAccountIds.x
          ? { x: normalizedCrossPost.targetAccountIds.x }
          : {}),
        ...(normalizedCrossPost.threads && normalizedCrossPost.targetAccountIds.threads
          ? { threads: normalizedCrossPost.targetAccountIds.threads }
          : {}),
      };
      const crossPostTargetAccountLabels = {
        ...(normalizedCrossPost.x && normalizedCrossPost.targetAccountLabels.x
          ? { x: normalizedCrossPost.targetAccountLabels.x }
          : {}),
        ...(normalizedCrossPost.threads && normalizedCrossPost.targetAccountLabels.threads
          ? { threads: normalizedCrossPost.targetAccountLabels.threads }
          : {}),
      };
      
      // Use account-aware API to post with selected account
      const response = await postForCurrentAccount('/api/posts', {
        post_content: unicodeContent,
        media_urls,
        ...(normalizedCrossPost.x && { postToTwitter: true }),
        ...(hasAnyCrossPostTarget && {
          crossPostTargets: {
            x: normalizedCrossPost.x,
            threads: normalizedCrossPost.threads,
          },
          ...(Object.keys(crossPostTargetAccountIds).length > 0
            ? { crossPostTargetAccountIds }
            : {}),
          ...(Object.keys(crossPostTargetAccountLabels).length > 0
            ? { crossPostTargetAccountLabels }
            : {}),
          optimizeCrossPost: normalizedCrossPost.optimizeCrossPost,
          ...(crossPostMedia.length > 0 ? { crossPostMedia } : {}),
        }),
      });

      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseData?.error || 'Failed to post to LinkedIn');
      }
      
      const accountInfo = selectedAccount?.linkedin_display_name || selectedAccount?.linkedin_username || 'LinkedIn';

      const crossPost = responseData?.crossPost;
      if (crossPost && typeof crossPost === 'object' && hasAnyCrossPostTarget) {
        const selectedPlatforms = [];
        if (normalizedCrossPost.x) selectedPlatforms.push({ label: 'X', result: crossPost.x || null });
        if (normalizedCrossPost.threads) selectedPlatforms.push({ label: 'Threads', result: crossPost.threads || null });

        const successful = [];
        const issues = [];
        const mediaNotices = [];

        for (const platform of selectedPlatforms) {
          const status = String(platform?.result?.status || '').trim();
          if (status === 'posted') {
            successful.push(platform.label);
            const mediaNotice = getCrossPostMediaNotice(platform.label, platform?.result);
            if (mediaNotice) mediaNotices.push(mediaNotice);
            continue;
          }

          const statusMessages = {
            not_connected: `${platform.label} not connected - original post succeeded.`,
            target_not_found: `${platform.label} target account was unavailable or no longer accessible - original post succeeded.`,
            timeout: `${platform.label} cross-post timed out - original post succeeded.`,
            skipped_individual_only: `${platform.label} cross-post is available only for personal LinkedIn accounts right now.`,
            skipped_not_configured: `${platform.label} cross-post is not configured yet.`,
            skipped: `${platform.label} cross-post was skipped.`,
            missing_target_route: `${platform.label} cross-post target was not selected - original post succeeded.`,
            failed_too_long: `${platform.label} cross-post failed because the LinkedIn post is too long for X.`,
            failed: `${platform.label} cross-post failed - original post succeeded.`,
            disabled: null,
            '': null,
          };
          const issue = statusMessages[status] ?? `${platform.label} cross-post did not complete (${status}). Original post succeeded.`;
          if (issue) issues.push(issue);
        }

        if (successful.length > 0 && issues.length === 0) {
          toast.success(`Posted to ${accountInfo} and cross-posted to ${successful.join(' + ')}!`);
        } else {
          toast.success(`Posted to ${accountInfo}!`);
          issues.forEach((message) => toast(message, { icon: '⚠️' }));
        }

        mediaNotices.forEach((message) => toast(message, { icon: 'ℹ️' }));
      } else {
        toast.success(`Posted to ${accountInfo}!`);
      }

      setContent('');
      setSelectedImages([]);
    } catch (err) {
      toast.error(err?.message || 'Failed to post to LinkedIn');
    } finally {
      setIsPosting(false);
    }
  };

  // Schedule post handler
  const handleSchedule = async (scheduleDate, userTimezone, crossPostInput = false) => {
    const normalizedCrossPost = normalizeCrossPostInput(crossPostInput);
    const hasAnyCrossPostTarget = normalizedCrossPost.x || normalizedCrossPost.threads;

    if (!content.trim() && selectedImages.length === 0) {
      toast.error('Please enter some content or add images');
      return;
    }
    setIsScheduling(true);
    try {
      // Convert HTML to Unicode-formatted plain text for LinkedIn
      const unicodeContent = htmlToUnicode(content);
      // Prepare media as array of URLs
      const media_urls = selectedImages.map(img => img.url || img.file?.name || '');
      const crossPostMedia = hasAnyCrossPostTarget ? await buildCrossPostMediaPayload() : [];
      const crossPostTargetAccountIds = {
        ...(normalizedCrossPost.x && normalizedCrossPost.targetAccountIds.x
          ? { x: normalizedCrossPost.targetAccountIds.x }
          : {}),
        ...(normalizedCrossPost.threads && normalizedCrossPost.targetAccountIds.threads
          ? { threads: normalizedCrossPost.targetAccountIds.threads }
          : {}),
      };
      const crossPostTargetAccountLabels = {
        ...(normalizedCrossPost.x && normalizedCrossPost.targetAccountLabels.x
          ? { x: normalizedCrossPost.targetAccountLabels.x }
          : {}),
        ...(normalizedCrossPost.threads && normalizedCrossPost.targetAccountLabels.threads
          ? { threads: normalizedCrossPost.targetAccountLabels.threads }
          : {}),
      };
      
      // Use account-aware API to schedule with selected account
      const scheduleResponse = await postForCurrentAccount('/api/schedule', {
        post_content: unicodeContent,
        media_urls,
        post_type: 'single_post',
        company_id: null,
        scheduled_time: scheduleDate,
        user_timezone: userTimezone,
        ...(hasAnyCrossPostTarget && {
          crossPostTargets: {
            x: normalizedCrossPost.x,
            threads: normalizedCrossPost.threads,
          },
          ...(Object.keys(crossPostTargetAccountIds).length > 0
            ? { crossPostTargetAccountIds }
            : {}),
          ...(Object.keys(crossPostTargetAccountLabels).length > 0
            ? { crossPostTargetAccountLabels }
            : {}),
          optimizeCrossPost: normalizedCrossPost.optimizeCrossPost,
          ...(crossPostMedia.length > 0 ? { crossPostMedia } : {}),
        }),
      });

      // fetch() doesn't throw on HTTP errors — check response.ok explicitly
      if (!scheduleResponse.ok) {
        let serverError = 'Failed to schedule post';
        try {
          const errData = await scheduleResponse.json();
          serverError = errData?.error || errData?.message || serverError;
        } catch { /* ignore parse error */ }
        throw new Error(serverError);
      }

      const scheduleData = await scheduleResponse.json().catch(() => ({}));
      const needsApproval = scheduleData?.approval_status === 'pending_approval';

      const accountInfo = selectedAccount?.linkedin_display_name || selectedAccount?.linkedin_username || 'LinkedIn';
      if (needsApproval) {
        toast.success('Post submitted for approval. An admin will need to approve it before it publishes.');
      } else if (hasAnyCrossPostTarget) {
        const labels = [];
        if (normalizedCrossPost.x) labels.push('X');
        if (normalizedCrossPost.threads) labels.push('Threads');
        toast.success(`Post scheduled for ${accountInfo}. Cross-post to ${labels.join(' + ')} will run at publish time.`);
      } else {
        toast.success(`Post scheduled for ${accountInfo}!`);
      }
      setScheduledFor(scheduleDate);
      setContent('');
      setSelectedImages([]);
    } catch (err) {
      const errMsg = err?.message || 'Failed to schedule post';
      toast.error(errMsg);
    } finally {
      setIsScheduling(false);
    }
  };
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
  // Helper to get base64 size
  const getBase64Size = (base64String) => {
    if (!base64String) return 0;
    const base64Data = base64String.replace(/^data:image\/[a-z]+;base64,/, '');
    return (base64Data.length * 3) / 4;
  };
  const handleImageGenerate = async () => {
    const sanitizedPrompt = sanitizeImagePrompt(imagePrompt.trim());
    if (!sanitizedPrompt) {
      toast.error('Please enter a valid image description');
      return;
    }
    if (sanitizedPrompt.includes('[FILTERED]')) {
      toast.error('Some content was filtered from your prompt for safety reasons');
    }
    setIsGeneratingImage(true);
    try {
      const response = await api.post('/api/image-generation/generate', { prompt: sanitizedPrompt, style: imageStyle }, {
        timeout: 90000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      if (response.data && response.data.success && response.data.imageUrl) {
        const imageSize = getBase64Size(response.data.imageUrl);
        if (imageSize > MAX_IMAGE_SIZE) {
          toast.error(`Generated image is too large (${(imageSize / (1024 * 1024)).toFixed(1)}MB). Max allowed is 5MB. Please try a different prompt.`);
          return;
        }
        const newImage = {
          file: null,
          preview: response.data.imageUrl,
          url: response.data.imageUrl,
          id: Math.random().toString(36).substr(2, 9),
          isAIGenerated: true,
          prompt: sanitizedPrompt,
          provider: response.data.provider || 'AI'
        };
        setSelectedImages(prev => [...prev, newImage]);
        setShowImagePrompt(false);
        setImagePrompt('');
        toast.success('Image generated successfully!');
      } else {
        toast.error('Failed to generate image - invalid response');
      }
    } catch (error) {
      console.error('Image generation error:', error);
      if (error.code === 'ECONNABORTED') {
        toast.error('Image generation timed out. Please try again.');
      } else if (error.response?.status === 413) {
        toast.error('Generated image is too large. Please try again.');
      } else if (error.response?.status === 500) {
        toast.error('Server error during image generation. Please try again.');
      } else {
        toast.error(`Failed to generate image: ${error.message}`);
      }
    } finally {
      setIsGeneratingImage(false);
    }
  };
  const handleCancelScheduled = () => {};
  const handleImageButtonClick = () => setShowImagePrompt(v => !v);
  const fetchScheduledPosts = () => {};

  return {
    content, setContent, isPosting, isScheduling, scheduledFor, setScheduledFor, showAIPrompt, aiPrompt, setAiPrompt, aiStyle, setAiStyle, isGenerating, showImagePrompt, imagePrompt, setImagePrompt, imageStyle, setImageStyle, isGeneratingImage, selectedImages, isUploadingImages, scheduledPosts, isLoadingScheduled, characterCount,
    handleImageUpload, handleImageRemove, handlePost, handleSchedule, handleAIGenerate, handleImageGenerate, handleCancelScheduled, handleAIButtonClick, handleImageButtonClick, fetchScheduledPosts,
    setShowAIPrompt // expose for modal cancel
  };
};

export default useLinkedInPostComposer;
export { useLinkedInPostComposer };
