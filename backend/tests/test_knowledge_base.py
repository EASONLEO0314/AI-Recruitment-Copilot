from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.knowledge_base import (
    build_knowledge_base,
    get_job_detail,
    load_knowledge_base_from_sqlite,
    quality_report_for,
    search_knowledge_base,
    write_knowledge_base_to_sqlite,
)
from backend.app.main import app


client = TestClient(app)


def test_build_knowledge_base_extracts_concepts_from_jd() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、LangChain、RAG、MySQL，参与 AI Agent 应用开发。",
                "岗位关键词（必备技能）": "Python、RAG",
                "入职部门": "AI4S模型研究院",
                "所属项目": "科研智能体",
                "需求数量": 1,
                "招聘类型": "正职",
                "岗位状态": "招聘中",
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    assert kb["source"] == {
        "file_name": "fixture.xlsx",
        "row_count": 1,
        "job_count": 1,
    }
    assert kb["jobs"][0]["required_keywords"] == ["Python", "RAG"]
    assert set(kb["jobs"][0]["concepts"]) >= {
        "AI4S",
        "AI智能体",
        "Python",
        "LangChain",
        "RAG",
        "MySQL",
    }
    assert {document["kind"] for document in kb["documents"]} == {"profile", "jd"}
    assert set(kb["jobs"][0]["profile"]["required_concepts"]) >= {
        "AI4S",
        "AI智能体",
        "Python",
        "RAG",
    }
    assert kb["quality_report"]["imported_jobs"] == 1


def test_search_knowledge_base_returns_relevant_jobs() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "负责 Java、Spring Boot、Redis、Kafka 高并发系统开发。",
                "需求数量": 1,
            },
            {
                "_source_row": 3,
                "岗位名称": "视觉设计师",
                "岗位jd": "负责 Figma、UI设计、品牌视觉设计。",
                "需求数量": 1,
            },
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    result = search_knowledge_base("SpringBoot Redis", limit=3, kb=kb)

    assert result["jobs"][0]["title"] == "后端工程师"
    assert result["jobs"][0]["matched_concepts"] == ["Redis", "Spring Boot"]
    assert {concept["canonical"] for concept in result["concepts"]} >= {
        "Redis",
        "Spring Boot",
    }


def test_build_knowledge_base_splits_required_and_preferred_profile() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": (
                    "任职要求 本科及以上学历，3年以上经验，熟悉 Java、Spring Boot、Redis。"
                    "加分项 有 RAG 或 AI Agent 项目经验。"
                ),
                "需求数量": 1,
                "岗位状态": "招聘中",
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    assert set(profile["required_concepts"]) >= {"Java", "Spring Boot", "Redis"}
    assert set(profile["preferred_concepts"]) >= {"RAG", "AI智能体"}
    assert profile["experience_years_min"] == 3
    assert profile["education_keywords"] == ["本科"]


def test_quality_report_summarizes_import_warnings() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "重复岗位",
                "岗位jd": "需要 Python。",
                "岗位状态": "招聘中",
            },
            {
                "_source_row": 3,
                "岗位名称": "重复岗位",
                "岗位jd": "需要 Redis。",
                "岗位状态": "暂停招聘",
            },
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    report = quality_report_for(kb)

    assert report["total_rows"] == 2
    assert report["imported_jobs"] == 2
    assert report["status_counts"] == {"招聘中": 1, "暂停招聘": 1}
    assert any(warning["code"] == "duplicate_title" for warning in report["warnings"])
    assert any(warning["code"] == "missing_required_keywords" for warning in report["warnings"])


def test_sqlite_storage_round_trips_knowledge_base(tmp_path) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "负责 Java、Spring Boot、Redis、Kafka 高并发系统开发。",
                "需求数量": 1,
                "岗位状态": "招聘中",
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    db_path = tmp_path / "job_knowledge_base.sqlite3"

    write_knowledge_base_to_sqlite(kb, db_path=db_path)
    loaded = load_knowledge_base_from_sqlite(db_path)

    assert loaded["source"] == {
        "file_name": "fixture.xlsx",
        "row_count": 1,
        "job_count": 1,
    }
    assert loaded["jobs"][0]["title"] == "后端工程师"
    assert set(loaded["jobs"][0]["concepts"]) >= {"Java", "Spring Boot", "Redis", "Kafka"}
    assert set(loaded["jobs"][0]["profile"]["required_concepts"]) >= {
        "Java",
        "Spring Boot",
        "Redis",
        "Kafka",
    }
    assert loaded["documents"][0]["job_id"] == "job-001"
    assert loaded["quality_report"]["imported_jobs"] == 1


def test_get_job_detail_includes_documents_and_profile() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    detail = get_job_detail("job-001", kb=kb)

    assert detail is not None
    assert detail["title"] == "AI4S 工程师"
    assert detail["profile"]["required_concepts"]
    assert {document["kind"] for document in detail["documents"]} == {"profile", "jd"}
    assert get_job_detail("job-999", kb=kb) is None


def test_knowledge_summary_endpoint_returns_loaded_kb(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "load_default_knowledge_base",
        lambda: build_knowledge_base(
            [
                {
                    "_source_row": 2,
                    "岗位名称": "AI4S 工程师",
                    "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                    "需求数量": 1,
                }
            ],
            source_name="fixture.xlsx",
            generated_at="2026-08-11T00:00:00+00:00",
        ),
    )

    response = client.get(
        "/v1/knowledge/summary",
        headers={"X-Request-ID": "kb-summary-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-summary-1"
    assert body["source"]["file_name"] == "fixture.xlsx"
    assert body["total_jobs"] == 1
    assert body["total_concepts"] >= 3
    assert body["top_concepts"]


def test_knowledge_quality_endpoint_returns_loaded_report(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "load_default_knowledge_base",
        lambda: build_knowledge_base(
            [
                {
                    "_source_row": 2,
                    "岗位名称": "AI4S 工程师",
                    "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                    "需求数量": 1,
                }
            ],
            source_name="fixture.xlsx",
            generated_at="2026-08-11T00:00:00+00:00",
        ),
    )

    response = client.get(
        "/v1/knowledge/quality",
        headers={"X-Request-ID": "kb-quality-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-quality-1"
    assert body["report"]["imported_jobs"] == 1
    assert body["report"]["warning_count"] >= 1


def test_knowledge_search_endpoint_returns_matches(monkeypatch) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    monkeypatch.setattr(
        main,
        "search_knowledge_base",
        lambda query, limit: search_knowledge_base(query, limit=limit, kb=kb),
    )

    response = client.get(
        "/v1/knowledge/search",
        headers={"X-Request-ID": "kb-search-1"},
        params={"query": "AI4S RAG Python", "limit": 5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-search-1"
    assert body["query"] == "AI4S RAG Python"
    assert body["jobs"]
    assert any(concept["canonical"] == "Python" for concept in body["concepts"])


def test_knowledge_job_detail_endpoint_returns_profile(monkeypatch) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    monkeypatch.setattr(main, "get_job_detail", lambda job_id: get_job_detail(job_id, kb=kb))

    response = client.get(
        "/v1/knowledge/jobs/job-001",
        headers={"X-Request-ID": "kb-job-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-job-1"
    assert body["title"] == "AI4S 工程师"
    assert body["profile"]["required_concepts"]
    assert len(body["documents"]) == 2

    missing = client.get("/v1/knowledge/jobs/job-999")
    assert missing.status_code == 404
