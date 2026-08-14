"""Deterministic scoring rules shared by demo and real assessments."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from backend.app.explanation import build_rule_explanation
from backend.app.knowledge_base import (
    bonus_concepts_for_categories,
    clean_text,
    concept_aliases_for,
    contains_concept_alias,
    extract_concepts_from_text,
    related_concepts_for,
)
from backend.app.models import (
    AssessmentEvidenceSource,
    CandidateProfile,
    ConceptGraphLayer,
    EligibilityRequirementResult,
    EligibilityResult,
    MatchAssessmentResponse,
    MatchDimensionResult,
    MatchEvidence,
    MatchMissingInformation,
    MatchRiskFlag,
    ScoringCriterion,
    ScoringStandard,
    SemanticReview,
)


RuleMatchMode = Literal["rule_v1", "rule_v1.1"]
MatchType = Literal["DIRECT", "ALIAS", "RELATED", "BONUS", "NONE"]

RULE_MATCH_WEIGHTS = {
    "skills": 35,
    "experience_years": 20,
    "education": 20,
    "experience_evidence": 25,
}
DIMENSION_NAMES = {
    "skills": "技能匹配",
    "experience_years": "工作年限匹配",
    "education": "教育背景匹配",
    "experience_evidence": "工作/项目经历匹配",
}
SCORING_STANDARD_TEMPLATES = {
    "research": {
        "weights": {
            "skills": 25,
            "experience_years": 10,
            "education": 25,
            "experience_evidence": 40,
        },
        "rationale": "科研/AI4S 岗更看重研究方向、论文/项目质量和教育背景，年限只作弱参考。",
    },
    "engineering": {
        "weights": {
            "skills": 40,
            "experience_years": 15,
            "education": 10,
            "experience_evidence": 35,
        },
        "rationale": "工程岗更看重技术栈直接匹配和可验证交付经历，学历权重降低。",
    },
    "product_solution": {
        "weights": {
            "skills": 25,
            "experience_years": 20,
            "education": 10,
            "experience_evidence": 45,
        },
        "rationale": "产品/解决方案岗更看重项目推进、需求拆解、客户场景和交付闭环。",
    },
    "general": {
        "weights": RULE_MATCH_WEIGHTS,
        "rationale": "岗位画像不足以归入专门族群，使用通用初筛权重。",
    },
}

DIRECT_MATCH_WEIGHT = 1.0
ALIAS_MATCH_WEIGHT = 0.9
RELATED_MATCH_WEIGHT = 0.55
CONTEXTUAL_RELATED_MATCH_WEIGHT = 0.4
BONUS_MATCH_WEIGHT = 0.35
RELATED_REQUIRED_CAP = 0.65
TRANSFER_EXPERIENCE_CAP_WITHOUT_DIRECT_REQUIRED = 72
QUALITY_MATERIAL_EXPERIENCE_FLOOR = 70

DEGREE_RANKS = {
    "大专": 1,
    "专科": 1,
    "本科": 2,
    "研究生": 3,
    "硕士": 3,
    "博士": 4,
}


@dataclass(frozen=True)
class TextSource:
    source: AssessmentEvidenceSource
    text: str
    source_index: int | None = None


@dataclass(frozen=True)
class TransferableSignal:
    label: str
    evidence: MatchEvidence
    score: float


@dataclass(frozen=True)
class SemanticEnrichment:
    related_concepts: dict[str, list[str]]
    transferable_signals: list[TransferableSignal]


@dataclass(frozen=True)
class LLMScoreAdjustment:
    enabled: bool = False
    max_delta: int = 0
    reason: str = "Reserved for future bounded LLM calibration; disabled in rule_v1.1."


def validate_weights(weights: Sequence[int]) -> None:
    """Validate integer percentage weights with an exact total of 100."""
    if not weights:
        raise ValueError("At least one weight is required")
    if any(isinstance(weight, bool) or not isinstance(weight, int) for weight in weights):
        raise ValueError("Weights must be integers")
    if any(weight < 0 or weight > 100 for weight in weights):
        raise ValueError("Weights must be between 0 and 100")
    if sum(weights) != 100:
        raise ValueError("Weights must add up to 100")


def calculate_total_score(weighted_scores: Sequence[tuple[int, int]]) -> int:
    """Return a rounded 0-100 weighted score after validating all inputs."""
    validate_weights([weight for _, weight in weighted_scores])
    scores = [score for score, _ in weighted_scores]
    if any(isinstance(score, bool) or not isinstance(score, int) for score in scores):
        raise ValueError("Scores must be integers")
    if any(score < 0 or score > 100 for score in scores):
        raise ValueError("Scores must be between 0 and 100")
    return round(sum(score * weight for score, weight in weighted_scores) / 100)


def build_scoring_standard(
    job_detail: dict[str, Any],
    scoring_weights: dict[str, int] | None = None,
) -> ScoringStandard:
    """Create the job-level scoring standard used by the rule score."""
    profile = job_detail.get("profile") or {}
    job_family = _job_family(profile, clean_text(job_detail.get("title")))
    template = SCORING_STANDARD_TEMPLATES[job_family]
    weights = dict(template["weights"])
    source = "rule_generated"
    if scoring_weights is not None:
        weights = _validated_scoring_weight_overrides(scoring_weights)
        source = "hr_adjusted"
    validate_weights(list(weights.values()))
    dimensions = [
        ScoringCriterion(
            key=key,
            name=DIMENSION_NAMES[key],
            weight=weight,
            rationale=template["rationale"],
        )
        for key, weight in weights.items()
    ]
    return ScoringStandard(
        standard_id=f"{job_family}_dynamic_v1",
        source=source,
        job_family=job_family,
        related_compensation_cap=round(RELATED_REQUIRED_CAP * 100),
        dimensions=dimensions,
    )


def _validated_scoring_weight_overrides(overrides: dict[str, int]) -> dict[str, int]:
    expected = set(RULE_MATCH_WEIGHTS)
    received = set(overrides)
    if received != expected:
        missing = ", ".join(sorted(expected - received))
        extra = ", ".join(sorted(received - expected))
        detail = "; ".join(
            item for item in [
                f"missing weights: {missing}" if missing else "",
                f"unknown weights: {extra}" if extra else "",
            ] if item
        )
        raise ValueError(f"scoring_weights must contain exactly {sorted(expected)} ({detail})")
    weights = {}
    for key in RULE_MATCH_WEIGHTS:
        weight = overrides[key]
        if isinstance(weight, bool) or not isinstance(weight, int):
            raise ValueError("scoring_weights values must be integers")
        weights[key] = weight
    validate_weights(list(weights.values()))
    return weights


def _job_family(profile: dict[str, Any], title: str) -> str:
    categories = set(_text_list(profile.get("concept_categories")))
    title_lower = title.lower()
    if "bio_ai" in categories or any(
        keyword in title for keyword in ["科研", "研究", "生物", "科学家", "算法科学"]
    ):
        return "research"
    if categories & {"product_pm", "sales_solution"}:
        return "product_solution"
    if categories & {
        "programming_language",
        "backend",
        "frontend",
        "database_middleware",
        "devops",
        "testing",
    } or any(keyword in title_lower for keyword in ["engineer", "developer", "fullstack"]):
        return "engineering"
    return "general"


def _apply_scoring_standard(
    dimensions: list[MatchDimensionResult],
    scoring_standard: ScoringStandard,
) -> list[MatchDimensionResult]:
    weights = {dimension.key: dimension.weight for dimension in scoring_standard.dimensions}
    return [
        dimension.model_copy(update={"weight": weights.get(dimension.key, dimension.weight)})
        for dimension in dimensions
    ]


def build_rule_match_assessment(
    *,
    request_id: str,
    job_detail: dict[str, Any],
    candidate_profile: CandidateProfile,
    version: RuleMatchMode = "rule_v1.1",
    scoring_weights: dict[str, int] | None = None,
) -> MatchAssessmentResponse:
    """Build a deterministic, explainable first-pass match assessment."""
    if version == "rule_v1":
        return _build_rule_v1_match_assessment(
            request_id=request_id,
            job_detail=job_detail,
            candidate_profile=candidate_profile,
            scoring_weights=scoring_weights,
        )
    return _build_rule_v11_match_assessment(
        request_id=request_id,
        job_detail=job_detail,
        candidate_profile=candidate_profile,
        scoring_weights=scoring_weights,
    )


def _build_rule_v1_match_assessment(
    *,
    request_id: str,
    job_detail: dict[str, Any],
    candidate_profile: CandidateProfile,
    scoring_weights: dict[str, int] | None = None,
) -> MatchAssessmentResponse:
    """Build a deterministic, explainable first-pass match assessment."""
    profile = job_detail.get("profile") or {}
    scoring_standard = build_scoring_standard(job_detail, scoring_weights)
    required_concepts = _text_list(profile.get("required_concepts"))
    preferred_concepts = _text_list(profile.get("preferred_concepts"))
    all_concepts = _text_list(profile.get("all_concepts")) or _unique_concepts(
        [*required_concepts, *preferred_concepts]
    )
    education_keywords = _text_list(profile.get("education_keywords"))
    experience_years_min = _optional_int(profile.get("experience_years_min"))

    missing_information: list[MatchMissingInformation] = []
    dimensions = []

    skills_dimension, skill_hits, skill_missing = _score_skills(
        candidate_profile,
        required_concepts,
        preferred_concepts,
    )
    dimensions.append(skills_dimension)
    missing_information.extend(skill_missing)

    years_dimension, years_missing = _score_experience_years(
        candidate_profile.experience_years,
        experience_years_min,
    )
    dimensions.append(years_dimension)
    missing_information.extend(years_missing)

    education_dimension, education_hits, education_missing, education_mismatch = _score_education(
        candidate_profile,
        all_concepts,
        education_keywords,
    )
    dimensions.append(education_dimension)
    missing_information.extend(education_missing)

    experience_dimension, experience_hits, experience_missing = _score_experience_evidence(
        candidate_profile,
        all_concepts,
        required_concepts,
    )
    dimensions.append(experience_dimension)
    dimensions = _apply_scoring_standard(dimensions, scoring_standard)
    missing_information.extend(experience_missing)
    missing_information = _unique_missing_information(missing_information)

    all_candidate_sources = [
        *_skill_sources(candidate_profile),
        *_education_sources(candidate_profile),
        *_experience_sources(candidate_profile),
    ]
    required_global_hits = _match_concepts(all_candidate_sources, required_concepts)
    missing_required = [
        concept for concept in required_concepts if concept not in required_global_hits
    ]
    explicit_negative_hits = _explicit_negative_concepts(all_candidate_sources, required_concepts)

    risk_flags = _build_risks(
        missing_required=missing_required,
        missing_information=missing_information,
        experience_years=candidate_profile.experience_years,
        experience_years_min=experience_years_min,
        education_mismatch=education_mismatch,
        has_candidate_sources=bool(all_candidate_sources),
        has_experience_sources=bool(_experience_sources(candidate_profile)),
        experience_hits=experience_hits,
    )
    follow_up_questions = _build_follow_up_questions(
        missing_required=missing_required,
        missing_information=missing_information,
        experience_years=candidate_profile.experience_years,
        experience_years_min=experience_years_min,
        education_mismatch=education_mismatch,
        experience_hits=experience_hits,
        all_concepts=all_concepts,
    )
    highlights = _build_highlights(
        required_hits=list(required_global_hits),
        preferred_hits=[
            concept
            for concept in preferred_concepts
            if concept in {**skill_hits, **education_hits, **experience_hits}
        ],
        experience_years=candidate_profile.experience_years,
        experience_years_min=experience_years_min,
        education_hits=list(education_hits),
        experience_hits=list(experience_hits),
    )

    fit_score = calculate_total_score(
        [(dimension.score, dimension.weight) for dimension in dimensions]
    )
    eligibility = _build_eligibility_result(
        candidate_profile=candidate_profile,
        required_concepts=required_concepts,
        required_direct_hits=list(required_global_hits),
        related_required_hits={},
        explicit_negative_hits=explicit_negative_hits,
        missing_direct_required=missing_required,
        missing_information=missing_information,
        experience_years_min=experience_years_min,
        education_keywords=education_keywords,
        education_mismatch=education_mismatch,
    )
    total_score = _apply_eligibility_cap(fit_score, eligibility)
    potential_level, potential_summary = _potential_summary(
        fit_score=fit_score,
        eligibility=eligibility,
        transfer_signals=[],
        bonus_hits={},
    )
    return MatchAssessmentResponse(
        request_id=request_id,
        job_id=clean_text(job_detail.get("job_id")),
        job_title=clean_text(job_detail.get("title")) or "未知岗位",
        total_score=total_score,
        fit_score=fit_score,
        hybrid_score=total_score,
        hybrid_delta=0,
        hybrid_summary="当前为规则评分，LLM 语义校准未启用。",
        potential_level=potential_level,
        potential_summary=potential_summary,
        eligibility=eligibility,
        scoring_standard=scoring_standard,
        concept_graph=_build_concept_graph(
            required_concepts,
            preferred_concepts,
            [],
            [],
        ),
        semantic_review=SemanticReview(),
        recommendation=_recommendation(total_score, risk_flags, missing_information),
        dimensions=dimensions,
        highlights=highlights,
        risk_flags=risk_flags,
        missing_information=missing_information,
        follow_up_questions=follow_up_questions,
        evidence=_unique_evidence(
            evidence for dimension in dimensions for evidence in dimension.evidence
        ),
    )


def _build_rule_v11_match_assessment(
    *,
    request_id: str,
    job_detail: dict[str, Any],
    candidate_profile: CandidateProfile,
    scoring_weights: dict[str, int] | None = None,
) -> MatchAssessmentResponse:
    """Build rule_v1.1 scoring with bounded related-skill compensation."""
    profile = job_detail.get("profile") or {}
    scoring_standard = build_scoring_standard(job_detail, scoring_weights)
    required_concepts = _text_list(profile.get("required_concepts"))
    preferred_concepts = _text_list(profile.get("preferred_concepts"))
    all_concepts = _text_list(profile.get("all_concepts")) or _unique_concepts(
        [*required_concepts, *preferred_concepts]
    )
    concept_categories = _text_list(profile.get("concept_categories"))
    related_concepts = _text_list(profile.get("related_concepts")) or _related_concepts_for_targets(
        [*required_concepts, *preferred_concepts]
    )
    bonus_concepts = _text_list(profile.get("bonus_concepts")) or bonus_concepts_for_categories(
        concept_categories
    )
    evaluation_materials = _evaluation_materials(profile.get("evaluation_materials"))
    education_keywords = _text_list(profile.get("education_keywords"))
    experience_years_min = _optional_int(profile.get("experience_years_min"))

    missing_information: list[MatchMissingInformation] = []
    dimensions = []

    skills_dimension, skill_hits, skill_bonus_hits, skill_missing = _score_skills_v11(
        candidate_profile,
        required_concepts,
        preferred_concepts,
        related_concepts,
        bonus_concepts,
    )
    dimensions.append(skills_dimension)
    missing_information.extend(skill_missing)

    years_dimension, years_missing = _score_experience_years(
        candidate_profile.experience_years,
        experience_years_min,
    )
    dimensions.append(years_dimension)
    missing_information.extend(years_missing)

    education_dimension, education_hits, education_missing, education_mismatch = _score_education(
        candidate_profile,
        all_concepts,
        education_keywords,
    )
    dimensions.append(education_dimension)
    missing_information.extend(education_missing)

    (
        experience_dimension,
        experience_hits,
        experience_bonus_hits,
        transfer_signals,
        experience_missing,
    ) = _score_experience_evidence_v11(
        candidate_profile,
        all_concepts,
        required_concepts,
        preferred_concepts,
        related_concepts,
        bonus_concepts,
        evaluation_materials,
    )
    dimensions.append(experience_dimension)
    dimensions = _apply_scoring_standard(dimensions, scoring_standard)
    missing_information.extend(experience_missing)
    missing_information = _unique_missing_information(missing_information)

    all_candidate_sources = [
        *_skill_sources(candidate_profile),
        *_education_sources(candidate_profile),
        *_experience_sources(candidate_profile),
    ]
    required_global_hits = _match_concepts_detailed(
        all_candidate_sources,
        required_concepts,
        related_concepts_by_target=_related_map_for_targets(
            required_concepts,
            related_concepts,
            excluded_targets=[*required_concepts, *preferred_concepts],
        ),
    )
    required_direct_hits = [
        concept
        for concept in required_concepts
        if _is_direct_or_alias(required_global_hits.get(concept))
    ]
    related_required_hits = {
        concept: evidence
        for concept, evidence in required_global_hits.items()
        if evidence.match_type == "RELATED"
    }
    explicit_negative_hits = _explicit_negative_concepts(all_candidate_sources, required_concepts)
    missing_direct_required = [
        concept
        for concept in required_concepts
        if concept not in required_direct_hits and concept not in explicit_negative_hits
    ]

    combined_hits: dict[str, MatchEvidence] = {
        **education_hits,
        **skill_hits,
        **experience_hits,
    }
    combined_bonus_hits: dict[str, MatchEvidence] = {
        **skill_bonus_hits,
        **experience_bonus_hits,
    }
    risk_flags = _build_risks_v11(
        missing_direct_required=missing_direct_required,
        related_required_hits=related_required_hits,
        explicit_negative_hits=explicit_negative_hits,
        missing_information=missing_information,
        experience_years=candidate_profile.experience_years,
        experience_years_min=experience_years_min,
        education_mismatch=education_mismatch,
        has_candidate_sources=bool(all_candidate_sources),
        has_experience_sources=bool(_experience_sources(candidate_profile)),
        experience_hits=experience_hits,
        transfer_signals=transfer_signals,
    )
    follow_up_questions = _build_follow_up_questions_v11(
        candidate_profile=candidate_profile,
        missing_direct_required=missing_direct_required,
        related_required_hits=related_required_hits,
        missing_information=missing_information,
        experience_years=candidate_profile.experience_years,
        experience_years_min=experience_years_min,
        education_mismatch=education_mismatch,
        experience_hits=experience_hits,
        transfer_signals=transfer_signals,
        all_concepts=all_concepts,
    )
    highlights = _build_highlights_v11(
        required_hits=required_direct_hits,
        preferred_hits=[
            concept
            for concept in preferred_concepts
            if concept in combined_hits and combined_hits[concept].match_type != "RELATED"
        ],
        related_required_hits=related_required_hits,
        bonus_hits=combined_bonus_hits,
        transfer_signals=transfer_signals,
        experience_years=candidate_profile.experience_years,
        experience_years_min=experience_years_min,
        education_hits=list(education_hits),
        experience_hits=list(experience_hits),
    )

    fit_score = calculate_total_score(
        [(dimension.score, dimension.weight) for dimension in dimensions]
    )
    eligibility = _build_eligibility_result(
        candidate_profile=candidate_profile,
        required_concepts=required_concepts,
        required_direct_hits=required_direct_hits,
        related_required_hits=related_required_hits,
        explicit_negative_hits=explicit_negative_hits,
        missing_direct_required=missing_direct_required,
        missing_information=missing_information,
        experience_years_min=experience_years_min,
        education_keywords=education_keywords,
        education_mismatch=education_mismatch,
    )
    total_score = _apply_eligibility_cap(fit_score, eligibility)
    potential_level, potential_summary = _potential_summary(
        fit_score=fit_score,
        eligibility=eligibility,
        transfer_signals=transfer_signals,
        bonus_hits=combined_bonus_hits,
    )
    assessment = MatchAssessmentResponse(
        request_id=request_id,
        mode="rule_v1.1",
        job_id=clean_text(job_detail.get("job_id")),
        job_title=clean_text(job_detail.get("title")) or "未知岗位",
        total_score=total_score,
        fit_score=fit_score,
        hybrid_score=total_score,
        hybrid_delta=0,
        hybrid_summary="当前为规则评分，LLM 语义校准未启用。",
        potential_level=potential_level,
        potential_summary=potential_summary,
        eligibility=eligibility,
        scoring_standard=scoring_standard,
        concept_graph=_build_concept_graph(
            required_concepts,
            preferred_concepts,
            related_concepts,
            bonus_concepts,
        ),
        semantic_review=SemanticReview(),
        recommendation=_recommendation(total_score, risk_flags, missing_information),
        dimensions=dimensions,
        highlights=highlights,
        risk_flags=risk_flags,
        missing_information=missing_information,
        follow_up_questions=follow_up_questions,
        evidence=_unique_evidence(
            [
                *[
                    evidence
                    for dimension in dimensions
                    for evidence in dimension.evidence
                ],
                *explicit_negative_hits.values(),
            ]
        ),
    )
    return build_rule_explanation(
        assessment,
        candidate_profile=candidate_profile,
    )


def _build_eligibility_result(
    *,
    candidate_profile: CandidateProfile,
    required_concepts: list[str],
    required_direct_hits: list[str],
    related_required_hits: dict[str, MatchEvidence],
    explicit_negative_hits: dict[str, MatchEvidence],
    missing_direct_required: list[str],
    missing_information: list[MatchMissingInformation],
    experience_years_min: int | None,
    education_keywords: list[str],
    education_mismatch: bool,
) -> EligibilityResult:
    requirements: list[EligibilityRequirementResult] = []
    direct_hit_set = set(required_direct_hits)
    missing_set = set(missing_direct_required)
    for concept in required_concepts:
        if concept in explicit_negative_hits:
            requirements.append(EligibilityRequirementResult(
                key=f"required_concept:{concept}",
                label=f"必备概念：{concept}",
                status="not_met",
                severity="critical",
                reason=f"候选人资料明确表示不具备或不熟悉 {concept}。",
                related_concepts=[concept],
            ))
        elif concept in direct_hit_set:
            requirements.append(EligibilityRequirementResult(
                key=f"required_concept:{concept}",
                label=f"必备概念：{concept}",
                status="met",
                severity="info",
                reason=f"已看到 {concept} 的直接或别名证据。",
                related_concepts=[concept],
            ))
        elif concept in related_required_hits:
            evidence = related_required_hits[concept]
            requirements.append(EligibilityRequirementResult(
                key=f"required_concept:{concept}",
                label=f"必备概念：{concept}",
                status="related_only",
                severity="warning",
                reason=(
                    f"仅看到 {evidence.matched_with or '相关能力'} 的可迁移线索，"
                    f"不能直接视为满足 {concept}。"
                ),
                related_concepts=[concept],
            ))
        elif concept in missing_set:
            requirements.append(EligibilityRequirementResult(
                key=f"required_concept:{concept}",
                label=f"必备概念：{concept}",
                status="missing",
                severity="warning",
                reason=f"候选人资料中暂未看到 {concept} 的直接证据。",
                related_concepts=[concept],
            ))

    if experience_years_min is not None:
        if candidate_profile.experience_years is None:
            requirements.append(EligibilityRequirementResult(
                key="experience_years",
                label=f"工作年限：至少 {experience_years_min} 年",
                status="missing",
                severity="warning",
                reason="候选人资料未提供可计算工作年限。",
            ))
        elif candidate_profile.experience_years < experience_years_min:
            requirements.append(EligibilityRequirementResult(
                key="experience_years",
                label=f"工作年限：至少 {experience_years_min} 年",
                status="not_met",
                severity="critical",
                reason=(
                    f"候选人工作年限 {candidate_profile.experience_years} 年，"
                    f"低于岗位最低 {experience_years_min} 年。"
                ),
            ))
        else:
            requirements.append(EligibilityRequirementResult(
                key="experience_years",
                label=f"工作年限：至少 {experience_years_min} 年",
                status="met",
                severity="info",
                reason=f"候选人工作年限 {candidate_profile.experience_years} 年达到要求。",
            ))

    if education_keywords:
        education_label = f"学历要求：{_format_concepts(education_keywords)}"
        if not candidate_profile.education:
            requirements.append(EligibilityRequirementResult(
                key="education",
                label=education_label,
                status="missing",
                severity="warning",
                reason="候选人资料未提供教育经历。",
            ))
        elif education_mismatch:
            requirements.append(EligibilityRequirementResult(
                key="education",
                label=education_label,
                status="not_met",
                severity="critical",
                reason="候选人学历层次低于岗位硬性学历要求。",
            ))
        else:
            requirements.append(EligibilityRequirementResult(
                key="education",
                label=education_label,
                status="met",
                severity="info",
                reason="候选人学历层次达到岗位要求。",
            ))

    if any(item.status == "not_met" for item in requirements):
        return EligibilityResult(
            status="fail",
            summary="基础条件未通过：存在明确不满足的硬性要求。",
            score_cap=59,
            requirements=requirements,
        )
    hard_review = any(item.status in {"missing", "related_only"} for item in requirements)
    if hard_review:
        return EligibilityResult(
            status="review",
            summary="基础条件待核实：硬性要求存在缺失或仅有可迁移证据。",
            score_cap=74,
            requirements=requirements,
        )
    if missing_information:
        return EligibilityResult(
            status="review",
            summary="基础条件基本通过，但候选人资料仍有信息缺口。",
            score_cap=82,
            requirements=requirements,
        )
    return EligibilityResult(
        status="pass",
        summary="基础条件通过：硬性要求均有直接证据或达到条件。",
        score_cap=None,
        requirements=requirements,
    )


def _apply_eligibility_cap(fit_score: int, eligibility: EligibilityResult) -> int:
    if eligibility.score_cap is None:
        return fit_score
    return min(fit_score, eligibility.score_cap)


def _potential_summary(
    *,
    fit_score: int,
    eligibility: EligibilityResult,
    transfer_signals: list[TransferableSignal],
    bonus_hits: dict[str, MatchEvidence],
) -> tuple[str, str]:
    if eligibility.status == "fail":
        return "low", "硬性条件存在明确不满足，潜力判断需让位于基础门槛。"
    if fit_score >= 80 and (bonus_hits or len(transfer_signals) >= 2):
        return "high", "综合匹配较强，且存在项目深度或可迁移经历信号。"
    if fit_score >= 65 or transfer_signals or bonus_hits:
        return "medium", "存在可继续核实的能力线索，建议围绕真实贡献追问。"
    return "low", "当前资料中的岗位相关证据偏少，潜力判断置信度较低。"


def _build_concept_graph(
    required_concepts: list[str],
    preferred_concepts: list[str],
    related_concepts: list[str],
    bonus_concepts: list[str],
) -> list[ConceptGraphLayer]:
    return [
        ConceptGraphLayer(
            role="required",
            label="核心要求",
            concepts=required_concepts,
            description="必须优先核实，只有直接或别名证据才视为满足。",
        ),
        ConceptGraphLayer(
            role="preferred",
            label="明确加分",
            concepts=preferred_concepts,
            description="JD 中明确标记为优先或加分的要求。",
        ),
        ConceptGraphLayer(
            role="related",
            label="可迁移相关能力",
            concepts=related_concepts,
            compensation_cap=round(RELATED_REQUIRED_CAP * 100),
            description="只能提供有限补偿，不能替代核心要求。",
        ),
        ConceptGraphLayer(
            role="bonus",
            label="项目深度/工程能力信号",
            concepts=bonus_concepts,
            description="用于识别交付质量、复杂度和额外亮点，不替代硬性条件。",
        ),
    ]


def _score_skills(
    candidate_profile: CandidateProfile,
    required_concepts: list[str],
    preferred_concepts: list[str],
) -> tuple[MatchDimensionResult, dict[str, MatchEvidence], list[MatchMissingInformation]]:
    target_concepts = _unique_concepts([*required_concepts, *preferred_concepts])
    skill_sources = _skill_sources(candidate_profile)
    hits = _match_concepts(skill_sources, target_concepts)
    required_hits = [concept for concept in required_concepts if concept in hits]
    preferred_hits = [concept for concept in preferred_concepts if concept in hits]
    missing_required = [concept for concept in required_concepts if concept not in hits]
    missing_information = []
    if not candidate_profile.skills:
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.skills",
            reason="候选人资料未提供技能标签，技能维度只能依赖其他经历证据辅助判断。",
        ))

    if not target_concepts:
        score = 50
        reason = "岗位画像没有可用于技能匹配的标准概念。"
        confidence = 0.35
    elif required_concepts:
        required_ratio = len(required_hits) / len(required_concepts)
        preferred_ratio = (
            len(preferred_hits) / len(preferred_concepts)
            if preferred_concepts
            else 1
        )
        score = round(80 * required_ratio + 20 * preferred_ratio)
        reason = (
            f"技能标签命中 {len(required_hits)}/{len(required_concepts)} 个必备概念"
            f"、{len(preferred_hits)}/{len(preferred_concepts)} 个加分概念。"
        )
        confidence = 0.85 if skill_sources else 0.4
    else:
        preferred_ratio = len(preferred_hits) / len(preferred_concepts)
        score = round(100 * preferred_ratio)
        reason = f"技能标签命中 {len(preferred_hits)}/{len(preferred_concepts)} 个岗位概念。"
        confidence = 0.75 if skill_sources else 0.35

    return (
        MatchDimensionResult(
            key="skills",
            name="技能匹配",
            score=score,
            weight=RULE_MATCH_WEIGHTS["skills"],
            confidence=confidence,
            reason=reason,
            matched_concepts=[concept for concept in target_concepts if concept in hits],
            missing_concepts=missing_required,
            evidence=_ordered_evidence(hits, target_concepts),
        ),
        hits,
        missing_information,
    )


def _score_skills_v11(
    candidate_profile: CandidateProfile,
    required_concepts: list[str],
    preferred_concepts: list[str],
    related_concepts: list[str],
    bonus_concepts: list[str],
) -> tuple[
    MatchDimensionResult,
    dict[str, MatchEvidence],
    dict[str, MatchEvidence],
    list[MatchMissingInformation],
]:
    target_concepts = _unique_concepts([*required_concepts, *preferred_concepts])
    skill_sources = _skill_sources(candidate_profile)
    support_sources = _experience_sources(candidate_profile)
    candidate_sources = [*skill_sources, *support_sources]
    related_map = _related_map_for_targets(
        target_concepts,
        related_concepts,
        excluded_targets=target_concepts,
    )
    hits = _match_concepts_detailed(candidate_sources, target_concepts, related_map)
    negative_hits = _explicit_negative_concepts(candidate_sources, target_concepts)
    for concept in negative_hits:
        hits.pop(concept, None)
    bonus_hits = _match_bonus_concepts(candidate_sources, bonus_concepts)
    required_direct_hits = [
        concept for concept in required_concepts if _is_direct_or_alias(hits.get(concept))
    ]
    required_related_hits = [
        concept for concept in required_concepts if _is_related(hits.get(concept))
    ]
    missing_required = [
        concept for concept in required_concepts if not _is_direct_or_alias(hits.get(concept))
    ]
    preferred_hits = [concept for concept in preferred_concepts if concept in hits]
    missing_information = []
    if not candidate_profile.skills and not support_sources:
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.skills",
            reason="候选人资料未提供技能标签，也缺少可辅助判断技能的工作/项目文本。",
        ))
    elif not candidate_profile.skills:
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.skills",
            reason="候选人资料未提供技能标签，技能维度已用工作/项目文本做辅助判断。",
        ))

    if not target_concepts:
        score = 50
        reason = "岗位画像没有可用于技能匹配的标准概念。"
        confidence = 0.35
    elif required_concepts:
        required_ratio = _weighted_match_ratio(hits, required_concepts)
        if not required_direct_hits and required_related_hits:
            required_ratio = min(required_ratio, RELATED_REQUIRED_CAP)
        preferred_ratio = (
            _weighted_match_ratio(hits, preferred_concepts)
            if preferred_concepts
            else 1
        )
        score = round(82 * required_ratio + 18 * preferred_ratio)
        score = min(100, score + _bonus_score_adjustment(bonus_hits))
        if not required_direct_hits and required_related_hits:
            score = min(score, 68)
        preferred_part = (
            f"加分概念命中 {len(preferred_hits)}/{len(preferred_concepts)} 个。"
            if preferred_concepts
            else "岗位未设置加分概念。"
        )
        reason = (
            f"直接/别名命中 {len(required_direct_hits)}/{len(required_concepts)} 个必备概念"
            f"，相关证据覆盖 {len(required_related_hits)} 个；"
            f"{preferred_part}"
        )
        confidence = 0.86 if skill_sources else 0.68 if support_sources else 0.35
    else:
        preferred_ratio = _weighted_match_ratio(hits, preferred_concepts)
        score = min(100, round(100 * preferred_ratio) + _bonus_score_adjustment(bonus_hits))
        confidence = 0.78 if candidate_sources else 0.35
        reason = f"技能/经历文本命中 {len(preferred_hits)}/{len(preferred_concepts)} 个岗位概念。"

    evidence = [
        *_ordered_evidence(hits, target_concepts),
        *_ordered_evidence(bonus_hits, bonus_concepts),
        *_ordered_evidence(negative_hits, target_concepts),
    ]
    return (
        MatchDimensionResult(
            key="skills",
            name="技能匹配",
            score=score,
            weight=RULE_MATCH_WEIGHTS["skills"],
            confidence=confidence,
            reason=reason,
            matched_concepts=[concept for concept in target_concepts if concept in hits],
            missing_concepts=missing_required,
            evidence=evidence,
        ),
        hits,
        bonus_hits,
        missing_information,
    )


def _score_experience_years(
    experience_years: int | None,
    experience_years_min: int | None,
) -> tuple[MatchDimensionResult, list[MatchMissingInformation]]:
    evidence = []
    missing_information = []
    if experience_years_min is not None:
        evidence.append(MatchEvidence(
            source="job.profile",
            text=f"岗位最低工作年限：{experience_years_min}年",
        ))
    if experience_years is not None:
        evidence.append(MatchEvidence(
            source="candidate.experience_years",
            text=f"候选人工作年限：{experience_years}年",
        ))

    if experience_years_min is None:
        score = 80
        confidence = 0.45
        reason = "岗位画像未设置最低工作年限，年限维度只作弱参考。"
    elif experience_years is None:
        score = 55
        confidence = 0.35
        reason = "候选人资料未提供明确工作年限，不能直接判断年限是否满足。"
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.experience_years",
            reason="岗位设置了最低工作年限，但候选人资料未提供可计算年限。",
        ))
    elif experience_years >= experience_years_min:
        score = 100
        confidence = 0.9
        reason = f"候选人工作年限 {experience_years} 年达到岗位最低 {experience_years_min} 年要求。"
    else:
        score = max(30, round(100 * experience_years / experience_years_min))
        confidence = 0.9
        reason = f"候选人工作年限 {experience_years} 年低于岗位最低 {experience_years_min} 年要求。"

    return (
        MatchDimensionResult(
            key="experience_years",
            name="工作年限匹配",
            score=score,
            weight=RULE_MATCH_WEIGHTS["experience_years"],
            confidence=confidence,
            reason=reason,
            matched_concepts=[],
            missing_concepts=[],
            evidence=evidence,
        ),
        missing_information,
    )


def _score_education(
    candidate_profile: CandidateProfile,
    all_concepts: list[str],
    education_keywords: list[str],
) -> tuple[
    MatchDimensionResult,
    dict[str, MatchEvidence],
    list[MatchMissingInformation],
    bool,
]:
    education_sources = _education_sources(candidate_profile)
    hits = _match_concepts(education_sources, all_concepts)
    required_rank = _education_rank(education_keywords)
    candidate_rank = _candidate_education_rank(education_sources)
    missing_information = []
    education_mismatch = False

    if not education_keywords:
        score = 80 if education_sources else 55
        confidence = 0.45 if not education_sources else 0.55
        reason = "岗位画像未设置明确学历关键词，教育维度只作弱参考。"
        if not education_sources:
            missing_information.append(MatchMissingInformation(
                field="candidate_profile.education",
                reason="候选人资料未提供教育经历。",
            ))
    elif not education_sources:
        score = 55
        confidence = 0.35
        reason = "岗位设置了学历关键词，但候选人资料未提供教育经历。"
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.education",
            reason="岗位画像包含学历要求，候选人资料未提供教育经历。",
        ))
    elif candidate_rank is None:
        score = 70 if hits else 60
        confidence = 0.45
        reason = "候选人教育经历存在，但未识别到明确学历层次。"
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.education.degree",
            reason="教育经历未提供可识别的学历层次。",
        ))
    elif required_rank is not None and candidate_rank < required_rank:
        score = 50 if hits else 45
        confidence = 0.75
        reason = "候选人学历层次低于岗位画像中的学历关键词。"
        education_mismatch = True
    else:
        score = 100 if hits else 85
        confidence = 0.8
        reason = "候选人学历层次达到岗位画像中的学历关键词要求。"

    return (
        MatchDimensionResult(
            key="education",
            name="教育背景匹配",
            score=score,
            weight=RULE_MATCH_WEIGHTS["education"],
            confidence=confidence,
            reason=reason,
            matched_concepts=[concept for concept in all_concepts if concept in hits],
            missing_concepts=[],
            evidence=_ordered_evidence(hits, all_concepts),
        ),
        hits,
        missing_information,
        education_mismatch,
    )


def _score_experience_evidence(
    candidate_profile: CandidateProfile,
    all_concepts: list[str],
    required_concepts: list[str],
) -> tuple[MatchDimensionResult, dict[str, MatchEvidence], list[MatchMissingInformation]]:
    experience_sources = _experience_sources(candidate_profile)
    detailed_experience_sources = _detailed_experience_sources(candidate_profile)
    hits = _match_concepts(experience_sources, all_concepts)
    required_hits = [concept for concept in required_concepts if concept in hits]
    missing_required = [concept for concept in required_concepts if concept not in hits]
    missing_information = []

    if not all_concepts:
        score = 50
        confidence = 0.35
        reason = "岗位画像没有可用于经历匹配的标准概念。"
    elif not experience_sources:
        score = 45
        confidence = 0.35
        reason = "候选人资料未提供工作经历、项目经历或摘要，无法确认岗位相关经历证据。"
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.work_experiences/project_experiences/summary",
            reason="缺少可用于岗位相关经历匹配的工作、项目或摘要文本。",
        ))
    elif not detailed_experience_sources:
        score = min(60, max(35, round(100 * len(hits) / len(all_concepts)))) if all_concepts else 45
        confidence = 0.45
        reason = "候选人资料仅提供标题类线索，缺少可验证的工作、项目或摘要文本。"
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.work_experiences/project_experiences/summary",
            reason="当前仅看到候选人标题类线索，缺少可核实的经历正文。",
        ))
    elif required_concepts:
        required_ratio = len(required_hits) / len(required_concepts)
        all_ratio = len(hits) / len(all_concepts)
        score = max(35, round(70 * required_ratio + 30 * all_ratio))
        reason = (
            f"工作/项目/摘要命中 {len(required_hits)}/{len(required_concepts)} 个必备概念"
            f"、{len(hits)}/{len(all_concepts)} 个岗位概念。"
        )
        confidence = 0.8
    else:
        score = max(35, round(100 * len(hits) / len(all_concepts)))
        confidence = 0.75
        reason = f"工作/项目/摘要命中 {len(hits)}/{len(all_concepts)} 个岗位概念。"

    return (
        MatchDimensionResult(
            key="experience_evidence",
            name="工作/项目经历匹配",
            score=score,
            weight=RULE_MATCH_WEIGHTS["experience_evidence"],
            confidence=confidence,
            reason=reason,
            matched_concepts=[concept for concept in all_concepts if concept in hits],
            missing_concepts=missing_required,
            evidence=_ordered_evidence(hits, all_concepts),
        ),
        hits,
        missing_information,
    )


def _score_experience_evidence_v11(
    candidate_profile: CandidateProfile,
    all_concepts: list[str],
    required_concepts: list[str],
    preferred_concepts: list[str],
    related_concepts: list[str],
    bonus_concepts: list[str],
    evaluation_materials: list[dict[str, Any]],
) -> tuple[
    MatchDimensionResult,
    dict[str, MatchEvidence],
    dict[str, MatchEvidence],
    list[TransferableSignal],
    list[MatchMissingInformation],
]:
    experience_sources = _experience_sources(candidate_profile)
    detailed_experience_sources = _detailed_experience_sources(candidate_profile)
    target_concepts = _unique_concepts(
        all_concepts or [*required_concepts, *preferred_concepts]
    )
    related_map = _related_map_for_targets(
        target_concepts,
        related_concepts,
        excluded_targets=target_concepts,
    )
    hits = _match_concepts_detailed(experience_sources, target_concepts, related_map)
    negative_hits = _explicit_negative_concepts(experience_sources, target_concepts)
    for concept in negative_hits:
        hits.pop(concept, None)
    evaluation_hits = _match_evaluation_materials(experience_sources, evaluation_materials)
    bonus_hits = {
        **_match_bonus_concepts(experience_sources, bonus_concepts),
        **evaluation_hits,
    }
    transfer_signals = _transferable_experience_signals(experience_sources)
    required_direct_hits = [
        concept for concept in required_concepts if _is_direct_or_alias(hits.get(concept))
    ]
    required_related_hits = [
        concept for concept in required_concepts if _is_related(hits.get(concept))
    ]
    missing_required = [
        concept for concept in required_concepts if not _is_direct_or_alias(hits.get(concept))
    ]
    missing_information = []

    if not target_concepts:
        score = 50
        confidence = 0.35
        reason = "岗位画像没有可用于经历匹配的标准概念。"
    elif not experience_sources:
        score = 45
        confidence = 0.35
        reason = "候选人资料未提供工作经历、项目经历或摘要，无法确认岗位相关经历证据。"
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.work_experiences/project_experiences/summary",
            reason="缺少可用于岗位相关经历匹配的工作、项目或摘要文本。",
        ))
    elif not detailed_experience_sources:
        all_ratio = _weighted_match_ratio(hits, target_concepts)
        transfer_ratio = _transfer_signal_ratio(transfer_signals)
        score = min(60, max(35, round(58 * all_ratio + 22 * transfer_ratio)))
        score = min(100, score + _bonus_score_adjustment(bonus_hits))
        confidence = 0.48
        reason = "候选人资料仅提供标题类线索，缺少可验证的工作、项目或摘要文本。"
        missing_information.append(MatchMissingInformation(
            field="candidate_profile.work_experiences/project_experiences/summary",
            reason="当前仅看到候选人标题类线索，缺少可核实的经历正文。",
        ))
    elif required_concepts:
        required_ratio = _weighted_match_ratio(hits, required_concepts)
        if not required_direct_hits and required_related_hits:
            required_ratio = min(required_ratio, RELATED_REQUIRED_CAP)
        all_ratio = _weighted_match_ratio(hits, target_concepts)
        transfer_ratio = _transfer_signal_ratio(transfer_signals)
        score = max(35, round(62 * required_ratio + 20 * all_ratio + 18 * transfer_ratio))
        score = min(100, score + _bonus_score_adjustment(bonus_hits))
        if (
            evaluation_hits
            and _has_quality_evaluation_material_hit(evaluation_hits, evaluation_materials)
            and any(_is_direct_or_alias(evidence) for evidence in hits.values())
        ):
            score = max(score, QUALITY_MATERIAL_EXPERIENCE_FLOOR)
        if not required_direct_hits and (required_related_hits or transfer_signals):
            score = min(score, TRANSFER_EXPERIENCE_CAP_WITHOUT_DIRECT_REQUIRED)
        reason = (
            f"工作/项目/摘要直接命中 {len(required_direct_hits)}/{len(required_concepts)} 个必备概念"
            f"，相关迁移证据覆盖 {len(required_related_hits)} 个；"
            f"识别到 {len(transfer_signals)} 类工程经历信号。"
        )
        confidence = 0.82
    else:
        all_ratio = _weighted_match_ratio(hits, target_concepts)
        transfer_ratio = _transfer_signal_ratio(transfer_signals)
        score = max(35, round(78 * all_ratio + 22 * transfer_ratio))
        score = min(100, score + _bonus_score_adjustment(bonus_hits))
        if (
            evaluation_hits
            and _has_quality_evaluation_material_hit(evaluation_hits, evaluation_materials)
            and hits
        ):
            score = max(score, QUALITY_MATERIAL_EXPERIENCE_FLOOR)
        confidence = 0.76
        reason = (
            f"工作/项目/摘要命中 {len(hits)}/{len(target_concepts)} 个岗位概念，"
            f"识别到 {len(transfer_signals)} 类工程经历信号。"
        )

    bonus_evidence_order = _unique_concepts(
        [
            *bonus_concepts,
            *_evaluation_material_labels(evaluation_materials),
        ]
    )
    evidence = [
        *_ordered_evidence(hits, target_concepts),
        *_ordered_evidence(bonus_hits, bonus_evidence_order),
        *_ordered_evidence(negative_hits, target_concepts),
        *[signal.evidence for signal in transfer_signals],
    ]
    return (
        MatchDimensionResult(
            key="experience_evidence",
            name="工作/项目经历匹配",
            score=score,
            weight=RULE_MATCH_WEIGHTS["experience_evidence"],
            confidence=confidence,
            reason=reason,
            matched_concepts=[concept for concept in target_concepts if concept in hits],
            missing_concepts=missing_required,
            evidence=evidence,
        ),
        hits,
        bonus_hits,
        transfer_signals,
        missing_information,
    )


def _build_risks(
    *,
    missing_required: list[str],
    missing_information: list[MatchMissingInformation],
    experience_years: int | None,
    experience_years_min: int | None,
    education_mismatch: bool,
    has_candidate_sources: bool,
    has_experience_sources: bool,
    experience_hits: dict[str, MatchEvidence],
) -> list[MatchRiskFlag]:
    risks = []
    if missing_required:
        risks.append(MatchRiskFlag(
            code="missing_required_skill",
            severity="critical" if has_candidate_sources else "info",
            message=(
                "候选人资料中暂未看到必备概念证据："
                f"{_format_concepts(missing_required)}。"
            ),
            related_dimension="skills",
            related_concepts=missing_required,
        ))
    if experience_years is not None and experience_years_min is not None:
        if experience_years < experience_years_min:
            risks.append(MatchRiskFlag(
                code="insufficient_experience_years",
                severity="warning",
                message=(
                    f"候选人工作年限 {experience_years} 年低于岗位最低 "
                    f"{experience_years_min} 年。"
                ),
                related_dimension="experience_years",
            ))
    if education_mismatch:
        risks.append(MatchRiskFlag(
            code="education_mismatch",
            severity="warning",
            message="候选人教育经历中的学历层次低于岗位画像要求。",
            related_dimension="education",
        ))
    if missing_information:
        risks.append(MatchRiskFlag(
            code="insufficient_candidate_information",
            severity="info",
            message="候选人资料存在缺失字段，需要补充后再做最终判断。",
            related_dimension="candidate_profile",
        ))
    if not experience_hits:
        risks.append(MatchRiskFlag(
            code="missing_related_experience_evidence",
            severity="warning" if has_experience_sources else "info",
            message=(
                "工作/项目/摘要中未看到岗位相关概念证据。"
                if has_experience_sources
                else "候选人资料未提供工作、项目或摘要证据。"
            ),
            related_dimension="experience_evidence",
        ))
    return risks


def _build_risks_v11(
    *,
    missing_direct_required: list[str],
    related_required_hits: dict[str, MatchEvidence],
    explicit_negative_hits: dict[str, MatchEvidence],
    missing_information: list[MatchMissingInformation],
    experience_years: int | None,
    experience_years_min: int | None,
    education_mismatch: bool,
    has_candidate_sources: bool,
    has_experience_sources: bool,
    experience_hits: dict[str, MatchEvidence],
    transfer_signals: list[TransferableSignal],
) -> list[MatchRiskFlag]:
    risks = []
    if explicit_negative_hits:
        concepts = list(explicit_negative_hits)
        risks.append(MatchRiskFlag(
            code="missing_required_skill",
            severity="critical",
            message=(
                "候选人资料中出现明确不满足的必备项："
                f"{_format_concepts(concepts)}。"
            ),
            related_dimension="skills",
            related_concepts=concepts,
        ))
    if missing_direct_required:
        related_missing = [
            concept for concept in missing_direct_required if concept in related_required_hits
        ]
        severity = "warning" if related_missing else "critical" if has_candidate_sources else "info"
        suffix = (
            "已有相关/可迁移证据，但不能替代直接必备项。"
            if related_missing
            else "需要核实是否真实具备。"
        )
        risks.append(MatchRiskFlag(
            code="missing_required_skill",
            severity=severity,
            message=(
                "候选人资料中暂未看到必备概念的直接证据："
                f"{_format_concepts(missing_direct_required)}。{suffix}"
            ),
            related_dimension="skills",
            related_concepts=missing_direct_required,
        ))
    if experience_years is not None and experience_years_min is not None:
        if experience_years < experience_years_min:
            risks.append(MatchRiskFlag(
                code="insufficient_experience_years",
                severity="warning",
                message=(
                    f"候选人工作年限 {experience_years} 年低于岗位最低 "
                    f"{experience_years_min} 年。"
                ),
                related_dimension="experience_years",
            ))
    if education_mismatch:
        risks.append(MatchRiskFlag(
            code="education_mismatch",
            severity="warning",
            message="候选人教育经历中的学历层次低于岗位画像要求。",
            related_dimension="education",
        ))
    if missing_information:
        risks.append(MatchRiskFlag(
            code="insufficient_candidate_information",
            severity="info",
            message="候选人资料存在缺失字段，需要补充后再做最终判断。",
            related_dimension="candidate_profile",
        ))
    if not experience_hits and not transfer_signals:
        risks.append(MatchRiskFlag(
            code="missing_related_experience_evidence",
            severity="warning" if has_experience_sources else "info",
            message=(
                "工作/项目/摘要中未看到岗位相关或可迁移经历证据。"
                if has_experience_sources
                else "候选人资料未提供工作、项目或摘要证据。"
            ),
            related_dimension="experience_evidence",
        ))
    return risks


def _build_follow_up_questions(
    *,
    missing_required: list[str],
    missing_information: list[MatchMissingInformation],
    experience_years: int | None,
    experience_years_min: int | None,
    education_mismatch: bool,
    experience_hits: dict[str, MatchEvidence],
    all_concepts: list[str],
) -> list[str]:
    questions = []
    if missing_required:
        questions.append(f"请确认候选人是否具备 {_format_concepts(missing_required[:3])} 的实际经验。")
    if any(item.field == "candidate_profile.experience_years" for item in missing_information):
        questions.append("请确认候选人的实际工作年限。")
    if experience_years is not None and experience_years_min is not None:
        if experience_years < experience_years_min:
            questions.append("请确认候选人是否有高强度相关项目可以弥补年限差距。")
    if education_mismatch or any(item.field.startswith("candidate_profile.education") for item in missing_information):
        questions.append("请确认候选人的学历层次、专业方向与岗位要求是否匹配。")
    if not experience_hits and all_concepts:
        questions.append(f"请补充其工作或项目中与 {_format_concepts(all_concepts[:3])} 相关的职责和成果。")
    if not questions:
        questions.append("请进一步确认候选人的求职意向、到岗时间和薪资期望。")
    return _unique_strings(questions)[:6]


def _build_follow_up_questions_v11(
    *,
    candidate_profile: CandidateProfile,
    missing_direct_required: list[str],
    related_required_hits: dict[str, MatchEvidence],
    missing_information: list[MatchMissingInformation],
    experience_years: int | None,
    experience_years_min: int | None,
    education_mismatch: bool,
    experience_hits: dict[str, MatchEvidence],
    transfer_signals: list[TransferableSignal],
    all_concepts: list[str],
) -> list[str]:
    questions = []
    context_labels = _candidate_context_labels(candidate_profile)
    context = "、".join(context_labels[:2]) if context_labels else "现有经历"
    anchor = _candidate_experience_anchor(candidate_profile)
    if missing_direct_required:
        related_labels = [
            evidence.matched_with or concept
            for concept, evidence in related_required_hits.items()
            if concept in missing_direct_required
        ]
        if related_labels:
            questions.append(
                f"候选人在{context}中有 {_format_concepts(related_labels[:3])} 等相关线索；"
                f"请结合{anchor}确认是否直接使用过 {_format_concepts(missing_direct_required[:3])}，"
                "以及承担的模块、规模和结果。"
            )
        else:
            questions.append(
                f"请结合{anchor}确认候选人是否直接承担过 {_format_concepts(missing_direct_required[:3])} "
                f"相关工作，最好说明使用场景和产出。"
            )
    if transfer_signals:
        questions.append(
            f"请补充其{anchor}中的{_format_concepts([signal.label for signal in transfer_signals[:3]])}"
            "中的职责边界、技术栈、上线/测试覆盖或量化成果。"
        )
    if any(item.field == "candidate_profile.experience_years" for item in missing_information):
        questions.append("请确认候选人的实际工作年限、实习折算方式和最近一段经历时长。")
    if experience_years is not None and experience_years_min is not None:
        if experience_years < experience_years_min:
            questions.append("请确认候选人是否有高强度相关项目可以弥补年限差距。")
    if education_mismatch or any(item.field.startswith("candidate_profile.education") for item in missing_information):
        questions.append("请确认候选人的学历层次、专业方向与岗位要求是否匹配。")
    if not experience_hits and not transfer_signals and all_concepts:
        questions.append(f"请补充其工作或项目中与 {_format_concepts(all_concepts[:3])} 相关的职责和成果。")
    if not questions:
        questions.append("请进一步确认候选人的求职意向、到岗时间和薪资期望。")
    return _unique_strings(questions)[:6]


def _build_highlights(
    *,
    required_hits: list[str],
    preferred_hits: list[str],
    experience_years: int | None,
    experience_years_min: int | None,
    education_hits: list[str],
    experience_hits: list[str],
) -> list[str]:
    highlights = []
    if required_hits:
        highlights.append(f"必备概念已有证据：{_format_concepts(required_hits)}。")
    if preferred_hits:
        highlights.append(f"加分概念已有证据：{_format_concepts(preferred_hits)}。")
    if experience_years is not None and experience_years_min is not None:
        if experience_years >= experience_years_min:
            highlights.append(f"工作年限达到岗位最低 {experience_years_min} 年要求。")
    if education_hits:
        highlights.append(f"教育经历中出现岗位相关概念：{_format_concepts(education_hits)}。")
    if experience_hits:
        highlights.append(f"工作/项目经历中出现岗位相关概念：{_format_concepts(experience_hits)}。")
    if not highlights:
        highlights.append("当前资料可生成规则版初筛结果，但可解释亮点证据有限。")
    return highlights[:6]


def _build_highlights_v11(
    *,
    required_hits: list[str],
    preferred_hits: list[str],
    related_required_hits: dict[str, MatchEvidence],
    bonus_hits: dict[str, MatchEvidence],
    transfer_signals: list[TransferableSignal],
    experience_years: int | None,
    experience_years_min: int | None,
    education_hits: list[str],
    experience_hits: list[str],
) -> list[str]:
    highlights = []
    if required_hits:
        highlights.append(f"必备概念已有直接/别名证据：{_format_concepts(required_hits)}。")
    if preferred_hits:
        highlights.append(f"加分概念已有证据：{_format_concepts(preferred_hits)}。")
    if related_required_hits:
        related_pairs = [
            f"{evidence.matched_with}->{concept}"
            for concept, evidence in related_required_hits.items()
            if evidence.matched_with
        ]
        highlights.append(
            "存在可迁移相关证据："
            f"{_format_concepts(related_pairs or list(related_required_hits))}。"
        )
    if transfer_signals:
        highlights.append(
            "识别到工程/项目复杂度信号："
            f"{_format_concepts([signal.label for signal in transfer_signals])}。"
        )
    if bonus_hits:
        highlights.append(f"加分项已有证据：{_format_concepts(list(bonus_hits))}。")
    if experience_years is not None and experience_years_min is not None:
        if experience_years >= experience_years_min:
            highlights.append(f"工作年限达到岗位最低 {experience_years_min} 年要求。")
    if education_hits:
        highlights.append(f"教育经历中出现岗位相关概念：{_format_concepts(education_hits)}。")
    if experience_hits and not transfer_signals:
        highlights.append(f"工作/项目经历中出现岗位相关概念：{_format_concepts(experience_hits)}。")
    if not highlights:
        highlights.append("当前资料可生成规则版初筛结果，但可解释亮点证据有限。")
    return highlights[:6]


def _recommendation(
    total_score: int,
    risk_flags: list[MatchRiskFlag],
    missing_information: list[MatchMissingInformation],
) -> str:
    if any(risk.severity == "critical" for risk in risk_flags):
        return "存在必备项证据缺口，建议核实后再推进"
    if missing_information and total_score < 70:
        return "信息不足，建议补充关键资料后判断"
    if total_score >= 85:
        return "高度匹配，建议优先联系"
    if total_score >= 70:
        return "基本匹配，建议进一步确认"
    if total_score >= 55:
        return "部分匹配，建议补充关键信息后判断"
    return "匹配度较低，建议谨慎推进"


def _skill_sources(candidate_profile: CandidateProfile) -> list[TextSource]:
    return [
        TextSource(source="candidate.skills", text=skill, source_index=index)
        for index, skill in enumerate(candidate_profile.skills)
        if clean_text(skill)
    ]


def _education_sources(candidate_profile: CandidateProfile) -> list[TextSource]:
    sources = []
    for index, item in enumerate(candidate_profile.education):
        text = _join_texts(
            item.school,
            item.degree,
            item.major,
            item.period,
            item.raw_text,
        )
        if text:
            sources.append(TextSource(
                source="candidate.education",
                text=text,
                source_index=index,
            ))
    return sources


def _experience_sources(candidate_profile: CandidateProfile) -> list[TextSource]:
    sources = []
    current_title = clean_text(candidate_profile.current_title)
    if current_title:
        sources.append(TextSource(source="candidate.summary", text=current_title))
    for index, item in enumerate(candidate_profile.work_experiences):
        text = _join_texts(
            item.company,
            item.title,
            item.period,
            item.description,
            item.raw_text,
        )
        if text:
            sources.append(TextSource(
                source="candidate.work_experiences",
                text=text,
                source_index=index,
            ))
    for index, item in enumerate(candidate_profile.project_experiences):
        text = _join_texts(
            item.name,
            item.role,
            item.period,
            item.description,
            item.raw_text,
        )
        if text:
            sources.append(TextSource(
                source="candidate.project_experiences",
                text=text,
                source_index=index,
            ))
    if clean_text(candidate_profile.summary):
        sources.append(TextSource(source="candidate.summary", text=candidate_profile.summary or ""))
    return sources


def _detailed_experience_sources(candidate_profile: CandidateProfile) -> list[TextSource]:
    sources = []
    summary = clean_text(candidate_profile.summary)
    if summary and summary != clean_text(candidate_profile.current_title):
        sources.append(TextSource(source="candidate.summary", text=summary))
    for index, item in enumerate(candidate_profile.work_experiences):
        text = _experience_detail_text(
            item.description,
            item.raw_text,
            metadata=[item.company, item.title, item.period],
        )
        if text:
            sources.append(TextSource(
                source="candidate.work_experiences",
                text=text,
                source_index=index,
            ))
    for index, item in enumerate(candidate_profile.project_experiences):
        text = _experience_detail_text(
            item.description,
            item.raw_text,
            metadata=[item.name, item.role, item.period],
        )
        if text:
            sources.append(TextSource(
                source="candidate.project_experiences",
                text=text,
                source_index=index,
            ))
    return sources


def _experience_detail_text(
    description: object,
    raw_text: object,
    *,
    metadata: list[object],
) -> str:
    details = []
    if clean_text(description):
        details.append(clean_text(description))
    raw = clean_text(raw_text)
    metadata_text = _join_texts(*metadata)
    if raw and raw != metadata_text and len(raw) >= 12:
        details.append(raw)
    return _join_texts(*details)


def _match_concepts(
    sources: list[TextSource],
    target_concepts: list[str],
) -> dict[str, MatchEvidence]:
    hits: dict[str, MatchEvidence] = {}
    for concept in target_concepts:
        if concept in hits:
            continue
        for source in sources:
            if _text_matches_concept(source.text, concept):
                hits[concept] = MatchEvidence(
                    source=source.source,
                    source_index=source.source_index,
                    concept=concept,
                    text=_truncate(source.text),
                )
                break
    return hits


def _match_concepts_detailed(
    sources: list[TextSource],
    target_concepts: list[str],
    related_concepts_by_target: dict[str, list[str]] | None = None,
) -> dict[str, MatchEvidence]:
    hits: dict[str, MatchEvidence] = {}
    related_concepts_by_target = related_concepts_by_target or {}
    for concept in target_concepts:
        if concept in hits:
            continue
        for source in sources:
            evidence = _direct_or_alias_evidence(source, concept)
            if evidence:
                hits[concept] = evidence
                break
        if concept in hits:
            continue
        for related_concept in related_concepts_by_target.get(concept, []):
            for source in sources:
                evidence = _direct_or_alias_evidence(source, related_concept)
                if evidence:
                    hits[concept] = MatchEvidence(
                        source=source.source,
                        source_index=source.source_index,
                        concept=concept,
                        text=_truncate(source.text),
                        match_type="RELATED",
                        matched_with=related_concept,
                        weight=RELATED_MATCH_WEIGHT,
                        reason=f"{related_concept} 与岗位要求 {concept} 属于相近或可迁移经验。",
                    )
                    break
            if concept in hits:
                break
        if concept in hits:
            continue
        for source in sources:
            evidence = _contextual_related_evidence(source, concept)
            if evidence:
                hits[concept] = evidence
                break
    return hits


def _direct_or_alias_evidence(
    source: TextSource,
    concept: str,
) -> MatchEvidence | None:
    if _negative_alias_match(source.text, concept):
        return None
    aliases = concept_aliases_for(concept)
    for alias in aliases[1:]:
        if contains_concept_alias(source.text, alias):
            return MatchEvidence(
                source=source.source,
                source_index=source.source_index,
                concept=concept,
                text=_truncate(source.text),
                match_type="ALIAS",
                matched_with=alias,
                weight=ALIAS_MATCH_WEIGHT,
                reason=f"通过别名 {alias} 命中岗位概念 {concept}。",
            )
    if contains_concept_alias(source.text, concept):
        return MatchEvidence(
            source=source.source,
            source_index=source.source_index,
            concept=concept,
            text=_truncate(source.text),
            match_type="DIRECT",
            matched_with=concept,
            weight=DIRECT_MATCH_WEIGHT,
            reason=f"直接命中岗位概念 {concept}。",
        )
    return None


def _contextual_related_evidence(source: TextSource, concept: str) -> MatchEvidence | None:
    rules: dict[str, list[tuple[str, str]]] = {
        "JavaScript": [
            (r"全栈|前后端|前端|页面|组件|Vue", "全栈/前端经历"),
        ],
        "React": [
            (r"全栈|前后端|前端|页面|组件|Vue", "全栈/前端经历"),
        ],
        "TypeScript": [
            (r"全栈|前后端|前端|页面|组件|Vue|JavaScript|JS", "全栈/前端经历"),
        ],
        "Node.js": [
            (r"全栈|前后端|后端|Java|接口|API|联调|REST", "后端/API 经历"),
        ],
        "Python": [
            (r"测开|测试开发|自动化测试|接口测试|数据校验|脚本", "测开/自动化经历"),
        ],
        "REST API": [
            (r"接口|API|联调|对接|全栈|后端", "接口/API 经历"),
        ],
    }
    for pattern, label in rules.get(concept, []):
        if not re.search(pattern, source.text, flags=re.IGNORECASE):
            continue
        return MatchEvidence(
            source=source.source,
            source_index=source.source_index,
            concept=concept,
            text=_truncate(source.text),
            match_type="RELATED",
            matched_with=label,
            weight=CONTEXTUAL_RELATED_MATCH_WEIGHT,
            reason=f"{label} 可作为 {concept} 的弱迁移线索，需面试确认直接使用经验。",
        )
    return None


def _match_bonus_concepts(
    sources: list[TextSource],
    bonus_concepts: list[str],
) -> dict[str, MatchEvidence]:
    hits: dict[str, MatchEvidence] = {}
    for concept in bonus_concepts:
        for source in sources:
            evidence = _direct_or_alias_evidence(source, concept)
            if not evidence:
                continue
            hits[concept] = MatchEvidence(
                source=evidence.source,
                source_index=evidence.source_index,
                concept=concept,
                text=evidence.text,
                match_type="BONUS",
                matched_with=evidence.matched_with or concept,
                weight=BONUS_MATCH_WEIGHT,
                reason=f"{concept} 是工程能力加分证据，不替代岗位必备概念。",
            )
            break
    return hits


def _match_evaluation_materials(
    sources: list[TextSource],
    evaluation_materials: list[dict[str, Any]],
) -> dict[str, MatchEvidence]:
    hits: dict[str, MatchEvidence] = {}
    for material in evaluation_materials:
        label = clean_text(material.get("label"))
        if not label or label in hits:
            continue
        signals = sorted(_text_list(material.get("signals")), key=len, reverse=True)
        for source in sources:
            matched_signal = next(
                (signal for signal in signals if _material_signal_matches(source.text, signal)),
                None,
            )
            if not matched_signal:
                continue
            hits[label] = MatchEvidence(
                source=source.source,
                source_index=source.source_index,
                concept=label,
                text=_truncate(source.text),
                match_type="BONUS",
                matched_with=matched_signal,
                weight=BONUS_MATCH_WEIGHT,
                reason=f"{label} 可作为岗位相关成果质量的加分证据，不替代必备技能。",
            )
            break
    return hits


def _evaluation_material_labels(evaluation_materials: list[dict[str, Any]]) -> list[str]:
    return [
        label
        for material in evaluation_materials
        if (label := clean_text(material.get("label")))
    ]


def _has_quality_evaluation_material_hit(
    evaluation_hits: dict[str, MatchEvidence],
    evaluation_materials: list[dict[str, Any]],
) -> bool:
    quality_categories = {"research_publication", "research_engineering_artifact"}
    for material in evaluation_materials:
        label = clean_text(material.get("label"))
        category = clean_text(material.get("category"))
        if label in evaluation_hits and category in quality_categories:
            return True
    return False


def _material_signal_matches(text: str, signal: str) -> bool:
    if not text or not signal:
        return False
    if re.fullmatch(r"[A-Za-z0-9 .+/&-]+", signal):
        return re.search(
            rf"(?<![A-Za-z0-9]){re.escape(signal)}(?![A-Za-z0-9])",
            text,
            flags=re.IGNORECASE,
        ) is not None
    return signal in text


def _related_map_for_targets(
    target_concepts: list[str],
    related_concepts: list[str] | None = None,
    excluded_targets: list[str] | None = None,
) -> dict[str, list[str]]:
    allowed = set(related_concepts or [])
    excluded = set(excluded_targets or [])
    related_map: dict[str, list[str]] = {}
    for concept in target_concepts:
        candidates = [
            related
            for related in related_concepts_for(concept)
            if related not in excluded
        ]
        if allowed:
            candidates = [related for related in candidates if related in allowed]
        related_map[concept] = _unique_concepts(candidates)
    return related_map


def _related_concepts_for_targets(target_concepts: list[str]) -> list[str]:
    target_set = set(target_concepts)
    return _unique_concepts(
        related
        for concept in target_concepts
        for related in related_concepts_for(concept)
        if related not in target_set
    )


def _weighted_match_ratio(
    hits: dict[str, MatchEvidence],
    target_concepts: list[str],
) -> float:
    if not target_concepts:
        return 1
    total = 0.0
    for concept in target_concepts:
        if concept not in hits:
            continue
        total += hits[concept].weight if hits[concept].weight is not None else 1
    return min(1.0, total / len(target_concepts))


def _bonus_score_adjustment(bonus_hits: dict[str, MatchEvidence]) -> int:
    return min(8, round(2.5 * len(bonus_hits)))


def _is_direct_or_alias(evidence: MatchEvidence | None) -> bool:
    return evidence is not None and evidence.match_type in {"DIRECT", "ALIAS"}


def _is_related(evidence: MatchEvidence | None) -> bool:
    return evidence is not None and evidence.match_type == "RELATED"


def _transferable_experience_signals(sources: list[TextSource]) -> list[TransferableSignal]:
    rules: list[tuple[str, str, float, str]] = [
        (
            r"(?:腾讯|阿里|字节|百度|美团|京东|华为|小米|网易|快手|滴滴|BOSS直聘).{0,24}(?:实习|intern)|(?:实习|intern).{0,24}(?:腾讯|阿里|字节|百度|美团|京东|华为|小米|网易|快手|滴滴|BOSS直聘)",
            "大厂/知名企业实习经历",
            0.70,
            "知名企业实习经历可作为工程环境、协作强度和交付标准的加分证据。",
        ),
        (
            r"测开|测试开发|自动化测试|接口测试|性能测试|质量保障",
            "测试开发/质量工程经历",
            0.55,
            "测试开发、接口或自动化经验可迁移到工程交付和问题定位。",
        ),
        (
            r"全栈|前后端|前端.*后端|后端.*前端",
            "全栈开发经历",
            0.65,
            "全栈经历说明候选人可能具备跨端协作和端到端交付能力。",
        ),
        (
            r"Java|Spring Boot|SpringCloud|MyBatis|后端",
            "Java/后端工程经历",
            0.55,
            "Java 或后端工程经历可迁移到服务端接口、系统设计和工程协作场景。",
        ),
        (
            r"React|Vue|前端|页面|组件|TypeScript|JavaScript",
            "前端框架项目经历",
            0.45,
            "前端框架项目经历可辅助判断全栈、页面交付和跨端协作能力。",
        ),
        (
            r"实习|intern|企业|公司|项目组|团队协作",
            "企业/实习项目经历",
            0.35,
            "企业或实习项目经历可作为真实工程环境的辅助证据。",
        ),
        (
            r"接口|API|REST|网关|联调|对接",
            "接口/API 经验",
            0.50,
            "接口设计、联调或服务对接经验可迁移到后端和全栈岗位。",
        ),
        (
            r"数据库|SQL|MySQL|PostgreSQL|Redis|缓存|索引",
            "数据/存储经验",
            0.45,
            "数据和存储经验可辅助判断工程完整度。",
        ),
        (
            r"部署|上线|CI/CD|Jenkins|GitLab CI|Docker|K8s|容器",
            "部署/交付经验",
            0.45,
            "部署、容器或流水线经验说明候选人接触过工程交付链路。",
        ),
        (
            r"负责|主导|独立|落地|从0到1|闭环|优化|重构",
            "职责闭环/复杂度信号",
            0.35,
            "职责闭环、优化或重构表述可作为项目复杂度的弱证据。",
        ),
    ]
    signals = []
    seen_labels = set()
    for source in sources:
        for pattern, label, score, reason in rules:
            if label in seen_labels:
                continue
            if not re.search(pattern, source.text, flags=re.IGNORECASE):
                continue
            seen_labels.add(label)
            signals.append(TransferableSignal(
                label=label,
                score=score,
                evidence=MatchEvidence(
                    source=source.source,
                    source_index=source.source_index,
                    concept=label,
                    text=_truncate(source.text),
                    match_type="BONUS",
                    matched_with=label,
                    weight=score,
                    reason=reason,
                ),
            ))
    return signals[:8]


def _transfer_signal_ratio(signals: list[TransferableSignal]) -> float:
    return min(1.0, sum(signal.score for signal in signals[:5]) / 2.8)


def _candidate_context_labels(candidate_profile: CandidateProfile) -> list[str]:
    text = " ".join(source.text for source in [
        *_skill_sources(candidate_profile),
        *_experience_sources(candidate_profile),
    ])
    rules = [
        (r"测开|测试开发|自动化测试|接口测试|性能测试", "测试开发经历"),
        (r"全栈|前后端", "全栈经历"),
        (r"Java|Spring|后端", "Java/后端经历"),
        (r"React|Vue|前端|页面", "前端项目经历"),
        (r"腾讯|阿里|字节|百度|美团|京东|华为|小米|网易|快手|滴滴|BOSS直聘", "大厂/知名企业经历"),
        (r"实习|intern", "实习经历"),
    ]
    return _unique_strings([
        label
        for pattern, label in rules
        if re.search(pattern, text, flags=re.IGNORECASE)
    ])


def _candidate_experience_anchor(candidate_profile: CandidateProfile) -> str:
    for item in candidate_profile.work_experiences:
        label = _anchor_label(item.company, item.title)
        if label:
            return label
    for item in candidate_profile.project_experiences:
        label = _anchor_label(item.name, item.role)
        if label:
            return label
    if clean_text(candidate_profile.current_title):
        return clean_text(candidate_profile.current_title)
    return "最相关经历"


def _anchor_label(*values: object) -> str:
    parts = [clean_text(value) for value in values if clean_text(value)]
    if not parts:
        return ""
    if all(re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9（）()]+", part) for part in parts):
        return "".join(parts)
    return " ".join(parts)


def _explicit_negative_concepts(
    sources: list[TextSource],
    target_concepts: list[str],
) -> dict[str, MatchEvidence]:
    hits: dict[str, MatchEvidence] = {}
    for concept in target_concepts:
        for source in sources:
            alias = _negative_alias_match(source.text, concept)
            if not alias:
                continue
            hits[concept] = MatchEvidence(
                source=source.source,
                source_index=source.source_index,
                concept=concept,
                text=_truncate(source.text),
                match_type="NONE",
                matched_with=alias,
                weight=0,
                reason=f"候选人资料明确表示不具备或不熟悉 {concept}。",
            )
            break
    return hits


def _negative_alias_match(text: str, concept: str) -> str | None:
    if not text:
        return None
    for alias in concept_aliases_for(concept):
        escaped_alias = re.escape(alias)
        patterns = [
            rf"(?:不会|不熟悉|无|没有|缺少|未接触).{{0,12}}{escaped_alias}",
            rf"{escaped_alias}.{{0,12}}(?:不会|不熟悉|无经验|经验不足|未接触)",
        ]
        if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns):
            return alias
    return None


def _text_matches_concept(text: str, concept: str) -> bool:
    if not text or not concept:
        return False
    if concept in extract_concepts_from_text(text):
        return True
    return any(
        contains_concept_alias(text, alias)
        for alias in concept_aliases_for(concept)
    )


def _candidate_education_rank(sources: list[TextSource]) -> int | None:
    return _education_rank([source.text for source in sources])


def _education_rank(values: list[str]) -> int | None:
    rank = 0
    text = " ".join(values)
    for keyword, value in DEGREE_RANKS.items():
        if keyword in text:
            rank = max(rank, value)
    return rank or None


def _ordered_evidence(
    hits: dict[str, MatchEvidence],
    target_concepts: list[str],
) -> list[MatchEvidence]:
    return [hits[concept] for concept in target_concepts if concept in hits]


def _unique_evidence(evidence_items: Sequence[MatchEvidence]) -> list[MatchEvidence]:
    seen = set()
    unique = []
    for item in evidence_items:
        key = (item.source, item.source_index, item.concept, item.text)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:40]


def _unique_missing_information(
    items: list[MatchMissingInformation],
) -> list[MatchMissingInformation]:
    seen = set()
    unique = []
    for item in items:
        if item.field in seen:
            continue
        seen.add(item.field)
        unique.append(item)
    return unique


def _text_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return _unique_concepts(clean_text(item) for item in value)


def _evaluation_materials(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    materials = []
    for item in value:
        if not isinstance(item, dict):
            continue
        signals = _text_list(item.get("signals"))
        label = clean_text(item.get("label"))
        if label and signals:
            materials.append({
                "category": clean_text(item.get("category")),
                "label": label,
                "material_id": clean_text(item.get("material_id")),
                "signals": signals,
            })
    return materials[:8]


def _unique_concepts(values: Sequence[str]) -> list[str]:
    return _unique_strings(clean_text(value) for value in values if clean_text(value))


def _unique_strings(values: Sequence[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _format_concepts(values: list[str]) -> str:
    return "、".join(values[:6])


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    return None


def _join_texts(*values: object) -> str:
    return " ".join(clean_text(value) for value in values if clean_text(value))


def _truncate(value: str, max_length: int = 300) -> str:
    text = clean_text(value)
    if len(text) <= max_length:
        return text
    return f"{text[:max_length - 3]}..."


def _format_concepts(concepts: list[str], limit: int = 5) -> str:
    shown = concepts[:limit]
    suffix = "等" if len(concepts) > limit else ""
    return "、".join(shown) + suffix
