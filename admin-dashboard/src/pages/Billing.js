import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { getSubscriptionStatus, getSubscriptionPlans, activateSubscription } from '../services/api';

// Prices come from the server (backend/src/config/pricing.js), in Ghana cedis
const formatGHS = (amount) => `GH₵ ${Number(amount || 0).toLocaleString('en-GH')}`;

export default function Billing() {
  const [subscription, setSubscription] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);

  useEffect(() => {
    fetchStatus();
    getSubscriptionPlans()
      .then(({ data }) => setPricing(data))
      .catch((err) => {
        console.error('Failed to load plans', err?.response?.data || err.message || err);
        toast.error('Failed to load subscription prices');
      });
  }, []);

  const fetchStatus = async () => {
    try {
      const { data } = await getSubscriptionStatus();
      setSubscription(data.subscription || null);
    } catch (err) {
      console.error('Failed to get subscription status', err?.response?.data || err.message || err);
    }
  };

  const ensurePaystackLoaded = () => new Promise((resolve) => {
    if (window.PaystackPop) return resolve();
    const s = document.createElement('script');
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.onload = () => resolve();
    document.body.appendChild(s);
  });

  const handlePay = async (plan) => {
    setLoading(true);
    try {
      await ensurePaystackLoaded();

      const publicKey = process.env.REACT_APP_PAYSTACK_PUBLIC_KEY;
      if (!publicKey) {
        toast.error('Paystack public key not configured (REACT_APP_PAYSTACK_PUBLIC_KEY)');
        setLoading(false);
        return;
      }

      const email = (JSON.parse(localStorage.getItem('user')) || {}).email || '';
      const amountPesewas = (plan.amount * 100).toString();

      const handler = window.PaystackPop.setup({
        key: publicKey,
        email: email || 'billing@institution.local',
        amount: amountPesewas,
        currency: 'GHS',
        channels: ['mobile_money', 'card'],
        onClose: function() {
          setLoading(false);
          toast.info('Payment window closed');
        },
        callback: async function(response) {
          try {
            await activateSubscription({ planId: plan.id, paymentReference: response.reference });
            toast.success('Subscription activated');
            fetchStatus();
          } catch (err) {
            console.error('Failed to activate subscription', err?.response?.data || err.message || err);
            toast.error(err?.response?.data?.error || 'Failed to activate subscription');
          } finally {
            setLoading(false);
          }
        }
      });

      handler.openIframe();
    } catch (err) {
      console.error(err);
      toast.error('Payment initialization failed');
      setLoading(false);
    }
  };

  const monthlyPlan = pricing?.plans.find((p) => p.id === 'monthly');
  const savingFor = (plan) => {
    if (!monthlyPlan || plan.id === 'monthly') return null;
    const full = Math.round((monthlyPlan.amount / 30) * plan.days);
    const saved = full - plan.amount;
    return saved > 0 ? saved : null;
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Billing & Subscription</h1>

      <div style={{ display: 'flex', gap: 20, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260, padding: 20, background: '#fff', borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Current Subscription</h3>
          {subscription ? (
            <div>
              <p><strong>Status:</strong> {subscription.status}</p>
              <p><strong>Plan:</strong> {subscription.planName || 'trial'}</p>
              <p><strong>Days remaining:</strong> {subscription.daysRemaining ?? 'N/A'}</p>
            </div>
          ) : (
            <p>No subscription data (you may be on trial)</p>
          )}
          {pricing && (
            <p style={{ color: '#7f8c8d', fontSize: 13, marginBottom: 0 }}>
              Your price tier: <strong>{pricing.tier.name}</strong> ({pricing.staffCount} active staff
              {pricing.tier.maxStaff ? `, up to ${pricing.tier.maxStaff}` : ''})
            </p>
          )}
        </div>

        <div style={{ width: 380, maxWidth: '100%', padding: 20, background: '#fff', borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Purchase Plan</h3>
          {!pricing && <p style={{ color: '#95a5a6' }}>Loading prices...</p>}
          {pricing?.plans.map((p) => {
            const saved = savingFor(p);
            return (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div style={{ color: '#2c3e50' }}>{formatGHS(p.amount)} <span style={{ color: '#7f8c8d', fontSize: 12 }}>· {p.days} days</span></div>
                  {saved && (
                    <div style={{ color: '#27ae60', fontSize: 12, fontWeight: 600 }}>Save {formatGHS(saved)} vs monthly</div>
                  )}
                </div>
                <div>
                  <button
                    onClick={() => { setSelectedPlan(p); handlePay(p); }}
                    disabled={loading}
                    style={{ padding: '8px 12px', borderRadius: 8, background: '#1a5276', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    {loading && selectedPlan?.id === p.id ? 'Processing...' : 'Pay'}
                  </button>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, fontSize: 12, color: '#95a5a6' }}>
            Pay with MTN MoMo, Telecel Cash, AirtelTigo Money or card. Payments are processed by Paystack;
            your subscription activates as soon as payment is confirmed.
          </div>
        </div>
      </div>
    </div>
  );
}
