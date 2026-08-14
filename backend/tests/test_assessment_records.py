from fastapi.testclient import TestClient

import backend.app.assessment_store as store
import backend.app.main as main
from backend.app.knowledge_base import build_knowledge_base
from backend.app.main import app


client = TestClient(app)


def _install_kb(monkeypatch) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "全栈开发工程师",
                "岗位jd": "本科及以上学历，熟悉 React、Node.js、Python。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-13T00:00:00+00:00",
    )
    monkeypatch.setattr(main, "load_default_knowledge_base", lambda: kb)


def _install_temp_store(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "assessment_records.sqlite3"
    monkeypatch.setattr(store, "DATA_PATH", db_path)
    monkeypatch.setattr(main, "candidate_fingerprint", store.candidate_fingerprint)
    monkeypatch.setattr(main, "scoring_context_hash", store.scoring_context_hash)
    monkeypatch.setattr(main, "load_cached_assessment", store.load_cached_assessment)
    monkeypatch.setattr(main, "save_assessment_record", store.save_assessment_record)
    monkeypatch.setattr(main, "recent_assessment_records", store.recent_assessment_records)
    monkeypatch.setattr(main, "assessment_statistics", store.assessment_statistics)


def _payload() -> dict[str, object]:
    return {
        "job_id": "job-001",
        "candidate_profile": {
            "display_name": "张三",
            "current_title": "全栈开发",
            "experience_years": 2,
            "education": [{"school": "某大学", "degree": "本科"}],
            "skills": ["React", "Node.js", "Python"],
            "work_experiences": [
                {
                    "company": "含电话公司",
                    "description": "负责 React 和 Node.js，全量简历正文不得入库。电话 13800000000。",
                    "raw_text": "<html>secret resume body</html>",
                }
            ],
            "summary": "候选人邮箱 secret@example.com 不应被持久化。",
        },
    }


def test_match_assessment_persists_anonymous_record_and_reuses_cache(monkeypatch, tmp_path) -> None:
    _install_kb(monkeypatch)
    _install_temp_store(monkeypatch, tmp_path)

    first = client.post(
        "/v1/assessment/match",
        headers={"X-Request-ID": "record-first"},
        json=_payload(),
    )
    second = client.post(
        "/v1/assessment/match",
        headers={"X-Request-ID": "record-second"},
        json=_payload(),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["request_id"] == "record-second"
    assert second.json()["total_score"] == first.json()["total_score"]

    records = client.get("/v1/admin/assessments").json()["records"]
    assert len(records) == 1
    assert records[0]["candidate_fingerprint"]
    assert records[0]["job_id"] == "job-001"
    assert records[0]["job_title"] == "全栈开发工程师"

    raw_db = (tmp_path / "assessment_records.sqlite3").read_bytes()
    for forbidden in [
        "张三",
        "secret@example.com",
        "13800000000",
        "<html>",
        "全量简历正文不得入库",
    ]:
        assert forbidden.encode("utf-8") not in raw_db


def test_assessment_cache_is_scoped_by_hr_weights(monkeypatch, tmp_path) -> None:
    _install_kb(monkeypatch)
    _install_temp_store(monkeypatch, tmp_path)
    payload = _payload()
    weighted_payload = {
        **payload,
        "scoring_weights": {
            "skills": 50,
            "experience_years": 10,
            "education": 10,
            "experience_evidence": 30,
        },
    }

    assert client.post("/v1/assessment/match", json=payload).status_code == 200
    assert client.post("/v1/assessment/match", json=weighted_payload).status_code == 200

    records = client.get("/v1/admin/assessments").json()["records"]
    assert len(records) == 2


def test_admin_dashboard_and_aliases(monkeypatch, tmp_path) -> None:
    _install_kb(monkeypatch)
    _install_temp_store(monkeypatch, tmp_path)
    assert client.post("/v1/assessment/match", json=_payload()).status_code == 200

    dashboard = client.get("/v1/admin/dashboard").json()
    assert dashboard["total_jobs"] == 1
    assert dashboard["total_assessment_records"] == 1
    assert dashboard["unique_candidates"] == 1
    assert dashboard["top_jobs"][0]["job_id"] == "job-001"

    aliases = client.get("/v1/admin/aliases").json()["aliases"]
    react = next(item for item in aliases if item["canonical"] == "React")
    assert "React.js" in react["aliases"]


def test_existing_assessment_records_are_sanitized_on_load(monkeypatch, tmp_path) -> None:
    _install_temp_store(monkeypatch, tmp_path)
    db_path = tmp_path / "assessment_records.sqlite3"
    dirty_payload = {
        "request_id": "old-record",
        "mode": "rule_v1.1",
        "explanation_source": "rule",
        "assessment_summary": "联系 secret@example.com 或 13800000000。",
        "llm_enhancement": "disabled",
        "job_id": "job-001",
        "job_title": "全栈开发工程师",
        "total_score": 72,
        "fit_score": 72,
        "hybrid_score": 72,
        "hybrid_delta": 0,
        "hybrid_summary": "",
        "potential_level": "medium",
        "potential_summary": "",
        "eligibility": {
            "status": "review",
            "summary": "待核实",
            "score_cap": None,
            "requirements": [],
        },
        "scoring_standard": {
            "standard_id": "engineering_dynamic_v1",
            "source": "rule_generated",
            "job_family": "engineering",
            "related_compensation_cap": 65,
            "dimensions": [],
        },
        "concept_graph": [],
        "semantic_review": {
            "source": "rule",
            "status": "not_requested",
            "summary": "",
            "findings": [],
        },
        "recommendation": "建议核实后推进",
        "dimensions": [
            {
                "key": "skills",
                "name": "技能匹配",
                "score": 72,
                "weight": 35,
                "confidence": 0.8,
                "reason": "命中",
                "matched_concepts": ["React"],
                "missing_concepts": [],
                "evidence": [
                    {
                        "source": "candidate.work_experiences",
                        "text": "全量简历正文不得入库 <html>secret</html>",
                        "concept": "React",
                    }
                ],
            }
        ],
        "highlights": [],
        "risk_flags": [],
        "missing_information": [],
        "follow_up_questions": [],
        "evidence": [
            {
                "source": "candidate.summary",
                "text": "全量简历正文不得入库 Cookie: token=secret",
                "concept": "React",
            }
        ],
    }
    store._ensure_schema(db_path)  # noqa: SLF001
    with store.sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO assessment_records (
                candidate_fingerprint, job_id, job_title, scoring_context_hash,
                total_score, fit_score, hybrid_score, recommendation,
                assessed_at, scoring_result_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "f" * 64,
                "job-001",
                "全栈开发工程师",
                "s" * 64,
                72,
                72,
                72,
                "建议核实后推进",
                "2026-08-13T00:00:00+00:00",
                store.json.dumps(dirty_payload, ensure_ascii=False),
            ),
        )

    cached = store.load_cached_assessment(
        candidate_hash="f" * 64,
        job_id="job-001",
        scoring_hash="s" * 64,
        request_id="cleaned",
        db_path=db_path,
    )

    assert cached is not None
    assert cached.request_id == "cleaned"
    raw_db = db_path.read_bytes()
    for forbidden in [
        "secret@example.com",
        "13800000000",
        "<html>",
        "全量简历正文不得入库",
        "token=secret",
    ]:
        assert forbidden.encode("utf-8") not in raw_db
