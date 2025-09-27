
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
              <div className="text-gray-500">Loading mode preference...</div>
            ) : apiKeyPreference ? (
              <div>
                <span className="text-neutral-700">Current mode: </span>
                <span className={`font-semibold ${apiKeyPreference.api_key_preference === 'byok' ? 'text-green-700' : 'text-blue-700'}`}>{apiKeyPreference.api_key_preference === 'byok' ? 'BYOK (Your Own Keys)' : 'Platform Keys'}</span>
                {apiKeyPreference.api_key_preference === 'byok' && apiKeyPreference.byok_locked_until && (
                  <span className="ml-2 text-xs text-yellow-700">(Locked until {new Date(apiKeyPreference.byok_locked_until).toLocaleString()})</span>
                )}
              </div>
            ) : (
              <div className="text-gray-500">No mode preference found.</div>
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
