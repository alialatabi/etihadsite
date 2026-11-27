/**
 * PendingSubmit: the submit button of a server-action form. Idle markup must equal the plain
 * element it replaced (raw <button> or shadcn <Button>); while the form's action runs it is
 * disabled and aria-busy. useFormStatus is mocked because it only reports inside a live form.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => ({ pending: false }));
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  useFormStatus: () => ({ pending: status.pending, data: null, method: null, action: null }),
}));

import { PendingSubmit } from '@/components/admin/PendingSubmit';
import { btn } from '@/components/admin/kit';
import { Button } from '@/components/ui/button';

const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe('PendingSubmit idle markup equals the element it replaced', () => {
  beforeEach(() => {
    status.pending = false;
  });

  it('raw <button>', () => {
    const before = createElement('button', { type: 'submit', className: btn.outline }, 'x');
    const after = createElement(PendingSubmit, { className: btn.outline }, 'x');
    expect(render(after)).toBe(render(before));
    expect(render(after)).not.toContain('aria-busy');
    expect(render(after)).not.toContain('disabled=');
  });

  it('shadcn <Button>', () => {
    const cls = `${btn.primary} w-full`;
    const before = createElement(Button, { type: 'submit', className: cls }, 'x');
    const after = createElement(PendingSubmit, { shadcn: true, className: cls }, 'x');
    expect(render(after)).toBe(render(before));
  });

  it('shadcn <Button> with its own disabled (StatusForm: value === status)', () => {
    const before = createElement(Button, { type: 'submit', disabled: true, className: btn.primary }, 'x');
    const after = createElement(PendingSubmit, { shadcn: true, disabled: true, className: btn.primary }, 'x');
    expect(render(after)).toBe(render(before));
    expect(render(after)).toContain('disabled');
  });
});

describe('PendingSubmit while the action runs', () => {
  beforeEach(() => {
    status.pending = true;
  });

  it('raw button is disabled and aria-busy', () => {
    const html = render(createElement(PendingSubmit, { className: btn.danger }, 'x'));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(`class="${btn.danger}"`);
  });

  it('shadcn button is disabled and aria-busy', () => {
    const html = render(createElement(PendingSubmit, { shadcn: true, className: btn.primary }, 'x'));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it('stays disabled when pending is false but the caller disabled it, and when both', () => {
    status.pending = false;
    expect(render(createElement(PendingSubmit, { disabled: true }, 'x'))).toContain('disabled=""');
    status.pending = true;
    expect(render(createElement(PendingSubmit, { disabled: true }, 'x'))).toContain('disabled=""');
  });
});
