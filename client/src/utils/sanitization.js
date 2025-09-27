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
