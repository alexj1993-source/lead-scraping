'use client';

import { Badge } from '@/components/ui/badge';
import { DollarSign, Clock, TrendingDown } from 'lucide-react';
import clsx from 'clsx';
import { useBudgets } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';

interface ApiBudget {
  id: string;
  provider: string;
  monthlyCapUsd: number;
  alertAt80Pct: boolean;
  hardStopAt100: boolean;
  currentUsageUsd: number;
  monthResetAt: string;
  autoSwitchTo: string | null;
}

interface BudgetProvider {
  name: string;
  used: number;
  cap: number;
  remaining: number;
  daysUntilReset: number;
}

function getBudgetColor(percent: number): string {
  if (percent > 95) return 'red';
  if (percent > 80) return 'yellow';
  return 'green';
}

function formatProviderName(raw: string): string {
  const names: Record<string, string> = {
    anthropic: 'Anthropic (Claude)',
    apify: 'Apify',
    bounceban: 'BounceBan',
    exa: 'Exa',
    instantly: 'Instantly',
    neverbounce: 'NeverBounce',
    openai: 'OpenAI',
    phantombuster: 'PhantomBuster',
    scrapeowl: 'ScrapeOwl',
  };
  return names[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

function transformBudget(b: ApiBudget): BudgetProvider {
  const daysUntilReset = Math.max(0, Math.ceil((new Date(b.monthResetAt).getTime() - Date.now()) / 86400000));
  return {
    name: formatProviderName(b.provider),
    used: Math.round(b.currentUsageUsd * 100) / 100,
    cap: b.monthlyCapUsd,
    remaining: Math.round((b.monthlyCapUsd - b.currentUsageUsd) * 100) / 100,
    daysUntilReset,
  };
}

export default function BudgetsPage() {
  const budgetsQuery = useBudgets();

  if (budgetsQuery.isLoading) return <ApiLoadingState />;
  if (budgetsQuery.isError) return <ApiErrorState onRetry={() => budgetsQuery.refetch()} />;

  const raw = budgetsQuery.data;
  let providers: BudgetProvider[] = [];

  if (Array.isArray(raw)) {
    providers = (raw as ApiBudget[]).map(transformBudget);
  } else if (raw && typeof raw === 'object' && 'providers' in (raw as object)) {
    providers = (raw as { providers: BudgetProvider[] }).providers;
  }

  if (!providers.length) return <ApiEmptyState title="No budget data yet" description="Budget tracking starts when the pipeline begins using API services." />;

  const totalUsed = providers.reduce((s, p) => s + p.used, 0);
  const totalCap = providers.reduce((s, p) => s + p.cap, 0);
  const overallPercent = totalCap > 0 ? (totalUsed / totalCap) * 100 : 0;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Budgets</h1>
        <div className="text-right">
          <p className="text-xs text-text-muted">Total spend</p>
          <p className="text-lg font-bold tabular-nums">
            ${totalUsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-sm text-text-muted"> / ${totalCap.toLocaleString()}</span>
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-light p-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-text-muted">Overall budget utilization</span>
          <span className={clsx('font-medium', `text-${getBudgetColor(overallPercent)}`)}>
            {Math.round(overallPercent)}%
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-lighter">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', `bg-${getBudgetColor(overallPercent)}`)}
            style={{ width: `${Math.min(100, overallPercent)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const percent = provider.cap > 0 ? (provider.used / provider.cap) * 100 : 0;
          const color = getBudgetColor(percent);

          return (
            <div
              key={provider.name}
              className={clsx(
                'rounded-xl border bg-surface-light p-5 space-y-4 transition-colors duration-200',
                color === 'red' ? 'border-red/30' : color === 'yellow' ? 'border-yellow/30' : 'border-border'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-text-muted" />
                  <span className="font-medium text-text-primary">{provider.name}</span>
                </div>
                <Badge variant={color === 'red' ? 'red' : color === 'yellow' ? 'yellow' : 'green'}>
                  {Math.round(percent)}%
                </Badge>
              </div>

              <div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-lighter">
                  <div
                    className={clsx('h-full rounded-full transition-all duration-500', `bg-${color}`)}
                    style={{ width: `${Math.min(100, percent)}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-text-secondary tabular-nums">
                    ${provider.used.toFixed(2)} used
                  </span>
                  <span className="text-text-muted tabular-nums">
                    ${provider.cap} cap
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface p-2.5">
                  <span className="text-text-muted">Remaining</span>
                  <p className={clsx('mt-0.5 font-semibold tabular-nums', `text-${color}`)}>
                    ${provider.remaining.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-2.5">
                  <span className="text-text-muted">Reset in</span>
                  <p className="mt-0.5 font-semibold text-text-primary flex items-center gap-1 tabular-nums">
                    <Clock className="h-3 w-3" /> {provider.daysUntilReset}d
                  </p>
                </div>
              </div>

              {color === 'red' && (
                <div className="flex items-center gap-2 rounded-lg bg-red/10 p-2.5 text-xs text-red">
                  <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                  <span>Budget nearly exhausted</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
