// LinkedIn endpoints (parity with Twitter endpoints)
export const linkedin = {
  getStatus: () => api.get('/api/linkedin/status'),
  connect: ({ popup = true } = {}) => api.get('/api/linkedin/connect', { params: { popup: popup ? 'true' : 'false' } }),
  disconnect: () => api.post('/api/linkedin/disconnect'),
  getProfile: () => api.get('/api/linkedin/profile'),
  selectAccountType: (payload) => api.post('/api/oauth/linkedin/select-account-type', payload),
  uploadImageBase64: (base64, mimetype, filename) =>
    api.post('/api/linkedin/upload-image-base64', { base64, mimetype, filename }),
};
// BYOK/platform mode endpoints
export const byok = {
  getPreference: () => api.get('/api/user/api-key-preference'),
  getKeys: () => api.get('/api/user/byok-keys'), // For future use
};


const API_BASE_URL = String(import.meta.env.VITE_API_URL || '').trim();
const PLATFORM_URL = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173';
import axios from 'axios';
const AGENCY_WORKSPACE_STORAGE_KEY = 'suitegenie:agency-workspace-context';
// CSRF token cache
let csrfToken = null;

const readAgencyWorkspaceContext = () => {
  if (typeof window === 'undefined') return null;

  try {
    const params = new URLSearchParams(window.location.search || '');
    const token = String(params.get('agency_token') || '').trim();
    const workspaceId = String(params.get('workspace_id') || '').trim();
    const tool = String(params.get('tool') || '').trim();
    const target = String(params.get('target') || '').trim();

    if (token && workspaceId) {
      const context = { token, workspaceId, tool: tool || null, target: target || null };
      window.sessionStorage?.setItem(AGENCY_WORKSPACE_STORAGE_KEY, JSON.stringify(context));
      return context;
    }
  } catch {
    // Ignore URL parsing failures and fall back to stored context.
  }

  try {
    const stored = window.sessionStorage?.getItem(AGENCY_WORKSPACE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

// Fetch CSRF token from backend
export async function fetchCsrfToken() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/csrf-token`, { withCredentials: true });
    csrfToken = res.data.csrfToken;
    return csrfToken;
  } catch (err) {
    console.error('Failed to fetch CSRF token:', err);
    return null;
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

  // Axios request interceptor to add CSRF token for state-changing requests
  api.interceptors.request.use(async (config) => {
    const method = config.method && config.method.toUpperCase();
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      // Always fetch a fresh CSRF token for every state-changing request
      csrfToken = await fetchCsrfToken();
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      } else {
        console.warn('No CSRF token fetched for', method, config.url);
      }
      config.withCredentials = true; // Ensure cookies are sent
    }
    const agencyWorkspace = readAgencyWorkspaceContext();
    if (agencyWorkspace?.token && agencyWorkspace?.workspaceId) {
      config.headers['x-agency-token'] = agencyWorkspace.token;
      config.headers['x-agency-workspace-id'] = agencyWorkspace.workspaceId;
      if (agencyWorkspace.tool) {
        config.headers['x-agency-tool'] = agencyWorkspace.tool;
      }
      if (agencyWorkspace.target) {
        config.headers['x-agency-target'] = agencyWorkspace.target;
      }
    }
    return config;
  }, (error) => {
    // If CSRF error, reset token cache
    if (error?.response?.status === 403 && error?.response?.data?.code === 'EBADCSRFTOKEN') {
      csrfToken = null;
    }
    return Promise.reject(error);
  });

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => api(originalRequest)).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await axios.post(`${PLATFORM_URL}/api/auth/refresh`, {}, { withCredentials: true });
        isRefreshing = false;
        processQueue(null);
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        processQueue(refreshError, null);
        const currentPath = window.location.pathname;
        if (!currentPath.includes('/auth/callback') && !currentPath.includes('/login')) {
          const currentUrl = encodeURIComponent(window.location.href);
          // Use PLATFORM_URL from .env for login redirect
          window.location.href = `${PLATFORM_URL}/login?redirect=${currentUrl}`;
        }
        return Promise.reject(refreshError);
      }
    }
    // Debug log for CSRF errors
    if (error?.response?.status === 403 && error?.response?.data?.code === 'EBADCSRFTOKEN') {
      console.warn('CSRF token error:', error?.response?.data);
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const auth = {
  validate: () => api.get('/auth/validate'),
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
};

// Post endpoints
export const posts = {
  create: (postData) => api.post('/api/posts', postData),
  list: (params) => api.get('/api/posts', { params }),
  delete: (postId) => api.delete(`/api/posts/${postId}`),
  generateAI: (prompt) => api.post('/api/posts/ai-generate', prompt),
  bulkSaveDrafts: (items) => api.post('/api/posts/bulk-save', { items }),
};

// Scheduling endpoints
export const scheduling = {
  create: (scheduleData) => api.post('/api/schedule', scheduleData),
  bulk: (bulkData) => api.post('/api/schedule/bulk', bulkData),
  list: (params) => api.get('/api/schedule', { params }),
  update: (scheduleId, data) => api.put(`/api/schedule/${scheduleId}`, data),
  cancel: (scheduleId) => api.delete(`/api/schedule/${scheduleId}`),
};

// Analytics endpoints
export const analytics = {
  getOverview: (params) => api.get('/api/analytics/overview', { params }),
  getDetailed: (data) => api.post('/api/analytics/detailed', data),
  sync: (data = {}) => api.post('/api/analytics/sync', data, { timeout: 120000 }),
  getHashtags: (params) => api.get('/api/analytics/hashtags', { params }),
  getEngagement: (params) => api.get('/api/analytics/engagement', { params }),
  getAudience: (params) => api.get('/api/analytics/audience', { params }),
};

// Credits endpoints
export const credits = {
  getBalance: () => api.get('/api/credits/balance'),
  getHistory: (params) => api.get('/api/credits/history', { params }),
  getPricing: () => api.get('/api/credits/pricing'),
};

// AI endpoints
export const ai = {
  generate: ({ prompt, style = 'professional', isThread = false }) => api.post('/api/ai/generate', { prompt, style, isThread }),
  generateOptions: (prompt, style = 'professional', count = 3) => 
    api.post('/api/ai/generate-options', { prompt, style, count }),
  bulkGenerate: (prompts, options) => api.post('/api/ai/bulk-generate', { prompts, options }),
};

// Strategy Builder endpoints
export const strategy = {
  getCurrent: () => api.get('/api/strategy/current'),
  getById: (id) => api.get(`/api/strategy/${id}`),
  getContextVault: (id, params = {}) => api.get(`/api/strategy/${id}/context-vault`, { params }),
  refreshContextVault: (id, payload = {}) => api.post(`/api/strategy/${id}/context-vault/refresh`, payload),
  applyContextVault: (id, payload = {}) => api.post(`/api/strategy/${id}/context-vault/apply`, payload),
  getContentPlan: (id) => api.get(`/api/strategy/${id}/content-plan`),
  generateContentPlan: (id, payload = {}) => api.post(`/api/strategy/${id}/content-plan/generate`, payload),
  list: () => api.get('/api/strategy/list'),
  create: (data) => api.post('/api/strategy', data),
  chat: (message, strategyId, currentStep) =>
    api.post('/api/strategy/chat', { message, strategyId, currentStep }),
  addOn: (strategyId, data) => api.post(`/api/strategy/${strategyId}/add-on`, data),
  generatePrompts: (strategyId) => api.post(`/api/strategy/${strategyId}/generate-prompts`),
  getPrompts: (strategyId, params) => api.get(`/api/strategy/${strategyId}/prompts`, { params }),
  toggleFavorite: (promptId) => api.post(`/api/strategy/prompts/${promptId}/favorite`),
  markPromptUsed: (promptId, strategyId) =>
    api.post(`/api/strategy/prompts/${promptId}/mark-used`, { strategyId }),
  update: (strategyId, data) => api.patch(`/api/strategy/${strategyId}`, data),
  delete: (strategyId) => api.delete(`/api/strategy/${strategyId}`),
};

// Strategy analysis flow (Tweet Genie parity)
export const profileAnalysis = {
  analyse: (strategyId, options = {}) =>
    api.post('/api/strategy/init-analysis', { strategyId, ...options }, { timeout: 120000 }),
  uploadLinkedinProfilePdf: (strategyId, payload) =>
    api.post(
      '/api/strategy/upload-linkedin-profile-pdf',
      { strategyId, ...payload },
      { timeout: 120000 }
    ),
  getStatus: (analysisId) => api.get(`/api/strategy/analysis-status/${analysisId}`),
  getLatest: (strategyId) => api.get('/api/strategy/latest-analysis', { params: { strategyId } }),
  confirmStep: (analysisId, step, value) => api.post('/api/strategy/apply-analysis', { analysisId, step, value }),
  analyseReferenceAccounts: (analysisId, payload = {}) => {
    if (Array.isArray(payload)) {
      return api.post('/api/strategy/reference-analysis', { analysisId, handles: payload });
    }
    if (payload && typeof payload === 'object') {
      return api.post('/api/strategy/reference-analysis', {
        analysisId,
        ...payload,
      });
    }
    return api.post('/api/strategy/reference-analysis', { analysisId, handles: [] });
  },
  startPersonaEnrichment: (payload = {}) =>
    api.post('/api/strategy/persona-enrichment/start', payload, { timeout: 120000 }),
  getPersonaEnrichmentStatus: (jobId) =>
    api.get(`/api/strategy/persona-enrichment/${jobId}/status`),
  getPersonaSignals: () =>
    api.get('/api/strategy/persona-signals'),
  attachPersonaEnrichment: (jobId, payload = {}) =>
    api.post(`/api/strategy/persona-enrichment/${jobId}/attach`, payload),
  generatePrompts: (analysisId, strategyId) =>
    api.post('/api/strategy/generate-analysis-prompts', { analysisId, strategyId }, { timeout: 120000 }),
};

// LinkedIn automation endpoints
export const automationLinkedin = {
  getProfileContext: () => api.get('/api/automation/linkedin/profile-context'),
  saveProfileContext: (payload) => api.post('/api/automation/linkedin/profile-context', payload),
  saveCompetitors: (payload) => api.put('/api/automation/linkedin/competitors', payload),
  fetchLatest: (payload = {}) => api.post('/api/automation/linkedin/fetch-latest', payload),
  run: (payload) => api.post('/api/automation/linkedin/run', payload),
  getQueue: (params) => api.get('/api/automation/linkedin/queue', { params }),
  patchQueueItem: (id, payload) => api.patch(`/api/automation/linkedin/queue/${id}`, payload),
  runAdaptiveVaultLoop: (payload = {}) =>
    api.post('/api/automation/linkedin/adaptive-vault-loop/run', payload, { timeout: 120000 }),
  getLatestAdaptiveVaultLoop: () =>
    api.get('/api/automation/linkedin/adaptive-vault-loop/latest'),
  getCommentReplyInbox: (params = {}) =>
    api.get('/api/automation/linkedin/comment-reply/inbox', { params }),
  generateCommentReply: (payload = {}) =>
    api.post('/api/automation/linkedin/comment-reply/generate', payload, { timeout: 120000 }),
  sendCommentReply: (payload = {}) =>
    api.post('/api/automation/linkedin/comment-reply/send', payload, { timeout: 120000 }),
  getCommentReplyHistory: (params = {}) =>
    api.get('/api/automation/linkedin/comment-reply/history', { params }),
};

export default api;
// ...existing code for new Tweet Genie parity version only...
