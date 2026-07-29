import { describe, expect, it, vi } from 'vitest';

import { routeParserMessage } from './router';


const snapshot = {
  schema_version: 1,
  parser_version: 'boss-dom-v1',
  page_kind: 'logged_out',
  status: 'ready',
  captured_at: '2026-07-29T02:00:00.000Z',
  present_fields: [],
  missing_fields: [],
  warnings: [],
} as const;


describe('parser message router', () => {
  it('relays a valid frame snapshot only to frame zero in the same tab', async () => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    const result = await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot },
      { tab: { id: 17 }, frameId: 4, documentId: 'document-4' },
      sendToTab,
    );

    expect(result).toBe(true);
    expect(sendToTab).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledWith(17, {
      type: 'ARC_PARSER_RELAY',
      snapshot,
      source: { frame_id: 4, document_id: 'document-4' },
    }, { frameId: 0 });
  });

  it('uses safe source fallbacks when frame and document identifiers are missing', async () => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    const result = await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot },
      { tab: { id: 17 } },
      sendToTab,
    );

    expect(result).toBe(true);
    expect(sendToTab).toHaveBeenCalledWith(17, {
      type: 'ARC_PARSER_RELAY',
      snapshot,
      source: { frame_id: 0, document_id: 'unknown' },
    }, { frameId: 0 });
  });

  it('rejects refresh requests from child frames', async () => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_REFRESH' },
      { tab: { id: 17 }, frameId: 3 },
      sendToTab,
    )).toBe(false);
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it('broadcasts a frame-zero refresh without send options', async () => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_REFRESH' },
      { tab: { id: 17 }, frameId: 0 },
      sendToTab,
    )).toBe(true);
    expect(sendToTab).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledWith(
      17,
      { type: 'ARC_PARSER_REFRESH_COMMAND' },
    );
  });

  it('returns false when a frame-zero refresh broadcast rejects', async () => {
    const sendToTab = vi.fn().mockRejectedValue(new Error('send failed'));

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_REFRESH' },
      { tab: { id: 17 }, frameId: 0 },
      sendToTab,
    )).toBe(false);
    expect(sendToTab).toHaveBeenCalledWith(
      17,
      { type: 'ARC_PARSER_REFRESH_COMMAND' },
    );
  });

  it.each([
    ['missing tab id', { tab: {}, frameId: 0 }],
    ['NaN tab id', { tab: { id: Number.NaN }, frameId: 0 }],
    ['fractional tab id', { tab: { id: 17.5 }, frameId: 0 }],
  ])('rejects a message with %s', async (_label, sender) => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot },
      sender,
      sendToTab,
    )).toBe(false);
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it('rejects a snapshot with non-whitelisted DOM content', async () => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot: { ...snapshot, innerHTML: '<main>forbidden</main>' } },
      { tab: { id: 17 }, frameId: 4 },
      sendToTab,
    )).toBe(false);
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown message', { type: 'UNKNOWN' }],
    ['null', null],
    ['a string', 'ARC_PARSER_SNAPSHOT'],
  ])('rejects %s', async (_label, message) => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    expect(await routeParserMessage(
      message,
      { tab: { id: 17 }, frameId: 0 },
      sendToTab,
    )).toBe(false);
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it.each([
    ['an explicitly invalid frame id', { frameId: 1.5, documentId: 'document-4' }],
    ['an explicitly invalid document id', { frameId: 4, documentId: 42 as unknown as string }],
  ])('rejects a snapshot with %s', async (_label, source) => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot },
      { tab: { id: 17 }, ...source },
      sendToTab,
    )).toBe(false);
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it('returns false when sending rejects', async () => {
    const sendToTab = vi.fn().mockRejectedValue(new Error('send failed'));

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot },
      { tab: { id: 17 }, frameId: 4, documentId: 'document-4' },
      sendToTab,
    )).toBe(false);
  });

  it('returns false when sending throws synchronously', async () => {
    const sendToTab = vi.fn(() => {
      throw new Error('send failed');
    });

    expect(await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot },
      { tab: { id: 17 }, frameId: 4, documentId: 'document-4' },
      sendToTab,
    )).toBe(false);
  });
});
