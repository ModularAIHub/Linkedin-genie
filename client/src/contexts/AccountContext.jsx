import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api from '../utils/api';
import { useAuth } from './AuthContext';

export const getCurrentAccountId = (selectedAccount) => {
  if (!selectedAccount) return null;
  const accountId = selectedAccount.account_id || selectedAccount.id;

  // Team accounts (both personal and org): always return the UUID so the server
  // can route to the exact social_connected_accounts row.
  if (selectedAccount.isTeamAccount === true) {
    return accountId || null;
  }

  // Non-team org pages: return the account id (e.g. 'org:12345')
  if (selectedAccount.account_type === 'organization') {
    return accountId;
  }

  // Non-team personal accounts: no account id needed, server uses default.
  return null;
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
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const accountsRequestInFlightRef = useRef(false);

  const getDefaultAccount = useCallback((fetchedAccounts) => {
    if (!Array.isArray(fetchedAccounts) || fetchedAccounts.length === 0) return null;

    const organizationAccount = fetchedAccounts.find(
      (account) => account?.account_type === 'organization'
    );

    return organizationAccount || fetchedAccounts[0];
  }, []);

  const updateSelectedAccount = useCallback((account) => {
    setSelectedAccount(account);

    if (!account) {
      localStorage.removeItem('selectedLinkedInAccount');
      return;
    }

    localStorage.setItem(
      'selectedLinkedInAccount',
      JSON.stringify({
        id: account.id,
        account_id: account.account_id,
        account_type: account.account_type,
        organization_id: account.organization_id,
        team_id: account.team_id,
        username: account.linkedin_username,
        display_name: account.linkedin_display_name,
        isTeamAccount: account.isTeamAccount
      })
    );
  }, []);

  const fetchAccounts = useCallback(async () => {
    if (accountsRequestInFlightRef.current) {
      return;
    }

    accountsRequestInFlightRef.current = true;
    setLoading(true);

    try {
      const accountsResponse = await api.get('/api/team/accounts');
      const fetchedAccounts = accountsResponse.data.accounts || [];
      setAccounts(fetchedAccounts);

      try {
        const teamsResponse = await api.get('/api/team/teams');
        setTeams(teamsResponse.data.teams || []);
      } catch {
        setTeams([]);
      }

      if (fetchedAccounts.length === 0) {
        updateSelectedAccount(null);
        return;
      }

      const savedAccount = localStorage.getItem('selectedLinkedInAccount');
      let accountToSelect = null;
      if (savedAccount) {
        try {
          const saved = JSON.parse(savedAccount);
          accountToSelect = fetchedAccounts.find(
            (acc) => acc.id === saved.id || acc.account_id === saved.account_id
          );
        } catch {
          localStorage.removeItem('selectedLinkedInAccount');
        }
      }

      if (!accountToSelect) {
        accountToSelect = getDefaultAccount(fetchedAccounts);
      }

      updateSelectedAccount(accountToSelect);
    } catch {
      setAccounts([]);
      setTeams([]);
      updateSelectedAccount(null);
    } finally {
      setLoading(false);
      accountsRequestInFlightRef.current = false;
    }
  }, [getDefaultAccount, updateSelectedAccount]);

  useEffect(() => {
    if (authLoading) return;

    if (!isAuthenticated) {
      setAccounts([]);
      setTeams([]);
      updateSelectedAccount(null);
      setLoading(false);
      return;
    }

    fetchAccounts();
  }, [authLoading, isAuthenticated, fetchAccounts, updateSelectedAccount]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.setSelectedAccount = updateSelectedAccount;
    return () => {
      try {
        delete window.setSelectedAccount;
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, [updateSelectedAccount]);

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
