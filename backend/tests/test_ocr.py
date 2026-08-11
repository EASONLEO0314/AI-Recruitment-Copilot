from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.main import app


client = TestClient(app)
IMAGE_DATA_URL = "data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAA"


def test_ocr_skills_returns_local_candidates(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "ocr_skills_from_data_url",
        lambda _image_data_url: (True, ["Python", "MySQL"]),
    )

    response = client.post(
        "/v1/ocr/skills",
        headers={"X-Request-ID": "ocr-1"},
        json={"image_data_url": IMAGE_DATA_URL},
    )

    assert response.status_code == 200
    assert response.json() == {
        "request_id": "ocr-1",
        "available": True,
        "engine": "tesseract",
        "skills": ["Python", "MySQL"],
        "warning": None,
    }


def test_ocr_skills_reports_missing_engine(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "ocr_skills_from_data_url",
        lambda _image_data_url: (False, []),
    )

    response = client.post(
        "/v1/ocr/skills",
        headers={"X-Request-ID": "ocr-2"},
        json={"image_data_url": IMAGE_DATA_URL},
    )

    assert response.status_code == 200
    assert response.json() == {
        "request_id": "ocr-2",
        "available": False,
        "engine": None,
        "skills": [],
        "warning": "ocr-engine-unavailable",
    }
