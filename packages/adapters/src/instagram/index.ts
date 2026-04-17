import { prisma } from '@hyperscale/database';
import type { BaseAdapter } from '../base';
import { InstagramTier2Adapter } from './tier2';
import { InstagramTier3Adapter } from './tier3';

export { InstagramTier2Adapter } from './tier2';
export { InstagramTier3Adapter } from './tier3';
export {
  qualifyProfile,
  validateBioLink,
  extractCompanyName,
  type RawInstagramProfile,
  type IGQualificationResult,
} from './qualify';

export async function getActiveInstagramAdapter(): Promise<BaseAdapter> {
  const config = await prisma.sourceConfig.findUnique({
    where: { source: 'INSTAGRAM' },
  });

  switch (config?.activeTier) {
    case 'TIER_3_INHOUSE':
      return new InstagramTier3Adapter();
    case 'TIER_2_MANAGED':
    default:
      return new InstagramTier2Adapter();
  }
}
