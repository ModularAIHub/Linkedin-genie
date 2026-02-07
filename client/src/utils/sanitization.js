// Sanitization for LinkedIn Genie AI image prompts (parity with Tweet Genie)
export const sanitizeImagePrompt = (prompt) => {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }

  let sanitized = prompt;

  // Remove potentially harmful content for image generation
  const harmfulImageTerms = [
    'nude', 'naked', 'nsfw', 'explicit', 'sexual', 'porn', 'xxx',
    'violence', 'blood', 'gore', 'weapon', 'gun', 'knife', 'bomb',
    'hate', 'racist', 'nazi', 'terrorism', 'illegal', 'drug',
    'copyright', 'trademark', 'disney', 'marvel', 'pokemon'
  ];

  harmfulImageTerms.forEach(term => {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    if (regex.test(sanitized)) {
      console.warn(`Potentially inappropriate image prompt term detected: ${term}`);
      sanitized = sanitized.replace(regex, '[FILTERED]');
    }
  });

  // Basic sanitization for image prompts
  sanitized = sanitized.trim().slice(0, 1000);

  return sanitized;
};
// Sanitization for LinkedIn Genie AI content (parity with Tweet Genie)
export const sanitizeAIContent = (content, options = {}) => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const {
    maxLength = 5000,
    preserveFormatting = true,
    allowMarkdown = false
  } = options;

  let sanitized = content;

  // Remove AI artifacts
  sanitized = sanitized
    .replace(/^(AI:|Assistant:|Bot:)/gi, '')
    .replace(/\[AI_GENERATED\]/gi, '')
    .replace(/\*\*Note:\*\*.*/gi, '')
    .replace(/\*Disclaimer:.*/gi, '');

  // Remove markdown if not allowed
  if (!allowMarkdown) {
    sanitized = sanitized
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markdown
      .replace(/\*(.*?)\*/g, '$1') // Remove italic markdown
      .replace(/`(.*?)`/g, '$1') // Remove code markdown
      .replace(/#{1,6}\s/g, ''); // Remove heading markdown
  }

  // Truncate to maxLength
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
};
