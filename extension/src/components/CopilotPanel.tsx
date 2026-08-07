import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDemoAssessment, getHealth } from '../api';
import type {
  AssessmentResponse,
  ConnectionState,
  MessageType,
  ParserRelayMessage,
  ResumeReadErrorCode,
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


const DEMO_CANDIDATE = '张同学';
const START_COMMAND =
  'scripts\\python.cmd -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765';


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


export function CopilotPanel() {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedDimension, setExpandedDimension] = useState<string | null>(null);
  const [activeMessageType, setActiveMessageType] = useState<MessageType>('greeting');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [parserRelays, setParserRelays] = useState<ParserRelayMessage[]>([]);
  const [parserRefreshing, setParserRefreshing] = useState(false);
  const [resumeReading, setResumeReading] = useState(false);
  const [resumeResult, setResumeResult] = useState<SessionParserSnapshot | null>(null);
  const [resumeDomRelays, setResumeDomRelays] = useState<ParserRelayMessage[]>([]);
  const [resumeSessionId, setResumeSessionId] = useState('read-0');
  const [resumeReadError, setResumeReadError] = useState<ResumeReadErrorCode | null>(null);
  const copyFeedbackTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const resumeReadInFlight = useRef(false);
  const resumeSessionCounter = useRef(0);
  const activeResumeSession = useRef('read-0');

  const connect = useCallback(async () => {
    if (copyFeedbackTimer.current !== null) {
      globalThis.clearTimeout(copyFeedbackTimer.current);
      copyFeedbackTimer.current = null;
    }
    setCopyFeedback('');
    setConnection('connecting');
    setAssessment(null);
    try {
      await getHealth();
      const result = await getDemoAssessment(DEMO_CANDIDATE);
      setAssessment(result);
      setActiveMessageType(result.messages[0]?.type ?? 'greeting');
      setConnection('online');
    } catch {
      setConnection('offline');
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => subscribeToParserRelays((incoming) => {
    setParserRelays((current) => upsertParserRelay(current, incoming));
    setParserRefreshing(false);
  }), []);

  useEffect(() => () => {
    if (copyFeedbackTimer.current !== null) {
      globalThis.clearTimeout(copyFeedbackTimer.current);
    }
  }, []);

  const activeMessage = useMemo(
    () => assessment?.messages.find((message) => message.type === activeMessageType),
    [activeMessageType, assessment],
  );

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
    setResumeSessionId(sessionId);
    setResumeDomRelays(parserRelays);
    setResumeReading(true);
    setResumeResult(null);
    setResumeReadError(null);
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

  const copyActiveMessage = async () => {
    if (!activeMessage) {
      return;
    }
    try {
      await navigator.clipboard.writeText(activeMessage.content);
      setCopyFeedback('已复制');
      if (copyFeedbackTimer.current !== null) {
        globalThis.clearTimeout(copyFeedbackTimer.current);
      }
      copyFeedbackTimer.current = globalThis.setTimeout(() => {
        setCopyFeedback('');
        copyFeedbackTimer.current = null;
      }, 1800);
    } catch {
      setCopyFeedback('复制失败，请手动选择文本');
    }
  };

  if (collapsed) {
    return (
      <aside className="arc-rail" aria-label="AI Recruitment Copilot 已折叠">
        <span className="arc-rail__logo" aria-hidden="true">AI</span>
        <strong>{assessment ? `${assessment.total_score}%` : '—'}</strong>
        <span className={`arc-rail__dot arc-rail__dot--${connection}`} aria-hidden="true" />
        <button type="button" aria-label="展开助手" onClick={() => setCollapsed(false)}>
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="arc-panel" aria-label="AI Recruitment Copilot">
      <header className="arc-header">
        <div className="arc-brand">
          <span className="arc-brand__mark" aria-hidden="true">AI</span>
          <div>
            <strong>AI Recruitment Copilot</strong>
            <span>候选人匹配助手</span>
          </div>
        </div>
        <button
          className="arc-icon-button"
          type="button"
          aria-label="折叠助手"
          onClick={() => setCollapsed(true)}
        >
          —
        </button>
      </header>

      <div className="arc-toolbar">
        <div>
          <span className="arc-eyebrow">当前岗位</span>
          <strong>{assessment?.job_title ?? 'AI4S 工程师（演示岗位）'}</strong>
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

      <main className="arc-content">
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
        {connection === 'online' && assessment && (
          <>
            <section className="arc-summary">
              <div
                className="arc-score"
                style={{ '--arc-score': `${assessment.total_score * 3.6}deg` } as React.CSSProperties}
              >
                <div>
                  <strong>{assessment.total_score}%</strong>
                  <span>匹配度</span>
                </div>
              </div>
              <div className="arc-summary__copy">
                <span className="arc-demo-badge">演示数据</span>
                <strong>{assessment.recommendation}</strong>
                <span>{assessment.candidate_label} · 结果仅用于界面验收</span>
              </div>
            </section>

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
                            {dimension.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}
                          </ul>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="arc-section">
              <h2>候选人亮点</h2>
              <ul className="arc-check-list">
                {assessment.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
              </ul>
            </section>

            <div className="arc-grid">
              <section className="arc-card arc-card--risk">
                <h2>风险提示</h2>
                {assessment.risk_flags.map((flag) => <p key={flag}>{flag}</p>)}
              </section>
              <section className="arc-card arc-card--question">
                <h2>建议确认</h2>
                {assessment.follow_up_questions.map((question) => <p key={question}>{question}</p>)}
              </section>
            </div>

            <section className="arc-section arc-messages">
              <div className="arc-section__heading">
                <h2>沟通建议</h2>
                <span>仅复制，不自动发送</span>
              </div>
              <div className="arc-tabs" role="tablist" aria-label="沟通建议类型">
                {assessment.messages.map((message) => (
                  <button
                    key={message.type}
                    type="button"
                    role="tab"
                    aria-selected={activeMessageType === message.type}
                    onClick={() => {
                      setActiveMessageType(message.type);
                      if (copyFeedbackTimer.current !== null) {
                        globalThis.clearTimeout(copyFeedbackTimer.current);
                        copyFeedbackTimer.current = null;
                      }
                      setCopyFeedback('');
                    }}
                  >
                    {message.label}
                  </button>
                ))}
              </div>
              <div className="arc-message-box" role="tabpanel">
                {activeMessage?.content}
              </div>
              <div className="arc-copy-row">
                <span aria-live="polite">{copyFeedback}</span>
                <button
                  className="arc-button arc-button--primary"
                  type="button"
                  aria-label="复制话术"
                  onClick={() => void copyActiveMessage()}
                >
                  复制话术
                </button>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="arc-footer">
        M2 页面只读解析 · 评估仍为演示数据 · 无自动操作
      </footer>
    </aside>
  );
}
