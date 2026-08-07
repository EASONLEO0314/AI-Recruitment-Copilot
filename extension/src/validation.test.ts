import { describe, expect, it } from 'vitest';

import type { ParserSnapshot } from './contracts';
import * as validation from './validation';


const vueCapabilitySnapshot = {
  schema_version: 1,
  parser_version: 'boss-vue-v1',
  page_kind: 'recommend_frame',
  status: 'partial',
  captured_at: '2026-08-07T02:00:00.000Z',
  present_fields: [],
  missing_fields: [],
  warnings: [
    'vue-capability:root=lib-resume-recommend',
    'vue-capability:generation=vue2',
    'vue-capability:resume-object=resumeInfo',
  ],
} as unknown as ParserSnapshot;


function resumeReadValidators() {
  return validation as unknown as {
    isResumeReadRequest?: (value: unknown) => boolean;
    isResumeReadResponse?: (value: unknown) => boolean;
  };
}


describe('resume read request validation', () => {
  it('accepts only the fixed user-triggered request', () => {
    const { isResumeReadRequest } = resumeReadValidators();

    expect(isResumeReadRequest?.({ type: 'ARC_RESUME_READ' })).toBe(true);
    expect(isResumeReadRequest?.({ type: 'ARC_RESUME_READ', retry: true })).toBe(false);
    expect(isResumeReadRequest?.({ type: 'ARC_PARSER_REFRESH' })).toBe(false);
  });
});


describe('resume read response validation', () => {
  it('accepts a strictly validated Vue capability snapshot', () => {
    const { isResumeReadResponse } = resumeReadValidators();

    expect(validation.isParserSnapshot(vueCapabilitySnapshot)).toBe(true);
    expect(isResumeReadResponse?.({ ok: true, snapshot: vueCapabilitySnapshot })).toBe(true);
  });

  it('rejects unknown versions, extra keys, and oversized arrays', () => {
    const { isResumeReadResponse } = resumeReadValidators();

    expect(isResumeReadResponse?.({
      ok: true,
      snapshot: { ...vueCapabilitySnapshot, parser_version: 'unknown-v1' },
    })).toBe(false);
    expect(isResumeReadResponse?.({
      ok: true,
      snapshot: { ...vueCapabilitySnapshot, private_page_value: 'forbidden' },
    })).toBe(false);
    expect(isResumeReadResponse?.({
      ok: true,
      snapshot: { ...vueCapabilitySnapshot, warnings: Array(51).fill('bounded') },
    })).toBe(false);
  });

  it('accepts only fixed failure codes without diagnostic details', () => {
    const { isResumeReadResponse } = resumeReadValidators();

    expect(isResumeReadResponse?.({ ok: false, error: 'vue-root-not-found' })).toBe(true);
    expect(isResumeReadResponse?.({ ok: false, error: 'private exception text' })).toBe(false);
    expect(isResumeReadResponse?.({
      ok: false,
      error: 'vue-read-failed',
      detail: 'forbidden',
    })).toBe(false);
  });
});
