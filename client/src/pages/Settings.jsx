
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
    { id: 'ai', name: 'AI Providers', icon: Sparkles },
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

      {/* AI Providers Tab (placeholder for parity) */}
      {activeTab === 'ai' && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              AI Content Providers
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Configure your own API keys or use the platform's built-in providers (coming soon)
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
