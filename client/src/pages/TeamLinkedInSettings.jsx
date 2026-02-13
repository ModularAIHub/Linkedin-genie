import React, { useState, useEffect } from 'react';
import { Users, Link as LinkIcon, Trash2, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import { team } from '../utils/api';
import toast from 'react-hot-toast';

const TeamLinkedInSettings = () => {
  const { teams, accounts, refreshAccounts } = useAccount();
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(null);

  useEffect(() => {
    if (teams.length > 0 && !selectedTeam) {
      setSelectedTeam(teams[0]);
    }
  }, [teams]);

  // Handle OAuth callback results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');
    const error = params.get('error');
    
    if (success === 'true') {
      toast.success('LinkedIn account connected to team successfully!');
      refreshAccounts();
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (error) {
      // Refresh accounts first to show any existing connections
      if (error === 'already_connected') {
        refreshAccounts();
      }
      
      let errorMessage = 'Failed to connect LinkedIn account to team';
      switch (error) {
        case 'not_team_member':
          errorMessage = 'You are not a member of this team';
          break;
        case 'insufficient_permissions':
          errorMessage = 'Only team owners and admins can connect LinkedIn accounts';
          break;
        case 'already_connected':
          const existingTeam = params.get('existingTeam') || 'another team';
          const accountName = params.get('accountName') || 'This LinkedIn account';
          errorMessage = `${accountName} is already connected to ${existingTeam}. Each LinkedIn account can only be connected once. Check the accounts list below to see existing connections.`;
          break;
        case 'token_exchange_failed':
          errorMessage = 'Failed to exchange authorization code';
          break;
        case 'profile_fetch_failed':
          errorMessage = 'Failed to fetch LinkedIn profile';
          break;
        case 'database_error':
          errorMessage = 'Database error while saving account';
          break;
        default:
          errorMessage = `Connection failed: ${error}`;
      }
      toast.error(errorMessage, { duration: 6000 });
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refreshAccounts]);

  const getTeamAccounts = (teamId) => {
    return accounts.filter(acc => acc.isTeamAccount && acc.team_id === teamId);
  };

  const handleConnectAccount = async () => {
    if (!selectedTeam) {
      toast.error('Please select a team first');
      return;
    }

    try {
      setConnecting(true);
      
      // Get current user ID from auth context
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3004'}/api/user/profile`, {
        credentials: 'include'
      });
      const userData = await response.json();
      const userId = userData.id || userData.userId;
      
      if (!userId) {
        toast.error('Unable to get user ID. Please refresh and try again.');
        setConnecting(false);
        return;
      }
      
      // Construct return URL for OAuth callback
      const returnUrl = `${window.location.origin}/team-accounts`;
      
      // Redirect to LinkedIn OAuth for team connection
      const apiUrl = import.meta.env.VITE_API_URL || (
        import.meta.env.MODE === 'production'
          ? 'https://apilinkedin.suitegenie.in'
          : 'http://localhost:3004'
      );
      const oauthUrl = `${apiUrl}/api/oauth/linkedin/team-connect?teamId=${selectedTeam.id}&userId=${userId}&returnUrl=${encodeURIComponent(returnUrl)}`;
      
      console.log('Redirecting to LinkedIn OAuth for team connection:', oauthUrl);
      window.location.href = oauthUrl;
    } catch (error) {
      console.error('Failed to initiate LinkedIn connection:', error);
      toast.error('Failed to initiate LinkedIn connection');
      setConnecting(false);
    }
  };

  const handleDisconnectAccount = async (accountId) => {
    if (!confirm('Are you sure you want to disconnect this LinkedIn account from the team?')) {
      return;
    }

    try {
      setDisconnecting(accountId);
      await team.disconnectAccount(accountId);
      toast.success('LinkedIn account disconnected from team');
      await refreshAccounts();
    } catch (error) {
      console.error('Failed to disconnect account:', error);
      toast.error(error.response?.data?.error || 'Failed to disconnect LinkedIn account');
    } finally {
      setDisconnecting(null);
    }
  };

  if (teams.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-start space-x-3">
          <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Teams Available</h3>
            <p className="text-gray-600">
              You need to be part of a team to manage team LinkedIn accounts. 
              Contact your platform administrator or create a team on the main platform.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const teamAccounts = selectedTeam ? getTeamAccounts(selectedTeam.id) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
          <Users className="h-6 w-6 mr-2 text-blue-600" />
          Team LinkedIn Accounts
        </h2>
        <p className="mt-2 text-gray-600">
          Connect and manage LinkedIn accounts that your team can use for posting
        </p>
      </div>

      {/* Team Selector */}
      {teams.length > 1 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Team
          </label>
          <select
            value={selectedTeam?.id || ''}
            onChange={(e) => setSelectedTeam(teams.find(t => t.id === e.target.value))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.role})
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedTeam && (
        <>
          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">How Team LinkedIn Accounts Work:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Click "Connect Your LinkedIn Account" to share your personal LinkedIn credentials with the team</li>
                  <li>All team members can then post using this LinkedIn account</li>
                  <li>Only team owners and admins can connect/disconnect accounts</li>
                  <li>You can connect multiple LinkedIn accounts to a single team</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Connect Button (only for owner/admin) */}
          {(selectedTeam.role === 'owner' || selectedTeam.role === 'admin') && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <button
                onClick={handleConnectAccount}
                disabled={connecting}
                className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <LinkIcon className="h-5 w-5" />
                <span>{connecting ? 'Connecting...' : 'Connect Your LinkedIn Account to Team'}</span>
              </button>
              <p className="mt-2 text-sm text-gray-600">
                This will allow all team members to post using your LinkedIn account
              </p>
            </div>
          )}

          {/* Connected Accounts List */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Connected LinkedIn Accounts ({teamAccounts.length})
            </h3>

            {teamAccounts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Users className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p>No LinkedIn accounts connected to this team yet</p>
                {(selectedTeam.role === 'owner' || selectedTeam.role === 'admin') && (
                  <p className="text-sm mt-2">Connect your LinkedIn account above to get started</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {teamAccounts.map((account) => (
                  <div
                    key={account.account_id}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center space-x-4">
                      {account.linkedin_profile_image_url ? (
                        <img
                          src={account.linkedin_profile_image_url}
                          alt={account.linkedin_display_name}
                          className="h-12 w-12 rounded-full"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                          <Users className="h-6 w-6 text-blue-600" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-gray-900">
                          {account.linkedin_display_name || account.linkedin_username}
                        </div>
                        {account.headline && (
                          <div className="text-sm text-gray-600">{account.headline}</div>
                        )}
                        <div className="flex items-center space-x-2 mt-1">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span className="text-xs text-gray-500">Connected by team member</span>
                        </div>
                      </div>
                    </div>

                    {(selectedTeam.role === 'owner' || selectedTeam.role === 'admin') && (
                      <button
                        onClick={() => handleDisconnectAccount(account.account_id)}
                        disabled={disconnecting === account.account_id}
                        className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="text-sm">
                          {disconnecting === account.account_id ? 'Removing...' : 'Remove'}
                        </span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TeamLinkedInSettings;
