import os

import httpx

from backend.app import explanation
from backend.app.explanation import clear_explanation_cache, enhance_match_explanation
from backend.app.knowledge_base import build_knowledge_base
from backend.app.models import (
    CandidateProfile,
    EducationExperience,
    ProjectExperience,
    WorkExperience,
)
from backend.app.scoring import build_rule_match_assessment


def _base_assessment():
    job = {
        "_source_row": 2,
        "岗位名称": "全栈开发工程师",
        "岗位jd": "本科及以上学历，熟悉 JavaScript、Node.js、React。",
        "岗位关键词（必备技能）": "JavaScript、Node.js、React",
        "需求数量": 1,
    }
    candidate = CandidateProfile(
        experience_years=1,
        education=[EducationExperience(degree="本科", major="软件工程")],
        skills=["Java", "Vue", "接口测试"],
        work_experiences=[
            WorkExperience(
                company="匿名科技",
                title="全栈开发实习生",
                description="负责 Java 后端接口、Vue 页面和 MySQL 数据库设计。",
            )
        ],
    )
    kb = build_knowledge_base(
        [job],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    return (
        build_rule_match_assessment(
            request_id="explain-guard-1",
            job_detail=kb["jobs"][0],
            candidate_profile=candidate,
            version="rule_v1",
        ),
        candidate,
        kb["jobs"][0],
    )


def _passing_assessment():
    job = {
        "_source_row": 2,
        "岗位名称": "全栈开发工程师",
        "岗位jd": "本科及以上学历，熟悉 JavaScript、Node.js、React。",
        "岗位关键词（必备技能）": "JavaScript、Node.js、React",
        "需求数量": 1,
    }
    candidate = CandidateProfile(
        experience_years=3,
        education=[EducationExperience(degree="本科", major="软件工程")],
        skills=["JavaScript", "Node.js", "React"],
        work_experiences=[
            WorkExperience(
                company="匿名科技",
                title="全栈开发工程师",
                description="负责 React 前端、Node.js 服务和 JavaScript 工程化交付。",
            )
        ],
    )
    kb = build_knowledge_base(
        [job],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    return (
        build_rule_match_assessment(
            request_id="explain-hybrid-1",
            job_detail=kb["jobs"][0],
            candidate_profile=candidate,
        ),
        candidate,
        kb["jobs"][0],
    )


def test_rule_explanation_does_not_change_scoring_facts(monkeypatch) -> None:
    monkeypatch.delenv("ARC_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _base_assessment()
    score_facts = {
        "total_score": assessment.total_score,
        "dimensions": [dimension.model_dump() for dimension in assessment.dimensions],
        "risk_flags": [flag.model_dump() for flag in assessment.risk_flags],
        "evidence": [evidence.model_dump() for evidence in assessment.evidence],
    }

    enhanced = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    assert enhanced.explanation_source == "rule"
    assert enhanced.llm_enhancement == "disabled"
    assert enhanced.assessment_summary
    assert enhanced.total_score == score_facts["total_score"]
    assert [dimension.model_dump() for dimension in enhanced.dimensions] == score_facts["dimensions"]
    assert [flag.model_dump() for flag in enhanced.risk_flags] == score_facts["risk_flags"]
    assert [evidence.model_dump() for evidence in enhanced.evidence] == score_facts["evidence"]


def test_llm_provider_failure_keeps_rule_explanation_and_score_facts(monkeypatch) -> None:
    monkeypatch.setenv("ARC_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _base_assessment()
    score_facts = assessment.model_dump(
        include={
            "total_score",
            "fit_score",
            "dimensions",
            "risk_flags",
            "evidence",
            "eligibility",
            "scoring_standard",
            "concept_graph",
        }
    )

    class FailingClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, *args, **kwargs):
            raise RuntimeError("network should not change score")

    monkeypatch.setattr("backend.app.explanation.httpx.Client", FailingClient)

    enhanced = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    assert enhanced.llm_enhancement == "failed"
    assert enhanced.model_dump(include=set(score_facts)) == score_facts


def test_llm_provider_can_only_rewrite_explanation_fields(monkeypatch) -> None:
    monkeypatch.setenv("ARC_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _base_assessment()
    score_facts = assessment.model_dump(
        include={
            "total_score",
            "fit_score",
            "dimensions",
            "risk_flags",
            "evidence",
            "eligibility",
            "scoring_standard",
            "concept_graph",
        }
    )

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "output_text": (
                    '{"assessment_summary":"LLM 只整理解释，不改变评分。",'
                    '"recommendation":"建议带着关键问题面谈",'
                    '"highlights":["候选人有可迁移工程线索"],'
                    '"follow_up_questions":["请说明 Node.js 与 React 的直接项目证据。"],'
                    '"personalized_follow_up_questions":[{"question":"请你结合 Java/Vue 项目说明 Node.js 与 React 的直接使用证据？",'
                    '"purpose":"核实可迁移经历是否覆盖岗位必备技术。",'
                    '"evidence_anchor":"Java/Vue 项目",'
                    '"copy_text":"请你结合 Java/Vue 项目说明 Node.js 与 React 的直接使用证据？"}],'
                    '"semantic_review":{"summary":"Java/Vue 具备迁移性但需核实直接贡献。",'
                    '"findings":[{"topic":"transferability","verdict":"uncertain",'
                    '"summary":"候选人有相关工程经历，但 Node.js 与 React 仍缺直接证据。",'
                    '"related_concepts":["Node.js","React"]}]}}'
                )
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, *args, **kwargs):
            assert kwargs["json"]["store"] is False
            assert kwargs["json"]["text"]["format"]["strict"] is True
            assert "semantic_review" in kwargs["json"]["text"]["format"]["schema"]["required"]
            assert "personalized_follow_up_questions" in kwargs["json"]["text"]["format"]["schema"]["required"]
            return FakeResponse()

    monkeypatch.setattr("backend.app.explanation.httpx.Client", FakeClient)

    enhanced = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    assert enhanced.explanation_source == "llm"
    assert enhanced.llm_enhancement == "applied"
    assert enhanced.assessment_summary == "LLM 只整理解释，不改变评分。"
    assert enhanced.follow_up_questions == ["请说明 Node.js 与 React 的直接项目证据。"]
    assert enhanced.personalized_follow_up_questions[0].copy_text == (
        "请你结合 Java/Vue 项目说明 Node.js 与 React 的直接使用证据？"
    )
    assert enhanced.semantic_review.source == "llm"
    assert enhanced.semantic_review.status == "applied"
    assert enhanced.semantic_review.findings[0].topic == "transferability"
    assert enhanced.model_dump(include=set(score_facts)) == score_facts


def test_deepseek_provider_uses_json_mode_and_preserves_score_facts(monkeypatch) -> None:
    monkeypatch.setenv("ARC_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-key")
    monkeypatch.delenv("ARC_LLM_MODEL", raising=False)
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _base_assessment()
    score_facts = assessment.model_dump(
        include={
            "total_score",
            "fit_score",
            "dimensions",
            "risk_flags",
            "evidence",
            "eligibility",
            "scoring_standard",
            "concept_graph",
        }
    )

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"assessment_summary":"DeepSeek 只整理解释，不改变评分。",'
                                '"recommendation":"建议核实后推进",'
                                '"highlights":["存在可迁移线索"],'
                                '"follow_up_questions":["请确认 React 和 Node.js 的直接项目证据。"],'
                                '"personalized_follow_up_questions":[{"question":"请你结合 Java/Vue 经历说明 React 和 Node.js 的直接项目证据？",'
                                '"purpose":"确认必备技能缺口严重性。",'
                                '"evidence_anchor":"Java/Vue 经历",'
                                '"copy_text":"请你结合 Java/Vue 经历说明 React 和 Node.js 的直接项目证据？"}],'
                                '"semantic_review":{"summary":"缺口严重性需要人工确认。",'
                                '"findings":[{"topic":"missing_skill_severity","verdict":"risk",'
                                '"summary":"React 和 Node.js 未见直接证据，不能由 Vue/Java 完全替代。",'
                                '"related_concepts":["React","Node.js"]}]}}'
                            )
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, *args, **kwargs):
            assert url == "https://api.deepseek.com/chat/completions"
            assert kwargs["headers"]["Authorization"] == "Bearer deepseek-test-key"
            assert kwargs["json"]["model"] == "deepseek-v4-flash"
            assert kwargs["json"]["response_format"] == {"type": "json_object"}
            assert "JSON" in kwargs["json"]["messages"][0]["content"]
            return FakeResponse()

    monkeypatch.setattr("backend.app.explanation.httpx.Client", FakeClient)

    enhanced = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    assert enhanced.explanation_source == "llm"
    assert enhanced.llm_enhancement == "applied"
    assert enhanced.assessment_summary == "DeepSeek 只整理解释，不改变评分。"
    assert enhanced.personalized_follow_up_questions[0].question == (
        "请你结合 Java/Vue 经历说明 React 和 Node.js 的直接项目证据？"
    )
    assert enhanced.semantic_review.source == "llm"
    assert enhanced.semantic_review.findings[0].topic == "missing_skill_severity"
    assert enhanced.total_score == assessment.total_score
    assert enhanced.hybrid_delta == -3
    assert enhanced.hybrid_score == assessment.total_score - 3
    assert "规则事实未被改写" in enhanced.hybrid_summary
    assert enhanced.model_dump(include=set(score_facts)) == score_facts


def test_llm_semantic_review_calibrates_hybrid_score_with_bounds(monkeypatch) -> None:
    monkeypatch.setenv("ARC_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _passing_assessment()

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "output_text": (
                    '{"assessment_summary":"LLM 识别到候选人项目复杂度较高。",'
                    '"recommendation":"建议优先沟通",'
                    '"highlights":["候选人有完整全栈交付经验"],'
                    '"follow_up_questions":["请确认项目中的个人贡献边界。"],'
                    '"personalized_follow_up_questions":[{"question":"请你结合全栈项目说明个人负责的模块、上线范围和结果指标？",'
                    '"purpose":"确认项目复杂度和个人贡献边界。",'
                    '"evidence_anchor":"全栈项目",'
                    '"copy_text":"请你结合全栈项目说明个人负责的模块、上线范围和结果指标？"}],'
                    '"semantic_review":{"summary":"项目复杂度和贡献较强。",'
                    '"findings":['
                    '{"topic":"project_complexity","verdict":"strong",'
                    '"summary":"项目覆盖前端、服务端和工程化链路。","related_concepts":["React","Node.js"]},'
                    '{"topic":"candidate_contribution","verdict":"positive",'
                    '"summary":"描述中体现直接负责交付。","related_concepts":["全栈开发"]}'
                    ']}}'
                )
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("backend.app.explanation.httpx.Client", FakeClient)

    enhanced = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    assert enhanced.total_score == assessment.total_score
    assert enhanced.fit_score == assessment.fit_score
    assert enhanced.hybrid_delta == min(5, 100 - assessment.total_score)
    assert enhanced.hybrid_score == assessment.total_score + enhanced.hybrid_delta
    assert "硬性条件上限仍生效" in enhanced.hybrid_summary


def test_llm_explanation_cache_reuses_payload_without_score_changes(monkeypatch) -> None:
    clear_explanation_cache()
    monkeypatch.setenv("ARC_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-key")
    monkeypatch.delenv("ARC_LLM_MODEL", raising=False)
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _base_assessment()
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"assessment_summary":"缓存中的 DeepSeek 解释。",'
                                '"recommendation":"建议核实后推进",'
                                '"highlights":["存在可迁移线索"],'
                                '"follow_up_questions":["请确认项目里的个人贡献。"],'
                                '"personalized_follow_up_questions":[{"question":"请你结合当前项目说明个人贡献边界？",'
                                '"purpose":"确认候选人的直接贡献。",'
                                '"evidence_anchor":"当前项目",'
                                '"copy_text":"请你结合当前项目说明个人贡献边界？"}],'
                                '"semantic_review":{"summary":"缓存语义审阅。","findings":[]}}'
                            )
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, *args, **kwargs):
            calls.append(kwargs["json"])
            return FakeResponse()

    monkeypatch.setattr("backend.app.explanation.httpx.Client", FakeClient)

    first = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )
    second = enhance_match_explanation(
        assessment.model_copy(update={"request_id": "explain-cache-2"}),
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    try:
        assert len(calls) == 1
        assert first.assessment_summary == "缓存中的 DeepSeek 解释。"
        assert first.llm_enhancement == "applied"
        assert second.assessment_summary == "缓存中的 DeepSeek 解释。"
        assert second.llm_enhancement == "cached"
        assert second.request_id == "explain-cache-2"
        assert second.total_score == assessment.total_score
    finally:
        clear_explanation_cache()


def test_llm_context_is_bounded_for_fast_follow_up() -> None:
    assessment, candidate, job_detail = _passing_assessment()
    candidate = candidate.model_copy(update={
        "skills": [f"skill-{index}" for index in range(40)],
        "summary": "项目摘要" * 120,
        "work_experiences": [
            WorkExperience(
                company=f"公司{index}",
                title="全栈开发工程师",
                description="负责 React、Node.js、接口联调和上线交付。" * 12,
            )
            for index in range(9)
        ],
        "project_experiences": [
            ProjectExperience(
                name=f"项目{index}",
                role="核心开发",
                description="负责权限、接口、前端页面和自动化测试。" * 12,
            )
            for index in range(9)
        ],
    })
    job_detail = {
        **job_detail,
        "profile": {
            "required_concepts": [f"required-{index}" for index in range(24)],
            "preferred_concepts": [f"preferred-{index}" for index in range(24)],
            "related_concepts": [f"related-{index}" for index in range(24)],
            "bonus_concepts": [f"bonus-{index}" for index in range(24)],
            "education_keywords": ["本科", "硕士", "博士", "大专", "专科", "研究生", "MBA"],
            "experience_years_min": 2,
            "concept_categories": [f"category-{index}" for index in range(16)],
            "evaluation_materials": [{"label": "should-not-send", "signals": ["x"]}],
        },
    }

    context = explanation._llm_context(assessment, candidate, job_detail)

    assert len(context["evidence"]) <= explanation.MAX_LLM_EVIDENCE_ITEMS
    assert len(context["candidate"]["skills"]) == explanation.MAX_LLM_SKILLS
    assert len(context["candidate"]["work_experiences"]) == explanation.MAX_LLM_EXPERIENCE_ITEMS
    assert len(context["candidate"]["project_experiences"]) == explanation.MAX_LLM_EXPERIENCE_ITEMS
    assert len(context["candidate"]["summary"]) == explanation.MAX_LLM_SUMMARY_CHARS
    assert all(
        len(item["description"]) == explanation.MAX_LLM_EXPERIENCE_CHARS
        for item in context["candidate"]["work_experiences"]
    )
    assert len(context["job"]["profile"]["required_concepts"]) == 16
    assert "evaluation_materials" not in context["job"]["profile"]


def test_llm_timeout_is_reported_without_blocking_rule_explanation(monkeypatch) -> None:
    monkeypatch.setenv("ARC_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-key")
    monkeypatch.setenv("ARC_LLM_TIMEOUT_SECONDS", "1.5")
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _base_assessment()

    class TimeoutClient:
        def __init__(self, *args, **kwargs):
            assert kwargs["timeout"] == 1.5

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, *args, **kwargs):
            raise httpx.TimeoutException("slow provider")

    monkeypatch.setattr("backend.app.explanation.httpx.Client", TimeoutClient)

    enhanced = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    assert enhanced.explanation_source == "rule"
    assert enhanced.llm_enhancement == "timeout"
    assert enhanced.total_score == assessment.total_score
    assert enhanced.assessment_summary


def test_rule_followups_prioritize_candidate_specific_transfer_signals(monkeypatch) -> None:
    monkeypatch.delenv("ARC_LLM_PROVIDER", raising=False)
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    assessment, candidate, job_detail = _base_assessment()

    enhanced = enhance_match_explanation(
        assessment,
        candidate_profile=candidate,
        job_detail=job_detail,
    )

    assert enhanced.follow_up_questions
    assert any("Vue" in question or "Java" in question for question in enhanced.follow_up_questions)
    assert any("职责" in question or "规模" in question for question in enhanced.follow_up_questions)
    assert len(enhanced.follow_up_questions) <= 6
    assert enhanced.personalized_follow_up_questions
    assert enhanced.personalized_follow_up_questions[0].copy_text.endswith("？")
    assert enhanced.personalized_follow_up_questions[0].evidence_anchor


def test_no_llm_provider_is_enabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv("ARC_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})

    assert os.environ.get("ARC_LLM_PROVIDER") is None


def test_env_value_reads_dotenv_when_process_env_is_absent(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("ARC_LLM_PROVIDER", raising=False)
    monkeypatch.setattr(explanation, "PROJECT_ROOT", tmp_path)
    explanation._dotenv_values.cache_clear()
    (tmp_path / ".env").write_text(
        'export ARC_LLM_PROVIDER=deepseek\nARC_LLM_MODEL="deepseek-v4-flash"\n',
        encoding="utf-8",
    )

    try:
        assert explanation._env_value("ARC_LLM_PROVIDER") == "deepseek"
        assert explanation._env_value("ARC_LLM_MODEL") == "deepseek-v4-flash"

        monkeypatch.setenv("ARC_LLM_PROVIDER", "openai")
        assert explanation._env_value("ARC_LLM_PROVIDER") == "openai"
    finally:
        explanation._dotenv_values.cache_clear()
