import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import StaffApp from './staff/StaffApp';
import './index.css';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* Staff web check-in has its own sign-in and session, separate from the admin dashboard */}
    {window.location.pathname.startsWith('/staff') ? <StaffApp /> : <App />}
  </React.StrictMode>
);

// In development (localhost), the service worker can cache an older bundle/env
// and cause confusing API base URL behavior. Keep it disabled locally.
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  serviceWorkerRegistration.unregister();
} else {
  serviceWorkerRegistration.register();
}
