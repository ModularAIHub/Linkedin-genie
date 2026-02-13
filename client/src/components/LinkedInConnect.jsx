
import React, { useState, useEffect, useRef } from 'react';
import { Linkedin, ExternalLink, CheckCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedin } from '../utils/api';
import { useAccount } from '../contexts/AccountContext';

const OAUTH_RESULT_KEY = 'linkedin_oauth_result';

const LinkedInConnect = () => {
  const { accounts, loading: accountsLoading, refreshAccounts } = useAccount();
  const [connecting, setConnecting] = useState(false);
  const oauthMessageReceivedRef = useRef(false);
  const popupPollRef = useRef(null);

  const refreshAccountsWithRetry = async () => {
    try {
      await refreshAccounts();
      setTimeout(() => {
        refreshAccounts().catch(() => {});
      }, 1200);
    } catch {
      // Ignore and let normal UI fetch cycle continue
    }
  };

  const handleOAuthResult = async (result) => {
    const status = result?.status || (result?.type === 'linkedin_auth_error' ? 'error' : 'success');
    if (status === 'success' || result?.type === 'linkedin_auth_success') {
      oauthMessageReceivedRef.current = true;
      toast.success('LinkedIn account connected!');
      setConnecting(false);
      await refreshAccountsWithRetry();
      return;
    }

    oauthMessageReceivedRef.current = true;
    setConnecting(false);
    toast.error('LinkedIn authentication failed.');
  };

  useEffect(() => {
    const allowedOrigins = new Set([window.location.origin]);
    try {
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3004';
      const apiOrigin = new URL(apiBaseUrl).origin;
      allowedOrigins.add(apiOrigin);
    } catch {
      // Ignore malformed URL env values
    }

    // Listen for postMessage from OAuth popup
    const handlePopupMessage = async (event) => {
      if (!allowedOrigins.has(event.origin)) return;
      if (event.data.type === 'linkedin_auth_success') {
        await handleOAuthResult(event.data);
      } else if (event.data.type === 'linkedin_auth_error') {
        await handleOAuthResult(event.data);
      }
    };

    const handleStorage = async (event) => {
      if (event.key !== OAUTH_RESULT_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        if (!parsed || Date.now() - (parsed.timestamp || 0) > 15 * 60 * 1000) return;
        await handleOAuthResult(parsed);
        localStorage.removeItem(OAUTH_RESULT_KEY);
      } catch {
        // Ignore malformed data.
      }
    };

    const consumePendingOAuthResult = async () => {
      try {
        const cached = localStorage.getItem(OAUTH_RESULT_KEY);
        if (!cached) return;
        const parsed = JSON.parse(cached);
        if (!parsed || Date.now() - (parsed.timestamp || 0) > 15 * 60 * 1000) {
          localStorage.removeItem(OAUTH_RESULT_KEY);
          return;
        }
        await handleOAuthResult(parsed);
        localStorage.removeItem(OAUTH_RESULT_KEY);
      } catch {
        // Ignore malformed data.
      }
    };

    consumePendingOAuthResult();
    window.addEventListener('message', handlePopupMessage);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('message', handlePopupMessage);
      window.removeEventListener('storage', handleStorage);
      if (popupPollRef.current) {
        clearInterval(popupPollRef.current);
        popupPollRef.current = null;
      }
    };
  }, [refreshAccounts]);

  const handleConnect = async () => {
    oauthMessageReceivedRef.current = false;
    setConnecting(true);
    try {
      const isMobileLike = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
      const response = await linkedin.connect({ popup: !isMobileLike });
      const oauthUrl = response.data.url;

      if (isMobileLike) {
        window.location.assign(oauthUrl);
        return;
      }

      const popup = window.open(
        oauthUrl,
        'linkedin-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes,location=yes,menubar=no,toolbar=no,status=yes'
      );
      if (!popup) {
        toast('Popup blocked. Opening LinkedIn in this tab...');
        window.location.assign(oauthUrl);
        return;
      }

      if (popupPollRef.current) {
        clearInterval(popupPollRef.current);
      }

      // Monitor popup for completion
      popupPollRef.current = setInterval(() => {
        if (popup.closed) {
          clearInterval(popupPollRef.current);
          popupPollRef.current = null;
          setConnecting(false);
          // Always refresh after popup closes so newly linked account appears
          refreshAccountsWithRetry();
          if (!oauthMessageReceivedRef.current) {
            toast.success('LinkedIn connection completed. Refreshing accounts...');
          }
        }
      }, 1000);
    } catch (error) {
      toast.error('Failed to initiate LinkedIn connection.');
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Personal Accounts */}
      {accounts.filter(acc => !acc.isTeamAccount).map((account) => (
        <div key={account.id} className="card p-4 flex items-center gap-4">
          <Linkedin className="h-8 w-8 text-blue-700" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Personal LinkedIn Account</h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="h-5 w-5" /> Connected
              </div>
              <div className="flex items-center gap-4 mt-2">
                {account.linkedin_profile_image_url && (
                  <img src={account.linkedin_profile_image_url} alt="Profile" className="h-12 w-12 rounded-full border" />
                )}
                <div>
                  <div className="font-medium text-gray-900 text-base">
                    {account.linkedin_display_name || account.linkedin_username || 'N/A'}
                  </div>
                  {account.headline && (
                    <div className="text-xs text-gray-500 mt-1">{account.headline}</div>
                  )}
                  {account.id && (
                    <div className="text-xs text-gray-400 mt-1">ID: {account.id}</div>
                  )}
                </div>
              </div>
              <button
                className="btn btn-secondary mt-3 w-max"
                onClick={async () => {
                  try {
                    await linkedin.disconnect();
                    toast.success('Disconnected LinkedIn account');
                    refreshAccounts();
                  } catch (err) {
                    toast.error('Failed to disconnect');
                  }
                }}
              >Disconnect</button>
            </div>
          </div>
        </div>
      ))}

      {/* Team Accounts */}
      {accounts.filter(acc => acc.isTeamAccount).map((account) => (
        <div key={`${account.team_id}-${account.account_id}`} className="card p-4 flex items-center gap-4 bg-blue-50 border-blue-200">
          <Users className="h-8 w-8 text-blue-700" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Team LinkedIn Account</h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="h-5 w-5" /> Connected to Team: {account.team_name}
              </div>
              <div className="flex items-center gap-4 mt-2">
                {account.linkedin_profile_image_url && (
                  <img src={account.linkedin_profile_image_url} alt="Profile" className="h-12 w-12 rounded-full border" />
                )}
                <div>
                  <div className="font-medium text-gray-900 text-base">
                    {account.linkedin_display_name || account.linkedin_username || 'N/A'}
                  </div>
                  {account.headline && (
                    <div className="text-xs text-gray-500 mt-1">{account.headline}</div>
                  )}
                  <div className="text-xs text-blue-600 mt-1">Team Account • {account.user_role}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Connect New Account Button */}
      {accounts.length === 0 && !accountsLoading && (
        <div className="card p-6 flex flex-col items-center gap-4 bg-gradient-to-br from-blue-50 to-white border border-blue-100 shadow-lg rounded-xl text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="bg-blue-100 rounded-full p-4 mb-2">
              <Linkedin className="h-10 w-10 text-blue-700" />
            </div>
            <h3 className="font-bold text-lg text-gray-900">Connect your LinkedIn Account</h3>
            <p className="text-gray-600 text-sm max-w-xs mb-2">To use SuiteGenie, please connect your LinkedIn account. This enables posting, analytics, and more features.</p>
            <button
              className="btn btn-primary mt-2 px-6 py-2 text-base rounded-lg shadow hover:bg-blue-700 transition-all"
              onClick={handleConnect}
              disabled={connecting}
            >
              <ExternalLink className="h-4 w-4 mr-2 inline" />
              {connecting ? 'Connecting...' : 'Connect LinkedIn'}
            </button>
          </div>
        </div>
      )}

      {accountsLoading && (
        <div className="card p-4">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-gray-500">Loading accounts...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default LinkedInConnect;
