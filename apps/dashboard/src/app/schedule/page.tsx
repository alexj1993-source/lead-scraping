'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSchedule } from '@/lib/hooks';
import { ApiErrorState, ApiLoadingState } from '@/components/ui/api-state';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import {
  Clock,
  Play,
  Save,
  RotateCcw,
  Calendar,
  Target,
  Shuffle,
  Loader2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';

interface ScheduleConfig {
  enabled: boolean;
  cronExpression: string;
  dailyTarget: number;
  sourceWeights: { FACEBOOK_ADS: number; INSTAGRAM: number };
  keywordRotationEnabled: boolean;
  keywordMaxUses: number;
  timezone: string;
}

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Daily at 6 AM', cron: '0 6 * * *' },
  { label: 'Daily at 8 AM', cron: '0 8 * * *' },
  { label: 'Daily at 12 PM', cron: '0 12 * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Every 12 hours', cron: '0 */12 * * *' },
  { label: 'Weekdays at 6 AM', cron: '0 6 * * 1-5' },
];

function parseCronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dayOfMonth, month, dayOfWeek] = parts;

  const formatHour = (h: string) => {
    if (h.startsWith('*/')) return `every ${h.slice(2)} hours`;
    const n = parseInt(h, 10);
    const ampm = n >= 12 ? 'PM' : 'AM';
    const display = n === 0 ? 12 : n > 12 ? n - 12 : n;
    return `${display}:${min.padStart(2, '0')} ${ampm}`;
  };

  let timeStr = formatHour(hour);
  if (hour.startsWith('*/')) {
    timeStr = `Every ${hour.slice(2)} hours at :${min.padStart(2, '0')}`;
  } else {
    timeStr = `At ${timeStr}`;
  }

  if (dayOfWeek === '1-5') timeStr += ' on weekdays';
  else if (dayOfWeek !== '*') timeStr += ` on day-of-week ${dayOfWeek}`;

  if (dayOfMonth !== '*') timeStr += ` on day ${dayOfMonth}`;
  if (month !== '*') timeStr += ` in month ${month}`;

  return timeStr;
}

export default function SchedulePage() {
  const queryClient = useQueryClient();
  const scheduleQuery = useSchedule();
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  useEffect(() => {
    if (scheduleQuery.data && !config) {
      setConfig(scheduleQuery.data as ScheduleConfig);
    }
  }, [scheduleQuery.data, config]);

  const saveMutation = useMutation({
    mutationFn: (data: ScheduleConfig) =>
      apiFetch<ScheduleConfig>('/api/schedule', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (data) => {
      setConfig(data);
      setDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; jobsQueued: number }>('/api/schedule/run-now', { method: 'POST' }),
    onSuccess: (data) => {
      setRunResult(`Pipeline triggered: ${data.jobsQueued} jobs queued`);
      setTimeout(() => setRunResult(null), 5000);
    },
    onError: (err: Error) => {
      setRunResult(`Error: ${err.message}`);
      setTimeout(() => setRunResult(null), 5000);
    },
  });

  function update(partial: Partial<ScheduleConfig>) {
    if (!config) return;
    setConfig({ ...config, ...partial });
    setDirty(true);
  }

  function updateWeight(source: 'FACEBOOK_ADS' | 'INSTAGRAM', value: number) {
    if (!config) return;
    const clamped = Math.max(0, Math.min(100, value));
    const other = source === 'FACEBOOK_ADS' ? 'INSTAGRAM' : 'FACEBOOK_ADS';
    update({
      sourceWeights: {
        [source]: clamped,
        [other]: 100 - clamped,
      } as ScheduleConfig['sourceWeights'],
    });
  }

  if (scheduleQuery.isLoading || !config) return <ApiLoadingState />;
  if (scheduleQuery.isError) return <ApiErrorState onRetry={() => scheduleQuery.refetch()} />;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-6 w-6 text-text-muted" />
          <h1 className="text-xl font-bold">Schedule Editor</h1>
        </div>
        <Badge variant={config.enabled ? 'green' : 'red'}>
          {config.enabled ? 'Active' : 'Disabled'}
        </Badge>
      </div>

      {/* Pipeline toggle */}
      <section className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Pipeline Status</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Enable or disable the automated scraping pipeline
            </p>
          </div>
          <button
            onClick={() => update({ enabled: !config.enabled })}
            className={clsx(
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200',
              config.enabled ? 'bg-green' : 'bg-surface-lighter',
            )}
          >
            <span
              className={clsx(
                'inline-block h-5 w-5 rounded-full bg-white transition-transform duration-200',
                config.enabled ? 'translate-x-6' : 'translate-x-1',
              )}
            />
          </button>
        </div>
      </section>

      {/* Schedule config */}
      <section className="rounded-xl border border-border bg-surface-light p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-medium text-text-primary">Schedule</h2>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-text-muted">Cron Expression</span>
            <input
              type="text"
              value={config.cronExpression}
              onChange={(e) => update({ cronExpression: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
              placeholder="0 6 * * *"
            />
          </label>
          <div className="rounded-lg bg-surface p-3">
            <p className="text-xs text-text-muted">Preview</p>
            <p className="mt-0.5 text-sm font-medium text-text-primary">
              {parseCronToHuman(config.cronExpression)} ({config.timezone})
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.cron}
                onClick={() => update({ cronExpression: preset.cron })}
                className={clsx(
                  'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                  config.cronExpression === preset.cron
                    ? 'border-primary bg-primary/10 text-primary-light'
                    : 'border-border bg-surface text-text-secondary hover:bg-surface-lighter',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-xs text-text-muted">Timezone</span>
          <select
            value={config.timezone}
            onChange={(e) => update({ timezone: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
          >
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (ET)</option>
            <option value="America/Chicago">America/Chicago (CT)</option>
            <option value="America/Denver">America/Denver (MT)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET)</option>
          </select>
        </label>
      </section>

      {/* Daily target */}
      <section className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-medium text-text-primary">Daily Target</h2>
        </div>

        <label className="block">
          <span className="text-xs text-text-muted">Total leads per day</span>
          <input
            type="number"
            value={config.dailyTarget}
            onChange={(e) => update({ dailyTarget: parseInt(e.target.value, 10) || 0 })}
            min={0}
            max={10000}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
          />
        </label>
      </section>

      {/* Source weights */}
      <section className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
        <h2 className="text-sm font-medium text-text-primary">Source Weights</h2>
        <p className="text-xs text-text-muted">
          Distribute lead volume between sources. Must sum to 100%.
        </p>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-text-secondary">Facebook Ads</span>
              <span className="font-medium text-text-primary">{config.sourceWeights.FACEBOOK_ADS}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={config.sourceWeights.FACEBOOK_ADS}
              onChange={(e) => updateWeight('FACEBOOK_ADS', parseInt(e.target.value, 10))}
              className="w-full accent-primary"
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-text-secondary">Instagram</span>
              <span className="font-medium text-text-primary">{config.sourceWeights.INSTAGRAM}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={config.sourceWeights.INSTAGRAM}
              onChange={(e) => updateWeight('INSTAGRAM', parseInt(e.target.value, 10))}
              className="w-full accent-primary"
            />
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-surface p-3">
            <div className="flex-1 rounded-full bg-primary/20 h-3 overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${config.sourceWeights.FACEBOOK_ADS}%` }}
              />
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">
              FB {config.sourceWeights.FACEBOOK_ADS}% / IG {config.sourceWeights.INSTAGRAM}%
            </span>
          </div>
        </div>
      </section>

      {/* Keyword rotation */}
      <section className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Shuffle className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-medium text-text-primary">Keyword Rotation</h2>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">Auto-rotate keywords</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Retire keywords after reaching max uses
            </p>
          </div>
          <button
            onClick={() => update({ keywordRotationEnabled: !config.keywordRotationEnabled })}
            className={clsx(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
              config.keywordRotationEnabled ? 'bg-primary' : 'bg-surface-lighter',
            )}
          >
            <span
              className={clsx(
                'inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200',
                config.keywordRotationEnabled ? 'translate-x-6' : 'translate-x-1',
              )}
            />
          </button>
        </div>

        {config.keywordRotationEnabled && (
          <label className="block">
            <span className="text-xs text-text-muted">Max uses before rotation</span>
            <input
              type="number"
              value={config.keywordMaxUses}
              onChange={(e) => update({ keywordMaxUses: parseInt(e.target.value, 10) || 1 })}
              min={1}
              max={100}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
            />
          </label>
        )}
      </section>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => saveMutation.mutate(config)}
          disabled={!dirty || saveMutation.isPending}
          className={clsx(
            'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors min-h-[40px]',
            dirty
              ? 'bg-primary text-white hover:bg-primary/90'
              : 'bg-surface-lighter text-text-muted cursor-not-allowed',
          )}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Changes
        </button>

        <button
          onClick={() => runNowMutation.mutate()}
          disabled={!config.enabled || runNowMutation.isPending}
          className={clsx(
            'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors min-h-[40px]',
            config.enabled
              ? 'bg-green/10 text-green hover:bg-green/20'
              : 'bg-surface-lighter text-text-muted cursor-not-allowed',
          )}
        >
          {runNowMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run Now
        </button>

        <button
          onClick={() => {
            setConfig(scheduleQuery.data as ScheduleConfig);
            setDirty(false);
          }}
          disabled={!dirty}
          className={clsx(
            'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors min-h-[40px]',
            dirty
              ? 'bg-surface-lighter text-text-secondary hover:bg-surface-lighter/80'
              : 'text-text-muted cursor-not-allowed',
          )}
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
      </div>

      {/* Status messages */}
      {saveSuccess && (
        <div className="flex items-center gap-2 rounded-lg bg-green/10 px-4 py-3 text-sm text-green">
          <CheckCircle className="h-4 w-4" />
          Schedule config saved successfully
        </div>
      )}
      {saveMutation.isError && (
        <div className="flex items-center gap-2 rounded-lg bg-red/10 px-4 py-3 text-sm text-red">
          <AlertCircle className="h-4 w-4" />
          Failed to save: {(saveMutation.error as Error).message}
        </div>
      )}
      {runResult && (
        <div
          className={clsx(
            'flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
            runResult.startsWith('Error') ? 'bg-red/10 text-red' : 'bg-green/10 text-green',
          )}
        >
          {runResult.startsWith('Error') ? (
            <AlertCircle className="h-4 w-4" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          {runResult}
        </div>
      )}
    </div>
  );
}
