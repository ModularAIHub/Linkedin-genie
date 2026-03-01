
import React, { useState, useEffect, useRef } from 'react';
import { Linkedin, ExternalLink, CheckCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedin } from '../utils/api';
import { useAccount } from '../contexts/AccountContext';
import { useLocation, useNavigate } from 'react-router-dom';

const OAUTH_RESULT_KEY = 'linkedin_oauth_result';
const ACCOUNT_SELECTION_KEY = 'linkedin_account_selection_pending';

const LinkedInConnect = () => {
  const { accounts, teams, loading: accountsLoading, refreshAccounts } = useAccount();
  const [connecting, setConnecting] = useState(false);
  const [showAccountSelection, setShowAccountSelection] = useState(false);
  const [availableOrganizations, setAvailableOrganizations] = useState([]);
  const [pendingSelectionId, setPendingSelectionId] = useState(null);
  const [selectingAccount, setSelectingAccount] = useState(false);
  const oauthMessageReceivedRef = useRef(false);
  const popupPollRef = useRef(null);
  const autoClosingSelectionRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isInTeam = Array.isArray(teams) && teams.length > 0;
  const personalAccounts = accounts.filter((acc) => !acc.isTeamAccount);
  const teamAccounts = accounts.filter((acc) => acc.isTeamAccount);

  const hasMatchingOrganizationAccount = (organizations = availableOrganizations) =>
    Array.isArray(organizations) &&
    organizations.length > 0 &&
    personalAccounts.some((account) => {
      const organizationId =
        account?.organization_id ||
        (typeof account?.account_id === 'string' && account.account_id.startsWith('org:')
          ? account.account_id.slice(4)
          : null);
      if (!organizationId) return false;
      return organizations.some((organization) => String(organization?.id) === String(organizationId));
    });

  const persistPendingSelection = ({ organizations, selectionId }) => {
    try {
      sessionStorage.setItem(
        ACCOUNT_SELECTION_KEY,
        JSON.stringify({
          organizations,
          selectionId,
          timestamp: Date.now(),
        })
      );
    } catch {
      // Ignore storage failures.
    }
  };

  const clearPendingSelection = () => {
    try {
      sessionStorage.removeItem(ACCOUNT_SELECTION_KEY);
    } catch {
      // Ignore storage failures.
    }
  };

  const getOrganizationIds = (organizations = []) =>
    (Array.isArray(organizations) ? organizations : [])
      .map((organization) => String(organization?.id || '').trim())
      .filter(Boolean)
      .sort();

  const hasSameOrganizationChoices = (left, right) => {
    const leftIds = getOrganizationIds(left);
    const rightIds = getOrganizationIds(right);

    return (
      leftIds.length === rightIds.length &&
      leftIds.every((value, index) => value === rightIds[index])
    );
  };

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
    if ((status === 'success' || result?.type === 'linkedin_auth_success') && result?.selectAccount && Array.isArray(result.organizations) && result.organizations.length > 0) {
      oauthMessageReceivedRef.current = true;
      setConnecting(false);
      autoClosingSelectionRef.current = false;
      setAvailableOrganizations(result.organizations);
      setPendingSelectionId(result.selectionId || null);
      setShowAccountSelection(true);
      persistPendingSelection({
        organizations: result.organizations,
        selectionId: result.selectionId || null,
      });
      await refreshAccountsWithRetry();
      return;
    }

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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shouldSelectAccount = params.get('select_account') === 'true';
    const selectionId = params.get('selectionId');
    const organizationsParam = params.get('organizations');
    const normalizedSelectionId = selectionId || null;

    if (shouldSelectAccount && organizationsParam) {
      try {
        const parsedOrganizations = JSON.parse(organizationsParam);
        if (Array.isArray(parsedOrganizations) && parsedOrganizations.length > 0) {
          if (hasMatchingOrganizationAccount(parsedOrganizations)) {
            clearPendingSelection();
            if (location.search !== '?linkedin_connected=true') {
              navigate('/settings?linkedin_connected=true', { replace: true });
            }
            return;
          }

          const alreadyShowingSameSelection =
            showAccountSelection &&
            String(pendingSelectionId || '') === String(normalizedSelectionId || '') &&
            hasSameOrganizationChoices(availableOrganizations, parsedOrganizations);

          if (alreadyShowingSameSelection) {
            return;
          }

          autoClosingSelectionRef.current = false;
          setAvailableOrganizations(parsedOrganizations);
          setPendingSelectionId(normalizedSelectionId);
          setShowAccountSelection(true);
          persistPendingSelection({
            organizations: parsedOrganizations,
            selectionId: normalizedSelectionId,
          });
        }
      } catch (error) {
        console.error('Failed to parse LinkedIn organizations:', error);
      }
      return;
    }

    if (showAccountSelection) {
      return;
    }

    try {
      const cachedSelection = sessionStorage.getItem(ACCOUNT_SELECTION_KEY);
      if (!cachedSelection) {
        return;
      }

      const parsed = JSON.parse(cachedSelection);
      if (!parsed || Date.now() - (parsed.timestamp || 0) > 15 * 60 * 1000) {
        clearPendingSelection();
        return;
      }

      if (Array.isArray(parsed.organizations) && parsed.organizations.length > 0) {
        if (hasMatchingOrganizationAccount(parsed.organizations)) {
          clearPendingSelection();
          return;
        }

        const cachedSelectionId = parsed.selectionId || null;
        const alreadyShowingSameSelection =
          showAccountSelection &&
          String(pendingSelectionId || '') === String(cachedSelectionId || '') &&
          hasSameOrganizationChoices(availableOrganizations, parsed.organizations);

        if (alreadyShowingSameSelection) {
          return;
        }

        autoClosingSelectionRef.current = false;
        setAvailableOrganizations(parsed.organizations);
        setPendingSelectionId(cachedSelectionId);
        setShowAccountSelection(true);
      } else {
        clearPendingSelection();
      }
    } catch {
      clearPendingSelection();
    }
  }, [
    location.search,
    showAccountSelection,
    pendingSelectionId,
    availableOrganizations,
    personalAccounts,
    navigate,
  ]);

  useEffect(() => {
    if (!showAccountSelection) {
      autoClosingSelectionRef.current = false;
      return;
    }

    if (!hasMatchingOrganizationAccount()) {
      return;
    }

    if (autoClosingSelectionRef.current) {
      return;
    }

    autoClosingSelectionRef.current = true;

    setShowAccountSelection(false);
    setAvailableOrganizations([]);
    setPendingSelectionId(null);
    clearPendingSelection();
    navigate('/settings?linkedin_connected=true', { replace: true });
  }, [showAccountSelection, availableOrganizations, personalAccounts, navigate]);

  const handleAccountTypeSelection = async ({ accountType, organization = null }) => {
    setSelectingAccount(true);
    try {
      await linkedin.selectAccountType({
        accountType,
        selectionId: pendingSelectionId,
        organizationId: organization?.id || null,
        organizationName: organization?.name || null,
        organizationVanityName: organization?.vanityName || null,
      });

      await refreshAccountsWithRetry();
      setShowAccountSelection(false);
      setAvailableOrganizations([]);
      setPendingSelectionId(null);
      clearPendingSelection();
      navigate('/settings?linkedin_connected=true', { replace: true });
      toast.success(
        accountType === 'organization'
          ? `LinkedIn organization page selected: ${organization?.name || 'Organization'}`
          : 'LinkedIn personal profile selected'
      );
    } catch (error) {
      const backendError = error?.response?.data?.error || 'Failed to save LinkedIn account selection.';

      if (
        /selection session expired/i.test(backendError) &&
        accountType === 'organization' &&
        hasMatchingOrganizationAccount(organization ? [organization] : availableOrganizations)
      ) {
        setShowAccountSelection(false);
        setAvailableOrganizations([]);
        setPendingSelectionId(null);
        clearPendingSelection();
        navigate('/settings?linkedin_connected=true', { replace: true });
        toast.success(`LinkedIn organization page selected: ${organization?.name || 'Organization'}`);
        return;
      }

      toast.error(backendError);
    } finally {
      setSelectingAccount(false);
    }
  };

  const handleConnect = async () => {
    if (isInTeam) {
      toast.error('Personal LinkedIn connection is disabled in team mode. Use Team -> Social Accounts.');
      return;
    }

    oauthMessageReceivedRef.current = false;
    setConnecting(true);
    try {
      const response = await linkedin.connect({ popup: false });
      const oauthUrl = response.data.url;
      window.location.assign(oauthUrl);
    } catch (error) {
      toast.error('Failed to initiate LinkedIn connection.');
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Personal Accounts */}
      {!isInTeam && personalAccounts.map((account) => (
        <div key={account.id} className="card p-4 flex items-center gap-4">
          <Linkedin className="h-8 w-8 text-blue-700" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">
              {account.account_type === 'organization' ? 'LinkedIn Organization Page' : 'Personal LinkedIn Account'}
            </h3>
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
              {!isInTeam && (
                <button
                  className="btn btn-primary mt-3 w-max"
                  onClick={handleConnect}
                  disabled={connecting}
                >
                  <ExternalLink className="h-4 w-4 mr-2 inline" />
                  {connecting ? 'Connecting...' : 'Reconnect / Change Account Type'}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Team Accounts */}
      {teamAccounts.map((account) => (
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
      {!isInTeam && personalAccounts.length === 0 && !accountsLoading && (
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

      {isInTeam && teamAccounts.length === 0 && !accountsLoading && (
        <div className="card p-5 bg-yellow-50 border border-yellow-200 rounded-xl">
          <h4 className="font-semibold text-yellow-900 mb-2">Team Mode Active</h4>
          <p className="text-sm text-yellow-800">
            Personal LinkedIn accounts are hidden in team mode. Connect LinkedIn accounts from the main
            platform Team page (SuiteGenie Dashboard - Team - Social Accounts).
          </p>
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

      {showAccountSelection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <h3 className="text-xl font-semibold text-gray-900">Choose LinkedIn Account Type</h3>
              <p className="mt-1 text-sm text-gray-600">
                Select whether you want to publish from your personal profile or an organization page.
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <button
                type="button"
                disabled={selectingAccount}
                onClick={() => handleAccountTypeSelection({ accountType: 'personal' })}
                className="w-full rounded-xl border border-gray-200 p-4 text-left transition hover:border-blue-500 hover:bg-blue-50 disabled:opacity-60"
              >
                <div className="font-semibold text-gray-900">Personal Profile</div>
                <div className="mt-1 text-sm text-gray-600">Use your own LinkedIn profile for posts and scheduling.</div>
              </button>

              <div className="border-t border-gray-100 pt-4">
                <div className="mb-3 text-sm font-medium text-gray-700">Organization Pages</div>
                <div className="space-y-3">
                  {availableOrganizations.map((organization) => (
                    <button
                      key={organization.id}
                      type="button"
                      disabled={selectingAccount}
                      onClick={() => handleAccountTypeSelection({ accountType: 'organization', organization })}
                      className="flex w-full items-center gap-3 rounded-xl border border-gray-200 p-4 text-left transition hover:border-blue-500 hover:bg-blue-50 disabled:opacity-60"
                    >
                      {organization.logo ? (
                        <img src={organization.logo} alt={organization.name} className="h-10 w-10 rounded-full border object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-blue-50 text-blue-700">
                          <Users className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-gray-900">{organization.name}</div>
                        <div className="text-sm text-gray-600">Organization Page</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LinkedInConnect;
