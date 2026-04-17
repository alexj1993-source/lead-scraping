'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  Settings as SettingsIcon,
  CheckCircle,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  AlertTriangle,
  Mail,
  Globe,
  Bot,
  Key,
  Shield,
  Search,
  Database,
  Users,
  Zap,
  Share2,
} from 'lucide-react';
import clsx from 'clsx';
import { useProviderSettings } from '@/lib/hooks';
import { ApiErrorState, ApiLoadingState } from '@/components/ui/api-state';
import { apiFetch } from '@/lib/api';

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

const providerIcons: Record<string, React.ReactNode> = {
  neverbounce: <Mail className="h-4 w-4" />,
  bounceban: <Mail className="h-4 w-4" />,
  instantly: <Mail className="h-4 w-4" />,
  anthropic: <Bot className="h-4 w-4" />,
  apollo: <Users className="h-4 w-4" />,
  snovio: <Search className="h-4 w-4" />,
  exa: <Search className="h-4 w-4" />,
  apify: <Share2 className="h-4 w-4" />,
  hetrixtools: <Shield className="h-4 w-4" />,
  getprospect: <Users className="h-4 w-4" />,
  lusha: <Database className="h-4 w-4" />,
  openai: <Zap className="h-4 w-4" />,
};

const providerCategories: { title: string; providers: string[] }[] = [
  {
    title: 'Email Validation',
    providers: ['neverbounce', 'bounceban'],
  },
  {
    title: 'Email Infrastructure',
    providers: ['instantly', 'hetrixtools'],
  },
  {
    title: 'Lead Enrichment',
    providers: ['apollo', 'snovio', 'getprospect', 'lusha'],
  },
  {
    title: 'AI & Search',
    providers: ['anthropic', 'openai', 'exa'],
  },
  {
    title: 'Scraping',
    providers: ['apify'],
  },
];

function ProviderRow({ provider }: { provider: ProviderInfo }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/settings/${provider.name}`, {
        method: 'PUT',
        body: JSON.stringify({ apiKey }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-settings'] });
      setEditing(false);
      setApiKey('');
      setTestResult(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiFetch<TestResult>(`/api/settings/${provider.name}/test`, {
        method: 'POST',
      }),
    onSuccess: (data) => setTestResult(data),
    onError: () =>
      setTestResult({ success: false, message: 'Network error' }),
  });

  const statusBadge = () => {
    if (testResult) {
      return testResult.success ? (
        <Badge variant="green">
          <CheckCircle className="mr-1 h-3 w-3" />
          Connected
        </Badge>
      ) : (
        <Badge variant="red">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    }
    if (provider.configured) {
      return <Badge variant="primary">Configured</Badge>;
    }
    return <Badge variant="muted">Not configured</Badge>;
  };

  return (
    <div className="rounded-lg border border-border/50 bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-text-muted">
            {providerIcons[provider.name] ?? <Globe className="h-4 w-4" />}
          </span>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {provider.label}
            </p>
            {provider.maskedKey && !editing && (
              <p className="text-xs text-text-muted font-mono mt-0.5">
                {provider.maskedKey}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge()}
          {provider.configured && !editing && (
            <button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className={clsx(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'bg-surface-lighter text-text-secondary hover:bg-surface-lighter/80',
                'disabled:opacity-50',
              )}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Test'
              )}
            </button>
          )}
          <button
            onClick={() => {
              setEditing(!editing);
              if (editing) {
                setApiKey('');
                setTestResult(null);
              }
            }}
            className={clsx(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              editing
                ? 'bg-red/10 text-red hover:bg-red/20'
                : 'bg-primary/10 text-primary-light hover:bg-primary/20',
            )}
          >
            {editing ? 'Cancel' : provider.configured ? 'Update' : 'Configure'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter ${provider.label} API key`}
              className={clsx(
                'w-full rounded-md border border-border bg-surface-light px-3 py-2 pr-9',
                'text-sm text-text-primary placeholder:text-text-muted/50',
                'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
              )}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              {showKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!apiKey || saveMutation.isPending}
            className={clsx(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              'bg-primary text-white hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      )}

      {testResult && (
        <p
          className={clsx(
            'text-xs',
            testResult.success ? 'text-green' : 'text-red',
          )}
        >
          {testResult.message}
        </p>
      )}

      {saveMutation.isError && (
        <p className="text-xs text-red">
          Failed to save:{' '}
          {saveMutation.error instanceof Error
            ? saveMutation.error.message
            : 'Unknown error'}
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const providersQuery = useProviderSettings();

  const providers: ProviderInfo[] = Array.isArray(providersQuery.data)
    ? (providersQuery.data as ProviderInfo[])
    : [];

  if (providersQuery.isLoading) return <ApiLoadingState />;
  if (providersQuery.isError) return <ApiErrorState onRetry={() => providersQuery.refetch()} />;

  const hasVaultWarning = providers.some((p) => p.vaultWarning);
  const configuredCount = providers.filter((p) => p.configured).length;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-text-muted" />
          <div>
            <h1 className="text-xl font-bold">API Settings</h1>
            <p className="text-sm text-text-muted">
              Configure your API provider keys. This is the first thing to set
              up &mdash; nothing works without valid API keys.
            </p>
          </div>
        </div>
        <Badge variant={configuredCount === providers.length ? 'green' : 'yellow'}>
          {configuredCount}/{providers.length} configured
        </Badge>
      </div>

      {hasVaultWarning && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow/30 bg-yellow/5 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow" />
          <div>
            <p className="text-sm font-medium text-yellow">
              Encryption Not Configured
            </p>
            <p className="mt-1 text-xs text-text-muted">
              The <code className="rounded bg-surface-lighter px-1">SESSION_ENCRYPTION_KEY</code>{' '}
              environment variable is not set. API keys cannot be stored securely
              until this is configured. Generate a 256-bit hex key:{' '}
              <code className="rounded bg-surface-lighter px-1">
                openssl rand -hex 32
              </code>
            </p>
          </div>
        </div>
      )}

      {providerCategories.map((category) => {
        const categoryProviders = category.providers
          .map((name) => providers.find((p) => p.name === name))
          .filter(Boolean) as ProviderInfo[];

        if (categoryProviders.length === 0) return null;

        return (
          <section
            key={category.title}
            className="rounded-xl border border-border bg-surface-light p-5 space-y-3"
          >
            <h2 className="text-sm font-medium text-text-primary">
              {category.title}
            </h2>
            <div className="space-y-2">
              {categoryProviders.map((provider) => (
                <ProviderRow key={provider.name} provider={provider} />
              ))}
            </div>
          </section>
        );
      })}

      <section className="rounded-xl border border-border bg-surface-light p-5 space-y-3">
        <h2 className="text-sm font-medium text-text-primary">
          <Key className="mr-2 inline h-4 w-4" />
          Security Info
        </h2>
        <div className="text-xs text-text-muted space-y-1">
          <p>
            All API keys are encrypted with AES-256-GCM before storage. Keys are
            never logged or exposed in API responses &mdash; only the last 4
            characters are displayed for identification.
          </p>
          <p>
            Connection tests make lightweight read-only API calls to verify
            credentials are valid.
          </p>
        </div>
      </section>
    </div>
  );
}
