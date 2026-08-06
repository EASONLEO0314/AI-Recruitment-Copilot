import { describe, expect, it } from 'vitest';

import { isParserSnapshot } from '../validation';
import { buildProfileSnapshot, buildStatusSnapshot, normalizeText } from './snapshot';


const capturedAt = new Date('2026-07-29T02:00:00.000Z');


describe('parser snapshot boundary', () => {
  it('normalizes whitespace', () => {
    expect(normalizeText('  AI\n  工程师  ')).toBe('AI 工程师');
  });

  it('builds a partial anonymous resume profile snapshot', () => {
    const snapshot = buildProfileSnapshot('resume_frame', {
      display_name: '候选人甲',
      current_title: 'AI 工程师',
      experience_years: 3,
      education: [],
      work_experiences: [],
      project_experiences: [],
      skills: ['TypeScript'],
    }, capturedAt);

    expect(snapshot.captured_at).toBe('2026-07-29T02:00:00.000Z');
    expect(snapshot.status).toBe('partial');
    expect(snapshot.present_fields).toContain('current_title');
    expect(snapshot.missing_fields).toContain('work_experiences');
    expect(isParserSnapshot(snapshot)).toBe(true);
  });

  it('rejects non-whitelisted snapshot fields', () => {
    const snapshot = buildProfileSnapshot('resume_frame', {
      education: [],
      work_experiences: [],
      project_experiences: [],
      skills: [],
    }, capturedAt);

    expect(isParserSnapshot({ ...snapshot, innerHTML: '<main>forbidden</main>' })).toBe(false);
  });

  it('rejects a profile summary longer than 500 characters', () => {
    const snapshot = buildProfileSnapshot('resume_frame', {
      education: [],
      work_experiences: [],
      project_experiences: [],
      skills: [],
    }, capturedAt);

    expect(isParserSnapshot({
      ...snapshot,
      profile: { ...snapshot.profile, summary: 'x'.repeat(501) },
    })).toBe(false);
  });

  it('sanitizes a profile before coverage without mutating the input', () => {
    const input = {
      display_name: '  候选人乙  ',
      current_title: ` ${'T'.repeat(170)} `,
      experience_years: 81,
      expected_position: '  平台\n工程师 ',
      education: [
        {
          school: '  示例大学 ',
          degree: '   ',
          major: ' 计算机 ',
          raw_text: ' 示例大学\n计算机 本科 ',
        },
        { school: '   ' },
      ],
      work_experiences: [
        {
          company: ' 示例公司 ',
          description: ` ${'d'.repeat(510)} `,
          raw_text: ` ${'工'.repeat(2_010)} `,
        },
        { title: '   ' },
      ],
      project_experiences: [{
        name: ' 匿名项目 ',
        description: '  项目\n说明 ',
        raw_text: ' 匿名项目\n负责数据分析 ',
      }],
      skills: [' TypeScript ', 'TypeScript', '   ', ...Array.from({ length: 55 }, (_, index) => `技能${index}`)],
      summary: ` ${'s'.repeat(510)} `,
    };
    const original = structuredClone(input);

    const snapshot = buildProfileSnapshot('resume_frame', input, capturedAt);

    expect(input).toEqual(original);
    expect(snapshot.profile).toMatchObject({
      display_name: '候选人乙',
      current_title: 'T'.repeat(160),
      expected_position: '平台 工程师',
      education: [{
        school: '示例大学',
        major: '计算机',
        raw_text: '示例大学 计算机 本科',
      }],
      work_experiences: [{
        company: '示例公司',
        description: 'd'.repeat(500),
        raw_text: '工'.repeat(2_000),
      }],
      project_experiences: [{
        name: '匿名项目',
        description: '项目 说明',
        raw_text: '匿名项目 负责数据分析',
      }],
      summary: 's'.repeat(500),
    });
    expect(snapshot.profile?.experience_years).toBeUndefined();
    expect(snapshot.profile?.skills).toHaveLength(50);
    expect(snapshot.profile?.skills[0]).toBe('TypeScript');
    expect(snapshot.missing_fields).toEqual(['experience_years']);
  });

  it('sets ready only when every core field has a value in core-field order', () => {
    const snapshot = buildProfileSnapshot('recommend_frame', {
      experience_years: 0,
      education: [{ school: '匿名学校' }],
      work_experiences: [{ title: '工程师' }],
      project_experiences: [{ role: '开发' }],
      skills: ['TypeScript'],
    }, capturedAt);

    expect(snapshot.status).toBe('ready');
    expect(snapshot.present_fields).toEqual([
      'work_experiences',
      'education',
      'project_experiences',
      'skills',
      'experience_years',
    ]);
    expect(snapshot.missing_fields).toEqual([]);
  });

  it('uses only non-identifying structural fields in the fingerprint', () => {
    const base = {
      display_name: '候选人甲',
      current_title: '工程师',
      education: [{ school: '学校甲' }],
      work_experiences: [{ company: '公司甲', description: '正文甲' }],
      project_experiences: [{ name: '项目甲', description: '项目正文甲' }],
      skills: ['TypeScript'],
    };

    const first = buildProfileSnapshot('resume_frame', base, capturedAt);
    const identifyingDetailsChanged = buildProfileSnapshot('resume_frame', {
      ...base,
      display_name: '候选人乙',
      education: [{ school: '学校乙' }],
      work_experiences: [{ company: '公司乙', description: '正文乙' }],
      project_experiences: [{ name: '项目乙', description: '项目正文乙' }],
    }, capturedAt);
    const structureChanged = buildProfileSnapshot('resume_frame', {
      ...base,
      skills: ['TypeScript', 'Python'],
    }, capturedAt);

    expect(first.fingerprint).toMatch(/^v1-[0-9a-f]{8}$/);
    expect(identifyingDetailsChanged.fingerprint).toBe(first.fingerprint);
    expect(structureChanged.fingerprint).not.toBe(first.fingerprint);
  });

  it('builds profile-free status snapshots with safely normalized warnings', () => {
    expect(buildStatusSnapshot('logged_out', 'waiting', undefined, capturedAt)).toEqual({
      schema_version: 1,
      parser_version: 'boss-dom-v1',
      page_kind: 'logged_out',
      status: 'waiting',
      captured_at: '2026-07-29T02:00:00.000Z',
      present_fields: [],
      missing_fields: [],
      warnings: [],
    });

    const snapshot = buildStatusSnapshot(
      'unsupported',
      'unsupported',
      `  ${'w'.repeat(170)}\n`,
      capturedAt,
    );
    expect(snapshot.warnings).toEqual(['w'.repeat(160)]);
    expect(snapshot).not.toHaveProperty('profile');
    expect(snapshot).not.toHaveProperty('fingerprint');
    expect(isParserSnapshot(snapshot)).toBe(true);
  });

  it('strictly validates nested keys, bounds, arrays, and timestamps', () => {
    const valid = buildProfileSnapshot('resume_frame', {
      education: [{ school: '示例大学' }],
      work_experiences: [{ company: '示例公司' }],
      project_experiences: [{ name: '匿名项目' }],
      skills: ['TypeScript'],
    }, capturedAt);

    expect(isParserSnapshot({
      ...valid,
      profile: {
        ...valid.profile,
        education: [{ school: '示例大学', href: '/forbidden' }],
      },
    })).toBe(false);
    expect(isParserSnapshot({ ...valid, captured_at: 'not-a-date' })).toBe(false);
    expect(isParserSnapshot({ ...valid, warnings: Array(21).fill('warning') })).toBe(false);
    expect(isParserSnapshot({
      ...valid,
      profile: { ...valid.profile, experience_years: 3.5 },
    })).toBe(false);
    expect(isParserSnapshot({
      ...valid,
      profile: { ...valid.profile, work_experiences: Array(51).fill({ title: '工程师' }) },
    })).toBe(false);
    expect(isParserSnapshot({
      ...valid,
      profile: {
        ...valid.profile,
        education: [{ raw_text: 'x'.repeat(2_001) }],
      },
    })).toBe(false);
  });
});
