"""Optional LLM generation for job-level scoring standards."""

from __future__ import annotations

import json
from hashlib import sha256
from threading import Lock
from typing import Any

import httpx

from backend.app.explanation import (
    DEFAULT_DEEPSEEK_MODEL,
    DEFAULT_EXPLANATION_MODEL,
    DEEPSEEK_CHAT_COMPLETIONS_URL,
    OPENAI_RESPONSES_URL,
    _env_value,
    _llm_max_tokens,
    _llm_timeout_seconds,
)
from backend.app.knowledge_base import clean_text
from backend.app.models import ScoringCriterion, ScoringStandard
from backend.app.scoring import DIMENSION_NAMES, build_scoring_standard


MAX_STANDARD_CACHE_ITEMS = 64
_STANDARD_CACHE: dict[str, ScoringStandard] = {}
_STANDARD_CACHE_ORDER: list[str] = []
_STANDARD_CACHE_LOCK = Lock()


def generate_job_scoring_standard(job_detail: dict[str, Any]) -> ScoringStandard:
    """Return an LLM-generated scoring standard when configured, otherwise rule fallback."""
    fallback = build_scoring_standard(job_detail)
    provider = _env_value("ARC_LLM_PROVIDER").strip().lower()
    if provider not in {"openai", "deepseek"}:
        return fallback

    model = _env_value(
        "ARC_LLM_MODEL",
        DEFAULT_DEEPSEEK_MODEL if provider == "deepseek" else DEFAULT_EXPLANATION_MODEL,
    )
    api_key = _env_value("DEEPSEEK_API_KEY" if provider == "deepseek" else "OPENAI_API_KEY").strip()
    if not api_key:
        return fallback

    cache_key = _standard_cache_key(provider, model, job_detail)
    cached = _cached_standard(cache_key)
    if cached:
        return cached

    payload = (
        _deepseek_standard(job_detail, fallback, api_key=api_key, model=model)
        if provider == "deepseek"
        else _openai_standard(job_detail, fallback, api_key=api_key, model=model)
    )
    if not payload:
        return fallback

    standard = _standard_from_payload(payload, fallback)
    if standard.source == "llm_generated":
        _store_cached_standard(cache_key, standard)
    return standard


def clear_scoring_standard_cache() -> None:
    with _STANDARD_CACHE_LOCK:
        _STANDARD_CACHE.clear()
        _STANDARD_CACHE_ORDER.clear()


def _openai_standard(
    job_detail: dict[str, Any],
    fallback: ScoringStandard,
    *,
    api_key: str,
    model: str,
) -> dict[str, Any] | None:
    payload = {
        "model": model,
        "store": False,
        "input": [
            {"role": "system", "content": _standard_system_prompt()},
            {
                "role": "user",
                "content": json.dumps(_standard_prompt_context(job_detail, fallback), ensure_ascii=False),
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "job_scoring_standard",
                "schema": _standard_json_schema(),
                "strict": True,
            },
        },
        "max_output_tokens": _llm_max_tokens(),
    }
    try:
        with httpx.Client(timeout=_llm_timeout_seconds()) as client:
            response = client.post(
                OPENAI_RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
    except Exception:
        return None
    return _parse_openai_payload(response.json())


def _deepseek_standard(
    job_detail: dict[str, Any],
    fallback: ScoringStandard,
    *,
    api_key: str,
    model: str,
) -> dict[str, Any] | None:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _standard_system_prompt()},
            {
                "role": "user",
                "content": (
                    "请基于以下岗位 JSON 输出评分标准 JSON object：\n"
                    f"{json.dumps(_standard_prompt_context(job_detail, fallback), ensure_ascii=False)}"
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": _llm_max_tokens(),
        "temperature": 0.1,
    }
    try:
        with httpx.Client(timeout=_llm_timeout_seconds()) as client:
            response = client.post(
                _env_value("DEEPSEEK_API_URL", DEEPSEEK_CHAT_COMPLETIONS_URL),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
    except Exception:
        return None
    return _parse_deepseek_payload(response.json())


def _standard_system_prompt() -> str:
    return (
        "你是招聘评分标准生成器。只能为已有确定性评分维度生成百分比权重和简短理由，"
        "不能新增维度，不能评估候选人，不能决定分数。"
        "输出 JSON object，字段只能包含 job_family、related_compensation_cap、dimensions。"
        "dimensions 必须且只能包含 skills、experience_years、education、experience_evidence，"
        "weight 必须是整数且总和为 100。"
    )


def _standard_prompt_context(
    job_detail: dict[str, Any],
    fallback: ScoringStandard,
) -> dict[str, Any]:
    profile = job_detail.get("profile") or {}
    return {
        "job": {
            "job_id": clean_text(job_detail.get("job_id")),
            "title": clean_text(job_detail.get("title")),
            "department": clean_text(job_detail.get("department")),
            "project": clean_text(job_detail.get("project")),
            "jd": clean_text(job_detail.get("jd")),
            "profile": {
                "required_concepts": profile.get("required_concepts", []),
                "preferred_concepts": profile.get("preferred_concepts", []),
                "concept_categories": profile.get("concept_categories", []),
                "education_keywords": profile.get("education_keywords", []),
                "experience_years_min": profile.get("experience_years_min"),
            },
        },
        "fallback_standard": fallback.model_dump(),
    }


def _standard_json_schema() -> dict[str, Any]:
    dimension_key_enum = list(DIMENSION_NAMES)
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "job_family": {"type": "string", "maxLength": 80},
            "related_compensation_cap": {"type": "integer", "minimum": 0, "maximum": 100},
            "dimensions": {
                "type": "array",
                "minItems": len(dimension_key_enum),
                "maxItems": len(dimension_key_enum),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "key": {"type": "string", "enum": dimension_key_enum},
                        "name": {"type": "string", "maxLength": 80},
                        "weight": {"type": "integer", "minimum": 0, "maximum": 100},
                        "rationale": {"type": "string", "maxLength": 240},
                    },
                    "required": ["key", "name", "weight", "rationale"],
                },
            },
        },
        "required": ["job_family", "related_compensation_cap", "dimensions"],
    }


def _standard_from_payload(
    payload: dict[str, Any],
    fallback: ScoringStandard,
) -> ScoringStandard:
    if not isinstance(payload.get("dimensions"), list):
        return fallback
    dimensions_by_key: dict[str, ScoringCriterion] = {}
    for item in payload["dimensions"]:
        if not isinstance(item, dict):
            return fallback
        key = clean_text(item.get("key"))
        if key not in DIMENSION_NAMES or key in dimensions_by_key:
            return fallback
        weight = item.get("weight")
        if isinstance(weight, bool) or not isinstance(weight, int):
            return fallback
        dimensions_by_key[key] = ScoringCriterion(
            key=key,
            name=clean_text(item.get("name")) or DIMENSION_NAMES[key],
            weight=weight,
            rationale=clean_text(item.get("rationale"))[:240],
        )
    if set(dimensions_by_key) != set(DIMENSION_NAMES):
        return fallback
    dimensions = [dimensions_by_key[key] for key in DIMENSION_NAMES]
    if sum(item.weight for item in dimensions) != 100:
        return fallback
    cap = payload.get("related_compensation_cap")
    if isinstance(cap, bool) or not isinstance(cap, int) or cap < 0 or cap > 100:
        cap = fallback.related_compensation_cap
    return ScoringStandard(
        standard_id="llm_dynamic_v1",
        source="llm_generated",
        job_family=clean_text(payload.get("job_family"))[:80] or fallback.job_family,
        related_compensation_cap=cap,
        dimensions=dimensions,
    )


def _parse_openai_payload(response_json: dict[str, Any]) -> dict[str, Any] | None:
    text = response_json.get("output_text")
    if isinstance(text, str):
        return _json_object(text)
    for item in response_json.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            content_text = content.get("text")
            if isinstance(content_text, str):
                parsed = _json_object(content_text)
                if parsed:
                    return parsed
    return None


def _parse_deepseek_payload(response_json: dict[str, Any]) -> dict[str, Any] | None:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    return _json_object(content) if isinstance(content, str) else None


def _json_object(value: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _standard_cache_key(provider: str, model: str, job_detail: dict[str, Any]) -> str:
    payload = {
        "provider": provider,
        "model": model,
        "job": _standard_prompt_context(job_detail, build_scoring_standard(job_detail)),
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return sha256(serialized.encode("utf-8")).hexdigest()


def _cached_standard(cache_key: str) -> ScoringStandard | None:
    with _STANDARD_CACHE_LOCK:
        return _STANDARD_CACHE.get(cache_key)


def _store_cached_standard(cache_key: str, standard: ScoringStandard) -> None:
    with _STANDARD_CACHE_LOCK:
        if cache_key not in _STANDARD_CACHE:
            _STANDARD_CACHE_ORDER.append(cache_key)
        _STANDARD_CACHE[cache_key] = standard
        while len(_STANDARD_CACHE_ORDER) > MAX_STANDARD_CACHE_ITEMS:
            stale_key = _STANDARD_CACHE_ORDER.pop(0)
            _STANDARD_CACHE.pop(stale_key, None)
