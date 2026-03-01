import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const OAUTH_RESULT_KEY = 'linkedin_oauth_result';

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status') === 'error' ? 'error' : 'success';
    const reason = params.get('reason') || null;
    const message = params.get('message') || null;
    const selectAccount = params.get('select_account') === 'true';
    const selectionId = params.get('selectionId') || null;
    const organizations = params.get('organizations') || null;

    const eventPayload = status === 'success'
      ? {
          type: 'linkedin_auth_success',
          selectAccount,
          selectionId,
          organizations: organizations ? JSON.parse(organizations) : undefined,
        }
      : { type: 'linkedin_auth_error', reason, message };

    try {
      localStorage.setItem(
        OAUTH_RESULT_KEY,
        JSON.stringify({
          status,
          reason,
          message,
          selectAccount,
          selectionId,
          organizations: organizations ? JSON.parse(organizations) : undefined,
          timestamp: Date.now()
        })
      );
    } catch {
      // Ignore localStorage failures.
    }

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(eventPayload, window.location.origin);
        window.close();
      }
    } catch {
      // Ignore opener access errors.
    }

    if (status === 'success') {
      navigate(`/settings${location.search ? `?${params.toString()}` : '?linkedin_connected=true'}`, { replace: true });
      return;
    }

    const query = new URLSearchParams({ error: reason || 'oauth_failed' });
    if (message) {
      query.set('message', message);
    }
    navigate(`/settings?${query.toString()}`, { replace: true });
  }, [location.search, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-600">Finalizing LinkedIn connection...</p>
    </div>
  );
}
