const escapeHtmlForEditor = (value = '') =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const plainTextToEditorHtml = (value = '') =>
  escapeHtmlForEditor(String(value || '').replace(/\r\n/g, '\n')).replace(/\n/g, '<br>');

export const hasLikelyHtmlTags = (value = '') =>
  /<\/?[a-z][\s\S]*>/i.test(String(value || ''));

export const ensureEditorHtml = (value = '') => {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  return hasLikelyHtmlTags(raw) ? raw : plainTextToEditorHtml(raw);
};

export default {
  plainTextToEditorHtml,
  hasLikelyHtmlTags,
  ensureEditorHtml,
};
