export type Source =
  | 'facebook_ads'
  | 'instagram'
  | 'FACEBOOK_ADS'
  | 'INSTAGRAM'
  | 'MANUAL_IMPORT';

export type SourceTier =
  | 'api'
  | 'managed_service'
  | 'in_house_playwright';

export type LeadStatus =
  | 'scraped'
  | 'enriching'
  | 'enriched'
  | 'scoring'
  | 'scored'
  | 'validating'
  | 'validated'
  | 'personalizing'
  | 'personalized'
  | 'uploading'
  | 'uploaded'
  | 'replied'
  | 'booked'
  | 'failed'
  | 'dead_letter';

export type EmailValidationResult =
  | 'valid'
  | 'invalid'
  | 'disposable'
  | 'catchall'
  | 'unknown';

export type ReplyClassification =
  | 'DIRECT_INTEREST'
  | 'INTEREST_OBJECTION'
  | 'NOT_INTERESTED'
  | 'OUT_OF_OFFICE'
  | 'UNSUBSCRIBE'
  | 'AGGRESSIVE'
  | 'NOT_CLASSIFIED';

export type RemediationStatus =
  | 'pending'
  | 'in_progress'
  | 'resolved'
  | 'failed'
  | 'escalated';

export interface LeadInput {
  companyName: string;
  sourceUrl: string;
  source: Source;
  firstName?: string;
  fullName?: string;
  title?: string;
  email?: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  phoneNumber?: string;
  adCreativeId?: string;
  landingPageUrl?: string;
  sourceHandle?: string;
  country?: string;
}

export interface EnrichedLead extends LeadInput {
  email: string;
  alternateEmails?: string[];
  employeeCount?: number;
  enrichmentProvider: string;
  enrichmentConfidence: number;
  enrichedAt: string;
}

export interface ScoredLead extends EnrichedLead {
  icpScore: number;
  icpPass: boolean;
  icpReasoning: string;
}

export interface ValidatedLead extends ScoredLead {
  neverbounceResult: EmailValidationResult;
  bouncebanResult: EmailValidationResult;
  validatedAt: string;
}

export interface Personalization {
  icebreaker: string;
  angle: string;
  subjectLine: string;
  variant: 'A' | 'B' | 'C';
}

export interface PersonalizedLead extends ValidatedLead {
  personalization: Personalization;
}
