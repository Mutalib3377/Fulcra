/**
 * Feature checks (rule 6). Moved to `billing/` in B1, where plans and trials live; kept here
 * so existing imports keep working.
 */
export { canUse, featureAccess } from '../billing/entitlements';
export type { FeatureKey } from '../billing/rules';
