import React from 'react';

/**
 * Modern account/team selector dropdown for Twitter Genie and LinkedIn Genie.
 * Props:
 * - accounts: array of account/team objects (must have id, name, avatar)
 * - selectedAccount: currently selected account object
 * - onSelect: function(account) => void
 * - label: string (optional, e.g. 'Select Account')
 */
const AccountSelector = ({ accounts, selectedAccount, onSelect, label = 'Select Account' }) => {
  if (!accounts || accounts.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-sm font-medium text-gray-700">{label}:</span>}
      <select
        className="input px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        value={selectedAccount?.id || ''}
        onChange={e => {
          const account = accounts.find(a => a.id === e.target.value);
          if (account) onSelect(account);
        }}
      >
        {accounts.map(account => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      {selectedAccount?.avatar && (
        <img src={selectedAccount.avatar} alt="avatar" className="h-6 w-6 rounded-full ml-2" />
      )}
    </div>
  );
};

export default AccountSelector;
