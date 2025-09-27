// Environment Variables Debug Component
// Use this component to check if environment variables are loaded correctly
import React from 'react';
const EnvDebug = () => {
  return (
    <div style={{ 
      position: 'fixed', 
      top: '10px', 
      right: '10px', 
      background: 'rgba(0,119,181,0.8)', 
      color: 'white', 
      padding: '10px', 
      fontSize: '12px',
      borderRadius: '5px',
      zIndex: 9999 
    }}>
      <h4>Environment Variables:</h4>
      <p>VITE_API_URL: {import.meta.env.VITE_API_URL}</p>
      <p>VITE_PLATFORM_URL: {import.meta.env.VITE_PLATFORM_URL}</p>
      <p>VITE_NODE_ENV: {import.meta.env.VITE_NODE_ENV}</p>
      <p>Current URL: {window.location.href}</p>
    </div>
  );
};
export default EnvDebug;
