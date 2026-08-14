"""Typed API contracts for the local service."""

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class EducationExperience(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    school: Optional[str] = Field(default=None, max_length=160)
    degree: Optional[str] = Field(default=None, max_length=160)
    major: Optional[str] = Field(default=None, max_length=160)
    period: Optional[str] = Field(default=None, max_length=160)
    raw_text: Optional[str] = Field(default=None, max_length=2_000)


class WorkExperience(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    company: Optional[str] = Field(default=None, max_length=160)
    title: Optional[str] = Field(default=None, max_length=160)
    period: Optional[str] = Field(default=None, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)
    raw_text: Optional[str] = Field(default=None, max_length=2_000)


class ProjectExperience(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: Optional[str] = Field(default=None, max_length=160)
    role: Optional[str] = Field(default=None, max_length=160)
    period: Optional[str] = Field(default=None, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)
    raw_text: Optional[str] = Field(default=None, max_length=2_000)


class CandidateProfile(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    display_name: Optional[str] = Field(default=None, max_length=160)
    current_title: Optional[str] = Field(default=None, max_length=160)
    location: Optional[str] = Field(default=None, max_length=160)
    experience_years: Optional[int] = Field(default=None, ge=0, le=80)
    expected_position: Optional[str] = Field(default=None, max_length=160)
    expected_city: Optional[str] = Field(default=None, max_length=160)
    education: list[EducationExperience] = Field(default_factory=list, max_length=50)
    work_experiences: list[WorkExperience] = Field(default_factory=list, max_length=50)
    project_experiences: list[ProjectExperience] = Field(default_factory=list, max_length=50)
    skills: list[Annotated[str, Field(max_length=160)]] = Field(
        default_factory=list,
        max_length=50,
    )
    summary: Optional[str] = Field(default=None, max_length=500)

    @field_validator("education", "work_experiences", "project_experiences", "skills", mode="before")
    @classmethod
    def _nullable_lists_to_empty(cls, value: object) -> object:
        return [] if value is None else value


class MatchAssessmentRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    job_id: str = Field(min_length=1, max_length=80)
    candidate_profile: CandidateProfile
    scoring_weights: Optional[dict[str, int]] = None


class ScoringStandardRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    job_id: str = Field(min_length=1, max_length=80)


class AssessmentRecordSummary(BaseModel):
    record_id: int = Field(ge=1)
    candidate_fingerprint: str = Field(max_length=64)
    job_id: str = Field(max_length=80)
    job_title: str = Field(max_length=160)
    total_score: int = Field(ge=0, le=100)
    fit_score: int = Field(ge=0, le=100)
    hybrid_score: int = Field(ge=0, le=100)
    recommendation: str = Field(max_length=160)
    assessed_at: str = Field(max_length=80)


class AssessmentRecordsResponse(BaseModel):
    request_id: str
    records: list[AssessmentRecordSummary] = Field(default_factory=list)


AssessmentEvidenceSource = Literal[
    "candidate.skills",
    "candidate.experience_years",
    "candidate.education",
    "candidate.work_experiences",
    "candidate.project_experiences",
    "candidate.summary",
    "job.profile",
]


class MatchEvidence(BaseModel):
    source: AssessmentEvidenceSource
    text: str = Field(max_length=300)
    concept: Optional[str] = Field(default=None, max_length=160)
    source_index: Optional[int] = Field(default=None, ge=0)
    match_type: Optional[Literal["DIRECT", "ALIAS", "RELATED", "BONUS", "NONE"]] = None
    matched_with: Optional[str] = Field(default=None, max_length=160)
    weight: Optional[float] = Field(default=None, ge=0, le=1)
    reason: Optional[str] = Field(default=None, max_length=240)


class MatchDimensionResult(BaseModel):
    key: str
    name: str
    score: int = Field(ge=0, le=100)
    weight: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    reason: str
    matched_concepts: list[str] = Field(default_factory=list)
    missing_concepts: list[str] = Field(default_factory=list)
    evidence: list[MatchEvidence] = Field(default_factory=list)


class ScoringCriterion(BaseModel):
    key: str
    name: str
    weight: int = Field(ge=0, le=100)
    rationale: str = Field(default="", max_length=240)


class ScoringStandard(BaseModel):
    standard_id: str = Field(max_length=80)
    source: Literal["rule_generated", "llm_generated", "hr_adjusted"] = "rule_generated"
    job_family: str = Field(max_length=80)
    related_compensation_cap: int = Field(ge=0, le=100)
    dimensions: list[ScoringCriterion]


class ScoringStandardResponse(BaseModel):
    request_id: str
    job_id: str
    job_title: str
    standard: ScoringStandard


class EligibilityRequirementResult(BaseModel):
    key: str
    label: str = Field(max_length=160)
    status: Literal["met", "missing", "not_met", "related_only"]
    severity: Literal["info", "warning", "critical"]
    reason: str = Field(max_length=260)
    related_concepts: list[str] = Field(default_factory=list)


class EligibilityResult(BaseModel):
    status: Literal["pass", "review", "fail"]
    summary: str = Field(max_length=260)
    score_cap: Optional[int] = Field(default=None, ge=0, le=100)
    requirements: list[EligibilityRequirementResult] = Field(default_factory=list)


class ConceptGraphLayer(BaseModel):
    role: Literal["required", "preferred", "related", "bonus"]
    label: str = Field(max_length=80)
    concepts: list[str] = Field(default_factory=list)
    compensation_cap: Optional[int] = Field(default=None, ge=0, le=100)
    description: str = Field(default="", max_length=240)


class SemanticReviewFinding(BaseModel):
    topic: Literal[
        "research_relevance",
        "project_complexity",
        "transferability",
        "candidate_contribution",
        "missing_skill_severity",
    ]
    verdict: Literal["strong", "positive", "uncertain", "risk", "not_applicable"]
    summary: str = Field(max_length=260)
    related_concepts: list[str] = Field(default_factory=list)


class SemanticReview(BaseModel):
    source: Literal["rule", "llm"] = "rule"
    status: Literal["not_requested", "applied", "failed"] = "not_requested"
    summary: str = Field(default="", max_length=500)
    findings: list[SemanticReviewFinding] = Field(default_factory=list)


class MatchRiskFlag(BaseModel):
    code: Literal[
        "missing_required_skill",
        "insufficient_experience_years",
        "education_mismatch",
        "insufficient_candidate_information",
        "missing_related_experience_evidence",
    ]
    severity: Literal["info", "warning", "critical"]
    message: str
    related_dimension: str
    related_concepts: list[str] = Field(default_factory=list)


class MatchMissingInformation(BaseModel):
    field: str
    reason: str


class PersonalizedFollowUpQuestion(BaseModel):
    question: str = Field(max_length=240)
    purpose: str = Field(max_length=180)
    evidence_anchor: str = Field(max_length=160)
    copy_text: str = Field(max_length=320)


class MatchAssessmentResponse(BaseModel):
    request_id: str
    mode: Literal["rule_v1", "rule_v1.1"] = "rule_v1"
    explanation_source: Literal["rule", "llm"] = "rule"
    assessment_summary: Optional[str] = Field(default=None, max_length=500)
    llm_enhancement: Optional[Literal["disabled", "applied", "cached", "failed", "timeout"]] = "disabled"
    job_id: str
    job_title: str
    total_score: int = Field(ge=0, le=100)
    fit_score: int = Field(ge=0, le=100)
    hybrid_score: int = Field(ge=0, le=100)
    hybrid_delta: int = Field(default=0, ge=-10, le=10)
    hybrid_summary: str = Field(default="", max_length=260)
    potential_level: Literal["low", "medium", "high"] = "medium"
    potential_summary: str = Field(default="", max_length=240)
    eligibility: EligibilityResult
    scoring_standard: ScoringStandard
    concept_graph: list[ConceptGraphLayer] = Field(default_factory=list)
    semantic_review: SemanticReview = Field(default_factory=SemanticReview)
    recommendation: str
    dimensions: list[MatchDimensionResult]
    highlights: list[str]
    risk_flags: list[MatchRiskFlag]
    missing_information: list[MatchMissingInformation]
    follow_up_questions: list[str]
    personalized_follow_up_questions: list[PersonalizedFollowUpQuestion] = Field(default_factory=list)
    evidence: list[MatchEvidence]


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


class KnowledgeQualityJobIssue(BaseModel):
    job_id: str
    title: str
    source_row: Optional[int] = None
    department: Optional[str] = None
    suggested_keywords: list[str] = Field(default_factory=list)


class KnowledgeUnrecognizedTerm(BaseModel):
    term: str = Field(max_length=80)
    frequency: int = Field(ge=2)
    sample_titles: list[Annotated[str, Field(max_length=160)]] = Field(
        default_factory=list,
        max_length=3,
    )


class KnowledgeQualityReport(BaseModel):
    total_rows: int = Field(ge=0)
    imported_jobs: int = Field(ge=0)
    warning_count: int = Field(ge=0)
    status_counts: dict[str, int] = Field(default_factory=dict)
    department_counts: dict[str, int] = Field(default_factory=dict)
    unrecognized_terms: list[KnowledgeUnrecognizedTerm] = Field(default_factory=list)
    missing_required_keyword_jobs: list[KnowledgeQualityJobIssue] = Field(default_factory=list)
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


class KnowledgeAliasItem(BaseModel):
    canonical: str
    category: str
    aliases: list[str] = Field(default_factory=list)
    frequency: int = Field(ge=0)


class KnowledgeAliasesResponse(BaseModel):
    request_id: str
    aliases: list[KnowledgeAliasItem] = Field(default_factory=list)


class DashboardTopJob(BaseModel):
    job_id: str
    job_title: str
    assessment_count: int = Field(ge=0)
    average_score: int = Field(ge=0, le=100)


class AdminDashboardResponse(BaseModel):
    request_id: str
    total_jobs: int = Field(ge=0)
    total_concepts: int = Field(ge=0)
    quality_warning_count: int = Field(ge=0)
    total_assessment_records: int = Field(ge=0)
    unique_candidates: int = Field(ge=0)
    unique_assessed_jobs: int = Field(ge=0)
    average_score: int = Field(ge=0, le=100)
    top_jobs: list[DashboardTopJob] = Field(default_factory=list)


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


class KnowledgeJobOption(BaseModel):
    job_id: str
    title: str
    department: Optional[str] = None
    project: Optional[str] = None
    status: Optional[str] = None


class KnowledgeSearchResponse(BaseModel):
    request_id: str
    query: str
    concepts: list[KnowledgeConcept] = Field(default_factory=list)
    jobs: list[KnowledgeJobHit] = Field(default_factory=list)


class KnowledgeJobsResponse(BaseModel):
    request_id: str
    jobs: list[KnowledgeJobOption] = Field(default_factory=list)


class KnowledgeEvaluationMaterial(BaseModel):
    material_id: str
    label: str
    category: str
    signals: list[str] = Field(default_factory=list)
    guidance: str = ""


class KnowledgeJobProfile(BaseModel):
    required_concepts: list[str] = Field(default_factory=list)
    preferred_concepts: list[str] = Field(default_factory=list)
    related_concepts: list[str] = Field(default_factory=list)
    bonus_concepts: list[str] = Field(default_factory=list)
    all_concepts: list[str] = Field(default_factory=list)
    concept_categories: list[str] = Field(default_factory=list)
    education_keywords: list[str] = Field(default_factory=list)
    experience_years_min: Optional[int] = None
    evaluation_materials: list[KnowledgeEvaluationMaterial] = Field(default_factory=list)


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
