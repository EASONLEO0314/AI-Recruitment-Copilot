from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.knowledge_base import build_knowledge_base
from backend.app.main import app


client = TestClient(app)


def _install_kb(monkeypatch, rows: list[dict[str, object]]) -> None:
    kb = build_knowledge_base(
        rows,
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    monkeypatch.setattr(main, "load_default_knowledge_base", lambda: kb)


def test_match_assessment_accepts_minimal_candidate_profile(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "本科及以上学历，3年以上经验，熟悉 Java、Spring Boot、Redis。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        headers={"X-Request-ID": "match-minimal-1"},
        json={"job_id": "job-001", "candidate_profile": {}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "match-minimal-1"
    assert body["mode"] == "rule_v1.1"
    assert body["job_id"] == "job-001"
    assert {item["field"] for item in body["missing_information"]} >= {
        "candidate_profile.skills",
        "candidate_profile.experience_years",
        "candidate_profile.education",
        "candidate_profile.work_experiences/project_experiences/summary",
    }
    assert any(
        flag["code"] == "insufficient_candidate_information"
        for flag in body["risk_flags"]
    )


def test_match_assessment_returns_explainable_rule_score(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "AI 工程师",
                "岗位jd": (
                    "本科及以上学历，3年以上经验，熟悉 Python、RAG、大语言模型。"
                    "加分项 熟悉 React.js。"
                ),
                "岗位关键词（必备技能）": "Python、RAG、大语言模型",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        headers={"X-Request-ID": "match-good-1"},
        json={
            "job_id": "job-001",
            "candidate_profile": {
                "experience_years": 4,
                "education": [
                    {
                        "school": "某大学",
                        "degree": "本科",
                        "major": "计算机科学",
                    }
                ],
                "skills": ["python", "检索增强生成", "Large Language Model", "ReactJS"],
                "work_experiences": [
                    {
                        "company": "某科技公司",
                        "title": "AI 工程师",
                        "description": "负责 Python RAG 服务建设。",
                    }
                ],
                "project_experiences": [
                    {
                        "name": "知识库问答",
                        "description": "建设面向业务的大模型检索增强生成应用。",
                    }
                ],
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total_score"] >= 85
    assert body["recommendation"] == "高度匹配，建议优先联系"
    assert {dimension["key"] for dimension in body["dimensions"]} == {
        "skills",
        "experience_years",
        "education",
        "experience_evidence",
    }
    skill_dimension = next(
        dimension for dimension in body["dimensions"] if dimension["key"] == "skills"
    )
    assert set(skill_dimension["matched_concepts"]) >= {"Python", "RAG", "大模型", "React"}
    assert any(item["concept"] == "大模型" for item in body["evidence"])
    assert not any(flag["code"] == "missing_required_skill" for flag in body["risk_flags"])
    assert body["fit_score"] >= body["total_score"]
    assert body["eligibility"]["status"] == "pass"
    assert body["scoring_standard"]["job_family"] == "engineering"
    assert body["concept_graph"]


def test_match_assessment_accepts_hr_scoring_weight_overrides(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "全栈开发工程师",
                "岗位jd": "本科及以上学历，熟悉 React、Node.js、Python。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        json={
            "job_id": "job-001",
            "scoring_weights": {
                "skills": 50,
                "experience_years": 10,
                "education": 10,
                "experience_evidence": 30,
            },
            "candidate_profile": {
                "skills": ["React", "Node.js", "Python"],
                "education": [{"degree": "本科"}],
                "work_experiences": [{"description": "负责 React 和 Node.js 全栈开发。"}],
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["scoring_standard"]["source"] == "hr_adjusted"
    assert {item["key"]: item["weight"] for item in body["scoring_standard"]["dimensions"]} == {
        "skills": 50,
        "experience_years": 10,
        "education": 10,
        "experience_evidence": 30,
    }


def test_match_assessment_rejects_invalid_hr_scoring_weights(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "熟悉 Java。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        json={
            "job_id": "job-001",
            "scoring_weights": {
                "skills": 80,
                "experience_years": 20,
            },
            "candidate_profile": {"skills": ["Java"]},
        },
    )

    assert response.status_code == 422


def test_match_assessment_does_not_block_on_llm_enhancement(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "AI 工程师",
                "岗位jd": "本科及以上学历，熟悉 Python、RAG。",
                "需求数量": 1,
            }
        ],
    )

    def fail_if_called(*args, **kwargs):
        raise AssertionError("match endpoint must return the rule score before LLM enhancement")

    monkeypatch.setattr(main, "enhance_match_explanation", fail_if_called)

    response = client.post(
        "/v1/assessment/match",
        json={
            "job_id": "job-001",
            "candidate_profile": {
                "skills": ["Python", "RAG"],
                "education": [{"degree": "本科"}],
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["explanation_source"] == "rule"
    assert response.json()["llm_enhancement"] == "disabled"


def test_match_explanation_endpoint_runs_llm_enhancement_after_rule_score(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "AI 工程师",
                "岗位jd": "本科及以上学历，熟悉 Python、RAG。",
                "需求数量": 1,
            }
        ],
    )

    def fake_enhance(assessment, *, candidate_profile, job_detail):
        return assessment.model_copy(update={
            "explanation_source": "llm",
            "llm_enhancement": "applied",
            "assessment_summary": "AI 已补充候选人个性化解释。",
        })

    monkeypatch.setattr(main, "enhance_match_explanation", fake_enhance)

    response = client.post(
        "/v1/assessment/match/explanation",
        headers={"X-Request-ID": "match-llm-1"},
        json={
            "job_id": "job-001",
            "candidate_profile": {
                "skills": ["Python", "RAG"],
                "education": [{"degree": "本科"}],
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "match-llm-1"
    assert body["explanation_source"] == "llm"
    assert body["llm_enhancement"] == "applied"
    assert body["assessment_summary"] == "AI 已补充候选人个性化解释。"


def test_match_assessment_aliases_torch_and_reactjs(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "深度学习工程师",
                "岗位jd": "熟悉 PyTorch、React.js 和大语言模型应用开发。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        json={
            "job_id": "job-001",
            "candidate_profile": {
                "skills": ["torch", "ReactJS", "Large Language Model"],
                "education": [{"degree": "本科", "major": "计算机科学"}],
                "work_experiences": [{"description": "使用 pytorch 训练模型。"}],
            },
        },
    )

    assert response.status_code == 200
    skill_dimension = next(
        dimension for dimension in response.json()["dimensions"]
        if dimension["key"] == "skills"
    )
    assert set(skill_dimension["matched_concepts"]) >= {"PyTorch", "React", "大模型"}


def test_match_assessment_accepts_dazhuan_degree(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "测试工程师",
                "岗位jd": "大专及以上学历，熟悉接口测试和自动化测试。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        json={
            "job_id": "job-001",
            "candidate_profile": {
                "education": [{"degree": "大专", "major": "软件技术"}],
                "skills": ["接口测试", "自动化测试"],
                "work_experiences": [{"description": "负责接口测试和自动化测试。"}],
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    education_dimension = next(
        dimension for dimension in body["dimensions"]
        if dimension["key"] == "education"
    )
    assert education_dimension["score"] >= 85
    assert not any(flag["code"] == "education_mismatch" for flag in body["risk_flags"])


def test_missing_experience_years_is_not_treated_as_insufficient(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "本科及以上学历，3年以上经验，熟悉 Java。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        json={
            "job_id": "job-001",
            "candidate_profile": {
                "skills": ["Java"],
                "education": [{"degree": "本科", "major": "软件工程"}],
                "work_experiences": [{"description": "负责 Java 后端开发。"}],
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert any(
        item["field"] == "candidate_profile.experience_years"
        for item in body["missing_information"]
    )
    assert any(
        flag["code"] == "insufficient_candidate_information"
        for flag in body["risk_flags"]
    )
    assert not any(
        flag["code"] == "insufficient_experience_years"
        for flag in body["risk_flags"]
    )


def test_insufficient_experience_years_is_explicit_risk(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "本科及以上学历，3年以上经验，熟悉 Java。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        json={
            "job_id": "job-001",
            "candidate_profile": {
                "experience_years": 1,
                "skills": ["Java"],
                "education": [{"degree": "本科", "major": "软件工程"}],
                "work_experiences": [{"description": "负责 Java 后端开发。"}],
            },
        },
    )

    assert response.status_code == 200
    assert any(
        flag["code"] == "insufficient_experience_years"
        for flag in response.json()["risk_flags"]
    )


def test_match_assessment_returns_404_for_unknown_job(monkeypatch) -> None:
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "熟悉 Java。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/match",
        json={"job_id": "job-999", "candidate_profile": {"skills": ["Java"]}},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "job-not-found"


def test_match_assessment_rejects_stale_knowledge_base(monkeypatch) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "熟悉 Java。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    kb["schema_version"] = 1
    monkeypatch.setattr(main, "load_default_knowledge_base", lambda: kb)

    response = client.post(
        "/v1/assessment/match",
        json={"job_id": "job-001", "candidate_profile": {"skills": ["Java"]}},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "knowledge-base-needs-rebuild"
