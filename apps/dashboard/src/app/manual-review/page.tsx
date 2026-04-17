'use client';

import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Bot, CheckCircle, RotateCcw, Send, Inbox } from 'lucide-react';
import { useManualReview } from '@/lib/hooks';
import { ApiErrorState, ApiLoadingState } from '@/components/ui/api-state';

interface ReviewItem {
  id: string;
  trigger: string;
  triggerDetail: string;
  autoRemediation: string;
  paperclipRecommendation: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
}

const severityConfig: Record<string, { variant: 'red' | 'yellow' | 'primary'; label: string }> = {
  critical: { variant: 'red', label: 'Critical' },
  warning: { variant: 'yellow', label: 'Warning' },
  info: { variant: 'primary', label: 'Info' },
};

export default function ManualReviewPage() {
  const reviewQuery = useManualReview();
  const reviewItems: ReviewItem[] = Array.isArray(reviewQuery.data) ? reviewQuery.data as ReviewItem[] : [];

  if (reviewQuery.isLoading) return <ApiLoadingState />;
  if (reviewQuery.isError) return <ApiErrorState onRetry={() => reviewQuery.refetch()} />;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Manual Review</h1>
        <Badge variant={reviewItems.length === 0 ? 'green' : 'yellow'}>
          {reviewItems.length} pending
        </Badge>
      </div>

      {reviewItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface-light py-16">
          <Inbox className="h-12 w-12 text-text-muted mb-4" />
          <p className="text-lg font-medium text-text-primary">All clear</p>
          <p className="mt-1 text-sm text-text-muted">No items require manual review</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviewItems.map((item) => {
            const sev = severityConfig[item.severity];
            return (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-surface-light p-5 space-y-4"
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 text-${sev.variant}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary">{item.trigger}</p>
                      <Badge variant={sev.variant}>{sev.label}</Badge>
                      <span className="text-xs text-text-muted">{item.timestamp}</span>
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">{item.triggerDetail}</p>
                  </div>
                </div>

                {/* Auto-remediation */}
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-xs font-medium text-text-muted mb-1">Auto-remediation taken</p>
                  <p className="text-sm text-text-secondary">{item.autoRemediation}</p>
                </div>

                {/* Paperclip recommendation */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Bot className="h-3.5 w-3.5 text-primary-light" />
                    <p className="text-xs font-medium text-primary-light">Auto SDR&apos;s Recommendation</p>
                  </div>
                  <p className="text-sm text-text-secondary">{item.paperclipRecommendation}</p>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  <button className="flex items-center gap-1.5 rounded-lg bg-green/10 px-4 py-2 text-sm font-medium text-green hover:bg-green/20 transition-colors min-h-[40px]">
                    <CheckCircle className="h-4 w-4" />
                    Approve
                  </button>
                  <button className="flex items-center gap-1.5 rounded-lg bg-surface-lighter px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-lighter/80 transition-colors min-h-[40px]">
                    <RotateCcw className="h-4 w-4" />
                    Override
                  </button>
                  <button className="flex items-center gap-1.5 rounded-lg bg-surface-lighter px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-lighter/80 transition-colors min-h-[40px]">
                    <Send className="h-4 w-4" />
                    Send Back
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
