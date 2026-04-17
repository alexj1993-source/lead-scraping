'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  ChevronDown,
  Plus,
  Trash2,
  Tag,
  Loader2,
  Play,
  Clock,
  X,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { useSources } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';
import { apiFetch } from '@/lib/api';

interface KeywordData {
  id: string;
  primary: string;
  secondary?: string | null;
  source: string;
  enabled: boolean;
  labels: string[];
  totalYield: number;
  icpPassRate: number;
  score: number;
  lastUsedAt: string | null;
}

interface SourceData {
  source: string;
  activeTier: string;
  autoTierSwitch: boolean;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleDailyTarget: number;
  keywordCount: number;
  totalYield: number;
  keywords: KeywordData[];
  tierHealth: any;
}

const SOURCE_DISPLAY: Record<string, { label: string; color: string }> = {
  FACEBOOK_ADS: { label: 'Facebook Ads', color: 'text-blue-400' },
  INSTAGRAM: { label: 'Instagram', color: 'text-pink-400' },
};

const SOURCE_API_KEY: Record<string, string> = {
  FACEBOOK_ADS: 'facebook_ads',
  INSTAGRAM: 'instagram',
};

const LABEL_COLORS = [
  'bg-blue-500/15 text-blue-400',
  'bg-green/15 text-green',
  'bg-purple-500/15 text-purple-400',
  'bg-yellow/15 text-yellow',
  'bg-pink-500/15 text-pink-400',
  'bg-cyan-500/15 text-cyan-400',
];

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

function formatDate(d: string | null): string {
  if (!d) return 'Never';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type ExpandedTab = 'keywords' | 'settings';

export default function SourcesPage() {
  const queryClient = useQueryClient();
  const sourcesQuery = useSources();
  const sources: SourceData[] = Array.isArray(sourcesQuery.data)
    ? (sourcesQuery.data as SourceData[])
    : [];
  const [expanded, setExpanded] = useState<Record<string, ExpandedTab | null>>({});
  const [newKeyword, setNewKeyword] = useState<Record<string, string>>({});
  const [newSecondary, setNewSecondary] = useState<Record<string, string>>({});
  const [runCounts, setRunCounts] = useState<Record<string, number>>({});
  const [showRunInput, setShowRunInput] = useState<Record<string, boolean>>({});

  const toggleMutation = useMutation({
    mutationFn: ({ source, enabled }: { source: string; enabled: boolean }) =>
      apiFetch(`/api/sources/${source}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  const keywordToggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/keywords/${id}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  const addKeywordMutation = useMutation({
    mutationFn: ({ primary, source, secondary }: { primary: string; source: string; secondary?: string }) =>
      apiFetch('/api/keywords', {
        method: 'POST',
        body: JSON.stringify({ primary, source, secondary }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      queryClient.invalidateQueries({ queryKey: ['keywords'] });
      setNewKeyword({});
      setNewSecondary({});
    },
  });

  const deleteKeywordMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/keywords/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      queryClient.invalidateQueries({ queryKey: ['keywords'] });
    },
  });

  const updateLabelsMutation = useMutation({
    mutationFn: ({ id, labels }: { id: string; labels: string[] }) =>
      apiFetch(`/api/keywords/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ labels }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  const runMutation = useMutation({
    mutationFn: ({ source, count }: { source: string; count: number }) =>
      apiFetch(`/api/sources/${source}/run`, {
        method: 'POST',
        body: JSON.stringify({ count }),
      }),
    onSuccess: () => {
      setShowRunInput({});
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ source, data }: { source: string; data: any }) =>
      apiFetch(`/api/sources/${source}/config`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  function toggleExpanded(source: string, tab: ExpandedTab) {
    setExpanded((prev) => ({
      ...prev,
      [source]: prev[source] === tab ? null : tab,
    }));
  }

  function handleAddKeyword(source: string) {
    const primary = newKeyword[source]?.trim();
    if (!primary) return;
    const apiSource = SOURCE_API_KEY[source] || source;
    const secondary = newSecondary[source]?.trim() || undefined;
    addKeywordMutation.mutate({ primary, source: apiSource, secondary });
  }

  if (sourcesQuery.isLoading) return <ApiLoadingState />;
  if (sourcesQuery.isError) return <ApiErrorState onRetry={() => sourcesQuery.refetch()} />;
  if (!sources.length) return <ApiEmptyState title="No sources configured" description="Configure Facebook Ads or Instagram sources to start scraping." />;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Sources</h1>
        <span className="text-sm text-text-muted">{sources.length} sources</span>
      </div>

      <div className="space-y-4">
        {sources.map((src) => {
          const display = SOURCE_DISPLAY[src.source] ?? { label: src.source, color: 'text-text-primary' };
          const activeTab = expanded[src.source] ?? null;
          const enabledKeywords = src.keywords.filter((k) => k.enabled).length;
          const isRunning = showRunInput[src.source];

          return (
            <div
              key={src.source}
              className="rounded-xl border border-border bg-surface-light overflow-hidden"
            >
              {/* Header */}
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className={clsx('h-5 w-5', display.color)} />
                    <div>
                      <span className="font-medium text-text-primary">{display.label}</span>
                      <p className="text-xs text-text-muted mt-0.5">
                        Tier: {(src.activeTier ?? 'UNKNOWN').replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleMutation.mutate({ source: src.source, enabled: !src.enabled })}
                    className={clsx(
                      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
                      src.enabled ? 'bg-green' : 'bg-surface-lighter',
                    )}
                  >
                    <span className={clsx(
                      'inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200',
                      src.enabled ? 'translate-x-6' : 'translate-x-1',
                    )} />
                  </button>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-lg bg-surface p-2.5">
                    <span className="text-text-muted">Keywords</span>
                    <p className="mt-0.5 font-medium text-text-primary">{enabledKeywords}/{src.keywordCount}</p>
                  </div>
                  <div className="rounded-lg bg-surface p-2.5">
                    <span className="text-text-muted">Total Yield</span>
                    <p className="mt-0.5 font-medium text-text-primary">{src.totalYield.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-surface p-2.5">
                    <span className="text-text-muted">Schedule</span>
                    <p className="mt-0.5">
                      {src.scheduleEnabled ? (
                        <Badge variant="green">{src.scheduleDailyTarget}/day</Badge>
                      ) : (
                        <Badge variant="muted">Off</Badge>
                      )}
                    </p>
                  </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center gap-2">
                  {!isRunning ? (
                    <button
                      onClick={() => {
                        setRunCounts((p) => ({ ...p, [src.source]: 10 }));
                        setShowRunInput((p) => ({ ...p, [src.source]: true }));
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/20 transition-colors"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Run Now
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={runCounts[src.source] ?? 10}
                        onChange={(e) => setRunCounts((p) => ({ ...p, [src.source]: parseInt(e.target.value) || 1 }))}
                        className="w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-primary tabular-nums"
                      />
                      <span className="text-xs text-text-muted">keywords</span>
                      <button
                        onClick={() => runMutation.mutate({ source: src.source, count: runCounts[src.source] ?? 10 })}
                        disabled={runMutation.isPending}
                        className="flex items-center gap-1 rounded-lg bg-green/15 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/25 transition-colors disabled:opacity-50"
                      >
                        {runMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Go
                      </button>
                      <button
                        onClick={() => setShowRunInput((p) => ({ ...p, [src.source]: false }))}
                        className="rounded p-1 text-text-muted hover:text-text-secondary"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {runMutation.isSuccess && !isRunning && (
                    <span className="text-xs text-green">
                      Queued {(runMutation.data as any)?.jobsQueued ?? 0} jobs
                    </span>
                  )}
                </div>

                {/* Tab toggles */}
                <div className="flex gap-1 border-t border-border pt-3 -mb-1">
                  <button
                    onClick={() => toggleExpanded(src.source, 'keywords')}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      activeTab === 'keywords'
                        ? 'bg-primary/10 text-primary-light'
                        : 'text-text-muted hover:text-text-secondary hover:bg-surface',
                    )}
                  >
                    <Tag className="h-3.5 w-3.5" />
                    Keywords ({src.keywordCount})
                    <ChevronDown className={clsx('h-3 w-3 transition-transform', activeTab === 'keywords' && 'rotate-180')} />
                  </button>
                  <button
                    onClick={() => toggleExpanded(src.source, 'settings')}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      activeTab === 'settings'
                        ? 'bg-primary/10 text-primary-light'
                        : 'text-text-muted hover:text-text-secondary hover:bg-surface',
                    )}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                    <ChevronDown className={clsx('h-3 w-3 transition-transform', activeTab === 'settings' && 'rotate-180')} />
                  </button>
                </div>
              </div>

              {/* Keywords panel */}
              {activeTab === 'keywords' && (
                <div className="border-t border-border bg-surface px-5 py-4 space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newKeyword[src.source] ?? ''}
                        onChange={(e) => setNewKeyword((p) => ({ ...p, [src.source]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddKeyword(src.source); }}
                        placeholder="New keyword..."
                        className="flex-1 rounded-lg border border-border bg-surface-light px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => handleAddKeyword(src.source)}
                        disabled={addKeywordMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary-light hover:bg-primary/20 transition-colors"
                      >
                        {addKeywordMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        Add
                      </button>
                    </div>
                    {src.source === 'FACEBOOK_ADS' && (
                      <input
                        type="text"
                        value={newSecondary[src.source] ?? ''}
                        onChange={(e) => setNewSecondary((p) => ({ ...p, [src.source]: e.target.value }))}
                        placeholder="Secondary keywords (comma-separated)..."
                        className="w-full rounded-lg border border-border bg-surface-light px-3 py-2 text-xs text-text-secondary placeholder-text-muted outline-none focus:border-primary"
                      />
                    )}
                  </div>

                  {src.keywords.length === 0 ? (
                    <p className="text-center text-sm text-text-muted py-4">No keywords yet. Add one above.</p>
                  ) : (
                    <div className="space-y-1">
                      <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-xs text-text-muted font-medium">
                        <div className="col-span-4">Keyword</div>
                        <div className="col-span-2">Labels</div>
                        <div className="col-span-1 text-right">Yield</div>
                        <div className="col-span-1 text-right">ICP</div>
                        <div className="col-span-2 text-right">Last Used</div>
                        <div className="col-span-2 text-right">Actions</div>
                      </div>

                      {src.keywords.map((kw) => (
                        <KeywordRow
                          key={kw.id}
                          kw={kw}
                          onToggle={(enabled) => keywordToggleMutation.mutate({ id: kw.id, enabled })}
                          onDelete={() => {
                            if (window.confirm(`Delete keyword "${kw.primary}"?`)) {
                              deleteKeywordMutation.mutate(kw.id);
                            }
                          }}
                          onUpdateLabels={(labels) => updateLabelsMutation.mutate({ id: kw.id, labels })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Settings panel */}
              {activeTab === 'settings' && (
                <div className="border-t border-border bg-surface px-5 py-4 space-y-5">
                  <ScheduleSettings
                    source={src.source}
                    scheduleEnabled={src.scheduleEnabled}
                    scheduleDailyTarget={src.scheduleDailyTarget}
                    autoTierSwitch={src.autoTierSwitch}
                    onSave={(data) => updateConfigMutation.mutate({ source: src.source, data })}
                    saving={updateConfigMutation.isPending}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeywordRow({
  kw,
  onToggle,
  onDelete,
  onUpdateLabels,
}: {
  kw: KeywordData;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onUpdateLabels: (labels: string[]) => void;
}) {
  const [labelInput, setLabelInput] = useState('');
  const [showLabelInput, setShowLabelInput] = useState(false);
  const labels = kw.labels ?? [];

  function addLabel() {
    const val = labelInput.trim().toLowerCase();
    if (!val || labels.includes(val)) return;
    onUpdateLabels([...labels, val]);
    setLabelInput('');
  }

  function removeLabel(label: string) {
    onUpdateLabels(labels.filter((l) => l !== label));
  }

  return (
    <div className={clsx(
      'grid grid-cols-12 gap-2 items-center rounded-lg px-3 py-2 text-sm transition-colors',
      kw.enabled ? 'bg-surface-light' : 'bg-surface-light/50 opacity-60',
    )}>
      <div className="col-span-4 min-w-0">
        <p className="truncate font-medium text-text-primary">{kw.primary}</p>
        {kw.secondary && <p className="truncate text-xs text-text-muted mt-0.5">{kw.secondary}</p>}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-1 min-w-0">
        {labels.map((label) => (
          <span
            key={label}
            className={clsx('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', labelColor(label))}
          >
            {label}
            <button onClick={() => removeLabel(label)} className="ml-0.5 hover:opacity-70">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {showLabelInput ? (
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addLabel();
              if (e.key === 'Escape') setShowLabelInput(false);
            }}
            onBlur={() => { addLabel(); setShowLabelInput(false); }}
            placeholder="label"
            autoFocus
            className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-[10px] text-text-primary outline-none focus:border-primary"
          />
        ) : (
          <button
            onClick={() => setShowLabelInput(true)}
            className="rounded p-0.5 text-text-muted hover:text-primary-light hover:bg-primary/10 transition-colors"
            title="Add label"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="col-span-1 text-right text-xs text-text-secondary tabular-nums">{kw.totalYield}</div>

      <div className="col-span-1 text-right text-xs">
        <span className={clsx(
          kw.icpPassRate >= 0.5 ? 'text-green' : kw.icpPassRate >= 0.3 ? 'text-yellow' : 'text-red',
        )}>
          {(kw.icpPassRate * 100).toFixed(0)}%
        </span>
      </div>

      <div className="col-span-2 text-right text-xs text-text-muted">{formatDate(kw.lastUsedAt)}</div>

      <div className="col-span-2 flex items-center justify-end gap-1">
        <button
          onClick={() => onToggle(!kw.enabled)}
          className={clsx(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
            kw.enabled ? 'bg-green' : 'bg-surface-lighter',
          )}
        >
          <span className={clsx(
            'inline-block h-3 w-3 rounded-full bg-white transition-transform duration-200',
            kw.enabled ? 'translate-x-5' : 'translate-x-1',
          )} />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-text-muted hover:text-red hover:bg-red/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ScheduleSettings({
  source,
  scheduleEnabled,
  scheduleDailyTarget,
  autoTierSwitch,
  onSave,
  saving,
}: {
  source: string;
  scheduleEnabled: boolean;
  scheduleDailyTarget: number;
  autoTierSwitch: boolean;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [enabled, setEnabled] = useState(scheduleEnabled);
  const [target, setTarget] = useState(scheduleDailyTarget);
  const [autoTier, setAutoTier] = useState(autoTierSwitch);
  const dirty = enabled !== scheduleEnabled || target !== scheduleDailyTarget || autoTier !== autoTierSwitch;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Scheduled Runs</p>
            <p className="text-xs text-text-muted mt-0.5">Automatically scrape this source daily</p>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={clsx(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
              enabled ? 'bg-green' : 'bg-surface-lighter',
            )}
          >
            <span className={clsx(
              'inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200',
              enabled ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>

        {enabled && (
          <div className="rounded-lg border border-border bg-surface-light p-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-text-muted">Daily target (keywords to scrape)</label>
              <input
                type="number"
                min={1}
                max={500}
                value={target}
                onChange={(e) => setTarget(parseInt(e.target.value) || 1)}
                className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-primary text-right outline-none focus:border-primary tabular-nums"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Clock className="h-3.5 w-3.5" />
              Runs daily at 6:00 AM UTC
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Auto Tier Switch</p>
            <p className="text-xs text-text-muted mt-0.5">Automatically fall back to lower tiers on failure</p>
          </div>
          <button
            onClick={() => setAutoTier(!autoTier)}
            className={clsx(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
              autoTier ? 'bg-green' : 'bg-surface-lighter',
            )}
          >
            <span className={clsx(
              'inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200',
              autoTier ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>
      </div>

      {dirty && (
        <button
          onClick={() => onSave({ scheduleEnabled: enabled, scheduleDailyTarget: target, autoTierSwitch: autoTier })}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Settings
        </button>
      )}
    </>
  );
}
