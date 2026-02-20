const PRO_ELIGIBLE_PLANS = new Set(['pro', 'enterprise']);
const PLAN_ALIASES = new Map([
  ['premium', 'pro'],
  ['business', 'pro'],
]);

const PLAN_KEYS = [
  'plan_type',
  'planType',
  'plan',
  'subscription_plan',
  'subscriptionPlan',
  'subscription_tier',
  'subscriptionTier',
  'tier',
];

const NESTED_KEYS = ['user', 'profile', 'account', 'subscription', 'billing'];

const extractPlanCandidate = (value, visited = new Set()) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  if (visited.has(value)) {
    return null;
  }
  visited.add(value);

  for (const key of PLAN_KEYS) {
    const candidate = value?.[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  for (const key of NESTED_KEYS) {
    const nested = value?.[key];
    const nestedPlan = extractPlanCandidate(nested, visited);
    if (nestedPlan) {
      return nestedPlan;
    }
  }

  return null;
};

export const normalizePlanType = (planType) =>
  PLAN_ALIASES.get(String(planType || 'free').trim().toLowerCase()) ||
  String(planType || 'free').trim().toLowerCase();

export const getUserPlanType = (user) =>
  normalizePlanType(extractPlanCandidate(user) || 'free');

export const hasProPlanAccess = (user) =>
  PRO_ELIGIBLE_PLANS.has(getUserPlanType(user));
