import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import { credits } from '../utils/api';
import { hasProPlanAccess } from '../utils/planAccess';
import AccountSwitcher from './AccountSwitcher';
import {
  LayoutDashboard,
  Edit3,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  CreditCard,
  History,
  Sparkles,
  Lock,
} from 'lucide-react';

const Layout = ({ children }) => {
  const { user, logout } = useAuth();
  const { accounts, selectedAccount } = useAccount();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [creditBalance, setCreditBalance] = useState(null);
  const [loadingCredits, setLoadingCredits] = useState(true);
  const CREDITS_REFRESH_MS = 5 * 60 * 1000;
  const hasProAccess = hasProPlanAccess(user);

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Compose', href: '/compose', icon: Edit3 },
    { name: 'Strategy Builder', href: '/strategy', icon: Sparkles, badge: 'New', proOnly: true },
    { name: 'Bulk Generation', href: '/bulk-generation', icon: BarChart3, proOnly: true },
    { name: 'Scheduling', href: '/scheduling', icon: Calendar },
    { name: 'History', href: '/history', icon: History },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const isActive = (href) => location.pathname === href;

  // Fetch credit balance
  useEffect(() => {
    const fetchCredits = async () => {
      try {
        setLoadingCredits(true);
        const response = await credits.getBalance();
        setCreditBalance(response.data.balance);
      } catch (error) {
        setCreditBalance(0);
      } finally {
        setLoadingCredits(false);
      }
    };
    if (user) {
      fetchCredits();
    }
  }, [user]);

  // Refresh credits periodically (every 5 minutes) and when tab becomes active.
  useEffect(() => {
    if (!user) return undefined;

    const refreshCredits = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const response = await credits.getBalance();
        setCreditBalance(response.data.balance);
      } catch (error) {}
    };

    const interval = setInterval(refreshCredits, CREDITS_REFRESH_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshCredits();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-[#f3f6f8] flex">
      {/* Mobile sidebar backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0077B5] bg-opacity-75 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:relative lg:flex lg:flex-col ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-blue-200">
          <div className="flex items-center">
            <span className="text-xl font-bold gradient-text">LinkedIn Genie</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 rounded-md text-blue-400 hover:text-blue-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 mt-6 px-4 overflow-y-auto">
          <ul className="space-y-2">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isProLocked = Boolean(item.proOnly && !hasProAccess);
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={`flex items-center justify-between px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive(item.href)
                        ? 'bg-blue-50 text-[#0077B5] border-r-2 border-[#0077B5]'
                        : 'text-blue-700 hover:bg-blue-50 hover:text-[#0077B5]'
                    }`}
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    <div className="flex items-center">
                      <Icon className="mr-3 h-5 w-5" />
                      {item.name}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.badge && (
                        <span className="px-2 py-0.5 text-xs font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-full">
                          {item.badge}
                        </span>
                      )}
                      {item.proOnly && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                            isProLocked
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {isProLocked && <Lock className="h-3 w-3" />}
                          Pro
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {/* Credits display */}
        <div className="p-4 border-t border-blue-200 flex-shrink-0">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-700">Credits</span>
              <CreditCard className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-blue-900">
              {loadingCredits ? (
                <div className="animate-pulse bg-blue-200 rounded h-8 w-12"></div>
              ) : (
                creditBalance !== null ? creditBalance.toFixed(1) : '--'
              )}
            </div>
            <p className="text-xs text-blue-500">Available credits</p>
          </div>
        </div>
      </div>
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="bg-white shadow-sm border-b border-blue-200 flex-shrink-0">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 rounded-md text-blue-400 hover:text-blue-600"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center space-x-4">
              {/* Account Switcher - only show if user has LinkedIn accounts */}
              {accounts.length > 0 && (
                <div className="flex items-center space-x-3">
                  <AccountSwitcher />
                  {selectedAccount && (
                    <div className="hidden sm:flex flex-col leading-tight text-xs text-blue-600">
                      <span className="font-semibold text-blue-800">Viewing as</span>
                      <span>{selectedAccount.linkedin_display_name || selectedAccount.linkedin_username}</span>
                    </div>
                  )}
                </div>
              )}
              
              <div className="relative">
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50"
                >
                  <span className="hidden sm:block">{user?.email || 'User'}</span>
                  <ChevronDown className="h-4 w-4" />
                </button>
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-blue-200 py-1 z-50">
                    <Link
                      to="/settings"
                      className="block px-4 py-2 text-sm text-blue-700 hover:bg-blue-50"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      <Settings className="inline h-4 w-4 mr-2" />
                      Settings
                    </Link>
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        logout();
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-blue-50"
                    >
                      <LogOut className="inline h-4 w-4 mr-2" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          <div className="page-transition h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
