export const AUTHORITY_MATRIX = {
  'retry_failed_job': { level: 'autonomous', requiresConfirmation: false },
  'requeue_dlq_items': { level: 'autonomous', requiresConfirmation: false },
  'enable_disable_keyword': { level: 'autonomous', requiresConfirmation: false },
  'acknowledge_non_critical_alert': { level: 'autonomous', requiresConfirmation: false },
  'switch_source_tier': { level: 'autonomous_with_confirmation', confirmationWindowHours: 24 },
  'increase_provider_budget': { level: 'recommend_only', requiresHumanApproval: true },
  'pause_campaign': { level: 'autonomous_pause_only', canResume: false },
  'reauthenticate_session': { level: 'autonomous', requiresConfirmation: false },
  'respond_to_positive_reply': { level: 'never', draftsOnly: true },
  'modify_personalization_prompts': { level: 'autonomous_ab_test', canPromoteWinners: true },
  'change_icp_criteria': { level: 'recommend_only', requiresHumanApproval: true },
  'disable_provider_permanently': { level: 'recommend_only', requiresHumanApproval: true },

  // CMO autonomous operations
  'adjust_keyword_weights': { level: 'autonomous', requiresConfirmation: false },
  'deactivate_low_yield_keyword': { level: 'autonomous', requiresConfirmation: false, minLeadsBeforeAction: 100, minYieldThreshold: 0.05 },
  'rotate_inbox': { level: 'autonomous', requiresConfirmation: false },
  'pause_pipeline_on_budget': { level: 'autonomous', requiresConfirmation: false },
  'adjust_scrape_volume': { level: 'autonomous', requiresConfirmation: false, maxAdjustmentPct: 20 },
  'retry_failed_jobs': { level: 'autonomous', requiresConfirmation: false, maxRetries: 3 },
  'scale_queue_concurrency': { level: 'autonomous', requiresConfirmation: false },
  'pause_degraded_source': { level: 'autonomous', requiresConfirmation: false },
  'switch_llm_model': { level: 'autonomous', requiresConfirmation: false },

  // Requires human approval
  'add_new_keyword': { level: 'recommend_only', requiresHumanApproval: true },
  'remove_keyword': { level: 'recommend_only', requiresHumanApproval: true },
  'change_daily_target': { level: 'recommend_only', requiresHumanApproval: true },
  'pause_entire_pipeline': { level: 'recommend_only', requiresHumanApproval: true },
  'burn_domain': { level: 'never', requiresHumanApproval: true },
  'change_api_keys': { level: 'never', requiresHumanApproval: true },
} as const;

export type AuthorityAction = keyof typeof AUTHORITY_MATRIX;

type AuthorityLevel = (typeof AUTHORITY_MATRIX)[AuthorityAction]['level'];

const AUTONOMOUS_LEVELS: Set<string> = new Set([
  'autonomous',
  'autonomous_with_confirmation',
  'autonomous_pause_only',
  'autonomous_ab_test',
]);

export function canActAutonomously(action: AuthorityAction): boolean {
  return AUTONOMOUS_LEVELS.has(AUTHORITY_MATRIX[action].level);
}

export function requiresConfirmation(action: AuthorityAction): boolean {
  const rule = AUTHORITY_MATRIX[action];
  return 'confirmationWindowHours' in rule;
}

export function requiresHumanApproval(action: AuthorityAction): boolean {
  const rule = AUTHORITY_MATRIX[action];
  return 'requiresHumanApproval' in rule && (rule as any).requiresHumanApproval === true;
}

export function getMaxAdjustmentPct(): number {
  return (AUTHORITY_MATRIX.adjust_scrape_volume as any).maxAdjustmentPct ?? 20;
}

export function getMaxRetries(): number {
  return (AUTHORITY_MATRIX.retry_failed_jobs as any).maxRetries ?? 3;
}
