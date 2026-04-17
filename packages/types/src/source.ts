import type { Source, SourceTier, LeadInput } from './lead';

export interface ScrapeJobInput {
  keyword: string;
  country?: string;
  maxResults?: number;
}

export interface SourceHealthResult {
  healthy: boolean;
  tier: SourceTier;
  errorRate: number;
  leadsPerRun: number;
  message?: string;
}

export interface TierSwitchDecision {
  shouldSwitch: boolean;
  fromTier: SourceTier;
  toTier: SourceTier;
  reason: string;
}

export interface SourceAdapter {
  source: Source;
  scrape(job: ScrapeJobInput): Promise<LeadInput[]>;
  healthCheck(): Promise<SourceHealthResult>;
}
