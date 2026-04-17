import type { LeadInput, ScoredLead, ValidatedLead, EnrichedLead } from './lead';
import type { ScrapeJobInput } from './source';
import type { RemediationEvent } from './remediation';
import type { ExaSearchInput } from './exa';

export type QueueName =
  | 'scrape-facebook'
  | 'scrape-instagram'
  | 'enrich'
  | 'score'
  | 'dedup'
  | 'validate'
  | 'validate-neverbounce'
  | 'validate-bounceban'
  | 'personalize'
  | 'qa'
  | 'upload'
  | 'reply-sync'
  | 'reply-classify'
  | 'remediate'
  | 'session-health-check'
  | 'session-auto-reauth'
  | 'paperclip-15min'
  | 'paperclip-hourly'
  | 'paperclip-daily'
  | 'paperclip-weekly'
  | 'exa-search'
  | 'keyword-score'
  | 'stats-rollup';

export type QueueJobData =
  | { queue: 'scrape-facebook'; data: ScrapeJobInput }
  | { queue: 'scrape-instagram'; data: ScrapeJobInput }
  | { queue: 'enrich'; data: { leads: LeadInput[] } }
  | { queue: 'score'; data: { leads: EnrichedLead[] } }
  | { queue: 'dedup'; data: { leadIds: string[] } }
  | { queue: 'validate'; data: { leads: ScoredLead[] } }
  | { queue: 'validate-neverbounce'; data: { trigger: string } }
  | { queue: 'validate-bounceban'; data: { leadIds?: string[] } }
  | { queue: 'personalize'; data: { leads: ValidatedLead[] } }
  | { queue: 'qa'; data: { leadId: string } }
  | { queue: 'upload'; data: { leadId: string } }
  | { queue: 'reply-sync'; data: { campaignId: string } }
  | { queue: 'reply-classify'; data: { replyId: string; body: string; leadId: string } }
  | { queue: 'remediate'; data: RemediationEvent }
  | { queue: 'session-health-check'; data: { provider: string } }
  | { queue: 'session-auto-reauth'; data: { provider: string; sessionId: string } }
  | { queue: 'paperclip-15min'; data: Record<string, never> }
  | { queue: 'paperclip-hourly'; data: Record<string, never> }
  | { queue: 'paperclip-daily'; data: Record<string, never> }
  | { queue: 'paperclip-weekly'; data: Record<string, never> }
  | { queue: 'exa-search'; data: ExaSearchInput }
  | { queue: 'keyword-score'; data: { keyword: string; source: string } }
  | { queue: 'stats-rollup'; data: { date: string } };
