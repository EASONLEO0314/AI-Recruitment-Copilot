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


class KnowledgeSource(BaseModel):
    file_name: Optional[str] = None
    row_count: int = 0
    job_count: int = 0


class KnowledgeConcept(BaseModel):
    canonical: str
    category: str
    aliases: list[str] = Field(default_factory=list)
    frequency: int = Field(ge=0)
    job_ids: list[str] = Field(default_factory=list)


class KnowledgeQualityWarning(BaseModel):
    code: str
    severity: Literal["info", "warning", "error"]
    message: str
    job_id: Optional[str] = None
    source_row: Optional[int] = None
    title: Optional[str] = None


class KnowledgeQualityReport(BaseModel):
    total_rows: int = Field(ge=0)
    imported_jobs: int = Field(ge=0)
    warning_count: int = Field(ge=0)
    status_counts: dict[str, int] = Field(default_factory=dict)
    department_counts: dict[str, int] = Field(default_factory=dict)
    warnings: list[KnowledgeQualityWarning] = Field(default_factory=list)


class KnowledgeSummaryResponse(BaseModel):
    request_id: str
    schema_version: int
    generated_at: Optional[str] = None
    source: KnowledgeSource
    total_jobs: int = Field(ge=0)
    total_concepts: int = Field(ge=0)
    top_concepts: list[KnowledgeConcept] = Field(default_factory=list)


class KnowledgeQualityResponse(BaseModel):
    request_id: str
    report: KnowledgeQualityReport


class KnowledgeJobHit(BaseModel):
    job_id: str
    title: str
    department: Optional[str] = None
    project: Optional[str] = None
    status: Optional[str] = None
    score: int = Field(ge=0)
    matched_concepts: list[str] = Field(default_factory=list)
    required_keywords: list[str] = Field(default_factory=list)
    snippet: str = ""


class KnowledgeSearchResponse(BaseModel):
    request_id: str
    query: str
    concepts: list[KnowledgeConcept] = Field(default_factory=list)
    jobs: list[KnowledgeJobHit] = Field(default_factory=list)


class KnowledgeJobProfile(BaseModel):
    required_concepts: list[str] = Field(default_factory=list)
    preferred_concepts: list[str] = Field(default_factory=list)
    all_concepts: list[str] = Field(default_factory=list)
    concept_categories: list[str] = Field(default_factory=list)
    education_keywords: list[str] = Field(default_factory=list)
    experience_years_min: Optional[int] = None


class KnowledgeDocument(BaseModel):
    doc_id: str
    job_id: str
    title: str
    kind: str
    text: str
    concepts: list[str] = Field(default_factory=list)


class KnowledgeJobDetailResponse(BaseModel):
    request_id: str
    job_id: str
    source_row: int
    title: str
    department: Optional[str] = None
    project: Optional[str] = None
    headcount: Optional[int] = None
    change_type: Optional[str] = None
    hiring_type: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_months: Optional[str] = None
    start_time: Optional[str] = None
    status: Optional[str] = None
    platform: Optional[str] = None
    written_test_required: Optional[str] = None
    required_keywords: list[str] = Field(default_factory=list)
    expected_outputs: Optional[str] = None
    jd: str
    concepts: list[str] = Field(default_factory=list)
    profile: KnowledgeJobProfile
    documents: list[KnowledgeDocument] = Field(default_factory=list)


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
