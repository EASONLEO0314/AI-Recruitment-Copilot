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

    expect(screen.getByText('DOM 摘要（仅本地）')).toBeInTheDocument();
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

  it('labels a Vue profile as an exact local read', () => {
    const snapshot: ParserSnapshot = {
      ...readySnapshot,
      parser_version: 'boss-vue-v1',
    };

    render(
      <PageReadingCard snapshot={snapshot} onRefresh={vi.fn()} refreshing={false} />,
    );

    expect(screen.getByText('Vue 精确读取（仅本地）')).toBeInTheDocument();
    expect(screen.getByText('工作 1')).toBeInTheDocument();
    expect(screen.getByText('教育 1')).toBeInTheDocument();
    expect(screen.getByText('项目 1')).toBeInTheDocument();
    expect(screen.queryByText('OCR')).not.toBeInTheDocument();
    expect(screen.queryByText('真实评估')).not.toBeInTheDocument();
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

  it('shows only safe structural diagnostics for an unsupported recommend frame', () => {
    const snapshot = {
      ...buildStatusSnapshot(
        'recommend_frame',
        'unsupported',
        'recommend-active-card-not-found',
        capturedAt,
      ),
      warnings: [
        'recommend-active-card-not-found',
        'structure:card-count=0',
        'structure:element-count=4',
        'structure:iframe-count=1',
        'structure:open-shadow-count=1',
        'structure:class=recommend-detail',
        'structure:class=resume-content',
        'structure:class-count=resume-simple-box:2',
        'structure:class-count=resume-item-detail:3',
        'structure:edge=resume-detail-wrap>resume-simple-box',
        'structure:edge=resume-simple-box>resume-item-detail+education',
        'structure:class=job-item',
        'arbitrary-private-detail',
      ],
    };

    render(<PageReadingCard snapshot={snapshot} onRefresh={vi.fn()} refreshing={false} />);

    expect(screen.getByText('已识别 BOSS 推荐页，但候选人结构未匹配')).toBeInTheDocument();
    expect(screen.getByText('旧选择器命中 0')).toBeInTheDocument();
    expect(screen.getByText('recommend-detail')).toBeInTheDocument();
    expect(screen.getByText('resume-content')).toBeInTheDocument();
    expect(screen.getByText('resume-simple-box ×2')).toBeInTheDocument();
    expect(screen.getByText('resume-item-detail ×3')).toBeInTheDocument();
    expect(screen.getByText('resume-detail-wrap → resume-simple-box')).toBeInTheDocument();
    expect(screen.getByText(
      'resume-simple-box → resume-item-detail + education',
    )).toBeInTheDocument();
    expect(screen.getByText('可见元素 4')).toBeInTheDocument();
    expect(screen.getByText('iframe 1')).toBeInTheDocument();
    expect(screen.getByText('开放 Shadow DOM 1')).toBeInTheDocument();
    expect(screen.queryByText('job-item')).not.toBeInTheDocument();
    expect(screen.queryByText('arbitrary-private-detail')).not.toBeInTheDocument();
    expect(screen.queryByText('recommend-active-card-not-found')).not.toBeInTheDocument();
  });

  it('shows every anonymous frame and the deterministic selection evidence', () => {
    const snapshot = {
      ...buildStatusSnapshot(
        'recommend_frame',
        'unsupported',
        undefined,
        capturedAt,
      ),
      warnings: ['probe:heading=work:1'],
    };

    render(
      <PageReadingCard
        snapshot={snapshot}
        frameDiagnostics={[
          {
            frameId: 0,
            pageKind: 'non_candidate',
            status: 'ready',
            warnings: [],
          },
          {
            frameId: 2,
            pageKind: 'recommend_frame',
            status: 'unsupported',
            warnings: [
              'probe:visible-elements=88',
              'probe:iframe-count=1',
              'probe:canvas-count=0',
              'probe:open-shadow-count=0',
              'probe:wasm-class-count=1',
              'probe:heading=work:1',
              'probe:heading=education:1',
              'probe:heading-path=work:main.resume-layout>section.work-experience>h2.title',
              'probe:heading-path=education:private candidate text',
            ],
          },
        ]}
        selectedFrameId={2}
        selectionReason="semantic_headings"
        onRefresh={vi.fn()}
        refreshing={false}
      />,
    );

    expect(screen.getByText('已选择 frame 2 · 检测到固定简历栏目')).toBeInTheDocument();
    expect(screen.getByText(/frame 0 · 页面外壳 · 已读取/)).toBeInTheDocument();
    expect(screen.getByText(/frame 2 · 推荐候选 · 未匹配/)).toBeInTheDocument();
    expect(screen.getByText(/元素 88/)).toBeInTheDocument();
    expect(screen.getByText(/iframe 1/)).toBeInTheDocument();
    expect(screen.getByText(/Canvas 0/)).toBeInTheDocument();
    expect(screen.getByText(/WASM 1/)).toBeInTheDocument();
    expect(screen.getByText('栏目：工作×1、教育×1')).toBeInTheDocument();
    expect(screen.getByText(
      '工作路径：main.resume-layout → section.work-experience → h2.title',
    )).toBeInTheDocument();
    expect(screen.queryByText(/private candidate text/)).not.toBeInTheDocument();
  });

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

  it('triggers one explicit resume read and disables it while in flight', async () => {
    const user = userEvent.setup();
    const onReadResume = vi.fn();
    const { rerender } = render(
      <PageReadingCard
        snapshot={partialSnapshot}
        onRefresh={vi.fn()}
        refreshing={false}
        onReadResume={onReadResume}
        resumeReading={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: '读取当前简历' }));
    expect(onReadResume).toHaveBeenCalledOnce();

    rerender(
      <PageReadingCard
        snapshot={partialSnapshot}
        onRefresh={vi.fn()}
        refreshing={false}
        onReadResume={onReadResume}
        resumeReading
      />,
    );
    expect(screen.getByRole('button', { name: '正在读取简历' })).toBeDisabled();
  });

  it('shows only safe Vue capability and top-level schema metadata', () => {
    const resumeSnapshot: ParserSnapshot = {
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
        'vue-capability:key=geekBaseInfo',
        'vue-capability:key=geekWorkExpList',
        'vue-capability:array=geekWorkExpList:3',
        'vue-schema:key=professionalSkillInfo:string',
        'vue-schema:key=unknownList:array:3',
        'vue-schema:key=bad-key:string',
        'vue-schema:key=privateValue:string:候选人值',
        'vue-nested-schema:container=geekDetailInfo:key=professionalSkill:string',
        'vue-nested-schema:container=geekDetailInfo:key=skillItems:array:3',
        'vue-nested-schema:container=geekQuestInfoVO:key=privateValue:string',
        'vue-nested-schema:container=geekDetailInfo:key=bad-key:string',
        'vue-nested-schema:container=geekDetailInfo:key=privateValue:string:候选人值',
        'private-candidate-value',
      ],
    };

    render(
      <PageReadingCard
        snapshot={partialSnapshot}
        onRefresh={vi.fn()}
        refreshing={false}
        onReadResume={vi.fn()}
        resumeReading={false}
        resumeSnapshot={resumeSnapshot}
      />,
    );

    expect(screen.getByText('已找到可读取的 resumeInfo')).toBeInTheDocument();
    expect(screen.getByText('推荐简历根')).toBeInTheDocument();
    expect(screen.getByText('Vue 2')).toBeInTheDocument();
    expect(screen.getByText('允许字段 2')).toBeInTheDocument();
    expect(screen.getByText('工作经历 3')).toBeInTheDocument();
    expect(screen.getByText('resumeInfo 顶层字段（仅结构）')).toBeInTheDocument();
    expect(screen.getByText('professionalSkillInfo · 字符串')).toBeInTheDocument();
    expect(screen.getByText('unknownList · 数组 3')).toBeInTheDocument();
    expect(screen.getByText('geekDetailInfo 下一层字段（仅结构）')).toBeInTheDocument();
    expect(screen.getByText('professionalSkill · 字符串')).toBeInTheDocument();
    expect(screen.getByText('skillItems · 数组 3')).toBeInTheDocument();
    expect(screen.queryByText(/geekQuestInfoVO/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bad-key/)).not.toBeInTheDocument();
    expect(screen.queryByText(/候选人值/)).not.toBeInTheDocument();
    expect(screen.queryByText('private-candidate-value')).not.toBeInTheDocument();
  });

  it.each([
    ['vue-root-not-found', '未找到当前简历，请先手动打开候选人简历'],
    ['vue-instance-not-found', '当前页面未暴露可读取的简历数据'],
    ['vue-resume-data-unavailable', '未获取到完整简历，可稍后评估 OCR 方案'],
    ['vue-schema-unsupported', '检测到新的简历结构，暂未适配'],
    ['vue-result-invalid', '页面读取结果无效，已安全丢弃'],
    ['vue-read-failed', '简历读取失败，可手动重试'],
  ] as const)('shows the fixed error copy for %s', (resumeReadError, message) => {
    render(
      <PageReadingCard
        snapshot={partialSnapshot}
        onRefresh={vi.fn()}
        refreshing={false}
        onReadResume={vi.fn()}
        resumeReading={false}
        resumeReadError={resumeReadError}
      />,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
