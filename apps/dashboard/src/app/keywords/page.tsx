'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Bot, CheckCircle, XCircle, Tag, Power } from 'lucide-react';
import clsx from 'clsx';
import { useKeywords } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';

interface Keyword {
  id: string;
  keyword: string;
  source: string;
  score: number;
  totalYield: number;
  icpPassRate: number;
  bookingYield: number;
  enabled: boolean;
  [key: string]: unknown;
}

export default function KeywordsPage() {
  const keywordsQuery = useKeywords();
  const keywordsData = keywordsQuery.data as any;
  const keywords: Keyword[] = keywordsData?.keywords ?? (Array.isArray(keywordsData) ? keywordsData : []);
  const proposedKeywords: { keyword: string; source: string; estimatedYield: number; reasoning: string }[] = keywordsData?.proposed ?? [];

  const [keywordState, setKeywordState] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Keyword[]>([]);

  const initialized = Object.keys(keywordState).length > 0;
  if (!initialized && keywords.length > 0) {
    setKeywordState(Object.fromEntries(keywords.map((k) => [k.id, k.enabled])));
  }

  function toggleKeyword(id: string) {
    setKeywordState((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const columns: Column<Keyword>[] = [
    {
      key: 'keyword',
      label: 'Keyword',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-medium">{row.keyword}</span>
        </div>
      ),
    },
    { key: 'source', label: 'Source', sortable: true, className: 'hidden sm:table-cell' },
    {
      key: 'score',
      label: 'Score',
      sortable: true,
      render: (row) => (
        <span className={clsx('font-medium', row.score >= 80 ? 'text-green' : row.score >= 60 ? 'text-yellow' : 'text-red')}>
          {row.score}
        </span>
      ),
    },
    { key: 'totalYield', label: 'Yield', sortable: true, className: 'hidden md:table-cell' },
    {
      key: 'icpPassRate',
      label: 'ICP %',
      sortable: true,
      className: 'hidden lg:table-cell',
      render: (row) => <span>{row.icpPassRate}%</span>,
    },
    {
      key: 'bookingYield',
      label: 'Booking %',
      sortable: true,
      className: 'hidden lg:table-cell',
      render: (row) => (
        <span className={clsx('font-medium', row.bookingYield >= 3 ? 'text-green' : row.bookingYield >= 1.5 ? 'text-yellow' : 'text-red')}>
          {row.bookingYield}%
        </span>
      ),
    },
    {
      key: 'enabled',
      label: 'Status',
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); toggleKeyword(row.id); }}
          className={clsx(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors min-h-[28px]',
            (keywordState[row.id] ?? row.enabled)
              ? 'bg-green/15 text-green hover:bg-green/25'
              : 'bg-surface-lighter text-text-muted hover:bg-surface-lighter/80'
          )}
        >
          <Power className="h-3 w-3" />
          {(keywordState[row.id] ?? row.enabled) ? 'On' : 'Off'}
        </button>
      ),
    },
  ];

  if (keywordsQuery.isLoading) return <ApiLoadingState />;
  if (keywordsQuery.isError) return <ApiErrorState onRetry={() => keywordsQuery.refetch()} />;
  if (!keywords.length && !proposedKeywords.length) return <ApiEmptyState title="No keywords yet" description="Add keywords in Sources to start scraping." />;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Keywords</h1>
        <span className="text-sm text-text-muted">
          {Object.values(keywordState).filter(Boolean).length} active
        </span>
      </div>

      {/* Paperclip's proposed keywords */}
      {proposedKeywords.length > 0 && (
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary-light" />
            <span className="text-sm font-medium text-primary-light">Auto SDR Suggestions</span>
          </div>
          {proposedKeywords.map((pk, i) => (
            <div key={i} className="flex items-center justify-between gap-4 rounded-lg bg-surface-light p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{pk.keyword}</span>
                  <Badge variant="primary">{pk.source}</Badge>
                  <span className="text-xs text-text-muted">~{pk.estimatedYield} leads/week</span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{pk.reasoning}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="flex items-center gap-1 rounded-lg bg-green/10 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/20 min-h-[32px]">
                  <CheckCircle className="h-3.5 w-3.5" /> Approve
                </button>
                <button className="flex items-center gap-1 rounded-lg bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/20 min-h-[32px]">
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Bulk actions */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-primary-light">{selected.length} selected</span>
          <button className="rounded-lg bg-green/10 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/20 min-h-[32px]">
            Enable All
          </button>
          <button className="rounded-lg bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/20 min-h-[32px]">
            Disable All
          </button>
        </div>
      )}

      <DataTable<Keyword>
        columns={columns}
        data={[...keywords].sort((a, b) => b.score - a.score)}
        pageSize={10}
        selectable
        onSelectionChange={setSelected}
        getRowId={(row) => row.id}
      />
    </div>
  );
}
