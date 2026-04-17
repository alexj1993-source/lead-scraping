'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { useOnboardingStatus, useProviderSettings, useKeywords } from '@/lib/hooks';
import { apiFetch } from '@/lib/api';
import clsx from 'clsx';
import {
  Key,
  Tag,
  Database,
  Rocket,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Globe,
  Bot,
  Share2,
  Mail,
  Search,
  Shield,
  Zap,
  Users,
  Play,
} from 'lucide-react';

const STEPS = [
  { key: 'apiKeys', label: 'API Keys', icon: Key, description: 'Connect your essential services' },
  { key: 'keywords', label: 'Keywords', icon: Tag, description: 'Define what you\'re looking for' },
  { key: 'sources', label: 'Sources', icon: Database, description: 'Configure lead sources' },
  { key: 'schedule', label: 'Launch', icon: Rocket, description: 'Set schedule & start' },
] as const;

const REQUIRED_PROVIDERS = ['meta', 'instantly', 'anthropic'];
const RECOMMENDED_PROVIDERS = ['neverbounce', 'bounceban', 'exa'];

const providerMeta: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  meta: { label: 'Meta (Facebook)', icon: <Share2 className="h-4 w-4" />, description: 'Required for Facebook Ads scraping' },
  instantly: { label: 'Instantly', icon: <Mail className="h-4 w-4" />, description: 'Required for email sending & campaign management' },
  anthropic: { label: 'Anthropic', icon: <Bot className="h-4 w-4" />, description: 'Required for AI-powered personalization & scoring' },
  neverbounce: { label: 'NeverBounce', icon: <Mail className="h-4 w-4" />, description: 'Recommended for primary email validation' },
  bounceban: { label: 'BounceBan', icon: <Mail className="h-4 w-4" />, description: 'Catch-all email verification (verifies accept-all domains)' },
  exa: { label: 'Exa', icon: <Search className="h-4 w-4" />, description: 'Recommended for lead enrichment & context' },
};

interface ProviderInfo {
  name: string;
  label: string;
  configured: boolean;
  maskedKey: string | null;
  status: string;
  vaultWarning: boolean;
}

interface TestResult {
  success: boolean;
  message: string;
}

function ProviderSetupRow({ provider, isRequired }: { provider: ProviderInfo; isRequired: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const meta = providerMeta[provider.name] ?? { label: provider.label, icon: <Globe className="h-4 w-4" />, description: '' };

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/settings/${provider.name}`, {
        method: 'PUT',
        body: JSON.stringify({ apiKey }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-settings'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      setEditing(false);
      setApiKey('');
      setTestResult(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiFetch<TestResult>(`/api/settings/${provider.name}/test`, { method: 'POST' }),
    onSuccess: (data) => setTestResult(data),
    onError: () => setTestResult({ success: false, message: 'Network error' }),
  });

  return (
    <div className={clsx(
      'rounded-lg border p-4 space-y-3 transition-colors',
      provider.configured ? 'border-green/30 bg-green/5' : isRequired ? 'border-yellow/30 bg-yellow/5' : 'border-border bg-surface',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-text-muted">{meta.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-text-primary">{meta.label}</p>
              {isRequired ? (
                <Badge variant="yellow">Required</Badge>
              ) : (
                <Badge variant="muted">Recommended</Badge>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {provider.configured ? (
            <Badge variant="green"><CheckCircle className="mr-1 h-3 w-3" />Connected</Badge>
          ) : (
            <Badge variant="muted"><XCircle className="mr-1 h-3 w-3" />Not Set</Badge>
          )}
        </div>
      </div>

      {!provider.configured && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/20 transition-colors"
        >
          Configure
        </button>
      )}

      {provider.configured && !editing && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="rounded-md bg-surface-lighter px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-lighter/80 transition-colors disabled:opacity-50"
          >
            {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test Connection'}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md bg-surface-lighter px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-lighter/80 transition-colors"
          >
            Update Key
          </button>
        </div>
      )}

      {editing && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter ${meta.label} API key`}
              className="w-full rounded-md border border-border bg-surface-light px-3 py-2 pr-9 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!apiKey || saveMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setApiKey(''); setTestResult(null); }}
            className="rounded-md bg-surface-lighter px-3 py-2 text-sm text-text-secondary hover:bg-surface-lighter/80 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {testResult && (
        <p className={clsx('text-xs', testResult.success ? 'text-green' : 'text-red')}>
          {testResult.message}
        </p>
      )}
      {saveMutation.isError && (
        <p className="text-xs text-red">
          Failed: {saveMutation.error instanceof Error ? saveMutation.error.message : 'Unknown error'}
        </p>
      )}
    </div>
  );
}

function StepApiKeys({ providers, onCanProceed }: { providers: ProviderInfo[]; onCanProceed: (ok: boolean) => void }) {
  const requiredConfigured = REQUIRED_PROVIDERS.every((name) =>
    providers.find((p) => p.name === name)?.configured,
  );

  useEffect(() => {
    onCanProceed(requiredConfigured);
  }, [requiredConfigured, onCanProceed]);

  const requiredProviders = providers.filter((p) => REQUIRED_PROVIDERS.includes(p.name));
  const recommendedProviders = providers.filter((p) => RECOMMENDED_PROVIDERS.includes(p.name));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-text-primary">Required API Keys</h3>
        <p className="mt-1 text-sm text-text-muted">
          These services are essential for the pipeline to function. Configure all three to continue.
        </p>
      </div>
      <div className="space-y-3">
        {requiredProviders.map((p) => (
          <ProviderSetupRow key={p.name} provider={p} isRequired />
        ))}
      </div>

      <div>
        <h3 className="text-base font-semibold text-text-primary">Recommended API Keys</h3>
        <p className="mt-1 text-sm text-text-muted">
          These improve accuracy and coverage but aren't required to get started.
        </p>
      </div>
      <div className="space-y-3">
        {recommendedProviders.map((p) => (
          <ProviderSetupRow key={p.name} provider={p} isRequired={false} />
        ))}
      </div>
    </div>
  );
}

const SUGGESTED_KEYWORDS = [
  'lead generation agency',
  'marketing automation',
  'B2B SaaS founders',
  'digital marketing agency',
  'growth hacking',
  'sales funnel optimization',
  'cold email outreach',
  'facebook ads agency',
  'demand generation',
  'outbound sales',
];

function StepKeywords({ onCanProceed }: { onCanProceed: (ok: boolean) => void }) {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [initialized, setInitialized] = useState(false);

  const keywordsQuery = useKeywords();
  const existingKeywords = keywordsQuery.data as any;

  useEffect(() => {
    if (!initialized && existingKeywords) {
      const existing = Array.isArray(existingKeywords)
        ? existingKeywords.map((k: any) => k.primary ?? k.keyword)
        : existingKeywords?.keywords?.map((k: any) => k.primary ?? k.keyword) ?? [];
      if (existing.length > 0) {
        setKeywords(existing);
      }
      setInitialized(true);
    }
  }, [existingKeywords, initialized]);

  useEffect(() => {
    onCanProceed(keywords.length >= 5);
  }, [keywords.length, onCanProceed]);

  function addKeyword(kw: string) {
    const trimmed = kw.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
    }
    setNewKeyword('');
  }

  function removeKeyword(idx: number) {
    setKeywords(keywords.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-text-primary">Configure Keywords</h3>
        <p className="mt-1 text-sm text-text-muted">
          Keywords determine what leads the pipeline looks for. They're used across Facebook Ads
          and Instagram scraping to find businesses matching your ideal customer profile.
          Add at least 5 to get started.
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-text-secondary mb-2">
          Suggestions — click to add:
        </p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_KEYWORDS.filter((s) => !keywords.includes(s)).map((kw) => (
            <button
              key={kw}
              onClick={() => addKeyword(kw)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary hover:border-primary hover:text-primary-light transition-colors"
            >
              <Plus className="mr-1 inline h-3 w-3" />
              {kw}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(newKeyword); } }}
          placeholder="Type a keyword and press Enter"
          className="flex-1 rounded-lg border border-border bg-surface-light px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={() => addKeyword(newKeyword)}
          disabled={!newKeyword.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          Add
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-text-secondary">
            Your keywords ({keywords.length}/5 minimum)
          </p>
          {keywords.length >= 5 && (
            <Badge variant="green"><CheckCircle className="mr-1 h-3 w-3" />Ready</Badge>
          )}
        </div>
        <div className="space-y-1.5">
          {keywords.map((kw, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-text-muted" />
                <span className="text-sm text-text-primary">{kw}</span>
              </div>
              <button
                onClick={() => removeKeyword(i)}
                className="rounded p-1 text-text-muted hover:bg-red/10 hover:text-red transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {keywords.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-surface/50 px-4 py-6 text-center text-sm text-text-muted">
              No keywords yet. Add some from suggestions above or type your own.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'UK', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'NL', label: 'Netherlands' },
];

function StepSources({ onCanProceed }: { onCanProceed: (ok: boolean) => void }) {
  const [fbEnabled, setFbEnabled] = useState(false);
  const [igEnabled, setIgEnabled] = useState(false);
  const [fbCountry, setFbCountry] = useState('US');
  const [igCountry, setIgCountry] = useState('US');

  useEffect(() => {
    onCanProceed(fbEnabled || igEnabled);
  }, [fbEnabled, igEnabled, onCanProceed]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-text-primary">Configure Sources</h3>
        <p className="mt-1 text-sm text-text-muted">
          Enable at least one lead source. Each source scrapes a different channel
          for businesses matching your keywords.
        </p>
      </div>

      <div className={clsx(
        'rounded-xl border p-5 space-y-4 transition-colors',
        fbEnabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-surface-light',
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Share2 className="h-5 w-5 text-text-muted" />
            <div>
              <p className="text-sm font-medium text-text-primary">Facebook Ads</p>
              <p className="text-xs text-text-muted">Scrape Facebook Ad Library for active advertisers</p>
            </div>
          </div>
          <button
            onClick={() => setFbEnabled(!fbEnabled)}
            className={clsx(
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200',
              fbEnabled ? 'bg-primary' : 'bg-surface-lighter',
            )}
          >
            <span className={clsx(
              'inline-block h-5 w-5 rounded-full bg-white transition-transform duration-200',
              fbEnabled ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>
        {fbEnabled && (
          <label className="block">
            <span className="text-xs text-text-muted">Target Country</span>
            <select
              value={fbCountry}
              onChange={(e) => setFbCountry(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className={clsx(
        'rounded-xl border p-5 space-y-4 transition-colors',
        igEnabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-surface-light',
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-text-muted" />
            <div>
              <p className="text-sm font-medium text-text-primary">Instagram</p>
              <p className="text-xs text-text-muted">Scrape Instagram for business profiles and influencers</p>
            </div>
          </div>
          <button
            onClick={() => setIgEnabled(!igEnabled)}
            className={clsx(
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200',
              igEnabled ? 'bg-primary' : 'bg-surface-lighter',
            )}
          >
            <span className={clsx(
              'inline-block h-5 w-5 rounded-full bg-white transition-transform duration-200',
              igEnabled ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>
        {igEnabled && (
          <label className="block">
            <span className="text-xs text-text-muted">Target Country</span>
            <select
              value={igCountry}
              onChange={(e) => setIgCountry(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function StepSchedule() {
  const [dailyTarget, setDailyTarget] = useState(500);
  const [cronPreset, setCronPreset] = useState('0 6 * * *');
  const [launched, setLaunched] = useState(false);

  const PRESETS = [
    { label: 'Daily at 6 AM UTC', cron: '0 6 * * *' },
    { label: 'Daily at 8 AM UTC', cron: '0 8 * * *' },
    { label: 'Every 12 hours', cron: '0 */12 * * *' },
    { label: 'Weekdays at 6 AM', cron: '0 6 * * 1-5' },
  ];

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/schedule', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          cronExpression: cronPreset,
          dailyTarget,
          sourceWeights: { FACEBOOK_ADS: 60, INSTAGRAM: 40 },
          keywordRotationEnabled: true,
          keywordMaxUses: 10,
          timezone: 'UTC',
        }),
      }),
  });

  const runMutation = useMutation({
    mutationFn: () => apiFetch('/api/schedule/run-now', { method: 'POST' }),
    onSuccess: () => setLaunched(true),
  });

  async function handleLaunch() {
    await saveMutation.mutateAsync();
    await runMutation.mutateAsync();
  }

  if (launched) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-6">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-green/10">
          <Rocket className="h-10 w-10 text-green" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-bold text-text-primary">Pipeline Launched!</h3>
          <p className="mt-2 text-sm text-text-muted max-w-md">
            Your first run has been queued. Leads will start appearing in your dashboard shortly.
            It may take a few minutes for the first results.
          </p>
        </div>
        <a
          href="/"
          className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
        >
          Go to Dashboard
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-text-primary">Schedule & Launch</h3>
        <p className="mt-1 text-sm text-text-muted">
          Set your daily target and schedule, then launch your first pipeline run.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
        <label className="block">
          <span className="text-xs text-text-muted">Daily Lead Target</span>
          <input
            type="number"
            value={dailyTarget}
            onChange={(e) => setDailyTarget(parseInt(e.target.value, 10) || 0)}
            min={50}
            max={10000}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
          />
        </label>

        <div>
          <span className="text-xs text-text-muted">Schedule</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.cron}
                onClick={() => setCronPreset(p.cron)}
                className={clsx(
                  'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                  cronPreset === p.cron
                    ? 'border-primary bg-primary/10 text-primary-light'
                    : 'border-border bg-surface text-text-secondary hover:bg-surface-lighter',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleLaunch}
        disabled={saveMutation.isPending || runMutation.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green px-6 py-3.5 text-sm font-semibold text-white hover:bg-green/90 disabled:opacity-50 transition-colors"
      >
        {saveMutation.isPending || runMutation.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Play className="h-5 w-5" />
        )}
        Start First Run
      </button>

      {(saveMutation.isError || runMutation.isError) && (
        <div className="rounded-lg bg-red/10 px-4 py-3 text-sm text-red">
          Failed to launch: {((saveMutation.error ?? runMutation.error) as Error)?.message ?? 'Unknown error'}
        </div>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [canProceed, setCanProceed] = useState(false);
  const onboardingQuery = useOnboardingStatus();
  const providersQuery = useProviderSettings();

  const providers: ProviderInfo[] = Array.isArray(providersQuery.data)
    ? (providersQuery.data as ProviderInfo[])
    : [];

  if (onboardingQuery.isLoading || providersQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  const step = STEPS[currentStep];

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-20 md:pb-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-text-primary">Welcome to Hyperscale</h1>
        <p className="mt-2 text-sm text-text-muted">
          Let's get your lead generation pipeline up and running in a few minutes.
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === currentStep;
          const isCompleted = i < currentStep;
          return (
            <button
              key={s.key}
              onClick={() => i <= currentStep && setCurrentStep(i)}
              className={clsx(
                'flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-colors',
                isActive && 'bg-primary/10 text-primary-light ring-1 ring-primary/30',
                isCompleted && 'bg-green/10 text-green cursor-pointer',
                !isActive && !isCompleted && 'bg-surface-light text-text-muted',
              )}
            >
              {isCompleted ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="rounded-2xl border border-border bg-surface-light p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Step {currentStep + 1} of {STEPS.length}
          </p>
          <p className="mt-1 text-sm text-text-secondary">{step.description}</p>
        </div>

        {currentStep === 0 && (
          <StepApiKeys providers={providers} onCanProceed={setCanProceed} />
        )}
        {currentStep === 1 && (
          <StepKeywords onCanProceed={setCanProceed} />
        )}
        {currentStep === 2 && (
          <StepSources onCanProceed={setCanProceed} />
        )}
        {currentStep === 3 && (
          <StepSchedule />
        )}
      </div>

      {/* Navigation */}
      {currentStep < 3 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            className={clsx(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
              currentStep > 0
                ? 'bg-surface-lighter text-text-secondary hover:bg-surface-lighter/80'
                : 'text-text-muted cursor-not-allowed opacity-50',
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            onClick={() => setCurrentStep(Math.min(STEPS.length - 1, currentStep + 1))}
            disabled={!canProceed}
            className={clsx(
              'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors',
              canProceed
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-surface-lighter text-text-muted cursor-not-allowed',
            )}
          >
            Save & Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
