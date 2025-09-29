// LinkedIn endpoints (parity with Twitter endpoints)
export const linkedin = {
  getStatus: () => api.get('/api/linkedin/status'),
  connect: () => api.get('/api/linkedin/connect'),
  disconnect: () => api.post('/api/linkedin/disconnect'),
  getProfile: () => api.get('/api/linkedin/profile'),
  uploadImageBase64: (base64, mimetype, filename) =>
    api.post('/api/linkedin/upload-image-base64', { base64, mimetype, filename }),
};
// BYOK/platform mode endpoints
export const byok = {
  getPreference: () => api.get('/api/user/api-key-preference'),
};


const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3004';
const PLATFORM_URL = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173';
import axios from 'axios';
// CSRF token cache
let csrfToken = null;

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
        await axios.post(`${API_BASE_URL}/api/auth/refresh`, {}, { withCredentials: true });
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
  create: (scheduleData) => api.post('/api/scheduling', scheduleData),
  list: (params) => api.get('/api/scheduling', { params }),
  update: (scheduleId, data) => api.put(`/api/scheduling/${scheduleId}`, data),
  cancel: (scheduleId) => api.delete(`/api/scheduling/${scheduleId}`),
};

// Analytics endpoints
export const analytics = {
  getOverview: (params) => api.get('/api/analytics/overview', { params }),
  getDetailed: (data) => api.post('/api/analytics/detailed', data),
  sync: () => api.post('/api/analytics/sync'),
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

export default api;
// ...existing code for new Tweet Genie parity version only...