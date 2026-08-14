from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/healthz", headers={"X-Request-ID": "health-check-1"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "health-check-1"
    assert response.json() == {
        "request_id": "health-check-1",
        "status": "ok",
        "service": "ai-recruitment-copilot",
        "version": "0.1.0",
    }


def test_cors_allows_local_development_origin() -> None:
    response = client.options(
        "/v1/demo/assessment",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:5173"
    assert "X-ARC-API-Token" in response.headers["Access-Control-Allow-Headers"]


def test_cors_rejects_arbitrary_web_origin() -> None:
    response = client.options(
        "/v1/demo/assessment",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "Access-Control-Allow-Origin" not in response.headers


def test_api_token_is_required_when_configured(monkeypatch) -> None:
    monkeypatch.setenv("ARC_API_TOKEN", "secret-token")

    response = client.get("/healthz")

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


def test_api_token_allows_protected_endpoints_when_configured(monkeypatch) -> None:
    monkeypatch.setenv("ARC_API_TOKEN", "secret-token")

    response = client.get("/healthz", headers={"X-ARC-API-Token": "secret-token"})

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
