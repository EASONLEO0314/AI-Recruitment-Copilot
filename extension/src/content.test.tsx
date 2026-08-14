import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapContentScript } from './content';
import { mountCopilot } from './mount';


const coordinatorMocks = vi.hoisted(() => ({
  stop: vi.fn(),
  start: vi.fn(),
}));


vi.mock('./styles.css?inline', () => ({
  default: ':host { display: block; }',
}));

vi.mock('./components/CopilotPanel', () => ({
  CopilotPanel: () => <div>mock-copilot-panel</div>,
}));


vi.mock('./parser/coordinator', () => ({
  startParserCoordinator: coordinatorMocks.start,
}));


describe('content script bootstrap', () => {
  beforeEach(() => {
    document.querySelectorAll('#ai-recruitment-copilot-root').forEach((host) => host.remove());
    document.body.replaceChildren();
    coordinatorMocks.start.mockReturnValue({ stop: coordinatorMocks.stop });
  });

  afterEach(() => {
    document.querySelectorAll('#ai-recruitment-copilot-root').forEach((host) => host.remove());
  });

  it('mounts one isolated UI host in the top frame and starts the coordinator', async () => {
    const options = {
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/geek/job',
      isTopFrame: true,
    };

    const handle = bootstrapContentScript(options);

    expect(coordinatorMocks.start).toHaveBeenCalledOnce();
    expect(coordinatorMocks.start).toHaveBeenCalledWith(options);
    expect(document.querySelectorAll('#ai-recruitment-copilot-root')).toHaveLength(1);
    expect(handle.stop).toBe(coordinatorMocks.stop);
    await waitFor(() => {
      expect(document.querySelector('#ai-recruitment-copilot-root')?.shadowRoot?.textContent)
        .toContain('mock-copilot-panel');
    });
  });

  it('starts the coordinator without mounting UI in a child recommend frame', () => {
    const options = {
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
    };

    const handle = bootstrapContentScript(options);

    expect(coordinatorMocks.start).toHaveBeenCalledOnce();
    expect(coordinatorMocks.start).toHaveBeenCalledWith(options);
    expect(document.querySelector('#ai-recruitment-copilot-root')).toBeNull();
    expect(handle.stop).toBe(coordinatorMocks.stop);
  });

  it('temporarily hides the panel for explicit OCR screenshots', () => {
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean) | undefined;
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((nextListener) => {
            listener = nextListener;
          }),
        },
      },
    });

    bootstrapContentScript({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/geek/job',
      isTopFrame: true,
    });
    const host = document.querySelector('#ai-recruitment-copilot-root') as HTMLElement;
    const sendResponse = vi.fn();

    expect(listener?.({ type: 'ARC_PANEL_VISIBILITY', hidden: true }, {}, sendResponse))
      .toBe(false);
    expect(host.style.display).toBe('none');
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });

    listener?.({ type: 'ARC_PANEL_VISIBILITY', hidden: false }, {}, sendResponse);
    expect(host.style.display).toBe('');

    vi.unstubAllGlobals();
  });

  it('keeps the existing duplicate-mount protection', async () => {
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

  it('boots exactly once when the production runtime guard is available', async () => {
    vi.resetModules();
    coordinatorMocks.start.mockClear();
    coordinatorMocks.start.mockReturnValue({ stop: coordinatorMocks.stop });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn() },
    });

    await import('./content');
    await import('./content');

    expect(coordinatorMocks.start).toHaveBeenCalledOnce();
    expect(coordinatorMocks.start).toHaveBeenCalledWith(expect.objectContaining({
      targetDocument: document,
      isTopFrame: true,
    }));
    expect(coordinatorMocks.start.mock.calls[0][0].currentUrl()).toBe(location.href);
    expect(document.querySelectorAll('#ai-recruitment-copilot-root')).toHaveLength(1);
  });
});
