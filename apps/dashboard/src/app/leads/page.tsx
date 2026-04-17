'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, X } from 'lucide-react';
import clsx from 'clsx';
import { useLeads } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';

interface Lead {
  id: string;
  company: string;
  contact: string;
  email: string;
  source: string;
  score: number;
  status: string;
  date: string;
  [key: string]: unknown;
}

const SOURCES = ['Facebook Ads', 'Instagram'];
const STATUSES = ['New', 'Enriched', 'Scored', 'Validated', 'Uploaded', 'Sent', 'Replied', 'Booked'];

const statusVariant: Record<string, 'green' | 'yellow' | 'primary' | 'muted' | 'default'> = {
  Booked: 'green',
  Replied: 'green',
  Sent: 'primary',
  Uploaded: 'primary',
  Validated: 'yellow',
  Scored: 'yellow',
  Enriched: 'default',
  New: 'muted',
};

const columns: Column<Lead>[] = [
  { key: 'company', label: 'Company', sortable: true },
  { key: 'contact', label: 'Contact', sortable: true },
  { key: 'email', label: 'Email', className: 'hidden lg:table-cell' },
  { key: 'source', label: 'Source', sortable: true, className: 'hidden sm:table-cell' },
  {
    key: 'score',
    label: 'Score',
    sortable: true,
    render: (row) => (
      <span className={clsx('font-medium', row.score >= 80 ? 'text-green' : row.score >= 60 ? 'text-yellow' : 'text-text-muted')}>
        {row.score}
      </span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    render: (row) => <Badge variant={statusVariant[row.status] || 'default'}>{row.status}</Badge>,
  },
  { key: 'date', label: 'Date', sortable: true, className: 'hidden md:table-cell' },
];

export default function LeadsPage() {
  const router = useRouter();
  const leadsQuery = useLeads();
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [selected, setSelected] = useState<Lead[]>([]);

  const allLeads: Lead[] = Array.isArray(leadsQuery.data) ? leadsQuery.data : [];

  const filtered = useMemo(() => {
    return allLeads.filter((lead) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !lead.company.toLowerCase().includes(q) &&
          !lead.email.toLowerCase().includes(q) &&
          !lead.contact.toLowerCase().includes(q)
        )
          return false;
      }
      if (selectedSources.size > 0 && !selectedSources.has(lead.source)) return false;
      if (selectedStatuses.size > 0 && !selectedStatuses.has(lead.status)) return false;
      if (lead.score < scoreRange[0] || lead.score > scoreRange[1]) return false;
      return true;
    });
  }, [allLeads, search, selectedSources, selectedStatuses, scoreRange]);

  function toggleSet(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const hasFilters = selectedSources.size > 0 || selectedStatuses.size > 0 || scoreRange[0] > 0 || scoreRange[1] < 100;

  if (leadsQuery.isLoading) return <ApiLoadingState />;
  if (leadsQuery.isError) return <ApiErrorState onRetry={() => leadsQuery.refetch()} />;
  if (!allLeads.length) return <ApiEmptyState title="No leads yet" description="Run your first pipeline to start generating leads." />;

  return (
    <div className="space-y-4 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Leads</h1>
        <span className="text-sm text-text-muted">{filtered.length} leads</span>
      </div>

      {/* Search + Filter toggle */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by company, email, or ask a question..."
            className="h-10 w-full rounded-lg border border-border bg-surface-light pl-10 pr-4 text-sm text-text-primary outline-none placeholder:text-text-muted transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors min-h-[40px]',
            filtersOpen || hasFilters
              ? 'border-primary/50 bg-primary/10 text-primary-light'
              : 'border-border bg-surface-light text-text-secondary hover:bg-surface-lighter'
          )}
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {hasFilters && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
              {selectedSources.size + selectedStatuses.size + (scoreRange[0] > 0 || scoreRange[1] < 100 ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="rounded-xl border border-border bg-surface-light p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">Filters</span>
            {hasFilters && (
              <button
                onClick={() => {
                  setSelectedSources(new Set());
                  setSelectedStatuses(new Set());
                  setScoreRange([0, 100]);
                }}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
              >
                <X className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Source */}
            <div>
              <p className="mb-2 text-xs font-medium text-text-secondary">Source</p>
              <div className="space-y-1.5">
                {SOURCES.map((src) => (
                  <label key={src} className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={selectedSources.has(src)}
                      onChange={() => setSelectedSources(toggleSet(selectedSources, src))}
                      className="rounded border-border bg-surface accent-primary"
                    />
                    {src}
                  </label>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="mb-2 text-xs font-medium text-text-secondary">Status</p>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((st) => (
                  <button
                    key={st}
                    onClick={() => setSelectedStatuses(toggleSet(selectedStatuses, st))}
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[28px]',
                      selectedStatuses.has(st)
                        ? 'bg-primary text-white'
                        : 'bg-surface-lighter text-text-secondary hover:bg-surface-lighter/80'
                    )}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Score */}
            <div>
              <p className="mb-2 text-xs font-medium text-text-secondary">
                Score: {scoreRange[0]} – {scoreRange[1]}
              </p>
              <div className="space-y-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={scoreRange[0]}
                  onChange={(e) => setScoreRange([Math.min(Number(e.target.value), scoreRange[1]), scoreRange[1]])}
                  className="w-full accent-primary"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={scoreRange[1]}
                  onChange={(e) => setScoreRange([scoreRange[0], Math.max(Number(e.target.value), scoreRange[0])])}
                  className="w-full accent-primary"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk actions */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-primary-light">{selected.length} selected</span>
          <div className="flex gap-2">
            {['Re-score', 'Force Upload', 'Mark Junk', 'Export'].map((action) => (
              <button
                key={action}
                className="rounded-lg bg-surface-light px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-lighter min-h-[32px]"
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <DataTable<Lead>
        columns={columns}
        data={filtered}
        pageSize={12}
        selectable
        onSelectionChange={setSelected}
        onRowClick={(row) => router.push(`/leads/${row.id}`)}
        getRowId={(row) => row.id}
      />
    </div>
  );
}
