import { waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { mountCopilot } from './mount';


vi.mock('./styles.css?inline', () => ({
  default: ':host { display: block; }',
}));

vi.mock('./components/CopilotPanel', () => ({
  CopilotPanel: () => <div>mock-copilot-panel</div>,
}));


it('mounts one isolated Shadow DOM host even when called twice', async () => {
  const firstHost = mountCopilot(document);
  const secondHost = mountCopilot(document);

  expect(secondHost).toBe(firstHost);
  expect(document.querySelectorAll('#ai-recruitment-copilot-root')).toHaveLength(1);
  expect(firstHost.shadowRoot).not.toBeNull();
  expect(firstHost.shadowRoot?.querySelector('style')?.textContent).toContain(':host');
  await waitFor(() => {
    expect(firstHost.shadowRoot?.textContent).toContain('mock-copilot-panel');
  });
});
