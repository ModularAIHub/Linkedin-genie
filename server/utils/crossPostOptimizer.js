const trimText = (value = '', maxLength = 5000) => String(value || '').trim().slice(0, maxLength);

const collapseExcessBlankLines = (text = '') =>
  String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeThreadParts = (thread = []) =>
  (Array.isArray(thread) ? thread : [])
    .map((part) => trimText(part, 1000))
    .filter(Boolean);

/**
 * Smartly truncates text for a single post within a character limit.
 * Used when content is only slightly over the limit and a single post is preferred.
 * Priority: sentence boundary → word boundary → hard cut. Appends '…' suffix.
 */
const smartTruncate = (text = '', limit = 280) => {
  if (!text || text.length <= limit) return text;

  const suffix = '…';
  const target = limit - suffix.length; // 277 for X's 280 limit

  // 1. Try sentence boundary (after '. ', '! ', '? ')
  const sentenceMatch = text.slice(0, target).match(/^[\s\S]*[.!?]\s/);
  if (sentenceMatch && sentenceMatch[0].length > target * 0.6) {
    return sentenceMatch[0].trimEnd() + suffix;
  }

  // 2. Fall back to word boundary
  const wordBoundary = text.slice(0, target).lastIndexOf(' ');
  if (wordBoundary > target * 0.6) {
    return text.slice(0, wordBoundary) + suffix;
  }

  // 3. Hard cut last resort
  return text.slice(0, target) + suffix;
};

/**
 * Splits content into an array of tweet-sized parts for an X thread.
 * Priority: paragraph boundary → sentence boundary → word boundary → hard cut.
 * Each part is guaranteed to be <= limit characters.
 */
const splitIntoThreadParts = (text = '', limit = 280) => {
  if (!text) return [];
  if (text.length <= limit) return [text.trim()];

  const parts = [];
  let remaining = text.trim();
  const minChunkRatio = 0.35; // don't cut too early

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      parts.push(remaining);
      break;
    }

    const chunk = remaining.slice(0, limit);

    // 1. Paragraph boundary (double newline) — best natural split
    const lastDoubleNewline = chunk.lastIndexOf('\n\n');
    if (lastDoubleNewline > limit * minChunkRatio) {
      parts.push(remaining.slice(0, lastDoubleNewline).trim());
      remaining = remaining.slice(lastDoubleNewline).trim();
      continue;
    }

    // 2. Single newline
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline > limit * minChunkRatio) {
      parts.push(remaining.slice(0, lastNewline).trim());
      remaining = remaining.slice(lastNewline).trim();
      continue;
    }

    // 3. Sentence boundary ('. ', '! ', '? ')
    const sentenceMatch = chunk.match(/^[\s\S]*[.!?]\s/);
    if (sentenceMatch && sentenceMatch[0].length > limit * minChunkRatio) {
      const cutAt = sentenceMatch[0].length;
      parts.push(remaining.slice(0, cutAt).trim());
      remaining = remaining.slice(cutAt).trim();
      continue;
    }

    // 4. Word boundary
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace > limit * minChunkRatio) {
      parts.push(remaining.slice(0, lastSpace).trim());
      remaining = remaining.slice(lastSpace).trim();
      continue;
    }

    // 5. Hard cut (last resort)
    parts.push(chunk.trim());
    remaining = remaining.slice(limit).trim();
  }

  return parts.filter(Boolean);
};

export const detectCrossPostMedia = ({ media = [], threadMedia = [], mediaUrls = [] } = {}) => {
  const hasSingleMedia = Array.isArray(media) && media.length > 0;
  const hasThreadMedia =
    Array.isArray(threadMedia) &&
    threadMedia.some((items) => Array.isArray(items) ? items.length > 0 : Boolean(items));
  const hasMediaUrls = Array.isArray(mediaUrls) && mediaUrls.some((item) => String(item || '').trim().length > 0);

  return hasSingleMedia || hasThreadMedia || hasMediaUrls;
};

export const buildCrossPostPayloads = ({
  content = '',
  postContent = '',
  thread = [],
  optimizeCrossPost = true,
} = {}) => {
  content = content || postContent;  // ← add this line
  const normalizedOptimize = optimizeCrossPost !== false;
  const threadParts = normalizeThreadParts(thread);
  const isThread = threadParts.length > 1;
  const singleContent = trimText(content, 5000);

  const clean = (value) => {
    const raw = trimText(value, 5000);
    return normalizedOptimize ? collapseExcessBlankLines(raw) : raw;
  };

  const flattenLinkedInThread = () => {
    const joined = threadParts.join('\n\n');
    return clean(joined);
  };

  const threadsSingleContent = isThread ? clean(threadParts.join('\n\n')) : clean(singleContent);
  const threadsThreadParts = normalizedOptimize
    ? threadParts.map((part) => clean(part))
    : [...threadParts];

  // Build X payload — thread mode if content exceeds 280, single mode otherwise
  const cleanedForX = clean(singleContent);
  const xThreadParts = splitIntoThreadParts(cleanedForX, 280);
  const xPayload =
    xThreadParts.length > 1
      ? {
          postMode: 'thread',
          threadParts: xThreadParts,
          content: xThreadParts[0], // first part for reference/logging
        }
      : {
          postMode: 'single',
          content: cleanedForX,
          threadParts: [],
        };

  return {
    source: {
      isThread,
      content: clean(singleContent),
      threadParts: normalizedOptimize ? threadParts.map((part) => clean(part)) : threadParts,
    },
    linkedin: {
      content: isThread ? flattenLinkedInThread() : clean(singleContent),
      postMode: 'single',
    },
    x: xPayload,
    threads: isThread
      ? {
          postMode: 'thread',
          content: threadsSingleContent,
          threadParts: threadsThreadParts,
        }
      : {
          postMode: 'single',
          content: threadsSingleContent,
          threadParts: [],
        },
  };
};