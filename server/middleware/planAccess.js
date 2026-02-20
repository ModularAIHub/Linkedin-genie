import { pool } from '../config/database.js';

const PRO_ELIGIBLE_PLANS = new Set(['pro', 'enterprise']);
const PLAN_ALIASES = new Map([
  ['premium', 'pro'],
  ['business', 'pro'],
]);
const PLAN_LOOKUP_CACHE_TTL_MS = Number(process.env.PLAN_LOOKUP_CACHE_TTL_MS || 15 * 1000);
const planLookupCache = new Map();

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
    const nestedPlan = extractPlanCandidate(value?.[key], visited);
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

export const hasProPlanAccess = (planType) =>
  PRO_ELIGIBLE_PLANS.has(normalizePlanType(planType));

export const getRequestPlanType = (req) =>
  getUserPlanType(req?.user);

const getPlanCacheKey = (userId, teamId) => `${userId || 'unknown'}:${teamId || 'personal'}`;

const getCachedPlanType = (cacheKey) => {
  const cached = planLookupCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    planLookupCache.delete(cacheKey);
    return null;
  }
  return cached.planType;
};

const setCachedPlanType = (cacheKey, planType) => {
  planLookupCache.set(cacheKey, {
    planType,
    expiresAt: Date.now() + PLAN_LOOKUP_CACHE_TTL_MS,
  });
};

const resolveTeamPlanType = async (userId, teamId) => {
  if (!userId || !teamId) return null;

  const result = await pool.query(
    `SELECT t.plan_type
       FROM teams t
       LEFT JOIN team_members tm
         ON tm.team_id = t.id
        AND tm.user_id = $2
        AND tm.status = 'active'
      WHERE t.id = $1
        AND (t.owner_id = $2 OR tm.user_id IS NOT NULL)
      LIMIT 1`,
    [teamId, userId]
  );

  return result.rows[0]?.plan_type || null;
};

const resolveUserPlanType = async (userId) => {
  if (!userId) return null;

  const result = await pool.query(
    'SELECT plan_type FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );

  return result.rows[0]?.plan_type || null;
};

export const resolveRequestPlanType = async (req) => {
  const directPlanType = getRequestPlanType(req);
  const userId = req?.user?.id || req?.user?.userId || null;
  const teamId = req?.headers?.['x-team-id'] || req?.user?.teamId || req?.user?.team_id || null;
  const cacheKey = getPlanCacheKey(userId, teamId);
  const cachedPlanType = getCachedPlanType(cacheKey);

  if (cachedPlanType) {
    return cachedPlanType;
  }

  let dbPlanType = null;

  if (userId) {
    try {
      dbPlanType = teamId
        ? await resolveTeamPlanType(userId, teamId)
        : null;

      if (!dbPlanType) {
        dbPlanType = await resolveUserPlanType(userId);
      }
    } catch (error) {
      // Fall back to token/platform payload plan when DB lookup fails.
      dbPlanType = null;
    }
  }

  const resolvedPlanType = normalizePlanType(dbPlanType || directPlanType || 'free');
  setCachedPlanType(cacheKey, resolvedPlanType);
  return resolvedPlanType;
};

export const requireProPlan =
  (featureName = 'This feature') =>
  async (req, res, next) => {
    const planType = await resolveRequestPlanType(req);

    if (hasProPlanAccess(planType)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: 'PRO_PLAN_REQUIRED',
      error: `${featureName} is available on Pro and above only. Upgrade your plan to continue.`,
      requiredPlan: 'pro',
      planType,
    });
  };
