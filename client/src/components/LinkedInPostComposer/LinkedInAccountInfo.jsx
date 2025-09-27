import React from 'react';

const LinkedInAccountInfo = ({ linkedInAccounts }) => {
  if (!linkedInAccounts || linkedInAccounts.length === 0) return null;
  return (
    <div className="card mb-6">
      <div className="flex items-center space-x-3">
        <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-[#0077B5] font-medium text-sm">
            {linkedInAccounts[0].display_name?.[0]?.toUpperCase()}
          </span>
        </div>
        <div>
          <h3 className="font-medium text-gray-900">
            Posting as {linkedInAccounts[0].profile_type === 'company' ? 'Company Page' : 'Personal Profile'}
          </h3>
          <p className="text-sm text-gray-600">
            {linkedInAccounts[0].display_name}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LinkedInAccountInfo;
