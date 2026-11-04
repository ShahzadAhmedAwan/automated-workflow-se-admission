import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './modules/auth/AuthProvider.jsx';
import { App } from './app/App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
