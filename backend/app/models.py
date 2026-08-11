"""Typed API contracts for the M1 demo slice."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    request_id: str
    status: Literal["ok"] = "ok"
    service: Literal["ai-recruitment-copilot"] = "ai-recruitment-copilot"
    version: Literal["0.1.0"] = "0.1.0"


class DemoAssessmentRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    candidate_label: str = Field(default="张同学", min_length=1, max_length=80)


class OcrSkillsRequest(BaseModel):
    image_data_url: str = Field(min_length=32, max_length=6_000_000)


class OcrSkillsResponse(BaseModel):
    request_id: str
    available: bool
    engine: Optional[str] = None
    skills: list[str] = Field(default_factory=list, max_length=20)
    warning: Optional[Literal["ocr-engine-unavailable", "ocr-failed", "no-skills-found"]] = None


class DimensionResult(BaseModel):
    key: str
    name: str
    score: int = Field(ge=0, le=100)
    weight: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    reason: str
    evidence: list[str]


class MessageSuggestion(BaseModel):
    type: Literal["greeting", "interview_invitation", "phone_script"]
    label: str
    content: str


class AssessmentResponse(BaseModel):
    request_id: str
    mode: Literal["demo"] = "demo"
    candidate_label: str
    job_title: str
    total_score: int = Field(ge=0, le=100)
    recommendation: str
    dimensions: list[DimensionResult]
    highlights: list[str]
    risk_flags: list[str]
    follow_up_questions: list[str]
    messages: list[MessageSuggestion]
