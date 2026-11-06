import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './modules/auth/AuthProvider.jsx';
import { App } from './app/App.jsx';
import { PublicUploadPortal } from './modules/verification/PublicUploadPortal.jsx';
import './styles.css';

const pathname = window.location.pathname;
const isPublicUpload = pathname.startsWith('/upload/');
const rawPart = isPublicUpload ? pathname.split('/upload/')[1] : null;
const uploadToken = rawPart
  ? decodeURIComponent(rawPart.split('?')[0].split('#')[0].trim()).replace(/\/$/, '')
  : null;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isPublicUpload && uploadToken ? (
      <PublicUploadPortal token={uploadToken} />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </React.StrictMode>,
);
