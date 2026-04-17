'use client';

import { TrafficLight } from '@/components/ui/traffic-light';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  Play,
  Pause,
  ListChecks,
  Bot,
  BarChart3,
} from 'lucide-react';
import { useHealth, useDailyStats, useAlerts } from '@/lib/hooks';
import { AlertCard } from '@/components/ui/alert-card';
import { useRouter } from 'next/navigation';

export default function HealthPage() {
  const health = useHealth();
  const stats = useDailyStats();
  const alertsQuery = useAlerts();
  const router = useRouter();

  const isLoading = health.isLoading || stats.isLoading;
  const allErrored = health.isError && stats.isError;

  const h = health.data as any;
  const s = stats.data as any;
  const alerts = Array.isArray(alertsQuery.data) ? (alertsQuery.data as any[]) : [];

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <p className="text-sm text-text-muted">Loading dashboard...</p>
    </div>
  );

  if (allErrored) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="rounded-full bg-yellow-500/10 p-4">
        <Play className="h-8 w-8 text-yellow-400" />
      </div>
      <h2 className="text-lg font-semibold text-text-primary">Backend API not connected</h2>
      <p className="max-w-md text-center text-sm text-text-muted">
        Make sure Docker is running (for Postgres + Redis), then start the API server.
      </p>
      <button
        onClick={() => { health.refetch(); stats.refetch(); alertsQuery.refetch(); }}
        className="mt-2 rounded-lg border border-border bg-surface-light px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-lighter transition-colors"
      >
        Retry Connection
      </button>
    </div>
  );

  const indicators = h ? [
    h.pipeline && { ...h.pipeline, label: h.pipeline.label ?? 'Pipeline' },
    h.budget && { ...h.budget, label: h.budget.label ?? 'Budget' },
    h.deliverability && { ...h.deliverability, label: h.deliverability.label ?? 'Sources' },
    h.paperclip && { ...h.paperclip, label: h.paperclip.label ?? 'Auto SDR' },
  ].filter(Boolean) : (h?.indicators ?? []);

  const todayNumbers = s ?? h?.todayNumbers ?? {};
  const fb = todayNumbers.facebook ?? { uploaded: 0, target: 300 };
  const ig = todayNumbers.instagram ?? { uploaded: 0, target: 200 };
  const total = todayNumbers.total ?? { uploaded: 0, target: 500 };

  return (
    <div className="space-y-8 pb-20 md:pb-6">
      {/* System Health */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">System Health</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {indicators.map((ind: any) => (
            <TrafficLight
              key={ind.label}
              status={ind.status}
              label={ind.label}
              detail={ind.detail}
              onClick={ind.link ? () => router.push(ind.link) : undefined}
            />
          ))}
        </div>
      </section>

      {/* Today's Pipeline */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Today&apos;s Pipeline</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PipelineCard
            label="Facebook Ads"
            value={fb.uploaded}
            target={fb.target}
          />
          <PipelineCard
            label="Instagram"
            value={ig.uploaded}
            target={ig.target}
          />
          <StatCard
            label="Total Uploaded"
            value={total.uploaded}
            subtitle={`of ${total.target} target`}
            icon={<BarChart3 className="h-5 w-5" />}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Total Cost" value={`$${(todayNumbers.costUsd ?? 0).toFixed(2)}`} />
          <MiniStat label="Cost/Lead" value={`$${(todayNumbers.costPerLead ?? 0).toFixed(2)}`} />
          <MiniStat label="Replies Today" value={String(todayNumbers.repliesToday ?? 0)} />
          <MiniStat label="Booked Today" value={String(todayNumbers.bookedToday ?? 0)} />
        </div>
      </section>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Active Alerts</h2>
          <div className="space-y-3">
            {alerts.map((alert: any, i: number) => (
              <AlertCard key={i} {...alert} onAction={() => {}} onDismiss={() => {}} />
            ))}
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Import CSV', icon: Upload },
            { label: 'Run Pipeline', icon: Play },
            { label: 'Pause All', icon: Pause },
            { label: 'Auto SDR Queue', icon: ListChecks },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-light px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-lighter hover:text-text-primary"
              >
                <Icon className="h-4 w-4" />
                {action.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PipelineCard({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? (value / target) * 100 : 0;
  return (
    <div className="rounded-xl border border-border bg-surface-light p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary">{label}</span>
        <Badge variant={pct >= 100 ? 'green' : pct > 0 ? 'yellow' : 'muted'}>
          {Math.round(pct)}%
        </Badge>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums">
        {value}
        <span className="text-lg text-text-muted"> / {target}</span>
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-lighter">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-light p-3">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
