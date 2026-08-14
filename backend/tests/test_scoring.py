import json
from pathlib import Path

import pytest

from backend.app.knowledge_base import build_knowledge_base
from backend.app.models import CandidateProfile
from backend.app.scoring import (
    build_rule_match_assessment,
    calculate_total_score,
    validate_weights,
)


SCORING_CASES_PATH = (
    Path(__file__).parent / "fixtures" / "scoring_cases" / "rule_v11_cases.json"
)


def test_calculate_total_score() -> None:
    assert calculate_total_score([(95, 30), (90, 30), (95, 20), (88, 20)]) == 92


@pytest.mark.parametrize("weights", [[30, 30], [100, 1], [-1, 101], []])
def test_rejects_invalid_weights(weights: list[int]) -> None:
    with pytest.raises(ValueError):
        validate_weights(weights)


@pytest.mark.parametrize("score", [-1, 101])
def test_rejects_out_of_range_score(score: int) -> None:
    with pytest.raises(ValueError):
        calculate_total_score([(score, 100)])


def _scoring_cases() -> dict[str, dict[str, object]]:
    payload = json.loads(SCORING_CASES_PATH.read_text())
    return {case["id"]: case for case in payload["cases"]}


def _assessment(case_id: str, *, version: str = "rule_v1.1", request_id: str = "case-1"):
    case = _scoring_cases()[case_id]
    kb = build_knowledge_base(
        [case["job"]],
        source_name="scoring_cases.json",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    return build_rule_match_assessment(
        request_id=request_id,
        job_detail=kb["jobs"][0],
        candidate_profile=CandidateProfile(**case["candidate_profile"]),
        version=version,
    )


def _dimension(response, key: str):
    return next(dimension for dimension in response.dimensions if dimension.key == key)


def test_rule_v11_scores_direct_alias_and_bonus_evidence() -> None:
    response = _assessment("direct_alias_bonus")

    assert response.mode == "rule_v1.1"
    assert response.total_score >= 85
    skills = _dimension(response, "skills")
    assert set(skills.matched_concepts) >= {"JavaScript", "Node.js", "React"}
    assert {evidence.match_type for evidence in response.evidence} >= {
        "DIRECT",
        "ALIAS",
        "BONUS",
    }
    assert any(
        evidence.concept == "React" and evidence.matched_with in {"React.js", "ReactJS"}
        for evidence in response.evidence
    )


def test_rule_v11_related_matches_are_capped_and_keep_required_gap() -> None:
    response = _assessment("related_cap")

    skills = _dimension(response, "skills")
    assert skills.score <= 68
    assert set(skills.missing_concepts) == {"Node.js", "React"}
    assert any(
        evidence.match_type == "RELATED"
        and evidence.concept == "Node.js"
        and evidence.matched_with in {"Java", "Spring Boot"}
        for evidence in response.evidence
    )
    missing_required = [
        flag for flag in response.risk_flags if flag.code == "missing_required_skill"
    ]
    assert missing_required
    assert missing_required[0].severity == "warning"
    assert "不能替代" in missing_required[0].message


def test_rule_v11_lifts_transferable_engineering_experience_without_full_credit() -> None:
    v1 = _assessment("transfer_rich_candidate", version="rule_v1", request_id="compare-1")
    v11 = _assessment("transfer_rich_candidate", request_id="compare-1")

    assert v1.mode == "rule_v1"
    assert v11.mode == "rule_v1.1"
    assert v11.total_score >= v1.total_score + 10
    assert 65 <= v11.total_score <= 88
    assert v11.fit_score >= v11.total_score
    assert v11.eligibility.status == "review"
    assert v11.eligibility.score_cap == 74
    assert 65 <= _dimension(v11, "experience_evidence").score <= 88
    assert any(evidence.concept == "全栈开发经历" for evidence in v11.evidence)
    assert any(evidence.concept == "测试开发/质量工程经历" for evidence in v11.evidence)
    assert any(evidence.concept == "大厂/知名企业实习经历" for evidence in v11.evidence)
    assert any("测试开发" in question or "全栈" in question for question in v11.follow_up_questions)
    assert any("腾讯测试开发实习生" in question for question in v11.follow_up_questions)


def test_rule_v11_recalls_contextual_engineering_signals_from_sparse_resume() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "全栈开发工程师",
                "岗位jd": "本科及以上学历，1年以上经验，熟悉 JavaScript、Node.js、Python、React。",
                "岗位关键词（必备技能）": "JavaScript、Node.js、Python、React",
                "需求数量": 1,
            }
        ],
        source_name="scoring_cases.json",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    response = build_rule_match_assessment(
        request_id="sparse-transfer-1",
        job_detail=kb["jobs"][0],
        candidate_profile=CandidateProfile(
            current_title="测开 / 全栈 / Java 实习生",
            experience_years=1,
            education=[{"degree": "本科", "major": "软件工程"}],
            summary="有大厂实习经历，项目覆盖接口、数据库、前端页面和上线交付。",
        ),
    )

    skills = _dimension(response, "skills")
    experience = _dimension(response, "experience_evidence")
    assert response.total_score >= 60
    assert response.eligibility.status == "review"
    assert set(skills.matched_concepts) >= {"JavaScript", "Node.js", "Python", "React"}
    assert set(skills.missing_concepts) >= {"JavaScript", "Node.js", "Python", "React"}
    assert experience.score >= 50
    assert any(
        evidence.match_type == "RELATED"
        and evidence.matched_with in {"全栈/前端经历", "后端/API 经历", "测开/自动化经历"}
        for evidence in response.evidence
    )
    assert any("全栈" in question or "测开" in question for question in response.follow_up_questions)


def test_rule_v11_title_only_work_project_requires_detail_evidence() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "全栈开发工程师",
                "岗位jd": "本科及以上学历，1年以上经验，熟悉 JavaScript、Node.js、Python、React。",
                "岗位关键词（必备技能）": "JavaScript、Node.js、Python、React",
                "需求数量": 1,
            }
        ],
        source_name="scoring_cases.json",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    response = build_rule_match_assessment(
        request_id="title-only-1",
        job_detail=kb["jobs"][0],
        candidate_profile=CandidateProfile(
            current_title="测开 / 全栈 / Java 实习生",
            experience_years=1,
            education=[{"degree": "本科", "major": "软件工程"}],
            skills=["JavaScript", "Node.js", "Python", "React"],
            work_experiences=[{"company": "腾讯", "title": "测试开发实习生"}],
            project_experiences=[{"name": "校园协作系统", "role": "核心开发"}],
        ),
    )

    experience = _dimension(response, "experience_evidence")
    assert experience.score <= 60
    assert "仅提供标题类线索" in experience.reason
    assert any(
        item.field == "candidate_profile.work_experiences/project_experiences/summary"
        and "缺少可核实的经历正文" in item.reason
        for item in response.missing_information
    )
    assert any(
        "技能证据" in question and "可验证经历正文" in question
        for question in response.follow_up_questions
    )
    assert not any(
        "已有 JavaScript" in question and "但 JavaScript" in question
        for question in response.follow_up_questions
    )


def test_rule_v11_uses_authoritative_bio_publications_as_bonus_evidence() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 生物信息学科学家",
                "岗位jd": "本科及以上学历，熟悉生命科学、生物信息学、药物研发和 Python。",
                "岗位关键词（必备技能）": "生命科学、生物信息学,Python",
                "需求数量": 1,
            }
        ],
        source_name="scoring_cases.json",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    response = build_rule_match_assessment(
        request_id="bio-authority-1",
        job_detail=kb["jobs"][0],
        candidate_profile=CandidateProfile(
            experience_years=2,
            education=[{"degree": "硕士", "major": "生物信息学"}],
            skills=["Python", "Bioinformatics"],
            project_experiences=[
                {
                    "name": "药物靶点分析",
                    "description": "参与 Nature Biotechnology 论文相关分析，负责生物信息学数据处理。",
                }
            ],
        ),
    )

    experience = _dimension(response, "experience_evidence")
    assert response.scoring_standard.job_family == "research"
    assert {item.key: item.weight for item in response.scoring_standard.dimensions} == {
        "skills": 25,
        "experience_years": 10,
        "education": 25,
        "experience_evidence": 40,
    }
    assert experience.score >= 70
    assert any(
        evidence.concept == "生命科学权威论文/期刊成果"
        and evidence.match_type == "BONUS"
        and evidence.matched_with == "Nature Biotechnology"
        for evidence in response.evidence
    )


def test_rule_v11_distinguishes_missing_evidence_from_explicit_not_satisfied() -> None:
    missing = _assessment("insufficient_candidate")
    explicit = _assessment("explicit_not_satisfied")

    assert any("暂未看到" in flag.message for flag in missing.risk_flags)
    assert any("明确不满足" in flag.message for flag in explicit.risk_flags)
    assert any(evidence.match_type == "NONE" for evidence in explicit.evidence)
    assert missing.eligibility.status == "review"
    assert explicit.eligibility.status == "fail"
    assert any(item.status == "not_met" for item in explicit.eligibility.requirements)
    assert explicit.total_score <= explicit.eligibility.score_cap


def test_rule_v11_builds_dynamic_engineering_standard_and_concept_graph() -> None:
    response = _assessment("direct_alias_bonus")

    assert response.scoring_standard.job_family == "engineering"
    assert response.scoring_standard.source == "rule_generated"
    assert {dimension.key: dimension.weight for dimension in response.dimensions} == {
        "skills": 40,
        "experience_years": 15,
        "education": 10,
        "experience_evidence": 35,
    }
    graph = {layer.role: layer for layer in response.concept_graph}
    assert set(graph) == {"required", "preferred", "related", "bonus"}
    assert graph["related"].compensation_cap == 65
    assert set(graph["required"].concepts) >= {"JavaScript", "Node.js", "React"}


def test_rule_v11_output_is_stable_and_traceable() -> None:
    first = _assessment("transfer_rich_candidate", request_id="stable-1")
    second = _assessment("transfer_rich_candidate", request_id="stable-1")

    assert first.model_dump() == second.model_dump()
    traced = [
        evidence
        for evidence in first.evidence
        if evidence.match_type in {"DIRECT", "ALIAS", "RELATED", "BONUS", "NONE"}
    ]
    assert traced
    assert all(evidence.weight is not None and evidence.reason for evidence in traced)


def test_rule_v11_explanation_enhances_copy_without_changing_score_facts() -> None:
    response = _assessment("transfer_rich_candidate", request_id="explain-1")

    assert response.explanation_source == "rule"
    assert response.llm_enhancement == "disabled"
    assert response.assessment_summary
    assert "基础条件" in response.assessment_summary
    assert "综合匹配" in response.assessment_summary
    assert "潜力" in response.assessment_summary
    assert response.hybrid_score == response.total_score
    assert response.hybrid_delta == 0
    assert {dimension.key for dimension in response.dimensions} == {
        "skills",
        "experience_years",
        "education",
        "experience_evidence",
    }
    assert any("职责" in question or "贡献" in question for question in response.follow_up_questions)


def test_rule_v1_mode_is_preserved_for_comparison() -> None:
    response = _assessment("direct_alias_bonus", version="rule_v1")

    assert response.mode == "rule_v1"
    assert {dimension.key for dimension in response.dimensions} == {
        "skills",
        "experience_years",
        "education",
        "experience_evidence",
    }
    assert all(evidence.match_type is None for evidence in response.evidence)
