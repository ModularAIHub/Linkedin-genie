// Unified filter persistence utility
// Stores and retrieves filter state per account/page in sessionStorage

export function saveFilters(key, accountId, filters) {
  if (!accountId) return;
  try {
    sessionStorage.setItem(`${key}:${accountId}`, JSON.stringify(filters));
  } catch (e) {}
}

export function loadFilters(key, accountId, defaults) {
  if (!accountId) return defaults;
  try {
    const raw = sessionStorage.getItem(`${key}:${accountId}`);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch (e) {}
  return defaults;
}

// Unified error handler
export function showError(message, toast) {
  if (toast) {
    toast.error(message);
  } else {
    alert(message);
  }
}
