import type { EnrichedLead } from './lead';

export type EnrichmentProvider =
  | 'apollo'
  | 'getprospect'
  | 'lusha'
  | 'snovio'
  | 'exa';

export interface EnrichmentResult {
  email?: string;
  alternateEmails?: string[];
  firstName?: string;
  fullName?: string;
  title?: string;
  linkedinUrl?: string;
  phoneNumber?: string;
  employeeCount?: number;
  provider: EnrichmentProvider;
  confidence: number;
}

export interface EnrichmentWaterfallResult {
  lead: EnrichedLead;
  providersUsed: EnrichmentProvider[];
  exaUsed: boolean;
  cost: number;
}
