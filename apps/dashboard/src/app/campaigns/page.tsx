'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Send, ChevronDown, Power } from 'lucide-react';
import clsx from 'clsx';
import { useCampaigns } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';

interface Campaign {
  id: string;
  name: string;
  active: boolean;
  dailyCap: number;
  todaySends: number;
  replyRate: number;
  bookingRate: number;
  sequences: { step: number; subject: string; delay: string }[];
}

export default function CampaignsPage() {
  const campaignsQuery = useCampaigns();
  const campaigns: Campaign[] = Array.isArray(campaignsQuery.data) ? campaignsQuery.data as Campaign[] : [];
  const [toggleState, setToggleState] = useState<Record<string, boolean>>({});
  const [expandedSeq, setExpandedSeq] = useState<Set<string>>(new Set());

  const initialized = Object.keys(toggleState).length > 0;
  if (!initialized && campaigns.length > 0) {
    const initial = Object.fromEntries(campaigns.map((c) => [c.id, c.active]));
    setToggleState(initial);
  }

  function toggleCampaign(id: string) {
    setToggleState((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleSequence(id: string) {
    setExpandedSeq((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (campaignsQuery.isLoading) return <ApiLoadingState />;
  if (campaignsQuery.isError) return <ApiErrorState onRetry={() => campaignsQuery.refetch()} />;
  if (!campaigns.length) return <ApiEmptyState title="No campaigns yet" description="Campaigns are created when you configure sources and run the pipeline." />;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Campaigns</h1>
        <span className="text-sm text-text-muted">
          {Object.values(toggleState).filter(Boolean).length} active
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {campaigns.map((campaign) => {
          const active = toggleState[campaign.id] ?? campaign.active;
          const sendPercent = (campaign.todaySends / campaign.dailyCap) * 100;
          const seqOpen = expandedSeq.has(campaign.id);

          return (
            <div
              key={campaign.id}
              className={clsx(
                'rounded-xl border bg-surface-light p-5 space-y-4 transition-all duration-200',
                active ? 'border-border' : 'border-border opacity-60'
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Send className="h-5 w-5 text-text-muted" />
                  <div>
                    <span className="font-medium text-text-primary">{campaign.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant={active ? 'green' : 'muted'}>{active ? 'Active' : 'Paused'}</Badge>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => toggleCampaign(campaign.id)}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px]',
                    active
                      ? 'bg-green/10 text-green hover:bg-green/20'
                      : 'bg-surface-lighter text-text-muted hover:bg-surface-lighter/80'
                  )}
                >
                  <Power className="h-3.5 w-3.5" />
                  {active ? 'On' : 'Off'}
                </button>
              </div>

              {/* Progress */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-text-muted">Today&apos;s sends</span>
                  <span className="font-medium text-text-primary">
                    {campaign.todaySends} / {campaign.dailyCap}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-lighter">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.min(100, sendPercent)}%` }}
                  />
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-lg font-bold text-text-primary">{campaign.replyRate}%</p>
                  <p className="text-xs text-text-muted">Reply rate</p>
                </div>
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-lg font-bold text-text-primary">{campaign.bookingRate}%</p>
                  <p className="text-xs text-text-muted">Booking rate</p>
                </div>
              </div>

              {/* Sequence preview */}
              <button
                onClick={() => toggleSequence(campaign.id)}
                className="flex w-full items-center justify-between text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                <span>Sequence ({campaign.sequences.length} steps)</span>
                <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', seqOpen && 'rotate-180')} />
              </button>
              {seqOpen && (
                <div className="space-y-2">
                  {campaign.sequences.map((seq) => (
                    <div key={seq.step} className="flex items-center gap-3 rounded-lg bg-surface p-3 text-xs">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-light font-medium">
                        {seq.step}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-text-primary truncate">{seq.subject}</p>
                        <p className="text-text-muted">{seq.delay}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
