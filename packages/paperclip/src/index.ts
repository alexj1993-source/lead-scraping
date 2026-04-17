export { PaperclipClient, type WeeklyStrategyInput } from './client';
export {
  AUTHORITY_MATRIX,
  type AuthorityAction,
  canActAutonomously,
  requiresConfirmation,
  requiresHumanApproval,
  getMaxAdjustmentPct,
  getMaxRetries,
} from './authority';
export {
  logAction,
  getRecentActions,
  getActionsByCategory,
  addHumanFeedback,
  rollbackAction,
} from './actions';
export {
  run15MinCycle,
  runHourlyCycle,
  runDailyCycle,
  runWeeklyCycle,
  morningAssessment,
  middayCheck,
  eveningWrap,
  continuousMonitor,
} from './cycles';
export {
  postToChannel,
  formatDailyDigest,
  formatWeeklyStrategy,
  formatEscalation,
  formatHotLead,
  type SlackMessage,
  type SlackBlock,
} from './slack';
export {
  PAPERCLIP_SYSTEM_PROMPT,
  DAILY_DIGEST_PROMPT,
  WEEKLY_STRATEGY_PROMPT,
  ALERT_TRIAGE_PROMPT,
  DLQ_REVIEW_PROMPT,
  TIER_SWITCH_PROMPT,
} from './prompts';
