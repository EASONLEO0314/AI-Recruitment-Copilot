import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import {
  ApiError,
  getAdminDashboard,
  getAssessmentRecords,
  getHealth,
  getKnowledgeAliases,
  getKnowledgeJobDetail,
  getKnowledgeJobs,
  getKnowledgeQuality,
  getMatchAssessment,
  getMatchExplanation,
  getScoringStandard,
} from '../api';
import type {
  AdminDashboardResponse,
  AssessmentRecordSummary,
  CandidateProfile,
  ConnectionState,
  KnowledgeAliasItem,
  KnowledgeJobDetailResponse,
  KnowledgeJobOption,
  KnowledgeQualityResponse,
  MatchAssessmentResponse,
  MatchEvidence,
  ParserRelayMessage,
  PersonalizedFollowUpQuestion,
  ResumeReadErrorCode,
  ScoringStandard,
} from '../contracts';
import {
  composeCandidateReading,
  requestParserRefresh,
  requestResumeRead,
  selectBestParserRelay,
  type SessionParserSnapshot,
  subscribeToParserRelays,
  upsertParserRelay,
} from '../parser/client';
import { PageReadingCard } from './PageReadingCard';


const START_COMMAND =
  'scripts\\python.cmd -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765';

type AssessmentStatus = 'idle' | 'ready' | 'assessing' | 'success' | 'error';
type ExplanationStatus = 'idle' | 'enhancing' | 'error';
type StandardStatus = 'idle' | 'loading' | 'error';
type ViewMode = 'screening' | 'admin';
type AdminStatus = 'idle' | 'loading' | 'success' | 'error';
type PanelDock = 'left' | 'right';
type ScoringWeightKey = 'skills' | 'experience_years' | 'education' | 'experience_evidence';
type ScoringWeights = Record<ScoringWeightKey, number>;
type PanelLayout = {
  dock: PanelDock;
  top: number;
};
type StoredPanelLayout = PanelLayout & {
  collapsed: boolean;
};
type PanelDragState = {
  kind: 'panel' | 'rail';
  pointerOffsetY: number;
};

const SCORING_WEIGHT_KEYS: ScoringWeightKey[] = [
  'skills',
  'experience_years',
  'education',
  'experience_evidence',
];
const SCORING_WEIGHT_LABELS: Record<ScoringWeightKey, string> = {
  skills: '技能',
  experience_years: '年限',
  education: '学历',
  experience_evidence: '经历',
};
const PANEL_LAYOUT_STORAGE_KEY = 'arc-panel-layout-v1';
const PANEL_WIDTH = 408;
const PANEL_MIN_HEIGHT = 520;
const PANEL_MOBILE_MIN_HEIGHT = 420;
const RAIL_ESTIMATED_HEIGHT = 184;
const PANEL_EDGE_GAP = 16;
const PANEL_MOBILE_EDGE_GAP = 12;
const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  dock: 'right',
  top: PANEL_EDGE_GAP,
};


function viewportSize() {
  return {
    width: Math.max(window.innerWidth || 0, 360),
    height: Math.max(window.innerHeight || 0, 520),
  };
}


function edgeGapForWidth(width: number): number {
  return width <= 720 ? PANEL_MOBILE_EDGE_GAP : PANEL_EDGE_GAP;
}


function minPanelHeightForWidth(width: number): number {
  return width <= 720 ? PANEL_MOBILE_MIN_HEIGHT : PANEL_MIN_HEIGHT;
}


function clampPanelTop(top: number): number {
  const { width, height } = viewportSize();
  const edgeGap = edgeGapForWidth(width);
  const minHeight = minPanelHeightForWidth(width);
  const maxTop = Math.max(edgeGap, height - minHeight - edgeGap);
  const normalizedTop = Number.isFinite(top) ? top : edgeGap;
  return Math.round(Math.min(Math.max(normalizedTop, edgeGap), maxTop));
}


function clampRailTop(top: number): number {
  const { width, height } = viewportSize();
  const edgeGap = edgeGapForWidth(width);
  const maxTop = Math.max(edgeGap, height - RAIL_ESTIMATED_HEIGHT - edgeGap);
  const normalizedTop = Number.isFinite(top) ? top : edgeGap;
  return Math.round(Math.min(Math.max(normalizedTop, edgeGap), maxTop));
}


function normalizeDock(value: unknown): PanelDock {
  return value === 'left' ? 'left' : 'right';
}


function normalizeStoredPanelLayout(value: unknown): StoredPanelLayout | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<StoredPanelLayout>;
  const collapsed = candidate.collapsed === true;
  return {
    dock: normalizeDock(candidate.dock),
    top: collapsed ? clampRailTop(Number(candidate.top)) : clampPanelTop(Number(candidate.top)),
    collapsed,
  };
}


function chromeStorageArea(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }
  return chrome.storage.local;
}


function loadStoredPanelLayout(): Promise<StoredPanelLayout | null> {
  const storage = chromeStorageArea();
  if (!storage) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    storage.get(PANEL_LAYOUT_STORAGE_KEY, (result) => {
      if (chrome.runtime?.lastError) {
        resolve(null);
        return;
      }
      resolve(normalizeStoredPanelLayout(result[PANEL_LAYOUT_STORAGE_KEY]));
    });
  });
}


function saveStoredPanelLayout(layout: StoredPanelLayout): void {
  const storage = chromeStorageArea();
  if (!storage) {
    return;
  }
  storage.set({ [PANEL_LAYOUT_STORAGE_KEY]: layout });
}


function panelPlacementStyle(layout: PanelLayout): CSSProperties {
  const { width } = viewportSize();
  const edgeGap = edgeGapForWidth(width);
  const top = clampPanelTop(layout.top);
  return {
    top: `${top}px`,
    left: layout.dock === 'left' ? `${edgeGap}px` : 'auto',
    right: layout.dock === 'right' ? `${edgeGap}px` : 'auto',
    height: `calc(100vh - ${top + edgeGap}px)`,
  };
}


function railPlacementStyle(layout: PanelLayout): CSSProperties {
  const top = clampRailTop(layout.top);
  return { top: `${top}px` };
}


function ConnectionPill({ state }: { state: ConnectionState }) {
  const label = {
    connecting: '正在连接',
    online: '本机服务在线',
    offline: '本机服务离线',
  }[state];

  return (
    <span className={`arc-status arc-status--${state}`}>
      <span className="arc-status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}


function LoadingState() {
  return (
    <div className="arc-state" role="status">
      <span className="arc-spinner" aria-hidden="true" />
      <strong>正在连接本机分析服务</strong>
      <span>首次启动通常只需要几秒钟</span>
    </div>
  );
}


function OfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="arc-state arc-state--offline">
      <span className="arc-state__icon" aria-hidden="true">!</span>
      <strong>本机服务未连接</strong>
      <span>请在项目根目录运行：</span>
      <code>{START_COMMAND}</code>
      <button className="arc-button arc-button--primary" type="button" onClick={onRetry}>
        重新连接
      </button>
    </div>
  );
}


function hasScoringSignal(profile: CandidateProfile | undefined): profile is CandidateProfile {
  if (!profile) {
    return false;
  }
  return profile.skills.length > 0
    || profile.education.length > 0
    || profile.work_experiences.length > 0
    || profile.project_experiences.length > 0
    || profile.experience_years !== undefined
    || Boolean(profile.summary);
}


function evidenceLabel(evidence: MatchEvidence): string {
  const prefix = evidence.concept ? `${evidence.concept}: ` : '';
  return `${prefix}${evidence.text}`;
}


function eligibilityLabel(status: MatchAssessmentResponse['eligibility']): string {
  if (!status) {
    return '基础条件：未分层';
  }
  return {
    pass: '基础条件：通过',
    review: '基础条件：待核实',
    fail: '基础条件：未通过',
  }[status.status];
}


function potentialLabel(level: MatchAssessmentResponse['potential_level']): string {
  if (!level) {
    return '';
  }
  return {
    high: '潜力：较高',
    medium: '潜力：中等',
    low: '潜力：较低',
  }[level];
}


function weightsFromStandard(standard: ScoringStandard): ScoringWeights {
  const values = Object.fromEntries(
    standard.dimensions.map((dimension) => [dimension.key, dimension.weight]),
  );
  return {
    skills: Number(values.skills ?? 0),
    experience_years: Number(values.experience_years ?? 0),
    education: Number(values.education ?? 0),
    experience_evidence: Number(values.experience_evidence ?? 0),
  };
}


function scoringWeightTotal(weights: ScoringWeights | null): number {
  if (!weights) {
    return 100;
  }
  return SCORING_WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0);
}


function scoringWeightsAreValid(weights: ScoringWeights | null): boolean {
  return !weights || (
    scoringWeightTotal(weights) === 100
    && SCORING_WEIGHT_KEYS.every((key) => Number.isInteger(weights[key])
      && weights[key] >= 0
      && weights[key] <= 100)
  );
}


function assessmentErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'BACKEND_UNAVAILABLE') {
      return '评分服务不可用，请确认本机后端正在运行。';
    }
    if (error.code === 'INVALID_RESPONSE') {
      return '评分服务返回格式异常，请刷新后重试。';
    }
    return error.message;
  }
  return '评分失败，请稍后重试。';
}


function candidateAssessmentKey(reading: SessionParserSnapshot | null): string {
  if (!reading) {
    return '';
  }
  const snapshot = reading.snapshot;
  if (!snapshot?.profile || !hasScoringSignal(snapshot.profile)) {
    return '';
  }
  return [
    reading.session_id,
    snapshot.fingerprint ?? 'no-fingerprint',
    snapshot.captured_at,
    snapshot.page_kind,
    snapshot.parser_version,
  ].join(':');
}


function sameAssessmentFacts(
  current: MatchAssessmentResponse,
  next: MatchAssessmentResponse,
): boolean {
  return current.mode === next.mode
    && current.job_id === next.job_id
    && current.total_score === next.total_score
    && current.fit_score === next.fit_score
    && JSON.stringify(current.eligibility) === JSON.stringify(next.eligibility)
    && JSON.stringify(current.scoring_standard) === JSON.stringify(next.scoring_standard)
    && JSON.stringify(current.concept_graph) === JSON.stringify(next.concept_graph)
    && JSON.stringify(current.dimensions) === JSON.stringify(next.dimensions)
    && JSON.stringify(current.risk_flags) === JSON.stringify(next.risk_flags)
    && JSON.stringify(current.missing_information) === JSON.stringify(next.missing_information)
    && JSON.stringify(current.evidence) === JSON.stringify(next.evidence);
}


function explanationBadgeText(
  assessment: MatchAssessmentResponse,
  explanationStatus: ExplanationStatus,
): string {
  if (explanationStatus === 'enhancing') {
    return 'AI 解释生成中';
  }
  if (assessment.llm_enhancement === 'cached') {
    return 'LLM 缓存解释';
  }
  if (assessment.llm_enhancement === 'timeout') {
    return 'AI 超时降级';
  }
  if (assessment.explanation_source === 'llm') {
    return 'LLM 辅助解释';
  }
  return '规则解释';
}


function shortFingerprint(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}


function compactList(values: string[], limit = 8): string {
  if (values.length === 0) {
    return '暂无';
  }
  const shown = values.slice(0, limit).join('、');
  return values.length > limit ? `${shown} +${values.length - limit}` : shown;
}


function formatAssessedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}


function personalizedFollowUpKey(question: PersonalizedFollowUpQuestion, index: number): string {
  return `${index}:${question.question}:${question.evidence_anchor}`;
}


function personalizedFollowUpCopy(question: PersonalizedFollowUpQuestion): string {
  return question.copy_text || question.question;
}


function formatPersonalizedFollowUps(questions: PersonalizedFollowUpQuestion[]): string {
  return questions
    .map((question, index) => `${index + 1}. ${personalizedFollowUpCopy(question)}`)
    .join('\n');
}


export function CopilotPanel() {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [assessment, setAssessment] = useState<MatchAssessmentResponse | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<AssessmentStatus>('idle');
  const [assessmentError, setAssessmentError] = useState('');
  const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus>('idle');
  const [scoringStandard, setScoringStandard] = useState<ScoringStandard | null>(null);
  const [weightDraft, setWeightDraft] = useState<ScoringWeights | null>(null);
  const [standardStatus, setStandardStatus] = useState<StandardStatus>('idle');
  const [standardError, setStandardError] = useState('');
  const [jobOptions, setJobOptions] = useState<KnowledgeJobOption[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT);
  const [panelLayoutLoaded, setPanelLayoutLoaded] = useState(false);
  const [panelDrag, setPanelDrag] = useState<PanelDragState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('screening');
  const [expandedDimension, setExpandedDimension] = useState<string | null>(null);
  const [parserRelays, setParserRelays] = useState<ParserRelayMessage[]>([]);
  const [parserRefreshing, setParserRefreshing] = useState(false);
  const [resumeReading, setResumeReading] = useState(false);
  const [resumeResult, setResumeResult] = useState<SessionParserSnapshot | null>(null);
  const [resumeDomRelays, setResumeDomRelays] = useState<ParserRelayMessage[]>([]);
  const [resumeSessionId, setResumeSessionId] = useState('read-0');
  const [resumeReadError, setResumeReadError] = useState<ResumeReadErrorCode | null>(null);
  const [adminStatus, setAdminStatus] = useState<AdminStatus>('idle');
  const [adminError, setAdminError] = useState('');
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboardResponse | null>(null);
  const [assessmentRecords, setAssessmentRecords] = useState<AssessmentRecordSummary[]>([]);
  const [knowledgeAliases, setKnowledgeAliases] = useState<KnowledgeAliasItem[]>([]);
  const [knowledgeQuality, setKnowledgeQuality] = useState<KnowledgeQualityResponse | null>(null);
  const [jobDetail, setJobDetail] = useState<KnowledgeJobDetailResponse | null>(null);
  const [copiedQuestionKey, setCopiedQuestionKey] = useState<string | null>(null);
  const resumeReadInFlight = useRef(false);
  const resumeSessionCounter = useRef(0);
  const activeResumeSession = useRef('read-0');
  const assessmentRequestCounter = useRef(0);
  const activeAssessmentRequest = useRef(0);
  const explanationRequestCounter = useRef(0);
  const activeExplanationRequest = useRef(0);
  const currentAssessmentContext = useRef({ candidateKey: '', jobId: '' });
  const selectedJobIdRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    void loadStoredPanelLayout().then((storedLayout) => {
      if (cancelled) {
        return;
      }
      if (storedLayout) {
        setPanelLayout({
          dock: storedLayout.dock,
          top: storedLayout.top,
        });
        setCollapsed(storedLayout.collapsed);
      }
      setPanelLayoutLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!panelLayoutLoaded) {
      return;
    }
    saveStoredPanelLayout({
      ...panelLayout,
      top: collapsed ? clampRailTop(panelLayout.top) : clampPanelTop(panelLayout.top),
      collapsed,
    });
  }, [collapsed, panelLayout, panelLayoutLoaded]);

  useEffect(() => {
    setPanelLayout((current) => {
      const nextTop = collapsed ? clampRailTop(current.top) : clampPanelTop(current.top);
      return nextTop === current.top ? current : { ...current, top: nextTop };
    });
  }, [collapsed]);

  useEffect(() => {
    const clampCurrentLayout = () => {
      setPanelLayout((current) => ({
        ...current,
        top: collapsed ? clampRailTop(current.top) : clampPanelTop(current.top),
      }));
    };
    window.addEventListener('resize', clampCurrentLayout);
    return () => {
      window.removeEventListener('resize', clampCurrentLayout);
    };
  }, [collapsed]);

  useEffect(() => {
    if (!panelDrag) {
      return undefined;
    }

    const movePanel = (event: PointerEvent) => {
      const nextDock: PanelDock = event.clientX < viewportSize().width / 2 ? 'left' : 'right';
      const nextTop = event.clientY - panelDrag.pointerOffsetY;
      setPanelLayout({
        dock: nextDock,
        top: panelDrag.kind === 'rail' ? clampRailTop(nextTop) : clampPanelTop(nextTop),
      });
    };
    const stopDrag = (event: PointerEvent) => {
      movePanel(event);
      setPanelDrag(null);
    };

    window.addEventListener('pointermove', movePanel);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointermove', movePanel);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, [panelDrag]);

  const startPanelDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, input, select, textarea, a')) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanelDrag({
      kind: 'panel',
      pointerOffsetY: event.clientY - clampPanelTop(panelLayout.top),
    });
  }, [panelLayout.top]);

  const startRailDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button')) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanelDrag({
      kind: 'rail',
      pointerOffsetY: event.clientY - clampRailTop(panelLayout.top),
    });
  }, [panelLayout.top]);

  const togglePanelDock = useCallback(() => {
    setPanelLayout((current) => ({
      dock: current.dock === 'right' ? 'left' : 'right',
      top: clampPanelTop(current.top),
    }));
  }, []);

  const invalidateAssessmentRequest = useCallback((context = { candidateKey: '', jobId: '' }) => {
    activeAssessmentRequest.current += 1;
    activeExplanationRequest.current += 1;
    currentAssessmentContext.current = context;
  }, []);

  const resetAssessmentUi = useCallback((status: AssessmentStatus) => {
    setAssessment(null);
    setAssessmentError('');
    setExplanationStatus('idle');
    setExpandedDimension(null);
    setAssessmentStatus(status);
  }, []);

  const connect = useCallback(async () => {
    invalidateAssessmentRequest();
    setConnection('connecting');
    resetAssessmentUi('idle');
    try {
      await getHealth();
      const jobs = await getKnowledgeJobs();
      const nextJobId = selectedJobIdRef.current
        && jobs.jobs.some((job) => job.job_id === selectedJobIdRef.current)
        ? selectedJobIdRef.current
        : jobs.jobs[0]?.job_id ?? '';
      selectedJobIdRef.current = nextJobId;
      setJobOptions(jobs.jobs);
      setSelectedJobId(nextJobId);
      setConnection('online');
    } catch {
      selectedJobIdRef.current = '';
      setJobOptions([]);
      setSelectedJobId('');
      setConnection('offline');
    }
  }, [invalidateAssessmentRequest, resetAssessmentUi]);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    setCopiedQuestionKey(null);
  }, [assessment?.request_id]);

  const parserSelection = useMemo(
    () => selectBestParserRelay(parserRelays),
    [parserRelays],
  );
  const candidateReading = useMemo(
    () => composeCandidateReading(
      resumeResult ? resumeDomRelays : parserRelays,
      resumeResult,
      resumeSessionId,
    ),
    [parserRelays, resumeDomRelays, resumeResult, resumeSessionId],
  );
  const frameDiagnostics = useMemo(
    () => parserRelays.map((relay) => ({
      frameId: relay.source.frame_id,
      pageKind: relay.snapshot.page_kind,
      status: relay.snapshot.status,
      warnings: relay.snapshot.warnings,
    })),
    [parserRelays],
  );
  const selectedJob = useMemo(
    () => jobOptions.find((job) => job.job_id === selectedJobId) ?? null,
    [jobOptions, selectedJobId],
  );
  const assessmentCandidateKey = useMemo(
    () => candidateAssessmentKey(candidateReading),
    [candidateReading],
  );
  const assessmentProfile = candidateReading?.snapshot.profile;
  const canAssess = connection === 'online'
    && Boolean(selectedJobId)
    && Boolean(assessmentCandidateKey)
    && hasScoringSignal(assessmentProfile);

  const clearAssessmentForCandidate = useCallback((candidateKey: string) => {
    invalidateAssessmentRequest({
      candidateKey,
      jobId: selectedJobIdRef.current,
    });
    resetAssessmentUi(candidateKey && selectedJobIdRef.current ? 'ready' : 'idle');
  }, [invalidateAssessmentRequest, resetAssessmentUi]);

  const loadAdminData = useCallback(async () => {
    if (connection !== 'online' || !selectedJobId) {
      return;
    }
    const jobId = selectedJobId;
    setAdminStatus('loading');
    setAdminError('');
    try {
      const [
        dashboard,
        records,
        aliases,
        quality,
        detail,
      ] = await Promise.all([
        getAdminDashboard(),
        getAssessmentRecords(20),
        getKnowledgeAliases(),
        getKnowledgeQuality(),
        getKnowledgeJobDetail(jobId),
      ]);
      if (selectedJobIdRef.current !== jobId) {
        return;
      }
      setAdminDashboard(dashboard);
      setAssessmentRecords(records.records);
      setKnowledgeAliases(aliases.aliases);
      setKnowledgeQuality(quality);
      setJobDetail(detail);
      setAdminStatus('success');
    } catch {
      if (selectedJobIdRef.current === jobId) {
        setAdminError('后台数据暂时无法读取，请确认本机服务状态。');
        setAdminStatus('error');
      }
    }
  }, [connection, selectedJobId]);

  const handleParserRelay = useCallback((incoming: ParserRelayMessage) => {
    const incomingCandidateKey = candidateAssessmentKey({
      session_id: resumeSessionId,
      snapshot: incoming.snapshot,
    });
    const nextPageHasNoCandidate = incoming.snapshot.page_kind === 'logged_out'
      || incoming.snapshot.page_kind === 'non_candidate';

    if ((incomingCandidateKey && incomingCandidateKey !== assessmentCandidateKey)
      || (!incomingCandidateKey && assessmentCandidateKey && nextPageHasNoCandidate)) {
      clearAssessmentForCandidate(incomingCandidateKey);
    }

    setParserRelays((current) => upsertParserRelay(current, incoming));
    setParserRefreshing(false);
  }, [assessmentCandidateKey, clearAssessmentForCandidate, resumeSessionId]);

  useEffect(() => subscribeToParserRelays(handleParserRelay), [handleParserRelay]);

  useEffect(() => {
    if (viewMode === 'admin' && connection === 'online' && selectedJobId) {
      void loadAdminData();
    }
  }, [connection, loadAdminData, selectedJobId, viewMode]);

  useLayoutEffect(() => {
    invalidateAssessmentRequest({
      candidateKey: assessmentCandidateKey,
      jobId: selectedJobId,
    });
    resetAssessmentUi(canAssess ? 'ready' : 'idle');
  }, [assessmentCandidateKey, canAssess, invalidateAssessmentRequest, resetAssessmentUi, selectedJobId]);

  const loadScoringStandard = useCallback(async () => {
    if (!selectedJobId) {
      return;
    }
    const jobId = selectedJobId;
    setStandardStatus('loading');
    setStandardError('');
    try {
      const response = await getScoringStandard(jobId);
      if (selectedJobIdRef.current !== response.job_id) {
        return;
      }
      setScoringStandard(response.standard);
      setWeightDraft(weightsFromStandard(response.standard));
      setStandardStatus('idle');
    } catch {
      if (selectedJobIdRef.current === jobId) {
        setStandardError('AI 权重暂未生成，可继续使用默认动态权重。');
        setStandardStatus('error');
      }
    }
  }, [selectedJobId]);

  const enhanceCandidateExplanation = useCallback(async (
    candidateKey: string,
    jobId: string,
    profile: CandidateProfile,
    scoringWeights?: ScoringWeights,
  ) => {
    explanationRequestCounter.current += 1;
    const explanationRequestId = explanationRequestCounter.current;
    activeExplanationRequest.current = explanationRequestId;
    setExplanationStatus('enhancing');
    try {
      const result = scoringWeights
        ? await getMatchExplanation(jobId, profile, scoringWeights)
        : await getMatchExplanation(jobId, profile);
      const context = currentAssessmentContext.current;
      if (activeExplanationRequest.current !== explanationRequestId
        || context.candidateKey !== candidateKey
        || context.jobId !== jobId) {
        return;
      }
      setAssessment((current) => (
        current && sameAssessmentFacts(current, result) ? result : current
      ));
      setExplanationStatus(
        result.llm_enhancement === 'failed' || result.llm_enhancement === 'timeout'
          ? 'error'
          : 'idle',
      );
    } catch {
      const context = currentAssessmentContext.current;
      if (activeExplanationRequest.current !== explanationRequestId
        || context.candidateKey !== candidateKey
        || context.jobId !== jobId) {
        return;
      }
      setExplanationStatus('error');
    }
  }, []);

  const refreshPageReading = async () => {
    const invalidatedSession = `read-${resumeSessionCounter.current + 1}`;
    resumeSessionCounter.current += 1;
    activeResumeSession.current = invalidatedSession;
    setResumeSessionId(invalidatedSession);
    setParserRefreshing(true);
    setParserRelays([]);
    setResumeResult(null);
    setResumeDomRelays([]);
    resumeReadInFlight.current = false;
    setResumeReading(false);
    setResumeReadError(null);
    invalidateAssessmentRequest();
    resetAssessmentUi('idle');
    try {
      await requestParserRefresh();
    } catch {
      setParserRefreshing(false);
    }
  };

  const readCurrentResume = async () => {
    if (resumeReadInFlight.current) {
      return;
    }
    const sessionId = `read-${resumeSessionCounter.current + 1}`;
    resumeSessionCounter.current += 1;
    activeResumeSession.current = sessionId;
    resumeReadInFlight.current = true;
    invalidateAssessmentRequest();
    setResumeSessionId(sessionId);
    setResumeDomRelays(parserRelays);
    setResumeReading(true);
    setResumeResult(null);
    setResumeReadError(null);
    resetAssessmentUi('idle');
    try {
      const response = await requestResumeRead();
      if (activeResumeSession.current === sessionId) {
        if (response.ok) {
          setResumeResult({ session_id: sessionId, snapshot: response.snapshot });
        } else {
          setResumeReadError(response.error);
        }
      }
    } catch {
      if (activeResumeSession.current === sessionId) {
        setResumeReadError('vue-read-failed');
      }
    } finally {
      if (activeResumeSession.current === sessionId) {
        resumeReadInFlight.current = false;
        setResumeReading(false);
      }
    }
  };

  const analyzeCandidate = async () => {
    if (!selectedJobId
      || !assessmentCandidateKey
      || !hasScoringSignal(assessmentProfile)
      || !scoringWeightsAreValid(weightDraft)) {
      return;
    }
    const requestWeights = weightDraft ? { ...weightDraft } : undefined;
    assessmentRequestCounter.current += 1;
    const requestId = assessmentRequestCounter.current;
    activeAssessmentRequest.current = requestId;
    currentAssessmentContext.current = {
      candidateKey: assessmentCandidateKey,
      jobId: selectedJobId,
    };
    setAssessment(null);
    setAssessmentError('');
    setExplanationStatus('idle');
    setExpandedDimension(null);
    setAssessmentStatus('assessing');
    try {
      const result = requestWeights
        ? await getMatchAssessment(selectedJobId, assessmentProfile, requestWeights)
        : await getMatchAssessment(selectedJobId, assessmentProfile);
      const context = currentAssessmentContext.current;
      if (activeAssessmentRequest.current !== requestId
        || context.candidateKey !== assessmentCandidateKey
        || context.jobId !== selectedJobId) {
        return;
      }
      setAssessment(result);
      if (result.scoring_standard) {
        setScoringStandard(result.scoring_standard);
        setWeightDraft((current) => current ?? weightsFromStandard(result.scoring_standard as ScoringStandard));
      }
      setAssessmentStatus('success');
      void enhanceCandidateExplanation(
        assessmentCandidateKey,
        selectedJobId,
        assessmentProfile,
        requestWeights,
      );
    } catch (error) {
      const context = currentAssessmentContext.current;
      if (activeAssessmentRequest.current !== requestId
        || context.candidateKey !== assessmentCandidateKey
        || context.jobId !== selectedJobId) {
        return;
      }
      setAssessmentError(assessmentErrorMessage(error));
      setAssessmentStatus('error');
    }
  };

  const handleJobSelectionChange = (jobId: string) => {
    selectedJobIdRef.current = jobId;
    invalidateAssessmentRequest({
      candidateKey: assessmentCandidateKey,
      jobId,
    });
    setSelectedJobId(jobId);
    setScoringStandard(null);
    setWeightDraft(null);
    setStandardStatus('idle');
    setStandardError('');
    resetAssessmentUi(assessmentCandidateKey && jobId ? 'ready' : 'idle');
  };

  const copyPersonalizedFollowUp = useCallback(async (text: string, key: string) => {
    try {
      const clipboard = window.navigator.clipboard;
      if (!clipboard?.writeText) {
        return;
      }
      await clipboard.writeText(text);
      setCopiedQuestionKey(key);
    } catch {
      setCopiedQuestionKey(null);
    }
  }, []);

  const displayedFitScore = assessment?.fit_score ?? assessment?.total_score ?? 0;
  const scoreWasCapped = Boolean(
    assessment
    && assessment.fit_score !== undefined
    && assessment.fit_score !== assessment.total_score,
  );
  const hybridWasCalibrated = Boolean(
    assessment
    && assessment.hybrid_score !== undefined
    && assessment.hybrid_delta !== undefined
    && assessment.hybrid_delta !== 0,
  );
  const potentialText = potentialLabel(assessment?.potential_level);
  const weightTotal = scoringWeightTotal(weightDraft);
  const weightsValid = scoringWeightsAreValid(weightDraft);
  const displayedAliases = useMemo(
    () => knowledgeAliases
      .filter((item) => item.aliases.length > 0)
      .slice()
      .sort((left, right) => right.frequency - left.frequency)
      .slice(0, 12),
    [knowledgeAliases],
  );
  const qualityReport = knowledgeQuality?.report ?? null;
  const displayedRecords = assessmentRecords.slice(0, 8);
  const personalizedFollowUps = assessment?.personalized_follow_up_questions ?? [];
  const missingKeywordJobs = qualityReport?.missing_required_keyword_jobs ?? [];
  const dockToggleLabel = panelLayout.dock === 'right' ? '移到左侧' : '移到右侧';
  const panelClassName = [
    'arc-panel',
    `arc-panel--${panelLayout.dock}`,
    panelDrag ? 'arc-panel--dragging' : '',
  ].filter(Boolean).join(' ');
  const railClassName = [
    'arc-rail',
    `arc-rail--${panelLayout.dock}`,
    panelDrag?.kind === 'rail' ? 'arc-rail--dragging' : '',
  ].filter(Boolean).join(' ');

  if (collapsed) {
    return (
      <aside
        className={railClassName}
        style={railPlacementStyle(panelLayout)}
        onPointerDown={startRailDrag}
        aria-label="AI Recruitment Copilot 已折叠"
      >
        <span className="arc-rail__logo" aria-hidden="true">AI</span>
        <strong>{assessment ? `${displayedFitScore}%` : '—'}</strong>
        <span className={`arc-rail__dot arc-rail__dot--${connection}`} aria-hidden="true" />
        <button type="button" aria-label="展开助手" onClick={() => setCollapsed(false)}>
          {panelLayout.dock === 'right' ? '‹' : '›'}
        </button>
      </aside>
    );
  }

  return (
    <aside className={panelClassName} style={panelPlacementStyle(panelLayout)} aria-label="AI Recruitment Copilot">
      <header className="arc-header" onPointerDown={startPanelDrag}>
        <div className="arc-brand">
          <span className="arc-brand__mark" aria-hidden="true">AI</span>
          <div>
            <strong>AI Recruitment Copilot</strong>
            <span>候选人匹配助手</span>
          </div>
        </div>
        <div className="arc-header__controls">
          <span className="arc-drag-grip" aria-hidden="true" />
          <button
            className="arc-icon-button"
            type="button"
            aria-label={dockToggleLabel}
            title={dockToggleLabel}
            onClick={togglePanelDock}
          >
            {panelLayout.dock === 'right' ? '⇤' : '⇥'}
          </button>
          <button
            className="arc-icon-button"
            type="button"
            aria-label="折叠助手"
            onClick={() => setCollapsed(true)}
          >
            —
          </button>
        </div>
      </header>

      <div className="arc-toolbar">
        <div>
          <span className="arc-eyebrow">当前岗位</span>
          {connection === 'online' && jobOptions.length > 0 ? (
            <select
              className="arc-job-select"
              aria-label="选择匹配岗位"
              value={selectedJobId}
              onChange={(event) => handleJobSelectionChange(event.currentTarget.value)}
              disabled={assessmentStatus === 'assessing'}
            >
              {jobOptions.map((job) => (
                <option key={job.job_id} value={job.job_id}>
                  {job.title}
                </option>
              ))}
            </select>
          ) : (
            <strong>{connection === 'online' ? '暂无可选岗位' : '等待服务连接'}</strong>
          )}
        </div>
        <div className="arc-connection">
          <ConnectionPill state={connection} />
          {connection === 'online' && (
            <button
              className="arc-refresh-button"
              type="button"
              onClick={() => void connect()}
            >
              刷新连接
            </button>
          )}
        </div>
      </div>

      <nav className="arc-view-tabs" aria-label="助手视图">
        <button
          className={viewMode === 'screening' ? 'arc-view-tabs__button--active' : ''}
          type="button"
          aria-pressed={viewMode === 'screening'}
          onClick={() => setViewMode('screening')}
        >
          评分
        </button>
        <button
          className={viewMode === 'admin' ? 'arc-view-tabs__button--active' : ''}
          type="button"
          aria-pressed={viewMode === 'admin'}
          onClick={() => setViewMode('admin')}
        >
          后台
        </button>
      </nav>

      <main className="arc-content">
        {viewMode === 'screening' && (
          <>
            <PageReadingCard
              snapshot={candidateReading?.snapshot ?? null}
              frameDiagnostics={frameDiagnostics}
              selectedFrameId={parserSelection?.relay.source.frame_id}
              selectionReason={parserSelection?.reason}
              onRefresh={() => void refreshPageReading()}
              refreshing={parserRefreshing}
              onReadResume={() => void readCurrentResume()}
              resumeReading={resumeReading}
              resumeSnapshot={resumeResult?.session_id === resumeSessionId
                ? resumeResult.snapshot
                : null}
              resumeReadError={resumeReadError}
            />
            {connection === 'connecting' && <LoadingState />}
            {connection === 'offline' && <OfflineState onRetry={() => void connect()} />}
            {connection === 'online' && (
              <>
                <section className="arc-section arc-assessment-control">
              <div className="arc-section__heading">
                <h2>真实规则评分</h2>
                <span>{selectedJob ? selectedJob.job_id : '未选择岗位'}</span>
              </div>
              <div className="arc-assessment-control__body">
                <p>
                  {!assessmentCandidateKey
                    ? '候选人信息不足，暂时无法评分'
                    : selectedJob
                      ? `将当前候选人与 ${selectedJob.title} 对比`
                      : '请先选择一个岗位'}
                </p>
                <button
                  className="arc-button arc-button--primary"
                  type="button"
                  disabled={!canAssess || !weightsValid || assessmentStatus === 'assessing'}
                  onClick={() => void analyzeCandidate()}
                >
                  {assessmentStatus === 'assessing' ? '正在分析' : '分析候选人'}
                </button>
              </div>
              <div className="arc-weight-control">
                <div className="arc-weight-control__bar">
                  <span>
                    评分权重
                    {scoringStandard && ` · ${scoringStandard.source === 'llm_generated' ? 'AI 建议' : '动态默认'}`}
                  </span>
                  <button
                    className="arc-link-button"
                    type="button"
                    disabled={!selectedJobId || standardStatus === 'loading'}
                    onClick={() => void loadScoringStandard()}
                  >
                    {standardStatus === 'loading' ? '生成中' : 'AI 建议权重'}
                  </button>
                </div>
                {weightDraft ? (
                  <>
                    <div className="arc-weight-grid">
                      {SCORING_WEIGHT_KEYS.map((key) => (
                        <label key={key}>
                          <span>{SCORING_WEIGHT_LABELS[key]}</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={weightDraft[key]}
                            onChange={(event) => {
                              const nextValue = Math.max(
                                0,
                                Math.min(100, Number(event.currentTarget.value || 0)),
                              );
                              setWeightDraft((current) => ({
                                ...(current ?? weightDraft),
                                [key]: nextValue,
                              }));
                            }}
                            aria-label={`${SCORING_WEIGHT_LABELS[key]}权重`}
                          />
                        </label>
                      ))}
                    </div>
                    <div className={`arc-weight-total ${weightsValid ? '' : 'arc-weight-total--invalid'}`}>
                      合计 {weightTotal}%
                      {!weightsValid && <span>需等于 100%</span>}
                      <button
                        className="arc-link-button"
                        type="button"
                        onClick={() => {
                          setScoringStandard(null);
                          setWeightDraft(null);
                          setStandardStatus('idle');
                          setStandardError('');
                        }}
                      >
                        使用默认
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="arc-weight-control__hint">未调整时使用岗位动态默认权重。</p>
                )}
                {standardError && <p className="arc-assessment-error">{standardError}</p>}
              </div>
              {assessmentStatus === 'error' && (
                <p className="arc-assessment-error" role="alert">{assessmentError}</p>
              )}
            </section>

            {assessmentStatus === 'assessing' && (
              <div className="arc-state arc-state--compact" role="status">
                <span className="arc-spinner" aria-hidden="true" />
                <strong>正在生成真实评分</strong>
                <span>评分仅发送岗位 ID、CandidateProfile 和可选权重</span>
              </div>
            )}

            {assessmentStatus === 'success' && assessment && (
              <section className="arc-summary">
                <div
                  className="arc-score"
                  style={{ '--arc-score': `${displayedFitScore * 3.6}deg` } as CSSProperties}
                >
                  <div>
                    <strong>{displayedFitScore}%</strong>
                    <span>综合匹配</span>
                  </div>
                </div>
                <div className="arc-summary__copy">
                  <span className="arc-real-badge">
                    真实评估 · {assessment.mode} · {explanationBadgeText(assessment, explanationStatus)}
                  </span>
                  <strong>{assessment.recommendation}</strong>
                  {assessment.assessment_summary && (
                    <p className="arc-assessment-summary">{assessment.assessment_summary}</p>
                  )}
                  <div className="arc-summary__meta" aria-label="评分分层">
                    <span className={`arc-eligibility arc-eligibility--${assessment.eligibility?.status ?? 'unknown'}`}>
                      {eligibilityLabel(assessment.eligibility)}
                    </span>
                    {potentialText && <span>{potentialText}</span>}
                    {scoreWasCapped && <span>推荐分：{assessment.total_score}%</span>}
                    {hybridWasCalibrated && <span>AI参考分：{assessment.hybrid_score}%</span>}
                  </div>
                  {hybridWasCalibrated && assessment.hybrid_summary && (
                    <span className="arc-summary__hint">{assessment.hybrid_summary}</span>
                  )}
                  {explanationStatus === 'enhancing' && (
                    <span className="arc-summary__hint">AI 追问生成中，当前先显示规则结果</span>
                  )}
                  {explanationStatus === 'error' && assessment.llm_enhancement === 'timeout' && (
                    <span className="arc-summary__hint">AI 解释响应较慢，已保留规则结果</span>
                  )}
                  {explanationStatus === 'error'
                    && assessment.llm_enhancement !== 'timeout'
                    && assessment.explanation_source !== 'llm' && (
                    <span className="arc-summary__hint">AI 解释暂未生成，已保留规则结果</span>
                  )}
                  <span>{assessment.job_title} · 基于当前页面读取资料</span>
                </div>
              </section>
            )}

            {assessmentStatus === 'success' && assessment && (
              <section className="arc-section">
                <div className="arc-section__heading">
                  <h2>匹配维度</h2>
                  <span>点击查看证据</span>
                </div>
                <div className="arc-dimensions">
                  {assessment.dimensions.map((dimension) => {
                    const isExpanded = expandedDimension === dimension.key;
                    return (
                      <article className="arc-dimension" key={dimension.key}>
                        <button
                          className="arc-dimension__toggle"
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedDimension(isExpanded ? null : dimension.key)}
                        >
                          <span>
                            <strong>{dimension.name}</strong>
                            <small>权重 {dimension.weight}% · 置信度 {Math.round(dimension.confidence * 100)}%</small>
                          </span>
                          <b>{dimension.score}%</b>
                          <i aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</i>
                        </button>
                        <div className="arc-progress" aria-hidden="true">
                          <span style={{ width: `${dimension.score}%` }} />
                        </div>
                        {isExpanded && (
                          <div className="arc-dimension__detail">
                            <p>{dimension.reason}</p>
                            <strong>参考证据</strong>
                            <ul>
                              {dimension.evidence.map((evidence) => (
                                <li key={`${evidence.source}:${evidence.source_index ?? 'n'}:${evidence.concept ?? 'n'}:${evidence.text}`}>
                                  {evidenceLabel(evidence)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {assessmentStatus === 'success' && assessment && (
              <section className="arc-section">
                <h2>候选人亮点</h2>
                <ul className="arc-check-list">
                  {assessment.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                </ul>
              </section>
            )}

            {assessmentStatus === 'success'
              && assessment?.semantic_review?.findings
              && assessment.semantic_review.findings.length > 0 && (
              <section className="arc-section">
                <h2>语义审阅</h2>
                {assessment.semantic_review.summary && (
                  <p className="arc-semantic-summary">{assessment.semantic_review.summary}</p>
                )}
                <ul className="arc-check-list">
                  {assessment.semantic_review.findings.map((finding) => (
                    <li key={`${finding.topic}:${finding.summary}`}>{finding.summary}</li>
                  ))}
                </ul>
              </section>
            )}

            {assessmentStatus === 'success' && assessment && (
              <div className="arc-grid">
                <section className="arc-card arc-card--risk">
                  <h2>风险提示</h2>
                  {assessment.risk_flags.length > 0
                    ? assessment.risk_flags.map((flag) => <p key={`${flag.code}:${flag.message}`}>{flag.message}</p>)
                    : <p>暂未发现明确风险。</p>}
                </section>
                <section className="arc-card arc-card--question">
                  <h2>待确认信息</h2>
                  {assessment.missing_information.length > 0
                    ? assessment.missing_information.map((item) => <p key={item.field}>{item.reason}</p>)
                    : <p>暂无明确缺失信息。</p>}
                </section>
              </div>
            )}

            {assessmentStatus === 'success' && assessment && personalizedFollowUps.length > 0 && (
              <section className="arc-section arc-personalized-followups">
                <div className="arc-section__heading">
                  <div>
                    <h2>AI 个性化追问</h2>
                    <span>
                      {assessment.explanation_source === 'llm'
                        ? '已结合当前候选人资料生成'
                        : '规则草稿，等待 AI 优化'}
                    </span>
                  </div>
                  <button
                    className="arc-link-button"
                    type="button"
                    aria-label="复制全部个性化追问"
                    onClick={() => void copyPersonalizedFollowUp(
                      formatPersonalizedFollowUps(personalizedFollowUps),
                      'all-personalized-followups',
                    )}
                  >
                    {copiedQuestionKey === 'all-personalized-followups' ? '已复制' : '复制全部'}
                  </button>
                </div>
                <div className="arc-followup-list">
                  {personalizedFollowUps.map((question, index) => {
                    const key = personalizedFollowUpKey(question, index);
                    return (
                      <article className="arc-followup-item" key={key}>
                        <div>
                          <p>{question.question}</p>
                          <span>{question.evidence_anchor} · {question.purpose}</span>
                        </div>
                        <button
                          className="arc-followup-copy"
                          type="button"
                          aria-label={`复制个性化追问 ${index + 1}`}
                          onClick={() => void copyPersonalizedFollowUp(
                            personalizedFollowUpCopy(question),
                            key,
                          )}
                        >
                          {copiedQuestionKey === key ? '已复制' : '复制'}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {assessmentStatus === 'success' && assessment && personalizedFollowUps.length === 0 && (
              <section className="arc-section">
                <h2>建议追问</h2>
                <ul className="arc-check-list">
                  {assessment.follow_up_questions.map((question) => <li key={question}>{question}</li>)}
                </ul>
              </section>
            )}
          </>
        )}
          </>
        )}

        {viewMode === 'admin' && (
          <>
            {connection === 'connecting' && <LoadingState />}
            {connection === 'offline' && <OfflineState onRetry={() => void connect()} />}
            {connection === 'online' && (
              <>
                <section className="arc-section arc-admin-overview">
                  <div className="arc-section__heading">
                    <h2>后台管理</h2>
                    <button
                      className="arc-link-button"
                      type="button"
                      disabled={adminStatus === 'loading'}
                      onClick={() => void loadAdminData()}
                    >
                      {adminStatus === 'loading' ? '刷新中' : '刷新'}
                    </button>
                  </div>
                  {adminError && (
                    <p className="arc-assessment-error" role="alert">{adminError}</p>
                  )}
                  {adminDashboard ? (
                    <div className="arc-admin-stats">
                      <div>
                        <span>岗位</span>
                        <strong>{adminDashboard.total_jobs}</strong>
                      </div>
                      <div>
                        <span>概念</span>
                        <strong>{adminDashboard.total_concepts}</strong>
                      </div>
                      <div>
                        <span>记录</span>
                        <strong>{adminDashboard.total_assessment_records}</strong>
                      </div>
                      <div>
                        <span>均分</span>
                        <strong>{adminDashboard.average_score}%</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="arc-admin-empty">
                      {adminStatus === 'loading' ? '正在读取后台数据。' : '后台数据尚未加载。'}
                    </p>
                  )}
                  {adminDashboard && adminDashboard.top_jobs.length > 0 && (
                    <div className="arc-admin-top-jobs">
                      {adminDashboard.top_jobs.map((job) => (
                        <span key={job.job_id}>
                          {job.job_title} · {job.assessment_count} 次 · {job.average_score}%
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <section className="arc-section">
                  <div className="arc-section__heading">
                    <h2>岗位列表</h2>
                    <span>{jobOptions.length} 个岗位</span>
                  </div>
                  <div className="arc-admin-job-list">
                    {jobOptions.slice(0, 10).map((job) => (
                      <button
                        key={job.job_id}
                        className={job.job_id === selectedJobId ? 'arc-admin-job--active' : ''}
                        type="button"
                        onClick={() => handleJobSelectionChange(job.job_id)}
                      >
                        <strong>{job.title}</strong>
                        <span>{job.department ?? '未分部门'} · {job.status ?? '状态未知'}</span>
                      </button>
                    ))}
                  </div>
                </section>

                {jobDetail && (
                  <section className="arc-section">
                    <div className="arc-section__heading">
                      <h2>岗位画像</h2>
                      <span>{jobDetail.job_id}</span>
                    </div>
                    <div className="arc-profile-grid">
                      <article>
                        <strong>必备概念</strong>
                        <p>{compactList(jobDetail.profile.required_concepts)}</p>
                      </article>
                      <article>
                        <strong>加分概念</strong>
                        <p>{compactList(jobDetail.profile.preferred_concepts)}</p>
                      </article>
                      <article>
                        <strong>相关能力</strong>
                        <p>{compactList(jobDetail.profile.related_concepts)}</p>
                      </article>
                      <article>
                        <strong>学历/年限</strong>
                        <p>
                          {compactList(jobDetail.profile.education_keywords, 3)}
                          {jobDetail.profile.experience_years_min !== null
                            && jobDetail.profile.experience_years_min !== undefined
                            ? ` · ${jobDetail.profile.experience_years_min}+ 年`
                            : ''}
                        </p>
                      </article>
                    </div>
                  </section>
                )}

                <section className="arc-section">
                  <div className="arc-section__heading">
                    <h2>alias 管理</h2>
                    <span>{knowledgeAliases.length} 个概念</span>
                  </div>
                  {displayedAliases.length > 0 ? (
                    <div className="arc-alias-list">
                      {displayedAliases.map((item) => (
                        <article key={`${item.category}:${item.canonical}`}>
                          <strong>{item.canonical}</strong>
                          <span>{item.category} · {item.frequency}</span>
                          <p>{compactList(item.aliases, 5)}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="arc-admin-empty">暂无 alias 数据。</p>
                  )}
                </section>

                <section className="arc-section">
                  <div className="arc-section__heading">
                    <h2>导入质量</h2>
                    <span>{qualityReport ? `${qualityReport.warning_count} 条提醒` : '未加载'}</span>
                  </div>
                  {qualityReport ? (
                    <>
                      <div className="arc-quality-summary">
                        <span>原始 {qualityReport.total_rows} 行</span>
                        <span>导入 {qualityReport.imported_jobs} 岗</span>
                        <span>部门 {Object.keys(qualityReport.department_counts).length}</span>
                      </div>
                      {qualityReport.unrecognized_terms.length > 0 && (
                        <div className="arc-unknown-term-list" aria-label="未识别候选概念">
                          {qualityReport.unrecognized_terms.slice(0, 5).map((item) => (
                            <span key={item.term}>
                              {item.term} · {item.frequency}
                            </span>
                          ))}
                        </div>
                      )}
                      {missingKeywordJobs.length > 0 && (
                        <div className="arc-empty-keyword-jobs">
                          <div>
                            <strong>关键词为空岗位</strong>
                            <span>{missingKeywordJobs.length} 岗依赖 JD 自动抽取</span>
                          </div>
                          <ul aria-label="关键词为空岗位">
                            {missingKeywordJobs.slice(0, 12).map((job) => (
                              <li key={job.job_id}>
                                <strong>{job.title}</strong>
                                <span>
                                  {job.source_row ? `第 ${job.source_row} 行 · ` : ''}
                                  {job.job_id}
                                  {job.department ? ` · ${job.department}` : ''}
                                </span>
                                {job.suggested_keywords.length > 0 && (
                                  <em>建议：{compactList(job.suggested_keywords, 8)}</em>
                                )}
                              </li>
                            ))}
                          </ul>
                          {missingKeywordJobs.length > 12 && (
                            <p>还有 {missingKeywordJobs.length - 12} 个岗位未显示。</p>
                          )}
                        </div>
                      )}
                      {qualityReport.warnings.length > 0 ? (
                        <ul className="arc-admin-warning-list">
                          {qualityReport.warnings.slice(0, 5).map((warning) => (
                            <li key={`${warning.code}:${warning.job_id ?? 'row'}:${warning.source_row ?? 'n'}`}>
                              <div>
                                <strong>{warning.severity}</strong>
                                <span>{warning.message}</span>
                              </div>
                              {(warning.title || warning.job_id || warning.source_row) && (
                                <small>
                                  {warning.title ?? '未命名岗位'}
                                  {warning.source_row ? ` · 第 ${warning.source_row} 行` : ''}
                                  {warning.job_id ? ` · ${warning.job_id}` : ''}
                                </small>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="arc-admin-empty">暂无导入质量提醒。</p>
                      )}
                    </>
                  ) : (
                    <p className="arc-admin-empty">导入质量报告尚未加载。</p>
                  )}
                </section>

                <section className="arc-section">
                  <div className="arc-section__heading">
                    <h2>评分记录</h2>
                    <span>最近 {displayedRecords.length} 条</span>
                  </div>
                  {displayedRecords.length > 0 ? (
                    <div className="arc-record-list">
                      {displayedRecords.map((record) => (
                        <article key={record.record_id}>
                          <div>
                            <strong>{record.total_score}%</strong>
                            <span>{record.job_title}</span>
                          </div>
                          <p>{record.recommendation}</p>
                          <small>
                            {shortFingerprint(record.candidate_fingerprint)}
                            {' · '}
                            {formatAssessedAt(record.assessed_at)}
                          </small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="arc-admin-empty">暂无评分记录。</p>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </main>

      <footer className="arc-footer">
        M2 页面只读解析 · 真实规则评分 · 无自动操作
      </footer>
    </aside>
  );
}
