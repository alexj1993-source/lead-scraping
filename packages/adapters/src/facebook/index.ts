import { prisma } from '@hyperscale/database';
import type { BaseAdapter } from '../base';
import { FacebookTier1Adapter } from './tier1';
import { FacebookTier2Adapter } from './tier2';
import { FacebookTier3Adapter } from './tier3';

export { FacebookTier1Adapter } from './tier1';
export { FacebookTier2Adapter } from './tier2';
export { FacebookTier3Adapter } from './tier3';
export { qualifyAd, type RawFacebookAd, type QualificationResult } from './qualify';

export async function getActiveFacebookAdapter(): Promise<BaseAdapter> {
  const config = await prisma.sourceConfig.findUnique({
    where: { source: 'FACEBOOK_ADS' },
  });

  switch (config?.activeTier) {
    case 'TIER_1_API':
      return new FacebookTier1Adapter();
    case 'TIER_3_INHOUSE':
      return new FacebookTier3Adapter();
    case 'TIER_2_MANAGED':
    default:
      return new FacebookTier2Adapter();
  }
}
