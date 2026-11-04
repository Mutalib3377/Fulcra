/**
 * Feature keys checked before a module or channel action runs.
 * The list grows as features are built.
 */
export type FeatureKey =
  | 'storefront'
  | 'agent'
  | 'channel.whatsapp'
  | 'channel.instagram'
  | 'channel.web_widget'
  | 'payments'
  | 'catalog_import'
  | 'owner_alerts';

/**
 * Whether a business may use a feature.
 *
 * Stub: allows everything until plans and entitlements are built in B1. Call it anyway,
 * so every feature is already wired to the check.
 */
export async function canUse(_businessId: string, _featureKey: FeatureKey): Promise<boolean> {
  return true;
}
