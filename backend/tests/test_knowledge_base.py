from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.knowledge_base import build_knowledge_base, search_knowledge_base
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
