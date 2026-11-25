import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './modules/auth/AuthProvider.jsx';
import './styles.css';

const App = lazy(() => import('./app/App.jsx').then((m) => ({ default: m.App })));
const PublicUploadPortal = lazy(() =>
  import('./modules/verification/PublicUploadPortal.jsx').then((m) => ({ default: m.PublicUploadPortal }))
);

const pathname = window.location.pathname;
const isPublicUpload = pathname.startsWith('/upload/') || pathname.startsWith('/u/');
const rawPart = isPublicUpload
  ? (pathname.startsWith('/u/') ? pathname.split('/u/')[1] : pathname.split('/upload/')[1])
  : null;
const uploadToken = rawPart
  ? decodeURIComponent(rawPart.split('?')[0].split('#')[0].trim()).replace(/\/$/, '')
  : null;

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-sans">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        <p className="text-xs font-semibold text-slate-600">Loading admissions workflow…</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={<LoadingFallback />}>
      {isPublicUpload && uploadToken ? (
        <PublicUploadPortal token={uploadToken} />
      ) : (
        <AuthProvider>
          <App />
        </AuthProvider>
      )}
    </Suspense>
  </React.StrictMode>,
);
