'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  Bot,
  Brain,
  ChevronDown,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { usePaperclipActions, usePaperclipRecommendations } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';

interface PaperclipAction {
  id: string;
  action: string;
  reasoning: string;
  timestamp: string;
  status: string;
  [key: string]: unknown;
}

const historyColumns: Column<PaperclipAction>[] = [
  { key: 'action', label: 'Action', sortable: true },
  { key: 'timestamp', label: 'Date', sortable: true, className: 'hidden sm:table-cell' },
  {
    key: 'status',
    label: 'Status',
    render: (row) => (
      <Badge variant={row.status === 'Executed' ? 'green' : 'yellow'}>{row.status}</Badge>
    ),
  },
];

export default function PaperclipPage() {
  const actionsQuery = usePaperclipActions();
  const recsQuery = usePaperclipRecommendations();
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [thinking] = useState(true);

  if (actionsQuery.isLoading || recsQuery.isLoading) return <ApiLoadingState />;
  if (actionsQuery.isError && recsQuery.isError)
    return <ApiErrorState onRetry={() => { actionsQuery.refetch(); recsQuery.refetch(); }} />;

  const actionsData = actionsQuery.data as any;
  const recentActions: { action: string; reasoning: string; timestamp: string }[] = actionsData?.recent ?? [];
  const historyData: PaperclipAction[] = actionsData?.history ?? [];
  const digest = actionsData?.digest;
  const weeklyStrategy = actionsData?.weeklyStrategy;
  const recommendations: { id: string; title: string; reasoning: string; priority: string }[] =
    Array.isArray(recsQuery.data) ? recsQuery.data as any[] : [];

  if (!recentActions.length && !recommendations.length)
    return <div className="p-8 text-center text-gray-400">No data yet</div>;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Bot className="h-5 w-5 text-primary-light" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Auto SDR</h1>
            <p className="text-sm text-text-muted">Autonomous sales development</p>
          </div>
        </div>
        {thinking && (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5">
            <Brain className="h-4 w-4 animate-pulse text-primary-light" />
            <span className="text-xs font-medium text-primary-light">Thinking...</span>
          </div>
        )}
      </div>

      {/* Daily digest */}
      {digest && (
        <section className="rounded-xl border border-primary/20 bg-surface-light p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-primary-light" />
            <h2 className="text-sm font-medium text-text-primary">{digest.title ?? 'Daily Digest'}</h2>
          </div>
          <div className="space-y-3 text-sm text-text-secondary leading-relaxed">
            {digest.sections?.map((section: { heading: string; body: string }, i: number) => (
              <p key={i}>
                <strong className="text-text-primary">{section.heading}:</strong> {section.body}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Activity feed */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Live Activity Feed</h2>
        <div className="space-y-2">
          {recentActions.map((action, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface-light p-4 transition-colors hover:bg-surface-lighter">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-3.5 w-3.5 text-primary-light" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{action.action}</p>
                  <p className="mt-1 text-xs text-text-secondary">{action.reasoning}</p>
                  <p className="mt-1 text-xs text-text-muted">{action.timestamp}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Weekly strategy */}
      {weeklyStrategy && (
        <section>
          <button
            onClick={() => setStrategyOpen(!strategyOpen)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-surface-light px-5 py-4 text-left transition-colors hover:bg-surface-lighter"
          >
            <div>
              <h2 className="text-sm font-medium text-text-primary">{weeklyStrategy.title ?? 'Weekly Strategy Report'}</h2>
              {weeklyStrategy.subtitle && <p className="text-xs text-text-muted">{weeklyStrategy.subtitle}</p>}
            </div>
            <ChevronDown
              className={clsx('h-5 w-5 text-text-muted transition-transform duration-200', strategyOpen && 'rotate-180')}
            />
          </button>
          {strategyOpen && (
            <div className="mt-2 rounded-xl border border-border bg-surface-light p-5 text-sm text-text-secondary leading-relaxed space-y-3">
              {weeklyStrategy.sections?.map((section: { heading: string; body: string }, i: number) => (
                <p key={i}>
                  <strong className="text-text-primary">{section.heading}:</strong> {section.body}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Recommendations */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Outstanding Recommendations</h2>
        <div className="space-y-3">
          {recommendations.map((rec) => (
            <div key={rec.id} className="flex items-start gap-4 rounded-xl border border-border bg-surface-light p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{rec.title}</p>
                  <Badge variant={rec.priority === 'high' ? 'red' : rec.priority === 'medium' ? 'yellow' : 'muted'}>
                    {rec.priority}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{rec.reasoning}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="flex items-center gap-1.5 rounded-lg bg-green/10 px-3 py-1.5 text-xs font-medium text-green transition-colors hover:bg-green/20 min-h-[32px]">
                  <CheckCircle className="h-3.5 w-3.5" /> Approve
                </button>
                <button className="flex items-center gap-1.5 rounded-lg bg-red/10 px-3 py-1.5 text-xs font-medium text-red transition-colors hover:bg-red/20 min-h-[32px]">
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Action history */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Action History</h2>
        <DataTable<PaperclipAction>
          columns={historyColumns}
          data={historyData}
          pageSize={8}
          getRowId={(row) => row.id}
        />
      </section>
    </div>
  );
}
