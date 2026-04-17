'use client';

import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Users,
  Bot,
  Database,
  Send,
  Tag,
  MessageSquare,
  Key,
  DollarSign,
  AlertTriangle,
  Settings,
  Play,
  FileText,
  Pause,
  Search,
} from 'lucide-react';

const pages = [
  { label: 'Health', href: '/', icon: Activity },
  { label: 'Leads', href: '/leads', icon: Users },
  { label: 'Sources', href: '/sources', icon: Database },
  { label: 'Keywords', href: '/keywords', icon: Tag },
  { label: 'Settings', href: '/settings', icon: Settings },
];

const actions = [
  { label: 'Run pipeline', icon: Play },
  { label: 'Generate daily report', icon: FileText },
  { label: 'Pause campaigns', icon: Pause },
  { label: 'Search leads...', icon: Search },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function navigate(href: string) {
    router.push(href);
    setOpen(false);
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface-light shadow-2xl">
            <Command className="flex flex-col" label="Command palette">
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="h-4 w-4 shrink-0 text-text-muted" />
                <Command.Input
                  placeholder="Type a command or search..."
                  className="h-12 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                  autoFocus
                />
              </div>
              <Command.List className="max-h-72 overflow-y-auto p-2">
                <Command.Empty className="py-6 text-center text-sm text-text-muted">
                  No results found.
                </Command.Empty>
                <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-muted">
                  {pages.map((page) => {
                    const Icon = page.icon;
                    return (
                      <Command.Item
                        key={page.href}
                        value={page.label}
                        onSelect={() => navigate(page.href)}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-secondary cursor-pointer transition-colors data-[selected=true]:bg-surface-lighter data-[selected=true]:text-text-primary"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {page.label}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
                <Command.Separator className="my-1 h-px bg-border" />
                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-muted">
                  {actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Command.Item
                        key={action.label}
                        value={action.label}
                        onSelect={() => setOpen(false)}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-secondary cursor-pointer transition-colors data-[selected=true]:bg-surface-lighter data-[selected=true]:text-text-primary"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {action.label}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              </Command.List>
              <div className="flex items-center gap-4 border-t border-border px-4 py-2.5">
                <span className="flex items-center gap-1 text-xs text-text-muted">
                  <kbd className="rounded bg-surface-lighter px-1.5 py-0.5 text-[10px] font-mono">↑↓</kbd> Navigate
                </span>
                <span className="flex items-center gap-1 text-xs text-text-muted">
                  <kbd className="rounded bg-surface-lighter px-1.5 py-0.5 text-[10px] font-mono">↵</kbd> Select
                </span>
                <span className="flex items-center gap-1 text-xs text-text-muted">
                  <kbd className="rounded bg-surface-lighter px-1.5 py-0.5 text-[10px] font-mono">esc</kbd> Close
                </span>
              </div>
            </Command>
          </div>
        </div>
      )}
    </>
  );
}
