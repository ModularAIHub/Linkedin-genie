const trimText = (value = '', maxLength = 5000) => String(value || '').trim().slice(0, maxLength);

const collapseExcessBlankLines = (text = '') =>
  String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const detectCrossPostMedia = ({ mediaUrls = [] } = {}) =>
  Array.isArray(mediaUrls) && mediaUrls.some((item) => String(item || '').trim().length > 0);

export const buildCrossPostPayloads = ({
  postContent = '',
  optimizeCrossPost = true,
} = {}) => {
  const optimize = optimizeCrossPost !== false;
  const clean = (value, maxLength = 5000) => {
    const raw = trimText(value, maxLength);
    return optimize ? collapseExcessBlankLines(raw) : raw;
  };

  const normalizedContent = clean(postContent, 5000);

  return {
    x: {
      postMode: 'single',
      content: clean(normalizedContent, 1000),
    },
    threads: {
      postMode: 'single',
      content: clean(normalizedContent, 5000),
      threadParts: [],
    },
  };
};

