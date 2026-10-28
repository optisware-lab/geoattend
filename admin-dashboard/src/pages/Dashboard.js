import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import {
  FiUsers, FiUserCheck, FiClock, FiUserX, FiCalendar, FiAlertCircle, FiCheckCircle, FiUserPlus,
  FiActivity, FiDownload, FiCreditCard, FiChevronRight, FiRefreshCw,
} from 'react-icons/fi';
import {
  getDashboardStats, getWeeklySummary, getLeaveStats, getRealTimeAttendance, getAttendanceRules, getSubscriptionStatus,
} from '../services/api';
import { PageHeader, StatCard, Card, Avatar, Badge, EmptyState, useIsMobile, useNow, useAutoRefresh } from '../components/ui';
import { formatDateLong, formatTime, formatClock, greeting, timeAgo, toDate } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler);

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesOfDay(hhmmss) {
  if (!hhmmss) return null;
  const [h, m] = String(hhmmss).split(':').map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}

function AttentionItem({ tone, icon: Icon, title, text, onClick }) {
  const colors = { red: '#e74c3c', orange: '#f39c12', blue: '#3498db', green: '#27ae60' };
  const c = colors[tone] || colors.blue;
  return (
    <button
      type="button"
      onClick={onClick}
      className="ga-hover"
      style={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 11, background: `${c}0d`, border: `1px solid ${c}33`, marginBottom: 10,
      }}
    >
      <span style={{ width: 34, height: 34, borderRadius: 9, background: `${c}1f`, color: c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={17} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#2c3e50' }}>{title}</span>
        {text && <span style={{ display: 'block', fontSize: 12.5, color: '#7f8c8d', marginTop: 2 }}>{text}</span>}
      </span>
      <FiChevronRight color="#95a5a6" />
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const now = useNow(30000);
  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) || {}; } catch { return {}; } }, []);

  const [stats, setStats] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [leaveStats, setLeaveStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [rules, setRules] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      getDashboardStats(), getWeeklySummary(), getLeaveStats(), getRealTimeAttendance(), getAttendanceRules(), getSubscriptionStatus(),
    ]);
    const [s, w, l, r, ru, sub] = results.map((x) => (x.status === 'fulfilled' ? x.value.data : undefined));
    if (s) setStats(s);
    if (Array.isArray(w)) setWeekly(w);
    if (l) setLeaveStats(l);
    if (Array.isArray(r)) setRecent(r);
    if (ru) setRules(ru);
    if (sub) setSubscription(sub.subscription || null);
    setUpdatedAt(new Date());
    setRefreshing(false);
  }, []);

  useAutoRefresh(load, 60000);

  const total = stats?.totalStaff || 0;
  const present = stats?.presentToday || 0;
  const late = stats?.lateToday || 0;
  const absent = stats?.absentToday || 0;
  const onLeave = Number(leaveStats?.on_leave_today || 0);
  const pendingLeave = Number(leaveStats?.pending || 0);
  const rate = total ? Math.round((present / total) * 100) : 0;
  const stillOut = recent.filter((r) => !r.check_out_time).length;

  // Is today a working day, and has the start time passed?
  const workingDays = Array.isArray(rules?.working_days) ? rules.working_days.map(Number) : [1, 2, 3, 4, 5];
  const isWorkingDay = workingDays.includes(now.getDay()); // same numbering as the server (0 = Sunday)
  const startMin = minutesOfDay(rules?.work_start_time);
  const lateMin = startMin != null ? startMin + Number(rules?.late_threshold_minutes || 0) : null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const pastStart = lateMin != null && nowMin >= lateMin;
  const notInYet = Math.max(0, absent - onLeave);

  const attention = [];
  if (pendingLeave > 0) {
    attention.push({ tone: 'orange', icon: FiCalendar, title: `${pendingLeave} leave request${pendingLeave > 1 ? 's' : ''} waiting`, text: 'Approve or reject in one click', to: '/leave' });
  }
  if (isWorkingDay && pastStart && notInYet > 0) {
    attention.push({ tone: 'red', icon: FiUserX, title: `${notInYet} staff not checked in yet`, text: `Work started at ${formatClock(rules?.work_start_time)}`, to: '/attendance?view=missing' });
  }
  if (late > 0) {
    attention.push({ tone: 'orange', icon: FiClock, title: `${late} arrived late today`, text: 'See who and what time', to: '/attendance?view=late' });
  }
  if (subscription && subscription.daysRemaining != null && subscription.daysRemaining <= 7) {
    attention.push({
      tone: subscription.daysRemaining <= 2 ? 'red' : 'orange', icon: FiCreditCard,
      title: subscription.status === 'trialing' ? `Free trial ends in ${subscription.daysRemaining} day(s)` : `Plan renews in ${subscription.daysRemaining} day(s)`,
      text: 'Renew to keep check-ins working', to: '/billing',
    });
  }
  if (subscription && subscription.status === 'past_due') {
    attention.push({ tone: 'red', icon: FiCreditCard, title: 'Payment overdue', text: 'Staff check-ins may be blocked', to: '/billing' });
  }

  const lineData = {
    labels: weekly.map((w) => {
      const d = toDate(w.date);
      return d ? `${DAYS_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '';
    }),
    datasets: [
      { label: 'Present', data: weekly.map((w) => parseInt(w.present, 10)), borderColor: '#27ae60', backgroundColor: 'rgba(39, 174, 96, 0.10)', fill: true, tension: 0.35, pointRadius: 4 },
      { label: 'Late', data: weekly.map((w) => parseInt(w.late, 10)), borderColor: '#f39c12', backgroundColor: 'rgba(243, 156, 18, 0.08)', fill: true, tension: 0.35, pointRadius: 4 },
    ],
  };

  const doughnutData = {
    labels: ['On time', 'Late', 'Not in'],
    datasets: [{ data: [Math.max(0, present - late), late, absent], backgroundColor: ['#27ae60', '#f39c12', '#e74c3c'], borderWidth: 0 }],
  };

  const firstLoad = stats === null;

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        title={`${greeting(now)}${user.firstName ? `, ${user.firstName}` : ''}`}
        subtitle={(
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {formatDateLong(now)}
            <span style={{ color: '#cfd6dd' }}>|</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="ga-live-dot" /> Live · updated {updatedAt ? timeAgo(updatedAt) : '...'}
            </span>
          </span>
        )}
        actions={(
          <>
            <button type="button" className="ga-btn" onClick={load} disabled={refreshing}>
              <FiRefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh
            </button>
            <button type="button" className="ga-btn ga-btn-primary" onClick={() => navigate('/staff/new')}>
              <FiUserPlus size={14} /> Add staff
            </button>
          </>
        )}
      />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard label="Total staff" value={firstLoad ? '–' : total} hint="Active accounts" icon={FiUsers} color="#3498db" onClick={() => navigate('/staff')} />
        <StatCard label="Present" value={firstLoad ? '–' : present} hint={`${rate}% of staff · ${stillOut} still on site`} icon={FiUserCheck} color="#27ae60" onClick={() => navigate('/attendance')} />
        <StatCard label="Late" value={firstLoad ? '–' : late} hint={rules?.work_start_time ? `After ${formatClock(rules.work_start_time)} + ${rules.late_threshold_minutes || 0} min` : 'Arrived after start time'} icon={FiClock} color="#f39c12" onClick={() => navigate('/attendance?view=late')} />
        <StatCard label="Not in" value={firstLoad ? '–' : absent} hint={onLeave ? `incl. ${onLeave} on approved leave` : 'No check-in today'} icon={FiUserX} color="#e74c3c" onClick={() => navigate('/attendance?view=missing')} />
      </div>

      <div className="ga-card" style={{ padding: '16px 20px', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#2c3e50' }}>Today's attendance rate</span>
          <span style={{ fontSize: 13, color: '#7f8c8d' }}>
            <strong style={{ fontSize: 20, color: rate >= 80 ? '#27ae60' : rate >= 60 ? '#f39c12' : '#e74c3c' }}>{rate}%</strong> · {present} of {total} checked in
          </span>
        </div>
        <div className="ga-progress" style={{ height: 10 }}>
          <div style={{ width: `${rate}%`, background: rate >= 80 ? '#27ae60' : rate >= 60 ? '#f39c12' : '#e74c3c' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 18, marginBottom: 18 }}>
        <Card title="Needs your attention" icon={FiAlertCircle}>
          {attention.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderRadius: 11, background: '#e8f6ee', color: '#1e8449' }}>
              <FiCheckCircle size={22} />
              <div>
                <div style={{ fontWeight: 700 }}>All clear</div>
                <div style={{ fontSize: 12.5, opacity: 0.85 }}>No pending leave, late arrivals or billing issues right now.</div>
              </div>
            </div>
          ) : attention.map((a) => (
            <AttentionItem key={a.title} {...a} onClick={() => navigate(a.to)} />
          ))}

          <div style={{ fontSize: 12, fontWeight: 700, color: '#95a5a6', textTransform: 'uppercase', letterSpacing: 0.4, margin: '16px 0 10px' }}>Quick actions</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <button type="button" className="ga-btn" onClick={() => navigate('/attendance')}><FiActivity size={14} /> Live attendance</button>
            <button type="button" className="ga-btn" onClick={() => navigate('/reports?period=today')}><FiDownload size={14} /> Today's report</button>
            <button type="button" className="ga-btn" onClick={() => navigate('/leave')}><FiCalendar size={14} /> Leave requests</button>
            <button type="button" className="ga-btn" onClick={() => navigate('/staff')}><FiUsers size={14} /> Manage staff</button>
          </div>
        </Card>

        <Card
          title="Latest check-ins"
          icon={FiActivity}
          action={<button type="button" className="ga-btn ga-btn-sm" onClick={() => navigate('/attendance')}>See all</button>}
        >
          {recent.length === 0 ? (
            <EmptyState icon={FiClock} title="No check-ins yet today" text={rules?.work_start_time ? `Work starts at ${formatClock(rules.work_start_time)}` : undefined} />
          ) : (
            <div>
              {recent.slice(0, 6).map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #f2f4f6' }}>
                  <Avatar first={r.first_name} last={r.last_name} photo={r.profile_photo_url} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.first_name} {r.last_name}</div>
                    <div style={{ fontSize: 12, color: '#95a5a6' }}>
                      In {formatTime(r.check_in_time)}{r.check_out_time ? ` · Out ${formatTime(r.check_out_time)}` : ''}{r.department ? ` · ${r.department}` : ''}
                    </div>
                  </div>
                  {r.is_late ? <Badge tone="orange">Late</Badge> : r.check_out_time ? <Badge tone="gray">Left</Badge> : <Badge tone="green">On site</Badge>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <Card title="Last 7 days">
          {weekly.length === 0 ? (
            <EmptyState icon={FiActivity} title="No attendance in the last 7 days" />
          ) : (
            <Line
              data={lineData}
              options={{ responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }}
            />
          )}
        </Card>
        <Card title="Today at a glance">
          {total === 0 ? (
            <EmptyState icon={FiUsers} title="No staff yet" action={<button type="button" className="ga-btn ga-btn-primary" onClick={() => navigate('/staff/new')}>Add your first staff member</button>} />
          ) : (
            <Doughnut data={doughnutData} options={{ responsive: true, cutout: '64%', plugins: { legend: { position: 'bottom' } } }} />
          )}
        </Card>
      </div>
    </div>
  );
}
