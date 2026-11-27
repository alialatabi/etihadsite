/**
 * AdminNav pending cue: each pill's <Link> holds a NavPending child that reads useLinkStatus().
 * Idle it renders nothing (so the pill's markup is unchanged apart from `relative`); pending it
 * renders one aria-hidden, text-less, absolutely positioned pulse that respects reduced motion.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const link = vi.hoisted(() => ({ pending: false }));
vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => createElement('a', props),
  useLinkStatus: () => ({ pending: link.pending }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/stats' }));

import { AdminNav, NavPending } from '@/components/admin/AdminNav';

describe('NavPending', () => {
  beforeEach(() => {
    link.pending = false;
  });

  it('renders nothing while idle', () => {
    expect(renderToStaticMarkup(createElement(NavPending))).toBe('');
  });

  it('renders a text-less, aria-hidden, motion-safe pulse while pending', () => {
    link.pending = true;
    const html = renderToStaticMarkup(createElement(NavPending));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('motion-safe:animate-pulse');
    expect(html).toContain('absolute inset-0');
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
  });
});

describe('AdminNav', () => {
  it('has the pulse child inside every pill and no markup change when idle', () => {
    link.pending = false;
    const idle = renderToStaticMarkup(createElement(AdminNav, { designAlerts: 3 }));
    expect(idle.match(/<a /g)).toHaveLength(7);
    expect(idle).not.toContain('animate-pulse');
    expect(idle).toContain('aria-current="page"');

    link.pending = true;
    const pending = renderToStaticMarkup(createElement(AdminNav, { designAlerts: 3 }));
    expect(pending.match(/motion-safe:animate-pulse/g)).toHaveLength(7);
    // each pulse sits inside its link (before the closing tag)
    expect(pending.match(/<span aria-hidden="true"[^>]*><\/span><\/a>/g)).toHaveLength(7);
  });
});
