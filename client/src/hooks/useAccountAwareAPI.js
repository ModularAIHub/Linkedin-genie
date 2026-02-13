import { useAccount } from '../contexts/AccountContext';

// Use the same API base URL as the rest of the app
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3004';

/**
 * Hook to make API calls account-aware
 * This ensures all data fetching uses the currently selected LinkedIn account
 */
export const useAccountAwareAPI = () => {
  const { selectedAccount, getCurrentAccountId } = useAccount();

  /**
   * Fetch data for the currently selected account
   * @param {string} endpoint - API endpoint to fetch from
   * @param {Object} options - Fetch options
   * @returns {Promise} - Fetch promise
   */
  const fetchForCurrentAccount = async (endpoint, options = {}) => {
    const accountId = getCurrentAccountId();
    
    // Build full URL using API base URL
    const url = new URL(endpoint, API_BASE_URL);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add account ID header if we have one (team accounts or multiple accounts)
    if (accountId) {
      headers['X-Selected-Account-Id'] = accountId;
    }

    return fetch(url.toString(), {
      credentials: 'include',
      ...options,
      headers,
    });
  };

  /**
   * Post data for the currently selected account
   * @param {string} endpoint - API endpoint to post to
   * @param {Object} data - Data to post
   * @param {Object} options - Fetch options
   * @returns {Promise} - Fetch promise
   */
  const postForCurrentAccount = async (endpoint, data = {}, options = {}) => {
    const accountId = getCurrentAccountId();
    
    // Include account ID in the data payload only if we have one
    const payload = accountId ? { ...data, account_id: accountId } : data;

    // Build full URL using API base URL
    const url = new URL(endpoint, API_BASE_URL);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add account ID header if we have one
    if (accountId) {
      headers['X-Selected-Account-Id'] = accountId;
    }

    return fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
      ...options
    });
  };

  /**
   * Get analytics for the currently selected account
   */
  const getAnalytics = async (timeRange = '7d') => {
    return fetchForCurrentAccount(`/api/analytics/overview?timeRange=${timeRange}`);
  };

  /**
   * Get scheduled posts for the currently selected account
   */
  const getScheduledPosts = async () => {
    return fetchForCurrentAccount('/api/schedule');
  };

  /**
   * Get post history for the currently selected account
   */
  const getPostHistory = async (page = 1, limit = 20) => {
    return fetchForCurrentAccount(`/api/posts?page=${page}&limit=${limit}`);
  };

  /**
   * Post to LinkedIn using the currently selected account
   */
  const postToLinkedIn = async (postData) => {
    return postForCurrentAccount('/api/posts', postData);
  };

  /**
   * Schedule a post using the currently selected account
   */
  const schedulePost = async (postData) => {
    return postForCurrentAccount('/api/schedule', postData);
  };

  return {
    selectedAccount,
    accountId: getCurrentAccountId(),
    
    // Raw methods
    fetchForCurrentAccount,
    postForCurrentAccount,
    
    // Specific API methods
    getAnalytics,
    getScheduledPosts,
    getPostHistory,
    postToLinkedIn,
    schedulePost,
    
    // Helper methods
    hasSelectedAccount: () => !!getCurrentAccountId(),
    getCurrentAccountInfo: () => selectedAccount,
  };
};

export default useAccountAwareAPI;
