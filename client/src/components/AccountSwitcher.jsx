import React, { useState } from 'react';
import { ChevronDown, User, Users, Check } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';

const AccountSwitcher = () => {
  const { selectedAccount, accounts, setSelectedAccount } = useAccount();
  const [isOpen, setIsOpen] = useState(false);

  const handleAccountSelect = (account) => {
    setSelectedAccount(account);
    setIsOpen(false);
  };

  if (!accounts || accounts.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {selectedAccount?.isTeamAccount ? (
          <Users className="h-4 w-4 text-blue-600" />
        ) : (
          <User className="h-4 w-4 text-gray-600" />
        )}
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium text-gray-900">
            {selectedAccount?.linkedin_display_name || selectedAccount?.linkedin_username || 'Select Account'}
          </span>
          {selectedAccount?.isTeamAccount && (
            <span className="text-xs text-gray-500">Team: {selectedAccount.team_name}</span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-96 overflow-y-auto">
            <div className="p-2">
              {/* Personal Accounts Section */}
              {accounts.filter(acc => !acc.isTeamAccount).length > 0 && (
                <>
                  <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Personal Account
                  </div>
                  {accounts
                    .filter(acc => !acc.isTeamAccount)
                    .map((account) => (
                      <button
                        key={account.id}
                        onClick={() => handleAccountSelect(account)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-100 transition-colors ${
                          selectedAccount?.id === account.id ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          {account.linkedin_profile_image_url ? (
                            <img
                              src={account.linkedin_profile_image_url}
                              alt={account.linkedin_display_name}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <User className="h-4 w-4 text-gray-500" />
                            </div>
                          )}
                          <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-gray-900">
                              {account.linkedin_display_name || account.linkedin_username}
                            </span>
                            {account.headline && (
                              <span className="text-xs text-gray-500 truncate max-w-[200px]">
                                {account.headline}
                              </span>
                            )}
                          </div>
                        </div>
                        {selectedAccount?.id === account.id && (
                          <Check className="h-4 w-4 text-blue-600" />
                        )}
                      </button>
                    ))}
                </>
              )}

              {/* Team Accounts Section */}
              {accounts.filter(acc => acc.isTeamAccount).length > 0 && (
                <>
                  <div className="px-3 py-2 mt-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-200">
                    Team Accounts
                  </div>
                  {accounts
                    .filter(acc => acc.isTeamAccount)
                    .map((account) => (
                      <button
                        key={`${account.team_id}-${account.account_id}`}
                        onClick={() => handleAccountSelect(account)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-100 transition-colors ${
                          selectedAccount?.account_id === account.account_id && selectedAccount?.team_id === account.team_id
                            ? 'bg-blue-50'
                            : ''
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          {account.linkedin_profile_image_url ? (
                            <img
                              src={account.linkedin_profile_image_url}
                              alt={account.linkedin_display_name}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                              <Users className="h-4 w-4 text-blue-600" />
                            </div>
                          )}
                          <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-gray-900">
                              {account.linkedin_display_name || account.linkedin_username}
                            </span>
                            <span className="text-xs text-blue-600">
                              Team: {account.team_name}
                            </span>
                          </div>
                        </div>
                        {selectedAccount?.account_id === account.account_id && selectedAccount?.team_id === account.team_id && (
                          <Check className="h-4 w-4 text-blue-600" />
                        )}
                      </button>
                    ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AccountSwitcher;
