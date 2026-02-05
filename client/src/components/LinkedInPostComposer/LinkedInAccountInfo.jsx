import React from 'react';
import { useAccount } from '../../contexts/AccountContext';

const LinkedInAccountInfo = () => {
  const { selectedAccount } = useAccount();
  
  if (!selectedAccount) return null;
  
  const displayName = selectedAccount.linkedin_display_name || selectedAccount.linkedin_username || 'LinkedIn User';
  const profileImage = selectedAccount.linkedin_profile_image_url;
  const accountType = selectedAccount.isTeamAccount ? 'Team Account' : 'Personal Profile';
  const teamName = selectedAccount.team_name;
  
  return (
    <div className="card mb-6">
      <div className="flex items-center space-x-3">
        {profileImage ? (
          <img 
            src={profileImage} 
            alt={displayName}
            className="h-10 w-10 rounded-full border-2 border-blue-200"
          />
        ) : (
          <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-[#0077B5] font-medium text-sm">
              {displayName[0]?.toUpperCase()}
            </span>
          </div>
        )}
        <div>
          <h3 className="font-medium text-gray-900">
            Posting as {accountType}
          </h3>
          <p className="text-sm text-gray-600">
            {displayName}
            {teamName && <span className="text-blue-600 ml-2">• Team: {teamName}</span>}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LinkedInAccountInfo;
