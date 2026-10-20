const {
  ensureTrialSubscription,
  getCurrentSubscription,
  buildSubscriptionSnapshot,
} = require('../services/subscriptionService');

async function requireActiveSubscription(req, res, next) {
  try {
    if (!req.user || !req.user.institution_id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role === 'super_admin') {
      return next();
    }

    const db = req.tenantDb;

    await ensureTrialSubscription(req.user.institution_id, db);
    const subscription = await getCurrentSubscription(req.user.institution_id, db);
    const now = new Date();

    if (!subscription) {
      return res.status(402).json({
        error: 'Subscription required',
        code: 'SUBSCRIPTION_REQUIRED',
        subscription: null,
      });
    }

    let allowed = false;
    if (subscription.status === 'trialing') {
      allowed = subscription.trial_end && new Date(subscription.trial_end) >= now;
    } else if (subscription.status === 'active') {
      allowed = !subscription.current_period_end || new Date(subscription.current_period_end) >= now;
    }

    if (allowed) {
      req.subscription = buildSubscriptionSnapshot(subscription);
      return next();
    }

    await db.query(
      `UPDATE subscriptions
       SET status = 'past_due', updated_at = NOW()
       WHERE id = $1 AND status IN ('trialing', 'active')`,
      [subscription.id]
    );

    return res.status(402).json({
      error: 'Subscription required',
      code: 'SUBSCRIPTION_REQUIRED',
      subscription: buildSubscriptionSnapshot({ ...subscription, status: 'past_due' }),
    });
  } catch (err) {
    console.error('Subscription middleware error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { requireActiveSubscription };
