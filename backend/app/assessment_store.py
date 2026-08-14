"""Privacy-preserving local persistence for match assessments."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any

from backend.app.knowledge_base import clean_text
from backend.app.models import CandidateProfile, MatchAssessmentResponse


DATA_PATH = Path(__file__).parent / "data" / "assessment_records.sqlite3"
MAX_RECORDS = 500
CACHE_CONTEXT_VERSION = "assessment-cache-v2-rule-v1.1-redacted"
_CANDIDATE_EVIDENCE_TEXT = "[candidate evidence redacted]"
_JOB_EVIDENCE_TEXT = "[job profile evidence redacted]"
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)")
_HTML_TAG_RE = re.compile(r"<[^>\n]{1,120}>")
_COOKIE_RE = re.compile(r"(?i)\bcookie\b\s*[:=]\s*[^;\s]{1,120}")


def candidate_fingerprint(candidate_profile: CandidateProfile) -> str:
    """Stable anonymous fingerprint for cache lookups without storing profile text."""
    payload = candidate_profile.model_dump(mode="json", exclude_none=True)
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return sha256(canonical.encode("utf-8")).hexdigest()


def scoring_context_hash(scoring_weights: dict[str, int] | None) -> str:
    payload = {
        "version": CACHE_CONTEXT_VERSION,
        "scoring_weights": scoring_weights or {},
    }
    canonical = json.dumps(payload, sort_keys=True)
    return sha256(canonical.encode("utf-8")).hexdigest()


def load_cached_assessment(
    *,
    candidate_hash: str,
    job_id: str,
    scoring_hash: str,
    request_id: str,
    db_path: Path | None = None,
) -> MatchAssessmentResponse | None:
    _ensure_schema(db_path)
    path = db_path or DATA_PATH
    with sqlite3.connect(path) as connection:
        row = connection.execute(
            """
            SELECT scoring_result_json
            FROM assessment_records
            WHERE candidate_fingerprint = ? AND job_id = ? AND scoring_context_hash = ?
            ORDER BY assessed_at DESC
            LIMIT 1
            """,
            (candidate_hash, job_id, scoring_hash),
        ).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row[0])
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    payload["request_id"] = request_id
    return MatchAssessmentResponse(**payload)


def save_assessment_record(
    *,
    candidate_hash: str,
    job_id: str,
    scoring_hash: str,
    assessment: MatchAssessmentResponse,
    db_path: Path | None = None,
) -> None:
    _ensure_schema(db_path)
    path = db_path or DATA_PATH
    assessed_at = datetime.now(timezone.utc).isoformat()
    result_json = json.dumps(_assessment_payload_for_storage(assessment), ensure_ascii=False)
    with sqlite3.connect(path) as connection:
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
                candidate_hash,
                job_id,
                assessment.job_title,
                scoring_hash,
                assessment.total_score,
                assessment.fit_score,
                assessment.hybrid_score,
                assessment.recommendation,
                assessed_at,
                result_json,
            ),
        )
        _trim_records(connection)


def recent_assessment_records(
    *,
    limit: int = 20,
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    _ensure_schema(db_path)
    path = db_path or DATA_PATH
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT record_id, candidate_fingerprint, job_id, job_title,
                   total_score, fit_score, hybrid_score, recommendation, assessed_at
            FROM assessment_records
            ORDER BY assessed_at DESC, record_id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "record_id": int(row["record_id"]),
            "candidate_fingerprint": clean_text(row["candidate_fingerprint"]),
            "job_id": clean_text(row["job_id"]),
            "job_title": clean_text(row["job_title"]),
            "total_score": int(row["total_score"]),
            "fit_score": int(row["fit_score"]),
            "hybrid_score": int(row["hybrid_score"]),
            "recommendation": clean_text(row["recommendation"]),
            "assessed_at": clean_text(row["assessed_at"]),
        }
        for row in rows
    ]


def assessment_statistics(*, db_path: Path | None = None) -> dict[str, Any]:
    _ensure_schema(db_path)
    path = db_path or DATA_PATH
    with sqlite3.connect(path) as connection:
        total_records = int(connection.execute(
            "SELECT COUNT(*) FROM assessment_records"
        ).fetchone()[0])
        unique_candidates = int(connection.execute(
            "SELECT COUNT(DISTINCT candidate_fingerprint) FROM assessment_records"
        ).fetchone()[0])
        unique_jobs = int(connection.execute(
            "SELECT COUNT(DISTINCT job_id) FROM assessment_records"
        ).fetchone()[0])
        average_score_row = connection.execute(
            "SELECT AVG(total_score) FROM assessment_records"
        ).fetchone()
        top_jobs = connection.execute(
            """
            SELECT grouped.job_id,
                   (
                       SELECT latest.job_title
                       FROM assessment_records latest
                       WHERE latest.job_id = grouped.job_id
                       ORDER BY latest.assessed_at DESC, latest.record_id DESC
                       LIMIT 1
                   ) AS job_title,
                   grouped.assessment_count,
                   grouped.average_score
            FROM (
                SELECT job_id, COUNT(*) AS assessment_count, AVG(total_score) AS average_score
                FROM assessment_records
                GROUP BY job_id
            ) grouped
            ORDER BY grouped.assessment_count DESC, grouped.job_id ASC
            LIMIT 8
            """
        ).fetchall()
    return {
        "total_records": total_records,
        "unique_candidates": unique_candidates,
        "unique_jobs": unique_jobs,
        "average_score": round(float(average_score_row[0] or 0)),
        "top_jobs": [
            {
                "job_id": clean_text(row[0]),
                "job_title": clean_text(row[1]),
                "assessment_count": int(row[2]),
                "average_score": round(float(row[3] or 0)),
            }
            for row in top_jobs
        ],
    }


def clear_assessment_records(*, db_path: Path | None = None) -> None:
    _ensure_schema(db_path)
    path = db_path or DATA_PATH
    with sqlite3.connect(path) as connection:
        connection.execute("DELETE FROM assessment_records")


def _ensure_schema(db_path: Path | None = None) -> None:
    path = db_path or DATA_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS assessment_records (
                record_id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_fingerprint TEXT NOT NULL,
                job_id TEXT NOT NULL,
                job_title TEXT NOT NULL,
                scoring_context_hash TEXT NOT NULL,
                total_score INTEGER NOT NULL,
                fit_score INTEGER NOT NULL,
                hybrid_score INTEGER NOT NULL,
                recommendation TEXT NOT NULL,
                assessed_at TEXT NOT NULL,
                scoring_result_json TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_assessment_records_cache
            ON assessment_records(candidate_fingerprint, job_id, scoring_context_hash, assessed_at DESC)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_assessment_records_recent
            ON assessment_records(assessed_at DESC)
            """
        )
        if _sanitize_existing_records(connection):
            connection.commit()
            connection.execute("VACUUM")


def _assessment_payload_for_storage(assessment: MatchAssessmentResponse) -> dict[str, Any]:
    payload = assessment.model_dump(mode="json")
    return _sanitize_payload_for_storage(payload)


def _sanitize_payload_for_storage(payload: dict[str, Any]) -> dict[str, Any]:
    _redact_sensitive_values(payload)
    _redact_evidence_list(payload.get("evidence"))
    dimensions = payload.get("dimensions")
    if isinstance(dimensions, list):
        for dimension in dimensions:
            if isinstance(dimension, dict):
                _redact_evidence_list(dimension.get("evidence"))
    return payload


def _sanitize_existing_records(connection: sqlite3.Connection) -> bool:
    changed = False
    rows = connection.execute(
        "SELECT record_id, scoring_result_json FROM assessment_records"
    ).fetchall()
    for record_id, raw_json in rows:
        try:
            payload = json.loads(raw_json)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        sanitized_json = json.dumps(
            _sanitize_payload_for_storage(payload),
            ensure_ascii=False,
        )
        if sanitized_json == raw_json:
            continue
        connection.execute(
            """
            UPDATE assessment_records
            SET scoring_result_json = ?
            WHERE record_id = ?
            """,
            (sanitized_json, record_id),
        )
        changed = True
    return changed


def _redact_evidence_list(value: object) -> None:
    if not isinstance(value, list):
        return
    for item in value:
        if not isinstance(item, dict):
            continue
        source = item.get("source")
        item["text"] = (
            _JOB_EVIDENCE_TEXT
            if source == "job.profile"
            else _CANDIDATE_EVIDENCE_TEXT
        )


def _redact_sensitive_values(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            value[key] = _redact_sensitive_text(child) if isinstance(child, str) else child
            _redact_sensitive_values(value[key])
    elif isinstance(value, list):
        for index, child in enumerate(value):
            value[index] = _redact_sensitive_text(child) if isinstance(child, str) else child
            _redact_sensitive_values(value[index])


def _redact_sensitive_text(value: str) -> str:
    redacted = _EMAIL_RE.sub("[email redacted]", value)
    redacted = _PHONE_RE.sub("[phone redacted]", redacted)
    redacted = _HTML_TAG_RE.sub("[html redacted]", redacted)
    return _COOKIE_RE.sub("cookie=[redacted]", redacted)


def _trim_records(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        DELETE FROM assessment_records
        WHERE record_id NOT IN (
            SELECT record_id
            FROM assessment_records
            ORDER BY assessed_at DESC, record_id DESC
            LIMIT ?
        )
        """,
        (MAX_RECORDS,),
    )
