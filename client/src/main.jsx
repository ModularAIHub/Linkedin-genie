
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Honeybadger, HoneybadgerErrorBoundary } from '@honeybadger-io/react';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import './index.css';

const honeybadger = Honeybadger.configure({
  apiKey: 'hbp_A8vjKimYh8OnyV8J3djwKrpqc4OniI3a4MJg', // Replace with your real key
  environment: 'production'
});


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HoneybadgerErrorBoundary honeybadger={honeybadger}>
      <BrowserRouter>
        <ScrollToTop />
        <App />
        <Toaster 
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
            success: {
              style: {
                background: '#10b981',
              },
            },
            error: {
              style: {
                background: '#ef4444',
              },
            },
          }}
        />
      </BrowserRouter>
    </HoneybadgerErrorBoundary>
  </React.StrictMode>,
);
