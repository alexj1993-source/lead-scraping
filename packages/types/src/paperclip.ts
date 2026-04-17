export type PaperclipActionCategory =
  | 'keyword_optimization'
  | 'alert_triage'
  | 'dlq_processing'
  | 'tier_switch_review'
  | 'reply_analysis'
  | 'daily_digest'
  | 'weekly_strategy'
  | 'session_reauth'
  | 'campaign_health'
  | 'budget_review'
  | 'personalization_ab_test'
  | 'morning_assessment'
  | 'midday_check'
  | 'evening_wrap'
  | 'continuous_monitor'
  | 'remediation'
  | 'scrape_volume_adjustment';

export interface CmoAssessment {
  shouldRun: boolean;
  reasoning: string;
  keywordAdjustments: Array<{ keywordId: string; action: 'increase_weight' | 'decrease_weight' | 'deactivate' }>;
  volumeAdjustment: number;
  alerts: string[];
}

export interface CmoMiddayStatus {
  onTrack: boolean;
  leadsToday: number;
  dailyTarget: number;
  pctComplete: number;
  recommendation: 'continue' | 'increase_volume' | 'decrease_volume' | 'pause';
  reasoning: string;
  queueHealth: Record<string, { waiting: number; active: number; failed: number }>;
}

export interface CmoEveningSummary {
  date: string;
  totalScraped: number;
  totalUploaded: number;
  totalCostUsd: number;
  keywordsDeactivated: string[];
  keywordsPromoted: string[];
  nextDayPlan: string;
}

export interface RemediationPattern {
  id: string;
  name: string;
  detection: string;
  primaryFix: string;
  escalation: string;
  cooldownMs: number;
  maxRetries: number;
}

export interface PaperclipDecision {
  action: string;
  reasoning: string;
  category: PaperclipActionCategory;
  confidence: number;
  requiresHumanApproval: boolean;
}

export interface DailyMetrics {
  leadsScraped: number;
  leadsEnriched: number;
  leadsPassedIcp: number;
  leadsValidated: number;
  leadsUploaded: number;
  leadsReplied: number;
  leadsBooked: number;
  totalCostUsd: number;
  costPerLead: number;
  bySource: Record<string, { scraped: number; uploaded: number; cost: number }>;
}

export interface DailyDigest {
  date: string;
  metrics: DailyMetrics;
  topWins: string[];
  topConcerns: string[];
  autonomousActions: string[];
  recommendations: string[];
  escalations: string[];
}

export interface WeeklyStrategy {
  weekOf: string;
  bookedLeadPatterns: {
    industry: string;
    geogrpahy: string;
    leadMagnetType: string;
    keyword: string;
  }[];
  keywordRecommendations: {
    add: string[];
    remove: string[];
    reasoning: string;
  };
  personalizationInsights: string[];
  budgetRecommendations: string[];
}
