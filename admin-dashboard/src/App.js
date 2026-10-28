import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import StaffManagement from './pages/StaffManagement';
import StaffForm from './pages/StaffForm';
import AttendanceMonitor from './pages/AttendanceMonitor';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import LeaveManagement from './pages/LeaveManagement';
import RequestLeave from './pages/RequestLeave';
import CreateInstitution from './pages/CreateInstitution';
import Institutions from './pages/Institutions';
import Analytics from './pages/Analytics';
import AuditLog from './pages/AuditLog';
import Payroll from './pages/Payroll';
import Sidebar from './components/Sidebar';
import { useIsMobile } from './components/ui';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      setUser(JSON.parse(stored));
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  // Only declare mainStyle ONCE
  const mainStyle = useMemo(() => ({
    flex: 1,
    padding: isMobile ? '64px 14px 20px' : '28px 32px',
    marginLeft: isMobile ? 0 : '250px',
    minHeight: '100vh',
    width: isMobile ? '100%' : undefined,
    overflowX: 'auto',
    overflowY: 'auto',
    boxSizing: 'border-box',
  }), [isMobile]);

  if (loading) return null;

  if (!user) {
    return (
      <>
        <Router>
          <Routes>
            <Route path="/login" element={<Login onLogin={handleLogin} />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </Router>
        <ToastContainer position="top-right" autoClose={3000} />
      </>
    );
  }

  // Super admin: show separate dashboard
  if (user.role && user.role.toLowerCase() === 'super_admin') {
    return (
      <Router>
        <Routes>
          <Route path="/*" element={<SuperAdminDashboard onLogout={handleLogout} />}>
            <Route path="institutions" element={<Institutions />} />
            <Route path="institutions/new" element={<CreateInstitution />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="*" element={<Navigate to="/institutions" />} />
          </Route>
        </Routes>
        <ToastContainer position="top-right" autoClose={3000} />
      </Router>
    );
  }

  

  // Only non-super_admins see the sidebar and regular dashboard
  return (
    <Router>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar user={user} onLogout={handleLogout} />
        <main style={mainStyle}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/staff" element={<StaffManagement />} />
            <Route path="/staff/new" element={<StaffForm />} />
            <Route path="/staff/:id/edit" element={<StaffForm />} />
            <Route path="/attendance" element={<AttendanceMonitor />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/leave" element={<LeaveManagement />} />
            <Route path="/request-leave" element={<RequestLeave />} />
            <Route path="/institutions/new" element={<CreateInstitution />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      <ToastContainer position="top-right" autoClose={3000} />
    </Router>
  );
}

export default App;
