import { useState, useEffect } from 'react';
import api, { linkedin } from '../utils/api';
import { sanitizeAIContent } from '../utils/sanitization';
import { htmlToUnicode } from '../components/LinkedInPostComposer/LinkedInPostContentEditor';
import toast from 'react-hot-toast';

const useLinkedInPostComposer = () => {
  // State
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [linkedInAccounts, setLinkedInAccounts] = useState([]);
  const [isLoadingLinkedInAccounts, setIsLoadingLinkedInAccounts] = useState(true);
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

  useEffect(() => {
    setIsLoadingLinkedInAccounts(true);
    api.get('/api/linkedin/status')
      .then(res => setLinkedInAccounts(res.data.accounts || []))
      .catch(() => setLinkedInAccounts([]))
      .finally(() => setIsLoadingLinkedInAccounts(false));
  }, []);

  // Image upload for single post (uploads as base64 to backend, stores LinkedIn URL)
  const handleImageUpload = async (event) => {
    const files = Array.from(event.target.files);
    const validFiles = files.filter(file => file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024);
    if (selectedImages.length + validFiles.length > 4) {
      toast.error('Maximum 4 images allowed per post');
      return;
    }
    setIsUploadingImages(true);
    try {
      const uploadedImages = [];
      for (const file of validFiles) {
        // Read file as base64
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        // Upload to backend
        let data;
        try {
          const res = await linkedin.uploadImageBase64(base64, file.type, file.name);
          data = res.data;
        } catch (uploadErr) {
          console.error('Image upload error:', uploadErr, uploadErr?.response?.data);
          toast.error('Image upload failed: ' + (uploadErr?.response?.data?.error || uploadErr.message));
          continue;
        }
        uploadedImages.push({
          file,
          preview: URL.createObjectURL(file),
          url: data.url,
          id: Math.random().toString(36).substr(2, 9),
        });
      }
      setSelectedImages(prev => [...prev, ...uploadedImages]);
    } catch (err) {
      console.error('Image upload unexpected error:', err);
      toast.error('Failed to upload image(s): ' + (err?.message || 'Unknown error'));
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
      await api.post('/api/posts', {
        post_content: unicodeContent,
        media_urls
      });
      toast.success('Posted to LinkedIn!');
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
      // Send local datetime and timezone to backend
      await api.post('/api/schedule', {
        post_content: unicodeContent,
        media_urls,
        post_type: 'single_post',
        company_id: null,
        scheduled_time: scheduleDate,
        user_timezone: userTimezone
      });
      toast.success('Post scheduled!');
      setScheduledFor(scheduleDate);
      setContent('');
      setSelectedImages([]);
    } catch (err) {
      toast.error('Failed to schedule post');
    } finally {
      setIsScheduling(false);
    }
  };
  const handleImageGenerate = () => {};
  const handleCancelScheduled = () => {};
  const handleImageButtonClick = () => {};
  const fetchScheduledPosts = () => {};

  return {
    content, setContent, isPosting, isScheduling, scheduledFor, setScheduledFor, linkedInAccounts, isLoadingLinkedInAccounts, showAIPrompt, aiPrompt, setAiPrompt, aiStyle, setAiStyle, isGenerating, showImagePrompt, imagePrompt, setImagePrompt, imageStyle, setImageStyle, isGeneratingImage, selectedImages, isUploadingImages, scheduledPosts, isLoadingScheduled, characterCount,
    handleImageUpload, handleImageRemove, handlePost, handleSchedule, handleAIGenerate, handleImageGenerate, handleCancelScheduled, handleAIButtonClick, handleImageButtonClick, fetchScheduledPosts,
    setShowAIPrompt // expose for modal cancel
  };
};

export default useLinkedInPostComposer;
export { useLinkedInPostComposer };