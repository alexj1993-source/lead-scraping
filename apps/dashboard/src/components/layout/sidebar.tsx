'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
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
  Calendar,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

const allNavItems = [
  { href: '/', label: 'Health', icon: Activity },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/paperclip', label: 'Auto SDR', icon: Bot, hidden: true },
  { href: '/sources', label: 'Sources', icon: Database },
  { href: '/campaigns', label: 'Campaigns', icon: Send, hidden: true },
  { href: '/keywords', label: 'Keywords', icon: Tag },
  { href: '/deliverability', label: 'Deliverability', icon: Shield, hidden: true },
  { href: '/schedule', label: 'Schedule', icon: Calendar, hidden: true },
  { href: '/replies', label: 'Replies', icon: MessageSquare, hidden: true },
  { href: '/sessions', label: 'Sessions', icon: Key, hidden: true },
  { href: '/budgets', label: 'Budgets', icon: DollarSign, hidden: true },
  { href: '/manual-review', label: 'Review', icon: AlertTriangle, hidden: true },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const navItems = allNavItems.filter((item) => !item.hidden);

const mobileNavItems = [
  { href: '/', label: 'Health', icon: Activity },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/sources', label: 'Sources', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMore, setMobileMore] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'hidden md:flex flex-col border-r border-border bg-surface transition-all duration-300',
          collapsed ? 'w-16' : 'w-56'
        )}
      >
        <div className={clsx('flex items-center border-b border-border px-4 py-4', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && (
            <span className="text-sm font-bold tracking-tight text-primary-light">Hyperscale</span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-light hover:text-text-secondary"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'group flex items-center gap-3 rounded-lg mx-2 min-h-[40px] transition-colors duration-200',
                  collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
                  active
                    ? 'bg-primary/10 text-primary-light'
                    : 'text-text-secondary hover:bg-surface-light hover:text-text-primary'
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border px-3 py-3">
          <div className="flex items-center justify-between">
            <ThemeToggle collapsed={collapsed} />
            {!collapsed && (
              <div className="flex items-center gap-1.5">
                <kbd className="rounded bg-surface-lighter px-1.5 py-0.5 text-[10px] font-mono text-text-muted">
                  ⌘K
                </kbd>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex md:hidden border-t border-border bg-surface/95 backdrop-blur-sm safe-area-bottom">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex flex-1 flex-col items-center gap-1 py-2 min-h-[56px] justify-center transition-colors',
                active ? 'text-primary-light' : 'text-text-muted'
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
        <div className="relative flex flex-1 flex-col items-center">
          <button
            onClick={() => setMobileMore(!mobileMore)}
            className={clsx(
              'flex flex-1 flex-col items-center gap-1 py-2 min-h-[56px] justify-center transition-colors w-full',
              mobileMore ? 'text-primary-light' : 'text-text-muted'
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
          {mobileMore && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMobileMore(false)} />
              <div className="absolute bottom-full right-0 z-50 mb-2 mr-2 w-48 rounded-xl border border-border bg-surface-light py-2 shadow-xl">
                {navItems
                  .filter((item) => !mobileNavItems.some((m) => m.href === item.href))
                  .map((item) => {
                    const Icon = item.icon;
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMore(false)}
                        className={clsx(
                          'flex items-center gap-3 px-4 py-2.5 min-h-[44px] transition-colors',
                          active
                            ? 'bg-primary/10 text-primary-light'
                            : 'text-text-secondary hover:bg-surface-lighter'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-sm">{item.label}</span>
                      </Link>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </nav>
    </>
  );
}
