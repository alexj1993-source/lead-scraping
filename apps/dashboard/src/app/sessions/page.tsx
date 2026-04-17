'use client';

import { Badge } from '@/components/ui/badge';
import { Key, RefreshCcw, Shield, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { useSessions } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';

interface Account {
  account: string;
  status: 'active' | 'expiring' | 'failed' | 'cooldown';
  lastReauth: string;
  failureCount: number;
}

interface ServicePool {
  service: string;
  accounts: Account[];
}

const statusConfig: Record<string, { variant: 'green' | 'yellow' | 'red' | 'muted'; label: string }> = {
  active: { variant: 'green', label: 'Active' },
  expiring: { variant: 'yellow', label: 'Expiring' },
  failed: { variant: 'red', label: 'Failed' },
  cooldown: { variant: 'muted', label: 'Cooldown' },
};

export default function SessionsPage() {
  const sessionsQuery = useSessions();
  const services: ServicePool[] = Array.isArray(sessionsQuery.data) ? sessionsQuery.data as ServicePool[] : [];

  if (sessionsQuery.isLoading) return <ApiLoadingState />;
  if (sessionsQuery.isError) return <ApiErrorState onRetry={() => sessionsQuery.refetch()} />;
  if (!services.length) return <ApiEmptyState title="No sessions" description="Session credentials are added when you configure Instagram scraping accounts." />;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Sessions</h1>
        <span className="text-sm text-text-muted">
          {services.reduce((s, svc) => s + svc.accounts.length, 0)} accounts
        </span>
      </div>

      {services.map((svc) => {
        const active = svc.accounts.filter((a) => a.status === 'active').length;
        const total = svc.accounts.length;
        const healthPct = (active / total) * 100;

        return (
          <section key={svc.service} className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
            {/* Service header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-text-muted" />
                <h2 className="text-base font-semibold text-text-primary">{svc.service}</h2>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={clsx(
                    'text-sm font-medium',
                    healthPct >= 60 ? 'text-green' : healthPct >= 40 ? 'text-yellow' : 'text-red'
                  )}
                >
                  {active}/{total} active
                </span>
              </div>
            </div>

            {/* Pool health meter */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-lighter">
              <div
                className={clsx(
                  'h-full rounded-full transition-all duration-500',
                  healthPct >= 60 ? 'bg-green' : healthPct >= 40 ? 'bg-yellow' : 'bg-red'
                )}
                style={{ width: `${healthPct}%` }}
              />
            </div>

            {/* Accounts table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-4 font-medium text-text-secondary">Account</th>
                    <th className="pb-2 pr-4 font-medium text-text-secondary">Status</th>
                    <th className="pb-2 pr-4 font-medium text-text-secondary hidden sm:table-cell">Last Reauth</th>
                    <th className="pb-2 pr-4 font-medium text-text-secondary hidden sm:table-cell">Failures</th>
                    <th className="pb-2 font-medium text-text-secondary text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {svc.accounts.map((acc) => {
                    const sc = statusConfig[acc.status];
                    return (
                      <tr key={acc.account}>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <Key className="h-3.5 w-3.5 text-text-muted" />
                            <span className="font-mono text-xs text-text-primary">{acc.account}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant={sc.variant}>{sc.label}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-text-secondary hidden sm:table-cell">{acc.lastReauth}</td>
                        <td className="py-3 pr-4 hidden sm:table-cell">
                          <span className={clsx(acc.failureCount > 3 ? 'text-red font-medium' : 'text-text-secondary')}>
                            {acc.failureCount}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {(acc.status === 'failed' || acc.status === 'expiring') ? (
                            <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/20 transition-colors min-h-[32px]">
                              <RefreshCcw className="h-3 w-3" />
                              Reauth
                            </button>
                          ) : acc.status === 'cooldown' ? (
                            <span className="flex items-center justify-end gap-1 text-xs text-text-muted">
                              <AlertCircle className="h-3 w-3" /> Cooling down
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">Healthy</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
