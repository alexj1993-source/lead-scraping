export interface BudgetConfig {
  provider: string;
  monthlyCapUsd: number;
  alertAt80Pct: boolean;
  hardStopAt100: boolean;
  autoSwitchTo: string | null;
}

export const DEFAULT_BUDGETS: BudgetConfig[] = [
  { provider: 'apify', monthlyCapUsd: 300, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'inhouse_tier3' },
  { provider: 'phantombuster', monthlyCapUsd: 150, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'apify_li_scraper' },
  { provider: 'apollo', monthlyCapUsd: 500, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'getprospect' },
  { provider: 'lusha', monthlyCapUsd: 300, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'snovio' },
  { provider: 'getprospect', monthlyCapUsd: 200, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'apollo' },
  { provider: 'snovio', monthlyCapUsd: 200, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'getprospect' },
  { provider: 'neverbounce', monthlyCapUsd: 200, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'bounceban' },
  { provider: 'bounceban', monthlyCapUsd: 200, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: 'neverbounce' },
  { provider: 'anthropic', monthlyCapUsd: 400, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: null },
  { provider: 'exa', monthlyCapUsd: 150, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: null },
  { provider: 'brightdata', monthlyCapUsd: 300, alertAt80Pct: true, hardStopAt100: true, autoSwitchTo: null },
];
