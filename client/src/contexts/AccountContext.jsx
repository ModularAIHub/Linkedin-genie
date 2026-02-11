import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

// Helper to get current account ID  
export const getCurrentAccountId = (selectedAccount) => {
  if (!selectedAccount) return null;

  // For team accounts, use account_id or id (should be integer)
  // For personal accounts, we don't need account_id (returns null)
  const accountId = selectedAccount.account_id || selectedAccount.id;

  // Personal accounts don't have account_id, which is correct
  if (selectedAccount.account_type === 'personal' || selectedAccount.isTeamAccount === false) {
    return null;
  }

  // Warn if we're getting a UUID when we expect an integer for team accounts
  if (accountId && typeof accountId === 'string' && accountId.includes('-')) {
    console.warn('[getCurrentAccountId] Unexpected UUID as account ID:', accountId, 'from account:', selectedAccount);
  }

  return accountId;
};

const AccountContext = createContext();

export const useAccount = () => {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
};

export const AccountProvider = ({ children }) => {
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);

  // Load persisted account selection on app start
  useEffect(() => {
    const savedAccount = localStorage.getItem('selectedLinkedInAccount');
    if (savedAccount) {
      try {
        const parsed = JSON.parse(savedAccount);
        console.log('[AccountContext] Loaded saved account selection:', parsed);
      } catch (error) {
        console.error('Failed to parse saved account:', error);
        localStorage.removeItem('selectedLinkedInAccount');
      }
    }
  }, []);

  const updateSelectedAccount = (account) => {
    console.log('[AccountContext] Updating selected account:', account);
    setSelectedAccount(account);

    if (account) {
      // Save to localStorage
      localStorage.setItem(
        'selectedLinkedInAccount',
        JSON.stringify({
          id: account.id,
          account_id: account.account_id,
          team_id: account.team_id,
          username: account.linkedin_username,
          display_name: account.linkedin_display_name,
          isTeamAccount: account.isTeamAccount
        })
      );

      // Notify backend of selection (for future use)
      api.post('/api/team/select-account', {
        accountId: account.account_id || account.id,
        teamId: account.team_id
      }).catch(err => {
        console.error('Failed to update backend account selection:', err);
      });
    } else {
      localStorage.removeItem('selectedLinkedInAccount');
    }
  };

  // Fetch all accounts (personal + team accounts)
  const fetchAccounts = async () => {
    try {
      setLoading(true);

      console.log('[AccountContext] Fetching accounts from /api/team/accounts...');

      // Fetch personal + team accounts
      const accountsResponse = await api.get('/api/team/accounts');

      console.log('[AccountContext] API Response:', accountsResponse);
      console.log('[AccountContext] Response data:', accountsResponse.data);

      const fetchedAccounts = accountsResponse.data.accounts || [];

      console.log('[AccountContext] Fetched accounts:', fetchedAccounts);
      setAccounts(fetchedAccounts);

      // Fetch teams
      try {
        const teamsResponse = await api.get('/api/team/teams');
        console.log('[AccountContext] Teams response:', teamsResponse.data);
        setTeams(teamsResponse.data.teams || []);
      } catch (teamError) {
        console.error('Failed to fetch teams:', teamError);
        setTeams([]);
      }

      // Auto-select account
      if (fetchedAccounts.length > 0) {
        // Try to restore saved selection
        const savedAccount = localStorage.getItem('selectedLinkedInAccount');
        let accountToSelect = null;

        if (savedAccount) {
          try {
            const saved = JSON.parse(savedAccount);
            accountToSelect = fetchedAccounts.find(
              acc => acc.id === saved.id || acc.account_id === saved.account_id
            );
          } catch (error) {
            console.error('Failed to parse saved account:', error);
          }
        }

        // Fallback to first account
        if (!accountToSelect) {
          accountToSelect = fetchedAccounts[0];
        }

        updateSelectedAccount(accountToSelect);
        console.log('[AccountContext] Auto-selected account:', accountToSelect);
      } else {
        console.warn('[AccountContext] No accounts found! User may need to connect a LinkedIn account.');
      }
    } catch (error) {
      console.error('[AccountContext] Failed to fetch accounts:', error);
      console.error('[AccountContext] Error details:', error.response?.data || error.message);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch accounts on mount
  useEffect(() => {
    fetchAccounts();
  }, []);

  const value = {
    selectedAccount,
    setSelectedAccount: updateSelectedAccount,
    accounts,
    teams,
    loading,
    refreshAccounts: fetchAccounts,
    getCurrentAccountId: () => getCurrentAccountId(selectedAccount),
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
};
