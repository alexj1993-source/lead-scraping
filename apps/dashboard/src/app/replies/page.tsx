'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, ChevronDown, Star, Clock } from 'lucide-react';
import clsx from 'clsx';
import { useReplies } from '@/lib/hooks';
import { ApiErrorState, ApiEmptyState, ApiLoadingState } from '@/components/ui/api-state';

type Classification = 'POSITIVE' | 'INTERESTED' | 'NEUTRAL' | 'NOT_INTERESTED' | 'OUT_OF_OFFICE' | 'UNSUBSCRIBE';

interface Reply {
  id: string;
  from: string;
  company: string;
  email: string;
  classification: Classification;
  preview: string;
  fullThread: string[];
  suggestedResponse?: string;
  date: string;
}

const classificationConfig: Record<Classification, { label: string; variant: 'green' | 'yellow' | 'default' | 'red' | 'muted' | 'primary' }> = {
  POSITIVE: { label: 'Positive', variant: 'green' },
  INTERESTED: { label: 'Interested', variant: 'primary' },
  NEUTRAL: { label: 'Neutral', variant: 'default' },
  NOT_INTERESTED: { label: 'Not Interested', variant: 'yellow' },
  OUT_OF_OFFICE: { label: 'OOO', variant: 'muted' },
  UNSUBSCRIBE: { label: 'Unsubscribe', variant: 'red' },
};

const classificationOrder: Classification[] = ['POSITIVE', 'INTERESTED', 'NEUTRAL', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE'];

export default function RepliesPage() {
  const repliesQuery = useReplies();
  const replies: Reply[] = Array.isArray(repliesQuery.data) ? repliesQuery.data as Reply[] : [];
  const [filterClass, setFilterClass] = useState<Classification | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (repliesQuery.isLoading) return <ApiLoadingState />;
  if (repliesQuery.isError) return <ApiErrorState onRetry={() => repliesQuery.refetch()} />;
  if (!replies.length) return <ApiEmptyState title="No replies yet" description="Replies will appear here once leads respond to your campaigns." />;

  const filtered = filterClass ? replies.filter((r) => r.classification === filterClass) : replies;
  const positiveReplies = filtered.filter((r) => r.classification === 'POSITIVE');
  const otherReplies = filtered.filter((r) => r.classification !== 'POSITIVE');

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Replies</h1>
        <span className="text-sm text-text-muted">{filtered.length} replies</span>
      </div>

      {/* Classification filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterClass(null)}
          className={clsx(
            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px]',
            filterClass === null ? 'bg-primary text-white' : 'bg-surface-light text-text-secondary hover:bg-surface-lighter'
          )}
        >
          All ({replies.length})
        </button>
        {classificationOrder.map((cls) => {
          const count = replies.filter((r) => r.classification === cls).length;
          if (count === 0) return null;
          const config = classificationConfig[cls];
          return (
            <button
              key={cls}
              onClick={() => setFilterClass(filterClass === cls ? null : cls)}
              className={clsx(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px]',
                filterClass === cls
                  ? 'bg-primary text-white'
                  : cls === 'POSITIVE'
                    ? 'bg-green/10 text-green hover:bg-green/20 ring-1 ring-green/20'
                    : 'bg-surface-light text-text-secondary hover:bg-surface-lighter'
              )}
            >
              {config.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Hot leads pinned */}
      {positiveReplies.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-green" />
            <h2 className="text-sm font-medium text-green">Hot Leads</h2>
          </div>
          <div className="space-y-3">
            {positiveReplies.map((reply) => (
              <ReplyCard
                key={reply.id}
                reply={reply}
                expanded={expandedId === reply.id}
                onToggle={() => setExpandedId(expandedId === reply.id ? null : reply.id)}
                highlighted
              />
            ))}
          </div>
        </section>
      )}

      {/* Other replies */}
      {otherReplies.length > 0 && (
        <section>
          {positiveReplies.length > 0 && (
            <h2 className="mb-3 text-sm font-medium text-text-secondary">Other Replies</h2>
          )}
          <div className="space-y-3">
            {otherReplies.map((reply) => (
              <ReplyCard
                key={reply.id}
                reply={reply}
                expanded={expandedId === reply.id}
                onToggle={() => setExpandedId(expandedId === reply.id ? null : reply.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReplyCard({
  reply,
  expanded,
  onToggle,
  highlighted = false,
}: {
  reply: Reply;
  expanded: boolean;
  onToggle: () => void;
  highlighted?: boolean;
}) {
  const config = classificationConfig[reply.classification];

  return (
    <div
      className={clsx(
        'rounded-xl border bg-surface-light p-4 transition-all duration-200',
        highlighted ? 'border-green/30' : 'border-border'
      )}
    >
      <button onClick={onToggle} className="flex w-full items-start gap-3 text-left">
        <MessageSquare className={clsx('mt-0.5 h-5 w-5 shrink-0', highlighted ? 'text-green' : 'text-text-muted')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary">{reply.from}</span>
            <span className="text-xs text-text-muted">{reply.company}</span>
            <Badge variant={config.variant}>{config.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary line-clamp-2">{reply.preview}</p>
          <div className="mt-2 flex items-center gap-1 text-xs text-text-muted">
            <Clock className="h-3 w-3" />
            {reply.date}
          </div>
        </div>
        <ChevronDown className={clsx('mt-1 h-4 w-4 shrink-0 text-text-muted transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="mt-4 ml-8 space-y-3">
          <div className="space-y-2">
            {reply.fullThread.map((msg, i) => (
              <div
                key={i}
                className={clsx(
                  'rounded-lg p-3 text-sm leading-relaxed',
                  msg.startsWith('You:') || msg.startsWith('Auto-reply:')
                    ? 'bg-surface text-text-secondary'
                    : 'bg-green/5 border border-green/10 text-text-secondary'
                )}
              >
                {msg}
              </div>
            ))}
          </div>
          {reply.suggestedResponse && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-medium text-primary-light mb-1">Suggested Response</p>
              <p className="text-sm text-text-secondary">{reply.suggestedResponse}</p>
              <button className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark transition-colors min-h-[32px]">
                Send Response
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
