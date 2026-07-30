import type { ParserSnapshot } from '../contracts';


interface PageReadingCardProps {
  snapshot: ParserSnapshot | null;
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
const STRUCTURE_CLASS_KEYWORD = /(?:resume|geek|candidate|recommend|history|experience|dialog|drawer|detail|job|expect|advantage|card|list|section|item|content|name|base|info)/i;


function RecommendStructureReading({ snapshot }: { snapshot: ParserSnapshot }) {
  const cardCountWarning = snapshot.warnings.find((warning) =>
    /^structure:card-count=(?:[0-9]|[1-4][0-9]|50)$/.test(warning));
  const cardCount = cardCountWarning?.slice('structure:card-count='.length);
  const classTokens = snapshot.warnings
    .filter((warning) => warning.startsWith('structure:class='))
    .map((warning) => warning.slice('structure:class='.length))
    .filter((token) => STRUCTURE_CLASS_FORMAT.test(token) && STRUCTURE_CLASS_KEYWORD.test(token))
    .slice(0, 18);

  return (
    <>
      <strong>已识别 BOSS 推荐页，但候选人结构未匹配</strong>
      {cardCount !== undefined && <span>旧版卡片匹配 {cardCount}</span>}
      {classTokens.length > 0 && (
        <div className="arc-reading__skills" aria-label="页面结构 class">
          {classTokens.map((token) => <span key={token}>{token}</span>)}
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
    </section>
  );
}
