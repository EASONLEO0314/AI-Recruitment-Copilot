import type { PageKind, ParserSnapshot, ParserStatus } from '../contracts';
import type { ParserSelectionReason } from '../parser/client';


export interface FrameReadingDiagnostic {
  frameId: number;
  pageKind: PageKind;
  status: ParserStatus;
  warnings: string[];
}


interface PageReadingCardProps {
  snapshot: ParserSnapshot | null;
  frameDiagnostics?: FrameReadingDiagnostic[];
  selectedFrameId?: number;
  selectionReason?: ParserSelectionReason;
  onRefresh: () => void;
  refreshing: boolean;
}


const MISSING_FIELD_LABELS: Readonly<Record<string, string>> = {
  work_experiences: '工作经历',
  education: '教育经历',
  project_experiences: '项目经历',
  skills: '技能',
  experience_years: '工作年限',
};

const CORE_PROFILE_FIELDS = new Set([
  'work_experiences',
  'education',
  'project_experiences',
  'skills',
  'experience_years',
]);

const STRUCTURE_CLASS_FORMAT = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const STRUCTURE_CLASS_KEYWORD = /(?:resume|geek|candidate|recommend|history|experience|education|project|advantage|detail|work|school|company|position|degree|major|timeline)/i;
const STRUCTURE_TOPOLOGY_CLASS_KEYWORD = /(?:resume|geek|candidate|recommend|history|experience|education|project|advantage|detail|work|school|company|position|degree|major|timeline|title|item|content|section|box|header|body|summary|greet)/i;
const PROBE_PATH_TAG_FORMAT = /^[a-z][a-z0-9-]{0,15}$/;

const PAGE_KIND_LABELS: Readonly<Record<PageKind, string>> = {
  logged_out: '未登录',
  non_candidate: '页面外壳',
  recommend_frame: '推荐候选',
  resume_frame: '候选简历',
  unsupported: '未知页面',
};

const STATUS_LABELS: Readonly<Record<ParserStatus, string>> = {
  waiting: '等待',
  ready: '已读取',
  partial: '部分读取',
  unsupported: '未匹配',
  error: '错误',
};

const SELECTION_REASON_LABELS: Readonly<Record<ParserSelectionReason, string>> = {
  logged_out: '检测到未登录状态',
  profile_evidence: '已解析到候选人资料字段',
  semantic_headings: '检测到固定简历栏目',
  candidate_structure: '候选页面结构证据最多',
  page_state: '当前页面状态',
};

const HEADING_LABELS = {
  work: '工作',
  education: '教育',
  project: '项目',
} as const;


function structureNodeLabel(value: string): string | undefined {
  const tokens = value.split('+');
  if (tokens.length === 0
    || tokens.length > 3
    || tokens.some((token) => !STRUCTURE_CLASS_FORMAT.test(token)
      || !STRUCTURE_TOPOLOGY_CLASS_KEYWORD.test(token))) {
    return undefined;
  }
  return tokens.join(' + ');
}


function probeNumber(
  warnings: readonly string[],
  prefix: string,
  maximum: number,
): number | undefined {
  const warning = warnings.find((value) => value.startsWith(prefix));
  if (!warning) {
    return undefined;
  }
  const value = Number(warning.slice(prefix.length));
  return Number.isInteger(value) && value >= 0 && value <= maximum ? value : undefined;
}


function safeProbePath(value: string): string | undefined {
  const nodes = value.split('>');
  if (nodes.length === 0 || nodes.length > 5) {
    return undefined;
  }
  for (const node of nodes) {
    const [tag, ...classes] = node.split('.');
    if (!PROBE_PATH_TAG_FORMAT.test(tag)
      || classes.length > 2
      || classes.some((token) => !STRUCTURE_CLASS_FORMAT.test(token)
        || !STRUCTURE_TOPOLOGY_CLASS_KEYWORD.test(token))) {
      return undefined;
    }
  }
  return nodes.join(' → ');
}


function FrameDiagnostics({
  frames,
  selectedFrameId,
  selectionReason,
}: {
  frames: FrameReadingDiagnostic[];
  selectedFrameId?: number;
  selectionReason?: ParserSelectionReason;
}) {
  if (frames.length === 0) {
    return null;
  }

  return (
    <div className="arc-reading__frames" aria-label="匿名 frame 诊断">
      {selectedFrameId !== undefined && selectionReason && (
        <strong>
          已选择 frame {selectedFrameId} · {SELECTION_REASON_LABELS[selectionReason]}
        </strong>
      )}
      {frames.map((frame) => {
        const visibleElements = probeNumber(
          frame.warnings,
          'probe:visible-elements=',
          999,
        );
        const iframeCount = probeNumber(frame.warnings, 'probe:iframe-count=', 50);
        const canvasCount = probeNumber(frame.warnings, 'probe:canvas-count=', 50);
        const shadowCount = probeNumber(frame.warnings, 'probe:open-shadow-count=', 50);
        const wasmCount = probeNumber(frame.warnings, 'probe:wasm-class-count=', 50);
        const headings = (Object.keys(HEADING_LABELS) as Array<keyof typeof HEADING_LABELS>)
          .flatMap((kind) => {
            const count = probeNumber(frame.warnings, `probe:heading=${kind}:`, 9);
            return count === undefined ? [] : [`${HEADING_LABELS[kind]}×${count}`];
          });
        const paths = (Object.keys(HEADING_LABELS) as Array<keyof typeof HEADING_LABELS>)
          .flatMap((kind) => {
            const prefix = `probe:heading-path=${kind}:`;
            const warning = frame.warnings.find((value) => value.startsWith(prefix));
            const path = warning ? safeProbePath(warning.slice(prefix.length)) : undefined;
            return path ? [{ kind, path }] : [];
          });
        const facts = [
          visibleElements !== undefined ? `元素 ${visibleElements}` : undefined,
          iframeCount !== undefined ? `iframe ${iframeCount}` : undefined,
          canvasCount !== undefined ? `Canvas ${canvasCount}` : undefined,
          shadowCount !== undefined ? `Shadow ${shadowCount}` : undefined,
          wasmCount !== undefined ? `WASM ${wasmCount}` : undefined,
        ].filter((value): value is string => value !== undefined);

        return (
          <div className="arc-reading__frame" key={frame.frameId}>
            <b>
              frame {frame.frameId} · {PAGE_KIND_LABELS[frame.pageKind]} ·{' '}
              {STATUS_LABELS[frame.status]}
              {frame.frameId === selectedFrameId ? '（已选）' : ''}
            </b>
            {facts.length > 0 && <span>{facts.join(' · ')}</span>}
            {headings.length > 0 && <span>栏目：{headings.join('、')}</span>}
            {paths.map(({ kind, path }) => (
              <small key={kind}>{HEADING_LABELS[kind]}路径：{path}</small>
            ))}
          </div>
        );
      })}
    </div>
  );
}


function RecommendStructureReading({ snapshot }: { snapshot: ParserSnapshot }) {
  const cardCountWarning = snapshot.warnings.find((warning) =>
    /^structure:card-count=(?:[0-9]|[1-4][0-9]|50)$/.test(warning));
  const cardCount = cardCountWarning?.slice('structure:card-count='.length);
  const elementCount = snapshot.warnings
    .find((warning) => /^structure:element-count=(?:0|[1-9][0-9]{0,2})$/.test(warning))
    ?.slice('structure:element-count='.length);
  const iframeCount = snapshot.warnings
    .find((warning) => /^structure:iframe-count=(?:0|[1-4]?[0-9]|50)$/.test(warning))
    ?.slice('structure:iframe-count='.length);
  const openShadowCount = snapshot.warnings
    .find((warning) => /^structure:open-shadow-count=(?:0|[1-4]?[0-9]|50)$/.test(warning))
    ?.slice('structure:open-shadow-count='.length);
  const classTokens = snapshot.warnings
    .filter((warning) => warning.startsWith('structure:class='))
    .map((warning) => warning.slice('structure:class='.length))
    .filter((token) => STRUCTURE_CLASS_FORMAT.test(token) && STRUCTURE_CLASS_KEYWORD.test(token))
    .slice(0, 18);
  const classCounts = snapshot.warnings.flatMap((warning) => {
    const match = warning.match(/^structure:class-count=([A-Za-z][A-Za-z0-9_-]{0,47}):([1-9][0-9]{0,2})$/);
    if (!match || !STRUCTURE_TOPOLOGY_CLASS_KEYWORD.test(match[1])) {
      return [];
    }
    return [{ token: match[1], count: match[2] }];
  }).slice(0, 16);
  const structureEdges = snapshot.warnings.flatMap((warning) => {
    if (!warning.startsWith('structure:edge=')) {
      return [];
    }
    const nodes = warning.slice('structure:edge='.length).split('>');
    if (nodes.length !== 2) {
      return [];
    }
    const parent = structureNodeLabel(nodes[0]);
    const child = structureNodeLabel(nodes[1]);
    return parent && child ? [`${parent} → ${child}`] : [];
  }).slice(0, 16);

  return (
    <>
      <strong>已识别 BOSS 推荐页，但候选人结构未匹配</strong>
      {cardCount !== undefined && <span>旧选择器命中 {cardCount}</span>}
      {(elementCount !== undefined
        || iframeCount !== undefined
        || openShadowCount !== undefined) && (
        <div className="arc-reading__facts" aria-label="页面结构统计">
          {elementCount !== undefined && <span>可见元素 {elementCount}</span>}
          {iframeCount !== undefined && <span>iframe {iframeCount}</span>}
          {openShadowCount !== undefined && <span>开放 Shadow DOM {openShadowCount}</span>}
        </div>
      )}
      {classTokens.length > 0 && (
        <div className="arc-reading__skills" aria-label="页面结构 class">
          {classTokens.map((token) => <span key={token}>{token}</span>)}
        </div>
      )}
      {classCounts.length > 0 && (
        <div className="arc-reading__skills" aria-label="页面结构 class 计数">
          {classCounts.map(({ token, count }) => (
            <span key={token}>{token} ×{count}</span>
          ))}
        </div>
      )}
      {structureEdges.length > 0 && (
        <div className="arc-reading__topology" aria-label="页面结构父子关系">
          {structureEdges.map((edge) => <span key={edge}>{edge}</span>)}
        </div>
      )}
      <small>仅显示结构标识，不包含候选人正文</small>
    </>
  );
}


function ProfileReading({ snapshot }: { snapshot: ParserSnapshot }) {
  const profile = snapshot.profile;
  const presentCoreFields = new Set(
    snapshot.present_fields.filter((field) => CORE_PROFILE_FIELDS.has(field)),
  );
  const coverage = Math.round((presentCoreFields.size / CORE_PROFILE_FIELDS.size) * 100);
  const missingLabels = snapshot.missing_fields
    .map((field) => MISSING_FIELD_LABELS[field])
    .filter((label): label is string => Boolean(label));

  return (
    <>
      <span className="arc-reading__badge">BOSS 页面（仅本地）</span>
      <strong>{profile?.display_name ?? '当前候选人'}</strong>

      {(profile?.current_title || profile?.location || profile?.experience_years !== undefined) && (
        <div className="arc-reading__facts">
          {profile.current_title && <span>{profile.current_title}</span>}
          {profile.location && <span>{profile.location}</span>}
          {profile.experience_years !== undefined && (
            <span>{profile.experience_years} 年经验</span>
          )}
        </div>
      )}

      <div className="arc-reading__facts" aria-label="资料条目数量">
        <span>工作 {profile?.work_experiences.length ?? 0}</span>
        <span>教育 {profile?.education.length ?? 0}</span>
        <span>项目 {profile?.project_experiences.length ?? 0}</span>
      </div>

      <span>字段覆盖率 {coverage}%</span>

      {profile && profile.skills.length > 0 && (
        <div className="arc-reading__skills" aria-label="候选人技能">
          {profile.skills.map((skill) => <span key={skill}>{skill}</span>)}
        </div>
      )}

      {missingLabels.length > 0 && (
        <span className="arc-reading__missing">缺少：{missingLabels.join('、')}</span>
      )}

      <small>
        {snapshot.parser_version} · 读取于{' '}
        <time dateTime={snapshot.captured_at}>
          {new Date(snapshot.captured_at).toLocaleString()}
        </time>
      </small>
    </>
  );
}


function ReadingStatus({ snapshot }: { snapshot: ParserSnapshot | null }) {
  if (!snapshot) {
    return <strong>等待页面读取</strong>;
  }

  if (snapshot.page_kind === 'logged_out') {
    return (
      <>
        <strong>BOSS 当前未登录</strong>
        <span>扩展已加载，登录后才可读取候选人资料</span>
      </>
    );
  }

  if (snapshot.page_kind === 'non_candidate') {
    return <strong>当前页面没有可读取的候选人资料</strong>;
  }

  if (snapshot.page_kind === 'recommend_frame' && snapshot.status === 'unsupported') {
    return <RecommendStructureReading snapshot={snapshot} />;
  }

  if (snapshot.page_kind === 'unsupported' || snapshot.status === 'unsupported') {
    return <strong>当前页面结构暂不支持</strong>;
  }

  if (snapshot.status === 'error') {
    return <strong>页面读取失败，可手动重试</strong>;
  }

  if (snapshot.status === 'ready' || snapshot.status === 'partial') {
    return <ProfileReading snapshot={snapshot} />;
  }

  return <strong>等待页面读取</strong>;
}


export function PageReadingCard({
  snapshot,
  frameDiagnostics = [],
  selectedFrameId,
  selectionReason,
  onRefresh,
  refreshing,
}: PageReadingCardProps) {
  return (
    <section className="arc-reading" aria-labelledby="arc-reading-title">
      <div className="arc-section__heading">
        <h2 id="arc-reading-title">页面读取</h2>
        <button type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? '正在重新读取' : '重新读取页面'}
        </button>
      </div>
      <div className="arc-reading__status" role="status">
        <ReadingStatus snapshot={snapshot} />
      </div>
      <FrameDiagnostics
        frames={frameDiagnostics}
        selectedFrameId={selectedFrameId}
        selectionReason={selectionReason}
      />
    </section>
  );
}
