from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_demo_assessment_is_explicitly_demo() -> None:
    response = client.post(
        "/v1/demo/assessment",
        headers={"X-Request-ID": "assessment-1"},
        json={"candidate_label": "张同学"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "assessment-1"
    assert body["mode"] == "demo"
    assert body["candidate_label"] == "张同学"
    assert body["job_title"] == "AI4S 工程师（演示岗位）"
    assert body["total_score"] == 92
    assert len(body["dimensions"]) == 4
    assert len(body["messages"]) == 3


def test_demo_assessment_rejects_blank_candidate_label() -> None:
    response = client.post(
        "/v1/demo/assessment",
        json={"candidate_label": "   "},
    )

    assert response.status_code == 422
