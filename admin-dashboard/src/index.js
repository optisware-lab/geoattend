import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import StaffApp from './staff/StaffApp';
import './index.css';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// /staff is the staff sign-in page. The admin's Staff pages live at
// /manage-staff; old admin links (/staff/new, /staff/<id>/edit) move there.
const oldAdminStaffPath = window.location.pathname.match(/^\/staff\/(new|[^/]+\/edit)\/?$/);
if (oldAdminStaffPath) {
  window.location.replace(`/manage-staff/${oldAdminStaffPath[1]}${window.location.search}`);
} else {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      {/* Staff web sign-in has its own login and session, separate from the admin dashboard */}
      {window.location.pathname.startsWith('/staff') ? <StaffApp /> : <App />}
    </React.StrictMode>
  );
}

// In development (localhost), the service worker can cache an older bundle/env
// and cause confusing API base URL behavior. Keep it disabled locally.
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  serviceWorkerRegistration.unregister();
} else {
  serviceWorkerRegistration.register();
}
