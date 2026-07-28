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
