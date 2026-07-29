import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ParserSnapshot } from '../contracts';
import { buildProfileSnapshot, buildStatusSnapshot } from '../parser/snapshot';
import { PageReadingCard } from './PageReadingCard';


const capturedAt = new Date('2026-07-29T02:00:00.000Z');
const loggedOutSnapshot = buildStatusSnapshot(
  'logged_out',
  'ready',
  undefined,
  capturedAt,
);
const partialSnapshotBase = buildProfileSnapshot('resume_frame', {
  display_name: '候选人甲',
  current_title: '平台工程师',
  location: '上海',
  education: [],
  work_experiences: [],
  project_experiences: [],
  skills: ['TypeScript', 'React'],
}, capturedAt);
const partialSnapshot = {
  ...partialSnapshotBase,
  present_fields: [...partialSnapshotBase.present_fields, 'skills'],
};
const readySnapshot = buildProfileSnapshot('recommend_frame', {
  current_title: '算法工程师',
  experience_years: 0,
  education: [{ school: '匿名学校' }],
  work_experiences: [{ title: '工程师' }],
  project_experiences: [{ role: '开发' }],
  skills: ['Python'],
}, capturedAt);


describe('PageReadingCard', () => {
  it('shows the logged-out safe state and an explicit refresh button', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <PageReadingCard
        snapshot={loggedOutSnapshot}
        onRefresh={onRefresh}
        refreshing={false}
      />,
    );

    expect(screen.getByText('BOSS 当前未登录')).toBeInTheDocument();
    expect(screen.getByText('扩展已加载，登录后才可读取候选人资料')).toBeInTheDocument();
    expect(screen.queryByText('候选人甲')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新读取页面' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows a local partial profile with safe facts and missing-field labels', () => {
    render(
      <PageReadingCard snapshot={partialSnapshot} onRefresh={vi.fn()} refreshing={false} />,
    );

    expect(screen.getByText('BOSS 页面（仅本地）')).toBeInTheDocument();
    expect(screen.getByText('候选人甲')).toBeInTheDocument();
    expect(screen.getByText('平台工程师')).toBeInTheDocument();
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.getByText('工作 0')).toBeInTheDocument();
    expect(screen.getByText('教育 0')).toBeInTheDocument();
    expect(screen.getByText('项目 0')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText(/缺少：工作经历/)).toBeInTheDocument();
    expect(screen.getByText('字段覆盖率 20%')).toBeInTheDocument();
    expect(screen.getByText(/boss-dom-v1/)).toBeInTheDocument();
    expect(screen.getByText(/读取于/)).toBeInTheDocument();
    expect(screen.queryByText('真实评估')).not.toBeInTheDocument();
  });

  it('uses a safe fallback candidate label for a ready profile', () => {
    render(
      <PageReadingCard snapshot={readySnapshot} onRefresh={vi.fn()} refreshing={false} />,
    );

    expect(screen.getByText('当前候选人')).toBeInTheDocument();
    expect(screen.getByText('0 年经验')).toBeInTheDocument();
    expect(screen.getByText('字段覆盖率 100%')).toBeInTheDocument();
    expect(screen.queryByText(/缺少：/)).not.toBeInTheDocument();
  });

  it.each([
    [null, '等待页面读取'],
    [
      buildStatusSnapshot('non_candidate', 'ready', undefined, capturedAt),
      '当前页面没有可读取的候选人资料',
    ],
    [
      buildStatusSnapshot('unsupported', 'unsupported', 'page-structure-unknown', capturedAt),
      '当前页面结构暂不支持',
    ],
    [
      buildStatusSnapshot('resume_frame', 'error', 'parser-exception', capturedAt),
      '页面读取失败，可手动重试',
    ],
  ] satisfies [ParserSnapshot | null, string][])(
    'renders parser state %# without stale candidate text',
    (snapshot, expected) => {
      render(<PageReadingCard snapshot={snapshot} onRefresh={vi.fn()} refreshing={false} />);

      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByText('候选人甲')).not.toBeInTheDocument();
      expect(screen.queryByText(/字段覆盖率/)).not.toBeInTheDocument();
    },
  );

  it('never renders warning codes or arbitrary warning text verbatim', () => {
    const snapshot = {
      ...partialSnapshot,
      warnings: ['parser-exception', 'arbitrary-private-detail'],
    };

    render(<PageReadingCard snapshot={snapshot} onRefresh={vi.fn()} refreshing={false} />);

    expect(screen.queryByText('parser-exception')).not.toBeInTheDocument();
    expect(screen.queryByText('arbitrary-private-detail')).not.toBeInTheDocument();
  });

  it('disables page refresh while a request is in flight', () => {
    render(<PageReadingCard snapshot={loggedOutSnapshot} onRefresh={vi.fn()} refreshing />);

    expect(screen.getByRole('button', { name: '正在重新读取' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '重新读取页面' })).not.toBeInTheDocument();
  });
});
