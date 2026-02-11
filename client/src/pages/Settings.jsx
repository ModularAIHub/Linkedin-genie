
import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Sparkles } from 'lucide-react';
import LinkedInConnect from '../components/LinkedInConnect';
import { byok } from '../utils/api';

const Settings = () => {
  const [activeTab, setActiveTab] = useState('linkedin');
  const [apiKeyPreference, setApiKeyPreference] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch BYOK/platform mode
      const prefRes = await byok.getPreference();
      setApiKeyPreference(prefRes.data);
    } catch (error) {
      // Optionally handle error
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'linkedin', name: 'LinkedIn Account', icon: SettingsIcon },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-gray-600">Manage your LinkedIn account and preferences</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-5 w-5 mr-2" />
                {tab.name}
              </button>
            );
          })}
        </nav>
      </div>

      {/* LinkedIn Account Tab */}
      {activeTab === 'linkedin' && (
        <div className="space-y-6">
          {/* Important Notice for Team Users */}
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  Important: Team vs Personal Accounts
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p className="mb-2">
                    <strong>If you are part of a team:</strong> You can only use LinkedIn accounts connected through your team. Personal LinkedIn accounts will not be accessible.
                  </p>
                  <p>
                    <strong>To use team accounts:</strong> Connect LinkedIn accounts through the Team page in the main platform (SuiteGenie Dashboard → Team → Social Accounts).
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              LinkedIn Account Connection
            </h3>
            <LinkedInConnect />
          </div>
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              API Key Mode
            </h3>
            {loading ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-gray-500">Loading mode preference...</span>
              </div>
            ) : apiKeyPreference ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-full ${
                    apiKeyPreference.api_key_preference === 'byok' ? 'bg-green-100' : 'bg-blue-100'
                  }`}>
                    {apiKeyPreference.api_key_preference === 'byok' ? '🔑' : '🏢'}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-neutral-700">Current mode: </span>
                      <span className={`font-semibold px-2 py-1 rounded-md text-sm ${
                        apiKeyPreference.api_key_preference === 'byok' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {apiKeyPreference.api_key_preference === 'byok' ? 'BYOK (Your Own Keys)' : 'Platform Keys'}
                      </span>
                    </div>
                    {apiKeyPreference.api_key_preference === 'byok' && apiKeyPreference.byok_locked_until && (
                      <div className="mt-1 text-sm text-yellow-600 bg-yellow-50 px-2 py-1 rounded-md inline-block">
                        🔒 Locked until {new Date(apiKeyPreference.byok_locked_until).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-md">
                  {apiKeyPreference.api_key_preference === 'byok' ? (
                    <div>
                      <p className="font-medium text-gray-700 mb-1">BYOK Mode Benefits:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>Use your own OpenAI, Gemini, or Perplexity API keys</li>
                        <li>Higher credit allowance when using your own keys</li>
                        <li>Direct control over AI service usage and costs</li>
                      </ul>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium text-gray-700 mb-1">Platform Mode Benefits:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>No need to manage your own API keys</li>
                        <li>Simplified setup and maintenance</li>
                        <li>Credits provided by the platform</li>
                      </ul>
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <a 
                    href="https://suitegenie.in/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    <SettingsIcon className="h-4 w-4 mr-2" />
                    Manage Mode in Platform Settings
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="text-gray-500 mb-2">No mode preference found.</div>
                <a 
                  href="https://suitegenie.in/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:text-primary-700 text-sm"
                >
                  Set up your API key mode in Platform Settings →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Providers Tab removed */}
    </div>
  );
};

export default Settings;
