import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { AccountProvider } from "./contexts/AccountContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import LoadingSpinner from "./components/LoadingSpinner";

// Pages (lazy loaded to reduce initial bundle size)
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const LinkedInPostComposer = React.lazy(() => import('./pages/LinkedInPostComposer'));
const BulkGeneration = React.lazy(() => import('./pages/BulkGeneration'));
const Scheduling = React.lazy(() => import('./pages/Scheduling'));
const History = React.lazy(() => import('./pages/History'));
const LinkedInAnalytics = React.lazy(() => import('./pages/LinkedInAnalytics'));
const Settings = React.lazy(() => import('./pages/Settings'));
const AuthCallback = React.lazy(() => import('./pages/AuthCallback'));
const Login = React.lazy(() => import('./pages/Login'));

const PageFallback = () => (
  <div className="min-h-[40vh] flex items-center justify-center">
    <LoadingSpinner size="lg" />
  </div>
);

function App() {
  return (
    <AuthProvider>
      <AccountProvider>
        <div className="min-h-screen bg-[#f3f6f8]"> {/* LinkedIn blue background tint */}
          <React.Suspense fallback={<PageFallback />}>
            <Routes>
              {/* Auth callback from LinkedIn */}
              <Route path="/auth/callback" element={<AuthCallback />} />
              {/* Public login route */}
              <Route path="/login" element={<Login />} />
              {/* Protected routes */}
              <Route 
                path="/*" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Routes>
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/compose" element={<LinkedInPostComposer />} />
                        <Route path="/bulk-generation" element={<BulkGeneration />} />
                        <Route path="/scheduling" element={<Scheduling />} />
                        <Route path="/history" element={<History />} />
                        <Route path="/analytics" element={<LinkedInAnalytics />} />
                        <Route path="/settings" element={<Settings />} />
                      </Routes>
                    </Layout>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </React.Suspense>
        </div>
      </AccountProvider>
    </AuthProvider>
  );
}

export default App;
