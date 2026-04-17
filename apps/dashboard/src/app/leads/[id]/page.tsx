'use client';

import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Timeline, type TimelineEvent } from '@/components/ui/timeline';
import {
  ArrowLeft,
  Globe,
  Mail,
  Building2,
  User,
  RefreshCcw,
  ShieldCheck,
  Upload,
  Trash2,
} from 'lucide-react';
import { useLead } from '@/lib/hooks';
import { ApiErrorState, ApiLoadingState } from '@/components/ui/api-state';

export default function LeadDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const leadQuery = useLead(id as string);

  if (leadQuery.isLoading) return <ApiLoadingState />;
  if (leadQuery.isError) return <ApiErrorState onRetry={() => leadQuery.refetch()} />;

  const lead = leadQuery.data as any;
  if (!lead) return <div className="p-8 text-center text-gray-400">No data yet</div>;

  const timeline: TimelineEvent[] = lead.timeline ?? [];
  const enrichment: { source: string; data: string }[] = lead.enrichment ?? [];
  const replyThread: { from: string; body: string; timestamp: string; sentiment?: string }[] = lead.replyThread ?? [];

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-light hover:text-text-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold">Lead #{id}</h1>
          <p className="text-sm text-text-muted">Full record and event timeline</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Lead card */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
                <Building2 className="h-6 w-6 text-primary-light" />
              </div>
              <div>
                <p className="font-semibold text-text-primary">{lead.company ?? 'Unknown'}</p>
                <p className="text-sm text-text-secondary">{lead.industry ?? ''}{lead.employeeCount ? ` · ${lead.employeeCount} employees` : ''}</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-text-secondary">
                <User className="h-4 w-4 text-text-muted" />
                {lead.contact ?? 'Unknown'}{lead.title ? ` · ${lead.title}` : ''}
              </div>
              <div className="flex items-center gap-2 text-text-secondary">
                <Mail className="h-4 w-4 text-text-muted" />
                {lead.email ?? '—'}
              </div>
              {lead.website && (
                <div className="flex items-center gap-2 text-text-secondary">
                  <Globe className="h-4 w-4 text-text-muted" />
                  {lead.website}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {lead.score != null && <Badge variant="green">Score: {lead.score}</Badge>}
              {lead.status && <Badge variant="primary">{lead.status}</Badge>}
              {lead.source && <Badge>{lead.source}</Badge>}
            </div>
          </div>

          {/* Enrichment trail */}
          {enrichment.length > 0 && (
            <div className="rounded-xl border border-border bg-surface-light p-5">
              <h3 className="mb-3 text-sm font-medium text-text-secondary">Enrichment Trail</h3>
              <div className="space-y-2 text-xs">
                {enrichment.map((item) => (
                  <div key={item.source} className="flex justify-between rounded-lg bg-surface p-2.5">
                    <span className="font-medium text-text-primary">{item.source}</span>
                    <span className="text-text-muted">{item.data}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Personalization preview */}
          {lead.personalization && (
            <div className="rounded-xl border border-border bg-surface-light p-5">
              <h3 className="mb-3 text-sm font-medium text-text-secondary">Personalization Preview</h3>
              <div className="rounded-lg bg-surface p-3 text-sm">
                <p className="font-medium text-text-primary">{lead.personalization.subject}</p>
                <p className="mt-2 text-text-secondary leading-relaxed">
                  {lead.personalization.body}
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Re-score', icon: RefreshCcw },
              { label: 'Re-validate', icon: ShieldCheck },
              { label: 'Force Upload', icon: Upload },
              { label: 'Mark Junk', icon: Trash2 },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-light px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-lighter min-h-[36px]"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Timeline */}
        <div className="lg:col-span-2">
          {timeline.length > 0 && (
            <div className="rounded-xl border border-border bg-surface-light p-5">
              <h3 className="mb-5 text-sm font-medium text-text-secondary">Event Timeline</h3>
              <Timeline events={timeline} />
            </div>
          )}

          {/* Reply thread */}
          {replyThread.length > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-surface-light p-5">
              <h3 className="mb-4 text-sm font-medium text-text-secondary">Reply Thread</h3>
              <div className="space-y-4">
                {replyThread.map((msg, i) => (
                  <div
                    key={i}
                    className={`rounded-lg p-4 ${
                      msg.sentiment === 'positive'
                        ? 'bg-green/5 border border-green/10'
                        : 'bg-primary/5 border border-primary/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${msg.sentiment === 'positive' ? 'text-green' : 'text-primary-light'}`}>
                          {msg.from}
                        </span>
                        {msg.sentiment === 'positive' && <Badge variant="green">Positive</Badge>}
                      </div>
                      <span className="text-xs text-text-muted">{msg.timestamp}</span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{msg.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
