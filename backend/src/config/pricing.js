// GeoAttend price list (Ghana cedis). The server is the source of truth: the
// dashboard shows these prices and payment verification checks against them.
//
// Tier is picked by the institution's active staff count. A term is billed as
// ~4 months at 3.5x the monthly price; a year is 10x the monthly price.

const CURRENCY = 'GHS';

const PERIODS = {
  monthly: { id: 'monthly', name: 'Monthly', days: 30 },
  termly: { id: 'termly', name: 'Per Term', days: 120 },
  yearly: { id: 'yearly', name: 'Yearly', days: 365 },
};

const TIERS = [
  { id: 'starter', name: 'Starter', maxStaff: 12, prices: { monthly: 100, termly: 350, yearly: 1000 } },
  { id: 'standard', name: 'Standard', maxStaff: 40, prices: { monthly: 200, termly: 700, yearly: 2000 } },
  { id: 'growth', name: 'Growth', maxStaff: 100, prices: { monthly: 400, termly: 1400, yearly: 4000 } },
];

// Above the largest tier: priced per active staff member
const ENTERPRISE_PER_STAFF_MONTHLY = 4;

function getTier(staffCount) {
  const count = Math.max(0, parseInt(staffCount, 10) || 0);
  const tier = TIERS.find((t) => count <= t.maxStaff);
  if (tier) return tier;

  const monthly = ENTERPRISE_PER_STAFF_MONTHLY * count;
  return {
    id: 'enterprise',
    name: 'Enterprise',
    maxStaff: null,
    prices: { monthly, termly: Math.round(monthly * 3.5), yearly: monthly * 10 },
  };
}

/** Plans an institution with `staffCount` active staff can buy, in GHS. */
function getPlansForStaffCount(staffCount) {
  const tier = getTier(staffCount);
  return {
    currency: CURRENCY,
    tier: { id: tier.id, name: tier.name, maxStaff: tier.maxStaff },
    plans: Object.values(PERIODS).map((p) => ({
      id: p.id,
      name: p.name,
      days: p.days,
      amount: tier.prices[p.id],
      monthlyEquivalent: Math.round((tier.prices[p.id] / p.days) * 30),
    })),
  };
}

function getPlan(staffCount, periodId) {
  return getPlansForStaffCount(staffCount).plans.find((p) => p.id === periodId) || null;
}

module.exports = { CURRENCY, PERIODS, TIERS, ENTERPRISE_PER_STAFF_MONTHLY, getTier, getPlansForStaffCount, getPlan };
