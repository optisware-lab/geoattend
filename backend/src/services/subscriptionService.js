const pool = require('../config/database');

const DEFAULT_TRIAL_DAYS = parseInt(process.env.TRIAL_DURATION_DAYS || '28', 10);

function normalizeInstitutionCode(code) {
  return String(code || '').trim().toUpperCase();
}

async function getInstitutionByCode(institutionCode, db = pool) {
  const normalized = normalizeInstitutionCode(institutionCode);
  if (!normalized) return null;

  const result = await db.query(
    'SELECT id, name, institution_code FROM institutions WHERE institution_code = $1',
    [normalized]
  );
  return result.rows[0] || null;
}

async function ensureTrialSubscription(institutionId, client = pool) {
  const existing = await client.query(
    `SELECT id, status, trial_start, trial_end, current_period_end
     FROM subscriptions
     WHERE institution_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [institutionId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const created = await client.query(
    `INSERT INTO subscriptions (institution_id, plan_name, status, trial_start, trial_end)
     VALUES ($1, 'trial', 'trialing', NOW(), NOW() + ($2 || ' days')::INTERVAL)
     RETURNING id, plan_name, status, trial_start, trial_end, current_period_end`,
    [institutionId, String(DEFAULT_TRIAL_DAYS)]
  );
  return created.rows[0];
}

async function getCurrentSubscription(institutionId, db = pool) {
  const result = await db.query(
    `SELECT id, plan_name, status, trial_start, trial_end, current_period_end, payment_reference, created_at, updated_at
     FROM subscriptions
     WHERE institution_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [institutionId]
  );
  return result.rows[0] || null;
}

function buildSubscriptionSnapshot(subscription) {
  if (!subscription) return null;

  const now = Date.now();
  const trialEndMs = subscription.trial_end ? new Date(subscription.trial_end).getTime() : null;
  const periodEndMs = subscription.current_period_end ? new Date(subscription.current_period_end).getTime() : null;

  let daysRemaining = null;
  if (subscription.status === 'trialing' && trialEndMs) {
    daysRemaining = Math.max(0, Math.ceil((trialEndMs - now) / (24 * 60 * 60 * 1000)));
  } else if (subscription.status === 'active' && periodEndMs) {
    daysRemaining = Math.max(0, Math.ceil((periodEndMs - now) / (24 * 60 * 60 * 1000)));
  }

  return {
    id: subscription.id,
    planName: subscription.plan_name,
    status: subscription.status,
    trialStart: subscription.trial_start,
    trialEnd: subscription.trial_end,
    currentPeriodEnd: subscription.current_period_end,
    paymentReference: subscription.payment_reference,
    daysRemaining,
  };
}

module.exports = {
  DEFAULT_TRIAL_DAYS,
  normalizeInstitutionCode,
  getInstitutionByCode,
  ensureTrialSubscription,
  getCurrentSubscription,
  buildSubscriptionSnapshot,
};
