import React, { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';

export const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading, redirectToLogin, authFailCount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect authenticated users from root to dashboard
  useEffect(() => {
    if (isAuthenticated && !isLoading && location.pathname === '/') {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isLoading, location.pathname, navigate]);

  // Prevent redirect loop: do not redirect if already on /login or /auth/callback
  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      if (location.pathname !== '/login' && location.pathname !== '/auth/callback') {
        if (authFailCount < 3) {
          redirectToLogin();
        }
      }
    }
  }, [isAuthenticated, isLoading, location.pathname, redirectToLogin, authFailCount]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && location.pathname !== '/login' && location.pathname !== '/auth/callback') {
    if (authFailCount >= 3) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-red-600">Authentication failed repeatedly.<br />Please clear cookies or contact support.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return children;
};
