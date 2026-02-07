
import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../utils/api';
import toast from 'react-hot-toast';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  // Try to load cached user/auth state from localStorage for instant UI
  const cachedUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('sg_user'));
    } catch {
      return null;
    }
  })();
  const cachedAuth = (() => {
    try {
      return JSON.parse(localStorage.getItem('sg_isAuthenticated'));
    } catch {
      return false;
    }
  })();
  const [user, setUser] = useState(cachedUser);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(cachedAuth);

  // Track failed auth attempts to prevent infinite loop
  const [authFailCount, setAuthFailCount] = useState(0);

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Reset fail count on successful login
  useEffect(() => {
    if (isAuthenticated) setAuthFailCount(0);
  }, [isAuthenticated]);

  // Set up periodic auth checks to handle token refresh
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      refreshTokenIfNeeded();
    }, 12 * 60 * 1000); // 12 minutes
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Proactive token refresh function
  const refreshTokenIfNeeded = async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        await checkAuthStatus();
      }
    } catch (error) {
      // Let axios interceptor handle errors
    }
  };

  const checkAuthStatus = async () => {
    try {
      const response = await auth.validate();
      if (response.data.success) {
        setUser(response.data.user);
        setIsAuthenticated(true);
        setAuthFailCount(0);
        // Cache user/auth state
        localStorage.setItem('sg_user', JSON.stringify(response.data.user));
        localStorage.setItem('sg_isAuthenticated', 'true');
      } else {
        setIsAuthenticated(false);
        setUser(null);
        setAuthFailCount((c) => c + 1);
        localStorage.removeItem('sg_user');
        localStorage.setItem('sg_isAuthenticated', 'false');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        setIsAuthenticated(false);
        setUser(null);
        setAuthFailCount((c) => c + 1);
        localStorage.removeItem('sg_user');
        localStorage.setItem('sg_isAuthenticated', 'false');
        // Do not redirect here, let ProtectedRoute handle it
      } else if (error.response?.status === 429) {
        setIsAuthenticated(false);
        setUser(null);
        localStorage.removeItem('sg_user');
        localStorage.setItem('sg_isAuthenticated', 'false');
        toast.error('You are being rate limited. Please wait and try again.');
        // Do NOT redirect to login!
        return;
      } else {
        setIsAuthenticated(false);
        setUser(null);
        setAuthFailCount((c) => c + 1);
        localStorage.removeItem('sg_user');
        localStorage.setItem('sg_isAuthenticated', 'false');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const redirectToLogin = () => {
    const currentUrl = encodeURIComponent(window.location.href);
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173';
    window.location.href = `${platformUrl}/login?redirect=${currentUrl}`;
  };

  const logout = async () => {
    try {
      // Call LinkedIn Genie backend logout to clear local cookies
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });

      // Also call Platform logout to clear platform cookies
      const platformUrl = import.meta.env.VITE_PLATFORM_API_URL || 'http://localhost:3000';
      await fetch(`${platformUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(error => {
        // Don't throw error if platform logout fails
      });
    } catch (error) {
      // Optionally handle error
    }
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('sg_user');
    localStorage.setItem('sg_isAuthenticated', 'false');
    toast.success('Logged out successfully');
    // Redirect to main platform root (not login)
    const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5173';
    window.location.href = platformUrl;
  };

  const value = {
    user,
    isLoading,
    isAuthenticated,
    logout,
    checkAuthStatus,
    redirectToLogin,
    authFailCount,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
// ...existing code for new Tweet Genie parity version only...
