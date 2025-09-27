// Utility to fetch BYOK/platform mode for the current user from new-platform
import axios from 'axios';

const PLATFORM_API_URL = import.meta.env.VITE_PLATFORM_API_URL || 'http://localhost:3000/api';

export async function fetchApiKeyPreference() {
  try {
    const response = await axios.get(`${PLATFORM_API_URL}/byok/preference`, { withCredentials: true });
    return response.data.api_key_preference || 'platform';
  } catch (error) {
    console.error('Failed to fetch API key preference:', error);
    return 'platform';
  }
}

export async function fetchByokKeys() {
  try {
    const response = await axios.get(`${PLATFORM_API_URL}/byok/keys`, { withCredentials: true });
    return response.data.keys || [];
  } catch (error) {
    console.error('Failed to fetch BYOK keys:', error);
    return [];
  }
}
