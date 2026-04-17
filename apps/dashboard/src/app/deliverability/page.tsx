'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { ApiErrorState } from '@/components/ui/api-state';
import {
  useDeliverabilityOverview,
  useDeliverabilityDomains,
  useDeliverabilityInboxes,
  useDeliverabilityCapacity,
} from '@/lib/hooks';
import { apiFetch } from '@/lib/api';
import clsx from 'clsx';
import {
  Shield,
  Globe,
  Mail,
  Clock,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Flame,
  Loader2,
  AlertTriangle,
  Server,
} from 'lucide-react';

type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'BLACKLISTED' | 'BURNED';
type InboxStatus = 'WARMING' | 'STANDBY' | 'ACTIVE' | 'ROTATED_OUT' | 'BURNED';

const statusOrder: Record<HealthStatus, number> = {
  BURNED: 0,
  BLACKLISTED: 1,
  DEGRADED: 2,
  HEALTHY: 3,
};

const domainStatusBadge: Record<HealthStatus, { variant: 'green' | 'yellow' | 'red' | 'muted'; label: string }> = {
  HEALTHY: { variant: 'green', label: 'Healthy' },
  DEGRADED: { variant: 'yellow', label: 'Degraded' },
  BLACKLISTED: { variant: 'red', label: 'Blacklisted' },
  BURNED: { variant: 'muted', label: 'Burned' },
};

const inboxStatusBadge: Record<InboxStatus, { variant: 'green' | 'yellow' | 'red' | 'muted' | 'primary'; label: string }> = {
  ACTIVE: { variant: 'green', label: 'Active' },
  STANDBY: { variant: 'primary', label: 'Standby' },
  WARMING: { variant: 'yellow', label: 'Warming' },
  ROTATED_OUT: { variant: 'muted', label: 'Rotated Out' },
  BURNED: { variant: 'red', label: 'Burned' },
};

function DnsIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="h-4 w-4 text-green" />
  ) : (
    <X className="h-4 w-4 text-red" />
  );
}

function OverallHealthIndicator({ overview }: { overview: any }) {
  const { domains } = overview;
  let status: 'green' | 'yellow' | 'red' = 'green';
  if (domains.degraded > 0) status = 'yellow';
  if (domains.blacklisted > 0 || domains.burned > 0) status = 'red';

  const colors = {
    green: 'bg-green ring-green/30',
    yellow: 'bg-yellow ring-yellow/30',
    red: 'bg-red ring-red/30',
  };

  const labels = {
    green: 'All Systems Healthy',
    yellow: 'Some Issues Detected',
    red: 'Critical Issues',
  };

  return (
    <div className="flex items-center gap-3">
      <span className="relative flex h-3.5 w-3.5 shrink-0">
        {status === 'red' && (
          <span className="absolute inset-0 animate-ping rounded-full bg-red/50" />
        )}
        <span className={clsx('relative inline-flex h-3.5 w-3.5 rounded-full ring-4', colors[status])} />
      </span>
      <span className="text-sm font-medium text-text-secondary">{labels[status]}</span>
    </div>
  );
}

function CapacityBar({ capacity }: { capacity: { totalDaily: number; utilized: number; available: number } }) {
  const pct = capacity.totalDaily > 0 ? (capacity.utilized / capacity.totalDaily) * 100 : 0;
  const barColor = pct >= 90 ? 'bg-red' : pct >= 70 ? 'bg-yellow' : 'bg-green';

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-lighter">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', barColor)}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 text-sm font-medium text-text-secondary">
        {capacity.utilized} / {capacity.totalDaily} daily
      </span>
    </div>
  );
}

function InboxRow({ inbox }: { inbox: any }) {
  const badge = inboxStatusBadge[inbox.status as InboxStatus] ?? { variant: 'muted' as const, label: inbox.status };
  const warmupPct = inbox.warmupCap > 0
    ? Math.min(100, Math.round((inbox.warmupEmailsSent / (inbox.warmupCap * 10)) * 100))
    : 0;

  const rotateMutation = useMutation({
    mutationFn: () => apiFetch(`/api/deliverability/inboxes/${inbox.id}/rotate-out`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Manual rotation from dashboard' }),
    }),
  });

  const burnMutation = useMutation({
    mutationFn: () => apiFetch(`/api/deliverability/inboxes/${inbox.id}/rotate-out`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Marked as burned from dashboard' }),
    }),
  });

  return (
    <tr className="border-t border-border/50 bg-surface/50 transition-colors hover:bg-surface-lighter/30">
      <td className="px-4 py-3 pl-12">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-sm">{inbox.email}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-text-secondary hidden md:table-cell">
        {inbox.campaignId ? inbox.campaignId.slice(0, 8) + '...' : '—'}
      </td>
      <td className="px-4 py-3 text-sm text-text-secondary hidden md:table-cell">{inbox.dailyCampaignLimit}</td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-lighter">
            <div
              className={clsx('h-full rounded-full transition-all', warmupPct >= 95 ? 'bg-green' : warmupPct >= 50 ? 'bg-yellow' : 'bg-primary')}
              style={{ width: `${warmupPct}%` }}
            />
          </div>
          <span className="text-xs text-text-muted">{warmupPct}%</span>
        </div>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary">
        {inbox.domain?.provider ?? '—'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {inbox.status === 'ACTIVE' && (
            <button
              onClick={() => rotateMutation.mutate()}
              disabled={rotateMutation.isPending}
              className="flex items-center gap-1 rounded-md bg-surface-lighter px-2 py-1 text-xs text-text-secondary hover:bg-yellow/10 hover:text-yellow transition-colors"
              title="Rotate out"
            >
              {rotateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            </button>
          )}
          {inbox.status !== 'BURNED' && (
            <button
              onClick={() => burnMutation.mutate()}
              disabled={burnMutation.isPending}
              className="flex items-center gap-1 rounded-md bg-surface-lighter px-2 py-1 text-xs text-text-secondary hover:bg-red/10 hover:text-red transition-colors"
              title="Mark burned"
            >
              {burnMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flame className="h-3 w-3" />}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function DomainRow({ domain, inboxes }: { domain: any; inboxes: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const status = domain.healthStatus as HealthStatus;
  const badge = domainStatusBadge[status] ?? { variant: 'muted' as const, label: status };
  const domainInboxes = inboxes.filter((i) => i.domainId === domain.id);

  return (
    <>
      <tr
        className="cursor-pointer border-b border-border transition-colors hover:bg-surface-lighter"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-text-muted" />
            )}
            <Globe className="h-4 w-4 text-text-muted" />
            <span className="font-medium">{domain.domain}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </td>
        <td className="px-4 py-3 hidden md:table-cell"><DnsIcon ok={domain.dkimOk} /></td>
        <td className="px-4 py-3 hidden md:table-cell"><DnsIcon ok={domain.spfOk} /></td>
        <td className="px-4 py-3 hidden md:table-cell"><DnsIcon ok={domain.dmarcOk} /></td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            {domain.blacklistTempCount > 0 && (
              <span className="text-yellow">{domain.blacklistTempCount} temp</span>
            )}
            {domain.blacklistPermCount > 0 && (
              <span className="text-red">{domain.blacklistPermCount} perm</span>
            )}
            {domain.blacklistTempCount === 0 && domain.blacklistPermCount === 0 && (
              <span className="text-green">Clean</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <Badge variant={domain.reputation === 'HIGH' ? 'green' : domain.reputation === 'MEDIUM' ? 'yellow' : domain.reputation === 'LOW' ? 'red' : 'muted'}>
            {domain.reputation ?? 'Unknown'}
          </Badge>
        </td>
        <td className="px-4 py-3 text-sm text-text-secondary hidden md:table-cell">
          {domain._count?.inboxes ?? domainInboxes.length}
        </td>
        <td className="px-4 py-3 text-xs text-text-muted hidden lg:table-cell">
          {domain.lastDnsCheck ? new Date(domain.lastDnsCheck).toLocaleDateString() : 'Never'}
        </td>
      </tr>
      {expanded && domainInboxes.length > 0 && (
        <tr>
          <td colSpan={9} className="p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-surface/80">
                  <th className="px-4 py-2 pl-12 font-medium text-text-muted text-xs">Email</th>
                  <th className="px-4 py-2 font-medium text-text-muted text-xs">Status</th>
                  <th className="px-4 py-2 font-medium text-text-muted text-xs hidden md:table-cell">Campaign</th>
                  <th className="px-4 py-2 font-medium text-text-muted text-xs hidden md:table-cell">Daily Limit</th>
                  <th className="px-4 py-2 font-medium text-text-muted text-xs hidden lg:table-cell">Warmup</th>
                  <th className="px-4 py-2 font-medium text-text-muted text-xs hidden lg:table-cell">Provider</th>
                  <th className="px-4 py-2 font-medium text-text-muted text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {domainInboxes.map((inbox) => (
                  <InboxRow key={inbox.id} inbox={inbox} />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
      {expanded && domainInboxes.length === 0 && (
        <tr>
          <td colSpan={9} className="px-4 py-6 pl-12 text-center text-sm text-text-muted">
            No inboxes configured for this domain
          </td>
        </tr>
      )}
    </>
  );
}

export default function DeliverabilityPage() {
  const overviewQuery = useDeliverabilityOverview();
  const domainsQuery = useDeliverabilityDomains();
  const inboxesQuery = useDeliverabilityInboxes();
  const capacityQuery = useDeliverabilityCapacity();

  if (overviewQuery.isLoading || domainsQuery.isLoading || inboxesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (overviewQuery.isError || domainsQuery.isError || inboxesQuery.isError) {
    return <ApiErrorState onRetry={() => { overviewQuery.refetch(); domainsQuery.refetch(); inboxesQuery.refetch(); }} />;
  }

  const overview = overviewQuery.data as any;
  const domains = (domainsQuery.data as any[]) ?? [];
  const inboxes = (inboxesQuery.data as any[]) ?? [];
  const capacity = (capacityQuery.data as any) ?? { totalDaily: 0, utilized: 0, available: 0 };

  const sortedDomains = [...domains].sort(
    (a, b) => (statusOrder[a.healthStatus as HealthStatus] ?? 3) - (statusOrder[b.healthStatus as HealthStatus] ?? 3),
  );

  const dkimPass = domains.filter((d: any) => d.dkimOk).length;
  const spfPass = domains.filter((d: any) => d.spfOk).length;
  const dmarcPass = domains.filter((d: any) => d.dmarcOk).length;
  const dnsFullPass = domains.filter((d: any) => d.dkimOk && d.spfOk && d.dmarcOk).length;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-text-muted" />
          <div>
            <h1 className="text-xl font-bold">Deliverability Health</h1>
            <OverallHealthIndicator overview={overview} />
          </div>
        </div>
      </div>

      {/* Capacity bar */}
      <div className="rounded-xl border border-border bg-surface-light p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary">
          <Server className="h-4 w-4" />
          <span>Send Capacity</span>
        </div>
        <CapacityBar capacity={capacity} />
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Domains"
          value={`${overview?.domains?.healthy ?? 0} / ${overview?.domains?.total ?? 0}`}
          subtitle={
            [
              overview?.domains?.degraded > 0 && `${overview.domains.degraded} degraded`,
              overview?.domains?.blacklisted > 0 && `${overview.domains.blacklisted} blacklisted`,
            ]
              .filter(Boolean)
              .join(', ') || 'All healthy'
          }
          icon={<Globe className="h-5 w-5" />}
        />
        <StatCard
          label="Inboxes"
          value={`${overview?.inboxes?.active ?? 0} / ${overview?.inboxes?.total ?? 0}`}
          subtitle={
            [
              overview?.inboxes?.standby > 0 && `${overview.inboxes.standby} standby`,
              overview?.inboxes?.warming > 0 && `${overview.inboxes.warming} warming`,
              overview?.inboxes?.burned > 0 && `${overview.inboxes.burned} burned`,
            ]
              .filter(Boolean)
              .join(', ') || 'All active'
          }
          icon={<Mail className="h-5 w-5" />}
        />
        <StatCard
          label="DNS Compliance"
          value={`${dnsFullPass} / ${domains.length}`}
          subtitle={`DKIM ${dkimPass} · SPF ${spfPass} · DMARC ${dmarcPass}`}
          icon={<Shield className="h-5 w-5" />}
        />
        <StatCard
          label="Avg Domain Age"
          value={`${overview?.domains?.averageAgeDays ?? 0}d`}
          subtitle="Average across all domains"
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* Domain table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-light">
                <th className="px-4 py-3 font-medium text-text-secondary">Domain</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Status</th>
                <th className="px-4 py-3 font-medium text-text-secondary hidden md:table-cell">DKIM</th>
                <th className="px-4 py-3 font-medium text-text-secondary hidden md:table-cell">SPF</th>
                <th className="px-4 py-3 font-medium text-text-secondary hidden md:table-cell">DMARC</th>
                <th className="px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">Blacklists</th>
                <th className="px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">Reputation</th>
                <th className="px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Inboxes</th>
                <th className="px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">Last Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedDomains.map((domain) => (
                <DomainRow key={domain.id} domain={domain} inboxes={inboxes} />
              ))}
              {sortedDomains.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-text-muted">
                    No domains configured yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
