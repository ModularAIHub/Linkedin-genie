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

  // Image/PDF upload for single post (uploads as base64 to backend, stores LinkedIn URL)
  const handleImageUpload = async (event) => {
    const files = Array.from(event.target.files);
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/');
      const isPDF = file.type === 'application/pdf';
      const sizeLimit = isPDF ? 100 * 1024 * 1024 : 5 * 1024 * 1024; // 100MB for PDF, 5MB for images
      return (isImage || isPDF) && file.size <= sizeLimit;
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
        
        // Read file as base64
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        // Upload to backend using account-aware API
        let data;
        try {
          const endpoint = isPDF ? '/api/linkedin/upload-document-base64' : '/api/linkedin/upload-image-base64';
          const res = await postForCurrentAccount(endpoint, {
            base64,
            mimetype: file.type,
            filename: file.name
          });
          
          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Upload failed');
          }
          
          data = await res.json();
        } catch (uploadErr) {
          console.error('File upload error:', uploadErr);
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
      console.error('File upload unexpected error:', err);
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
  const handlePost = async () => {
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
      
      // Use account-aware API to post with selected account
      await postForCurrentAccount('/api/posts', {
        post_content: unicodeContent,
        media_urls
      });
      
      const accountInfo = selectedAccount?.linkedin_display_name || selectedAccount?.linkedin_username || 'LinkedIn';
      toast.success(`Posted to ${accountInfo}!`);
      setContent('');
      setSelectedImages([]);
    } catch (err) {
      toast.error('Failed to post to LinkedIn');
    } finally {
      setIsPosting(false);
    }
  };

  // Schedule post handler
  const handleSchedule = async (scheduleDate, userTimezone) => {
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
      
      // Use account-aware API to schedule with selected account
      await postForCurrentAccount('/api/schedule', {
        post_content: unicodeContent,
        media_urls,
        post_type: 'single_post',
        company_id: null,
        scheduled_time: scheduleDate,
        user_timezone: userTimezone
      });
      
      const accountInfo = selectedAccount?.linkedin_display_name || selectedAccount?.linkedin_username || 'LinkedIn';
      toast.success(`Post scheduled for ${accountInfo}!`);
      setScheduledFor(scheduleDate);
      setContent('');
      setSelectedImages([]);
    } catch (err) {
      toast.error('Failed to schedule post');
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