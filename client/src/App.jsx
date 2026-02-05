import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { AccountProvider } from "./contexts/AccountContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Layout from "./components/Layout";

// Pages
import Dashboard from "./pages/Dashboard";
import LinkedInPostComposer from "./pages/LinkedInPostComposer";
import BulkGeneration from "./pages/BulkGeneration";
import Scheduling from "./pages/Scheduling";
import History from "./pages/History";
import LinkedInAnalytics from "./pages/LinkedInAnalytics";
import Settings from "./pages/Settings";
import AuthCallback from "./pages/AuthCallback";
// Add Login page (placeholder)
const Login = React.lazy(() => import('./pages/Login'));


function App() {
  return (
    <AuthProvider>
      <AccountProvider>
        <div className="min-h-screen bg-[#f3f6f8]"> {/* LinkedIn blue background tint */}
          <React.Suspense fallback={<div>Loading...</div>}>
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
