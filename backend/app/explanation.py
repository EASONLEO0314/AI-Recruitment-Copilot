"""LLM-assisted explanation and bounded semantic calibration for rule assessments."""

from __future__ import annotations

import json
import os
import re
from hashlib import sha256
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Literal, NamedTuple

import httpx

from backend.app.models import (
    CandidateProfile,
    MatchAssessmentResponse,
    MatchEvidence,
    PersonalizedFollowUpQuestion,
    SemanticReview,
    SemanticReviewFinding,
)


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions"
DEFAULT_EXPLANATION_MODEL = "gpt-4.1-mini"
DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash"
MAX_HIGHLIGHTS = 6
MAX_QUESTIONS = 6
MAX_EXPLANATION_CACHE_ITEMS = 128
DEFAULT_LLM_TIMEOUT_SECONDS = 4.0
DEFAULT_LLM_MAX_TOKENS = 520
MAX_LLM_EVIDENCE_ITEMS = 14
MAX_LLM_SKILLS = 24
MAX_LLM_EXPERIENCE_ITEMS = 5
MAX_LLM_SUMMARY_CHARS = 240
MAX_LLM_EXPERIENCE_CHARS = 240
PROJECT_ROOT = Path(__file__).resolve().parents[2]
_EXPLANATION_CACHE: dict[str, dict[str, Any]] = {}
_EXPLANATION_CACHE_ORDER: list[str] = []
_EXPLANATION_CACHE_LOCK = Lock()


class LLMCallResult(NamedTuple):
    payload: dict[str, Any] | None
    status: Literal["ok", "failed", "timeout"]


def enhance_match_explanation(
    assessment: MatchAssessmentResponse,
    *,
    candidate_profile: CandidateProfile,
    job_detail: dict[str, Any],
) -> MatchAssessmentResponse:
    """Improve summary copy and follow-ups without changing scoring facts."""
    enhanced = _rule_explanation(assessment, candidate_profile=candidate_profile)
    provider = _env_value("ARC_LLM_PROVIDER").strip().lower()
    if provider == "openai":
        api_key = _env_value("OPENAI_API_KEY").strip()
        if not api_key:
            return enhanced
        model = _env_value("ARC_LLM_MODEL", DEFAULT_EXPLANATION_MODEL)
        cache_key = _explanation_cache_key(provider, model, enhanced, candidate_profile, job_detail)
        cached_payload = _cached_explanation(cache_key)
        if cached_payload:
            return _apply_explanation_payload(enhanced, cached_payload, source="llm", cached=True)
        llm_result = _openai_explanation(
            enhanced,
            candidate_profile=candidate_profile,
            job_detail=job_detail,
            api_key=api_key,
            model=model,
        )
    elif provider == "deepseek":
        api_key = _env_value("DEEPSEEK_API_KEY").strip()
        if not api_key:
            return enhanced
        model = _env_value("ARC_LLM_MODEL", DEFAULT_DEEPSEEK_MODEL)
        cache_key = _explanation_cache_key(provider, model, enhanced, candidate_profile, job_detail)
        cached_payload = _cached_explanation(cache_key)
        if cached_payload:
            return _apply_explanation_payload(enhanced, cached_payload, source="llm", cached=True)
        llm_result = _deepseek_explanation(
            enhanced,
            candidate_profile=candidate_profile,
            job_detail=job_detail,
            api_key=api_key,
            model=model,
        )
    else:
        return enhanced

    if llm_result.status == "timeout":
        return enhanced.model_copy(update={"llm_enhancement": "timeout"})
    if not llm_result.payload:
        return enhanced.model_copy(update={"llm_enhancement": "failed"})
    llm_payload = llm_result.payload
    _store_cached_explanation(cache_key, llm_payload)
    return _apply_explanation_payload(enhanced, llm_payload, source="llm")


def build_rule_explanation(
    assessment: MatchAssessmentResponse,
    *,
    candidate_profile: CandidateProfile,
) -> MatchAssessmentResponse:
    """Apply deterministic copy improvements without calling an LLM provider."""
    return _rule_explanation(assessment, candidate_profile=candidate_profile)


def clear_explanation_cache() -> None:
    with _EXPLANATION_CACHE_LOCK:
        _EXPLANATION_CACHE.clear()
        _EXPLANATION_CACHE_ORDER.clear()


def _rule_explanation(
    assessment: MatchAssessmentResponse,
    *,
    candidate_profile: CandidateProfile,
) -> MatchAssessmentResponse:
    payload = {
        "assessment_summary": _rule_summary(assessment),
        "recommendation": _rule_recommendation(assessment),
        "highlights": _rule_highlights(assessment),
        "follow_up_questions": _rule_follow_up_questions(assessment, candidate_profile),
        "personalized_follow_up_questions": _rule_personalized_follow_ups(
            assessment,
            candidate_profile,
        ),
    }
    return _apply_explanation_payload(assessment, payload, source="rule")


def _rule_summary(assessment: MatchAssessmentResponse) -> str:
    strongest = sorted(assessment.dimensions, key=lambda item: item.score, reverse=True)
    weakest = sorted(assessment.dimensions, key=lambda item: item.score)
    positive = strongest[0].name if strongest else "当前资料"
    gap = weakest[0].name if weakest else "关键证据"
    risk = next((flag for flag in assessment.risk_flags if flag.severity == "critical"), None)
    eligibility_label = {
        "pass": "通过",
        "review": "待核实",
        "fail": "未通过",
    }[assessment.eligibility.status]
    potential_label = {
        "high": "较高",
        "medium": "中等",
        "low": "较低",
    }[assessment.potential_level]
    prefix = (
        f"基础条件：{eligibility_label}；综合匹配：{assessment.fit_score}%；"
        f"潜力：{potential_label}。"
    )
    if risk:
        return (
            f"{prefix}{positive}相对更稳，"
            f"但{gap}存在关键缺口，建议核实后再推进。"
        )
    if assessment.fit_score >= 80:
        return (
            f"{prefix}{positive}表现较好，"
            f"后续重点补齐{gap}的证据细节。"
        )
    return (
        f"{prefix}候选人与岗位存在部分相关性，"
        f"需要优先确认{gap}和必备项直接证据。"
    )


def _rule_recommendation(assessment: MatchAssessmentResponse) -> str:
    if assessment.eligibility.status == "fail":
        return "基础条件未通过，除非业务特批否则不建议推进"
    critical = any(flag.severity == "critical" for flag in assessment.risk_flags)
    warning = any(flag.severity == "warning" for flag in assessment.risk_flags)
    if critical:
        return "先核实必备项直接证据，再决定是否推进"
    if assessment.total_score >= 85 and not warning:
        return "高度匹配，建议优先联系"
    if assessment.total_score >= 70:
        return "具备推进价值，建议带着关键问题面谈"
    if assessment.total_score >= 55:
        return "存在可迁移线索，建议补证后判断"
    return "匹配证据偏弱，建议谨慎推进"


def _rule_highlights(assessment: MatchAssessmentResponse) -> list[str]:
    highlights = list(assessment.highlights)
    direct = _evidence_concepts(assessment.evidence, {"DIRECT", "ALIAS"})
    related = _evidence_concepts(assessment.evidence, {"RELATED"})
    bonus = _evidence_concepts(assessment.evidence, {"BONUS"})
    if direct:
        highlights.insert(0, f"直接证据集中在：{_format_items(direct)}。")
    if related:
        highlights.append(f"可迁移线索包括：{_format_items(related)}，需要确认是否能覆盖岗位场景。")
    if bonus:
        highlights.append(f"工程加分信号：{_format_items(bonus)}。")
    return _unique_strings(highlights)[:MAX_HIGHLIGHTS]


def _rule_follow_up_questions(
    assessment: MatchAssessmentResponse,
    candidate_profile: CandidateProfile,
) -> list[str]:
    direct = _evidence_concepts(assessment.evidence, {"DIRECT", "ALIAS"})
    related = _related_evidence_labels(assessment.evidence)
    raw_missing = _missing_concepts(assessment)
    missing = [concept for concept in raw_missing if concept not in direct]
    support_needed = [concept for concept in raw_missing if concept in direct]
    bonus = _evidence_concepts(assessment.evidence, {"BONUS"})
    context = _candidate_context(candidate_profile)
    anchor = _candidate_anchor(candidate_profile)
    questions: list[str] = []

    if related and missing:
        questions.append(
            f"候选人{context}里出现 {_format_items(related[:3])}，"
            f"请结合{anchor}确认这些经历是否能覆盖 {_format_items(missing[:3])}，"
            "重点问承担模块、技术栈、规模和结果。",
        )
    if direct and missing:
        questions.append(
            f"已有 {_format_items(direct[:3])} 的直接证据，"
            f"但 {_format_items(missing[:3])} 仍需补证；请结合{anchor}追问职责边界和产出。",
        )
    elif direct and support_needed:
        questions.append(
            f"已有 {_format_items(direct[:3])} 的技能证据；"
            f"请结合{anchor}补充可验证经历正文、个人贡献和交付结果。"
        )
    elif direct:
        questions.append(
            f"请让候选人结合{anchor}展开 {_format_items(direct[:3])}：职责、难点、指标和结果分别是什么？",
        )
    if bonus:
        questions.append(
            f"围绕{anchor}中的 {_format_items(bonus[:3])} 追问项目复杂度："
            "上线范围、协作方式、质量或性能指标是什么？",
        )
    questions.extend(_supplemental_follow_up_questions(
        assessment.follow_up_questions,
        has_related=bool(related),
        has_bonus=bool(bonus),
    ))
    if assessment.missing_information:
        questions.append("请补齐资料缺失项对应的原始经历描述，避免仅凭技能标签判断。")
    if not questions:
        questions.append("请进一步确认候选人的求职意向、到岗时间和薪资期望。")
    return _unique_strings(questions)[:MAX_QUESTIONS]


def _semantic_review_json_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "string", "maxLength": 500},
            "findings": {
                "type": "array",
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "topic": {
                            "type": "string",
                            "enum": [
                                "research_relevance",
                                "project_complexity",
                                "transferability",
                                "candidate_contribution",
                                "missing_skill_severity",
                            ],
                        },
                        "verdict": {
                            "type": "string",
                            "enum": [
                                "strong",
                                "positive",
                                "uncertain",
                                "risk",
                                "not_applicable",
                            ],
                        },
                        "summary": {"type": "string", "maxLength": 260},
                        "related_concepts": {
                            "type": "array",
                            "maxItems": 8,
                            "items": {"type": "string", "maxLength": 80},
                        },
                    },
                    "required": [
                        "topic",
                        "verdict",
                        "summary",
                        "related_concepts",
                    ],
                },
            },
        },
        "required": ["summary", "findings"],
    }


def _personalized_question_json_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "question": {"type": "string", "maxLength": 240},
            "purpose": {"type": "string", "maxLength": 180},
            "evidence_anchor": {"type": "string", "maxLength": 160},
            "copy_text": {"type": "string", "maxLength": 320},
        },
        "required": ["question", "purpose", "evidence_anchor", "copy_text"],
    }


def _openai_explanation(
    assessment: MatchAssessmentResponse,
    *,
    candidate_profile: CandidateProfile,
    job_detail: dict[str, Any],
    api_key: str,
    model: str,
) -> LLMCallResult:
    payload = {
        "model": model,
        "store": False,
        "input": [
            {
                "role": "system",
                "content": (
                    "你是招聘初筛语义审阅助手。只能改写解释、亮点、追问、推荐语，"
                    "并补充语义审阅结论。"
                    "严禁改变分数、维度、证据、风险或新增无证据事实。"
                    "personalized_follow_up_questions 必须是面试官可直接复制发送或照读的问题，"
                    "每条要结合候选人具体经历、岗位缺口或证据锚点。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    _llm_context(assessment, candidate_profile, job_detail),
                    ensure_ascii=False,
                ),
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "assessment_explanation",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "assessment_summary": {"type": "string", "maxLength": 500},
                        "recommendation": {"type": "string", "maxLength": 160},
                        "highlights": {
                            "type": "array",
                            "maxItems": MAX_HIGHLIGHTS,
                            "items": {"type": "string", "maxLength": 240},
                        },
                        "follow_up_questions": {
                            "type": "array",
                            "maxItems": MAX_QUESTIONS,
                            "items": {"type": "string", "maxLength": 240},
                        },
                        "personalized_follow_up_questions": {
                            "type": "array",
                            "maxItems": MAX_QUESTIONS,
                            "items": _personalized_question_json_schema(),
                        },
                        "semantic_review": _semantic_review_json_schema(),
                    },
                    "required": [
                        "assessment_summary",
                        "recommendation",
                        "highlights",
                        "follow_up_questions",
                        "personalized_follow_up_questions",
                        "semantic_review",
                    ],
                },
                "strict": True,
            },
        },
        "max_output_tokens": _llm_max_tokens(),
    }
    try:
        with httpx.Client(timeout=_llm_timeout_seconds()) as client:
            response = client.post(
                OPENAI_RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
    except httpx.TimeoutException:
        return LLMCallResult(None, "timeout")
    except Exception:
        return LLMCallResult(None, "failed")
    return LLMCallResult(_parse_openai_payload(response.json()), "ok")


def _deepseek_explanation(
    assessment: MatchAssessmentResponse,
    *,
    candidate_profile: CandidateProfile,
    job_detail: dict[str, Any],
    api_key: str,
    model: str,
) -> LLMCallResult:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是招聘初筛语义审阅助手。只能改写解释、亮点、追问、推荐语，"
                    "并补充语义审阅结论。"
                    "严禁改变分数、维度、证据、风险或新增无证据事实。"
                    "必须输出合法 JSON object，字段只能包含 assessment_summary、"
                    "recommendation、highlights、follow_up_questions、"
                    "personalized_follow_up_questions、semantic_review。"
                    "personalized_follow_up_questions 必须是面试官可直接复制发送或照读的问题，"
                    "每条要结合候选人具体经历、岗位缺口或证据锚点。"
                ),
            },
            {
                "role": "user",
                "content": (
                    "请基于以下 JSON 输入，输出 JSON object：\n"
                    f"{json.dumps(_llm_context(assessment, candidate_profile, job_detail), ensure_ascii=False)}\n"
                    "JSON 输出示例："
                    '{"assessment_summary":"...","recommendation":"...",'
                    '"highlights":["..."],"follow_up_questions":["..."],'
                    '"personalized_follow_up_questions":[{"question":"...",'
                    '"purpose":"...","evidence_anchor":"...","copy_text":"..."}],'
                    '"semantic_review":{"summary":"...","findings":[]}}'
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": _llm_max_tokens(),
        "temperature": 0.2,
    }
    try:
        with httpx.Client(timeout=_llm_timeout_seconds()) as client:
            response = client.post(
                _env_value("DEEPSEEK_API_URL", DEEPSEEK_CHAT_COMPLETIONS_URL),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
    except httpx.TimeoutException:
        return LLMCallResult(None, "timeout")
    except Exception:
        return LLMCallResult(None, "failed")
    return LLMCallResult(_parse_deepseek_payload(response.json()), "ok")


def _llm_context(
    assessment: MatchAssessmentResponse,
    candidate_profile: CandidateProfile,
    job_detail: dict[str, Any],
) -> dict[str, Any]:
    return {
        "immutable_score": {
            "total_score": assessment.total_score,
            "fit_score": assessment.fit_score,
            "mode": assessment.mode,
            "eligibility": assessment.eligibility.model_dump(),
            "potential_level": assessment.potential_level,
            "dimensions": [
                {
                    "key": dimension.key,
                    "name": dimension.name,
                    "score": dimension.score,
                    "reason": dimension.reason,
                    "matched_concepts": dimension.matched_concepts,
                    "missing_concepts": dimension.missing_concepts,
                }
                for dimension in assessment.dimensions
            ],
            "risk_flags": [flag.model_dump() for flag in assessment.risk_flags],
            "scoring_standard": assessment.scoring_standard.model_dump(),
            "concept_graph": [layer.model_dump() for layer in assessment.concept_graph],
        },
        "job": {
            "title": _clean_text(job_detail.get("title")),
            "profile": _job_prompt_profile(job_detail.get("profile") or {}),
        },
        "candidate": _candidate_prompt_context(candidate_profile),
        "evidence": [_evidence_for_prompt(item) for item in assessment.evidence[:MAX_LLM_EVIDENCE_ITEMS]],
        "current_text": {
            "recommendation": assessment.recommendation,
            "highlights": assessment.highlights,
            "follow_up_questions": assessment.follow_up_questions,
            "personalized_follow_up_questions": [
                item.model_dump()
                for item in assessment.personalized_follow_up_questions
            ],
        },
    }


def _parse_openai_payload(response_json: dict[str, Any]) -> dict[str, Any] | None:
    text = response_json.get("output_text")
    if isinstance(text, str):
        return _json_object(text)
    for item in response_json.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            content_text = content.get("text")
            if isinstance(content_text, str):
                parsed = _json_object(content_text)
                if parsed:
                    return parsed
    return None


def _parse_deepseek_payload(response_json: dict[str, Any]) -> dict[str, Any] | None:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    return _json_object(content) if isinstance(content, str) else None


def _json_object(value: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _apply_explanation_payload(
    assessment: MatchAssessmentResponse,
    payload: dict[str, Any],
    *,
    source: str,
    cached: bool = False,
) -> MatchAssessmentResponse:
    update = {
        "assessment_summary": _bounded_text(payload.get("assessment_summary"), 500)
        or assessment.assessment_summary,
        "recommendation": _bounded_text(payload.get("recommendation"), 160)
        or assessment.recommendation,
        "highlights": _bounded_text_list(payload.get("highlights"), MAX_HIGHLIGHTS, 240)
        or assessment.highlights,
        "follow_up_questions": _bounded_text_list(
            payload.get("follow_up_questions"),
            MAX_QUESTIONS,
            240,
        ) or assessment.follow_up_questions,
        "personalized_follow_up_questions": _personalized_questions_from_payload(
            payload.get("personalized_follow_up_questions"),
        ) or assessment.personalized_follow_up_questions,
        "semantic_review": _semantic_review_from_payload(
            payload.get("semantic_review"),
            source=source,
        ) or assessment.semantic_review,
        "explanation_source": "llm" if source == "llm" else "rule",
        "llm_enhancement": "cached" if cached else "applied" if source == "llm" else "disabled",
    }
    enhanced = assessment.model_copy(update=update)
    return _apply_hybrid_calibration(enhanced) if source == "llm" else enhanced


def _apply_hybrid_calibration(assessment: MatchAssessmentResponse) -> MatchAssessmentResponse:
    """Map LLM semantic findings to a bounded reference score without changing rule facts."""
    semantic_review = assessment.semantic_review
    if semantic_review.source != "llm" or semantic_review.status != "applied":
        return assessment

    raw_delta = sum(_semantic_finding_delta(finding) for finding in semantic_review.findings)
    delta = max(-5, min(5, raw_delta))
    cap = assessment.eligibility.score_cap if assessment.eligibility.score_cap is not None else 100
    hybrid_score = max(0, min(cap, assessment.total_score + delta))
    actual_delta = hybrid_score - assessment.total_score
    if actual_delta > 0:
        summary = (
            f"LLM 语义审阅识别到更强的相关性、复杂度或贡献线索，"
            f"在规则推荐分基础上上调 {actual_delta} 分；硬性条件上限仍生效。"
        )
    elif actual_delta < 0:
        summary = (
            f"LLM 语义审阅提示直接贡献、迁移性或缺口严重性存在风险，"
            f"在规则推荐分基础上下调 {abs(actual_delta)} 分；规则事实未被改写。"
        )
    else:
        summary = "LLM 语义审阅未触发分数校准，保持规则推荐分。"
    return assessment.model_copy(update={
        "hybrid_score": hybrid_score,
        "hybrid_delta": actual_delta,
        "hybrid_summary": summary,
    })


def _semantic_finding_delta(finding: SemanticReviewFinding) -> int:
    if finding.verdict == "strong":
        return 3 if finding.topic != "missing_skill_severity" else -3
    if finding.verdict == "positive":
        return 2 if finding.topic != "missing_skill_severity" else -2
    if finding.verdict == "risk":
        return -3
    if finding.verdict == "uncertain":
        return -1 if finding.topic in {"candidate_contribution", "missing_skill_severity"} else 0
    return 0


def _semantic_review_from_payload(value: object, *, source: str) -> SemanticReview | None:
    if source != "llm" or not isinstance(value, dict):
        return None
    findings = []
    for item in value.get("findings", []):
        if not isinstance(item, dict):
            continue
        try:
            findings.append(SemanticReviewFinding(
                topic=_bounded_text(item.get("topic"), 80),
                verdict=_bounded_text(item.get("verdict"), 40),
                summary=_bounded_text(item.get("summary"), 260),
                related_concepts=_bounded_text_list(item.get("related_concepts"), 8, 80),
            ))
        except Exception:
            continue
    return SemanticReview(
        source="llm",
        status="applied",
        summary=_bounded_text(value.get("summary"), 500),
        findings=findings[:5],
    )


def _personalized_questions_from_payload(value: object) -> list[PersonalizedFollowUpQuestion]:
    if not isinstance(value, list):
        return []
    questions = []
    seen = set()
    for item in value:
        if isinstance(item, PersonalizedFollowUpQuestion):
            raw_item = item.model_dump()
        elif isinstance(item, dict):
            raw_item = item
        else:
            continue
        question = _question_text(_bounded_text(raw_item.get("question"), 240))
        if not question or question in seen:
            continue
        seen.add(question)
        copy_text = _question_text(_bounded_text(raw_item.get("copy_text"), 320)) or question
        questions.append(PersonalizedFollowUpQuestion(
            question=question,
            purpose=_bounded_text(raw_item.get("purpose"), 180) or "核实岗位相关证据和个人贡献。",
            evidence_anchor=_bounded_text(raw_item.get("evidence_anchor"), 160) or "当前候选人资料",
            copy_text=copy_text,
        ))
    return questions[:MAX_QUESTIONS]


def _rule_personalized_follow_ups(
    assessment: MatchAssessmentResponse,
    candidate_profile: CandidateProfile,
) -> list[PersonalizedFollowUpQuestion]:
    anchor = _candidate_anchor(candidate_profile)
    questions = []
    for text in _rule_follow_up_questions(assessment, candidate_profile):
        question = _question_text(_direct_interview_question(text, anchor))
        if not question:
            continue
        questions.append(PersonalizedFollowUpQuestion(
            question=question,
            purpose=_question_purpose(text),
            evidence_anchor=anchor,
            copy_text=question,
        ))
    return questions[:MAX_QUESTIONS]


def _direct_interview_question(text: str, anchor: str) -> str:
    cleaned = _clean_text(text).rstrip("。；;,.，")
    if not cleaned:
        return ""
    for source, target in [
        ("请让候选人", "请你"),
        ("请进一步确认", "请你进一步说明"),
        ("请确认", "请你具体说明"),
        ("请补充", "请你补充"),
        ("请补齐", "请你补充"),
        ("请结合", "请你结合"),
    ]:
        cleaned = cleaned.replace(source, target)
    if cleaned.startswith("请你") or cleaned.startswith("能否") or cleaned.startswith("是否"):
        return _question_text(cleaned)
    if "请你" in cleaned:
        return _question_text(cleaned)
    return _question_text(f"能否结合{anchor}说明：{cleaned}")


def _question_text(text: str) -> str:
    cleaned = _clean_text(text)
    if not cleaned:
        return ""
    if cleaned[-1] not in "？?":
        cleaned = f"{cleaned}？"
    return cleaned


def _question_purpose(text: str) -> str:
    if "缺失" in text or "补证" in text or "直接证据" in text:
        return "核实岗位必备项是否有直接项目证据。"
    if "复杂度" in text or "上线" in text or "指标" in text:
        return "判断项目复杂度、交付质量和个人贡献。"
    if "年限" in text:
        return "确认实际工作年限和经历强度。"
    return "把规则建议转成可直接提问的候选人追问。"


def _bounded_text(value: object, max_length: int) -> str:
    text = _clean_text(value)
    return text[:max_length] if text else ""


def _bounded_text_list(value: object, max_items: int, max_length: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return _unique_strings(
        _bounded_text(item, max_length)
        for item in value
        if _bounded_text(item, max_length)
    )[:max_items]


def _evidence_concepts(
    evidence: list[MatchEvidence],
    match_types: set[str],
) -> list[str]:
    return _unique_strings(
        item.concept or item.matched_with or ""
        for item in evidence
        if item.match_type in match_types and (item.concept or item.matched_with)
    )


def _related_evidence_labels(evidence: list[MatchEvidence]) -> list[str]:
    labels = []
    for item in evidence:
        if item.match_type != "RELATED":
            continue
        if item.matched_with and item.concept and item.matched_with != item.concept:
            labels.append(f"{item.matched_with} 对应 {item.concept}")
        else:
            labels.append(item.matched_with or item.concept or "")
    return _unique_strings(labels)


def _supplemental_follow_up_questions(
    questions: list[str],
    *,
    has_related: bool,
    has_bonus: bool,
) -> list[str]:
    supplemental = []
    for question in questions:
        if has_related and ("相关线索" in question or "直接使用过" in question):
            continue
        if has_bonus and ("职责边界" in question or "量化成果" in question):
            continue
        supplemental.append(question)
    return supplemental


def _missing_concepts(assessment: MatchAssessmentResponse) -> list[str]:
    concepts = []
    for dimension in assessment.dimensions:
        concepts.extend(dimension.missing_concepts)
    for flag in assessment.risk_flags:
        concepts.extend(flag.related_concepts)
    return _unique_strings(concepts)


def _candidate_context(candidate_profile: CandidateProfile) -> str:
    labels = []
    text = " ".join(
        _clean_text(value)
        for value in [
            candidate_profile.current_title,
            candidate_profile.summary,
            *candidate_profile.skills,
            *[
                item.title or item.description or item.raw_text or ""
                for item in candidate_profile.work_experiences
            ],
            *[
                item.role or item.description or item.raw_text or ""
                for item in candidate_profile.project_experiences
            ],
        ]
    )
    for keyword, label in [
        ("测试", "测试/质量经历"),
        ("全栈", "全栈经历"),
        ("Java", "Java/后端经历"),
        ("Vue", "前端经历"),
        ("React", "前端经历"),
        ("实习", "实习经历"),
    ]:
        if keyword.lower() in text.lower():
            labels.append(label)
    labels = _unique_strings(labels)
    return f"的{'、'.join(labels[:2])}" if labels else "的现有经历"


def _candidate_anchor(candidate_profile: CandidateProfile) -> str:
    for item in candidate_profile.work_experiences:
        label = _anchor_label(item.company, item.title)
        if label:
            return label
    for item in candidate_profile.project_experiences:
        label = _anchor_label(item.name, item.role)
        if label:
            return label
    if _clean_text(candidate_profile.current_title):
        return _clean_text(candidate_profile.current_title)
    return "最相关经历"


def _anchor_label(*values: object) -> str:
    parts = [_clean_text(value) for value in values if _clean_text(value)]
    if not parts:
        return ""
    if all(re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9（）()]+", part) for part in parts):
        return "".join(parts)
    return " ".join(parts)


def _evidence_for_prompt(evidence: MatchEvidence) -> dict[str, Any]:
    return {
        "source": evidence.source,
        "concept": _safe_prompt_text(evidence.concept),
        "match_type": evidence.match_type,
        "matched_with": _safe_prompt_text(evidence.matched_with),
        "reason": _safe_prompt_text(evidence.reason),
        "text": _bounded_prompt_text(evidence.text, 220),
    }


def _candidate_prompt_context(candidate_profile: CandidateProfile) -> dict[str, Any]:
    return {
        "current_title": _safe_prompt_text(candidate_profile.current_title),
        "experience_years": candidate_profile.experience_years,
        "expected_position": _safe_prompt_text(candidate_profile.expected_position),
        "education": [
            {
                "degree": _safe_prompt_text(item.degree),
                "major": _safe_prompt_text(item.major),
                "period": _safe_prompt_text(item.period),
            }
            for item in candidate_profile.education[:8]
        ],
        "skills": [
            _safe_prompt_text(skill)
            for skill in candidate_profile.skills[:MAX_LLM_SKILLS]
            if _safe_prompt_text(skill)
        ],
        "summary": _bounded_prompt_text(candidate_profile.summary, MAX_LLM_SUMMARY_CHARS),
        "work_experiences": [
            {
                "company": _safe_prompt_text(item.company),
                "title": _safe_prompt_text(item.title),
                "period": _safe_prompt_text(item.period),
                "description": _bounded_prompt_text(
                    item.description or item.raw_text,
                    MAX_LLM_EXPERIENCE_CHARS,
                ),
            }
            for item in candidate_profile.work_experiences[:MAX_LLM_EXPERIENCE_ITEMS]
        ],
        "project_experiences": [
            {
                "name": _safe_prompt_text(item.name),
                "role": _safe_prompt_text(item.role),
                "period": _safe_prompt_text(item.period),
                "description": _bounded_prompt_text(
                    item.description or item.raw_text,
                    MAX_LLM_EXPERIENCE_CHARS,
                ),
            }
            for item in candidate_profile.project_experiences[:MAX_LLM_EXPERIENCE_ITEMS]
        ],
    }


def _job_prompt_profile(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "required_concepts": _profile_list(profile, "required_concepts", 16),
        "preferred_concepts": _profile_list(profile, "preferred_concepts", 16),
        "related_concepts": _profile_list(profile, "related_concepts", 16),
        "bonus_concepts": _profile_list(profile, "bonus_concepts", 16),
        "education_keywords": _profile_list(profile, "education_keywords", 6),
        "experience_years_min": profile.get("experience_years_min"),
        "concept_categories": _profile_list(profile, "concept_categories", 10),
    }


def _profile_list(profile: dict[str, Any], key: str, limit: int) -> list[str]:
    value = profile.get(key)
    if not isinstance(value, list):
        return []
    return [_safe_prompt_text(item) for item in value[:limit] if _safe_prompt_text(item)]


def _explanation_cache_key(
    provider: str,
    model: str,
    assessment: MatchAssessmentResponse,
    candidate_profile: CandidateProfile,
    job_detail: dict[str, Any],
) -> str:
    payload = {
        "provider": provider,
        "model": model,
        "context": _llm_context(assessment, candidate_profile, job_detail),
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return sha256(serialized.encode("utf-8")).hexdigest()


def _cached_explanation(cache_key: str) -> dict[str, Any] | None:
    with _EXPLANATION_CACHE_LOCK:
        payload = _EXPLANATION_CACHE.get(cache_key)
        return dict(payload) if payload else None


def _store_cached_explanation(cache_key: str, payload: dict[str, Any]) -> None:
    with _EXPLANATION_CACHE_LOCK:
        if cache_key not in _EXPLANATION_CACHE:
            _EXPLANATION_CACHE_ORDER.append(cache_key)
        _EXPLANATION_CACHE[cache_key] = dict(payload)
        while len(_EXPLANATION_CACHE_ORDER) > MAX_EXPLANATION_CACHE_ITEMS:
            stale_key = _EXPLANATION_CACHE_ORDER.pop(0)
            _EXPLANATION_CACHE.pop(stale_key, None)


def _clean_text(value: object) -> str:
    return "" if value is None else " ".join(str(value).split())


def _env_value(key: str, default: str = "") -> str:
    value = os.environ.get(key)
    if value is not None:
        return value
    return _dotenv_values().get(key, default)


def _llm_timeout_seconds() -> float:
    raw_value = _env_value("ARC_LLM_TIMEOUT_SECONDS", str(DEFAULT_LLM_TIMEOUT_SECONDS))
    try:
        value = float(raw_value)
    except ValueError:
        value = DEFAULT_LLM_TIMEOUT_SECONDS
    return max(1.0, min(15.0, value))


def _llm_max_tokens() -> int:
    raw_value = _env_value("ARC_LLM_MAX_OUTPUT_TOKENS", str(DEFAULT_LLM_MAX_TOKENS))
    try:
        value = int(raw_value)
    except ValueError:
        value = DEFAULT_LLM_MAX_TOKENS
    return max(200, min(1200, value))


@lru_cache(maxsize=1)
def _dotenv_values() -> dict[str, str]:
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return {}
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        if stripped.startswith("export "):
            stripped = stripped[len("export ") :].strip()
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def _format_items(items: list[str]) -> str:
    return "、".join(items[:5]) + ("等" if len(items) > 5 else "")


def _unique_strings(values) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _bounded_prompt_text(value: object, max_length: int) -> str:
    text = _safe_prompt_text(value)
    return text[:max_length] if text else ""


def _safe_prompt_text(value: object) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    replacements = [
        (r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[email]"),
        (r"(?<!\d)1[3-9]\d{9}(?!\d)", "[phone]"),
        (r"(?:token|cookie|authorization|bearer)\s*[:=]\s*\S+", "[credential]"),
        (r"<[^>]{1,80}>", " "),
    ]
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return _clean_text(text)
