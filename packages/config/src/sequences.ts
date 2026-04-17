import facebookAds from '../sequences/facebook-ads.json';
import instagram from '../sequences/instagram.json';

export interface SequenceStep {
  step: number;
  delay_days: number;
  subject: string;
  body: string;
}

const templates: Record<string, SequenceStep[]> = {
  FACEBOOK_ADS: facebookAds as SequenceStep[],
  facebook_ads: facebookAds as SequenceStep[],
  INSTAGRAM: instagram as SequenceStep[],
  instagram: instagram as SequenceStep[],
};

export function getSequenceTemplate(source: string): SequenceStep[] | null {
  return templates[source] ?? null;
}
