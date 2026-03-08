export const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  needs_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  scheduled: 'bg-blue-100 text-blue-800',
  posted: 'bg-green-100 text-green-800',
  rejected: 'bg-rose-100 text-rose-800',
};

export const CONFIDENCE_STYLES = {
  high: { dot: 'bg-green-500', text: 'text-green-700', label: 'High confidence' },
  medium: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Medium confidence' },
  low: { dot: 'bg-red-500', text: 'text-red-700', label: 'Low confidence' },
};

export const getBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const buildDefaultScheduleTime = () => {
  const local = new Date();
  local.setDate(local.getDate() + 1);
  local.setHours(9, 0, 0, 0);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  const hours = String(local.getHours()).padStart(2, '0');
  const minutes = String(local.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
};

export const normalizeQueue = (items = []) =>
  (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    status: String(item?.status || 'draft').toLowerCase(),
    hashtags: Array.isArray(item?.hashtags) ? item.hashtags : [],
    reason: String(item?.reason || '').trim(),
    suggestedDayOffset: Number(item?.suggestedDayOffset || 0),
    suggestedLocalTime: String(item?.suggestedLocalTime || '').trim(),
  }));
