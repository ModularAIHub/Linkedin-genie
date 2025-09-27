

import React, { useState, useEffect } from 'react';
import { Linkedin, ExternalLink, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedin } from '../utils/api';

// Helper to fetch user info if LinkedIn account is missing
async function fetchUserStatus() {
  try {
    const res = await fetch('/api/user/status');
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.user ? data.user : null;
  } catch {
    return null;
  }
}

const LinkedInConnect = () => {

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    fetchStatus();
    // Listen for postMessage from OAuth popup
    const handlePopupMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data.type === 'linkedin_auth_success') {
        toast.success('LinkedIn account connected!');
        setConnecting(false);
        fetchStatus();
      } else if (event.data.type === 'linkedin_auth_error') {
        toast.error('LinkedIn authentication failed.');
        setConnecting(false);
      }
    };
    window.addEventListener('message', handlePopupMessage);
    return () => window.removeEventListener('message', handlePopupMessage);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await linkedin.getStatus();
      if (res.data.accounts && res.data.accounts.length > 0) {
        setAccount(res.data.accounts[0]);
        setConnected(true);
        console.debug('[LinkedInConnect] Connected account:', res.data.accounts[0]);
      } else {
        // Fallback: check if user is authenticated and show minimal info
        const user = await fetchUserStatus();
        if (user) {
          setAccount({ display_name: user.name || user.email, id: user.id });
          setConnected(true);
          console.debug('[LinkedInConnect] No LinkedIn account, but user is authenticated:', user);
        } else {
          setAccount(null);
          setConnected(false);
        }
      }
    } catch (err) {
      setAccount(null);
      setConnected(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const response = await linkedin.connect();
      const oauthUrl = response.data.url + '&popup=true';
      const popup = window.open(
        oauthUrl,
        'linkedin-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes,location=yes,menubar=no,toolbar=no,status=yes'
      );
      if (!popup) {
        toast.error('Popup was blocked. Please allow popups and try again.');
        setConnecting(false);
        return;
      }
      // Monitor popup for completion
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          setConnecting(false);
        }
      }, 1000);
    } catch (error) {
      toast.error('Failed to initiate LinkedIn connection.');
      setConnecting(false);
    }
  };

  return (
    <div className="card p-4 flex items-center gap-4">
      <Linkedin className="h-8 w-8 text-blue-700" />
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900">LinkedIn Account</h3>
        {connected ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle className="h-5 w-5" /> Connected
            </div>
            {account && (
              <div className="flex items-center gap-4 mt-2">
                {account.profile_image_url && (
                  <img src={account.profile_image_url} alt="Profile" className="h-12 w-12 rounded-full border" />
                )}
                <div>
                  <div className="font-medium text-gray-900 text-base">
                    {account.display_name || account.username || 'N/A'}
                  </div>
                  {account.headline && (
                    <div className="text-xs text-gray-500 mt-1">{account.headline}</div>
                  )}
                  {account.id && (
                    <div className="text-xs text-gray-400 mt-1">ID: {account.id}</div>
                  )}
                </div>
              </div>
            )}
            <button
              className="btn btn-secondary mt-3 w-max"
              onClick={async () => {
                try {
                  await linkedin.disconnect();
                  toast.success('Disconnected LinkedIn account');
                  fetchStatus();
                } catch (err) {
                  toast.error('Failed to disconnect');
                }
              }}
            >Disconnect</button>
          </div>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={connecting}
          >
            <ExternalLink className="h-4 w-4 mr-1 inline" />
            {connecting ? 'Connecting...' : 'Connect LinkedIn'}
          </button>
        )}
      </div>
    </div>
  );
};

export default LinkedInConnect;
