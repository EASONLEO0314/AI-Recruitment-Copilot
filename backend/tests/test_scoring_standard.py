from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.knowledge_base import build_knowledge_base
from backend.app.main import app
from backend.app.scoring_standard import clear_scoring_standard_cache


client = TestClient(app)


def _install_kb(monkeypatch, rows: list[dict[str, object]]) -> None:
    kb = build_knowledge_base(
        rows,
        source_name="fixture.xlsx",
        generated_at="2026-08-13T00:00:00+00:00",
    )
    monkeypatch.setattr(main, "load_default_knowledge_base", lambda: kb)


def test_scoring_standard_endpoint_returns_rule_fallback_without_llm(monkeypatch) -> None:
    monkeypatch.delenv("ARC_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
    _install_kb(
        monkeypatch,
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 生物信息学科学家",
                "岗位jd": "本科及以上学历，熟悉生命科学、生物信息学和 Python。",
                "需求数量": 1,
            }
        ],
    )

    response = client.post(
        "/v1/assessment/scoring-standard",
        headers={"X-Request-ID": "standard-rule-1"},
        json={"job_id": "job-001"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "standard-rule-1"
    assert body["standard"]["source"] == "rule_generated"
    assert body["standard"]["job_family"] == "research"
    assert sum(item["weight"] for item in body["standard"]["dimensions"]) == 100


def test_scoring_standard_endpoint_uses_deepseek_json_when_configured(monkeypatch) -> None:
    clear_scoring_standard_cache()
    monkeypatch.setenv("ARC_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-key")
    monkeypatch.setenv("ARC_LLM_TIMEOUT_SECONDS", "2")
    monkeypatch.setenv("ARC_LLM_MAX_OUTPUT_TOKENS", "420")
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
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

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"job_family":"engineering","related_compensation_cap":60,'
                                '"dimensions":['
                                '{"key":"skills","name":"技能匹配","weight":45,"rationale":"全栈岗优先核实技术栈。"},'
                                '{"key":"experience_years","name":"工作年限匹配","weight":10,"rationale":"年限作为弱门槛。"},'
                                '{"key":"education","name":"教育背景匹配","weight":10,"rationale":"学历满足即可。"},'
                                '{"key":"experience_evidence","name":"交付经历匹配","weight":35,"rationale":"项目交付证明真实能力。"}'
                                "]}"
                            )
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            assert kwargs["timeout"] == 2

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, *args, **kwargs):
            assert url == "https://api.deepseek.com/chat/completions"
            assert kwargs["headers"]["Authorization"] == "Bearer deepseek-test-key"
            assert kwargs["json"]["response_format"] == {"type": "json_object"}
            assert kwargs["json"]["max_tokens"] == 420
            return FakeResponse()

    monkeypatch.setattr("backend.app.scoring_standard.httpx.Client", FakeClient)

    try:
        response = client.post(
            "/v1/assessment/scoring-standard",
            json={"job_id": "job-001"},
        )
    finally:
        clear_scoring_standard_cache()

    assert response.status_code == 200
    standard = response.json()["standard"]
    assert standard["source"] == "llm_generated"
    assert standard["related_compensation_cap"] == 60
    assert {item["key"]: item["weight"] for item in standard["dimensions"]} == {
        "skills": 45,
        "experience_years": 10,
        "education": 10,
        "experience_evidence": 35,
    }


def test_scoring_standard_does_not_cache_llm_failure_fallback(monkeypatch) -> None:
    clear_scoring_standard_cache()
    monkeypatch.setenv("ARC_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-key")
    monkeypatch.setattr("backend.app.explanation._dotenv_values", lambda: {})
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

    calls = 0

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"job_family":"engineering","related_compensation_cap":60,'
                                '"dimensions":['
                                '{"key":"skills","name":"技能匹配","weight":45,"rationale":"全栈岗优先核实技术栈。"},'
                                '{"key":"experience_years","name":"工作年限匹配","weight":10,"rationale":"年限作为弱门槛。"},'
                                '{"key":"education","name":"教育背景匹配","weight":10,"rationale":"学历满足即可。"},'
                                '{"key":"experience_evidence","name":"交付经历匹配","weight":35,"rationale":"项目交付证明真实能力。"}'
                                "]}"
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
            nonlocal calls
            calls += 1
            if calls == 1:
                raise TimeoutError("simulated slow provider")
            return FakeResponse()

    monkeypatch.setattr("backend.app.scoring_standard.httpx.Client", FakeClient)

    try:
        first = client.post("/v1/assessment/scoring-standard", json={"job_id": "job-001"})
        second = client.post("/v1/assessment/scoring-standard", json={"job_id": "job-001"})
    finally:
        clear_scoring_standard_cache()

    assert calls == 2
    assert first.status_code == 200
    assert first.json()["standard"]["source"] == "rule_generated"
    assert second.status_code == 200
    assert second.json()["standard"]["source"] == "llm_generated"
