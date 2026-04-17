'use client';

import { AlertCircle, RefreshCw, Server } from 'lucide-react';

interface ApiErrorStateProps {
  title?: string;
  onRetry?: () => void;
}

export function ApiErrorState({ title = 'Cannot connect to API', onRetry }: ApiErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="rounded-full bg-yellow-500/10 p-3">
        <Server className="h-6 w-6 text-yellow-400" />
      </div>
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      <p className="max-w-sm text-center text-sm text-gray-400">
        Start the backend API server to see live data here.
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-light px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-lighter transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

interface ApiEmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
}

export function ApiEmptyState({ icon, title = 'No data yet', description }: ApiEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      {icon && <div className="rounded-full bg-surface-lighter p-3">{icon}</div>}
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {description && <p className="max-w-sm text-center text-sm text-gray-400">{description}</p>}
    </div>
  );
}

export function ApiLoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  );
}
