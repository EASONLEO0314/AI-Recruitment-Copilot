"""FastAPI entry point for the local M1 service."""

from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.app.assessment_store import (
    assessment_statistics,
    candidate_fingerprint,
    load_cached_assessment,
    recent_assessment_records,
    save_assessment_record,
    scoring_context_hash,
)
from backend.app.demo import build_demo_assessment
from backend.app.explanation import enhance_match_explanation
from backend.app.knowledge_base import (
    clean_text,
    get_job_detail,
    knowledge_base_needs_rebuild,
    list_job_options,
    load_default_knowledge_base,
    quality_report_for,
    search_knowledge_base,
    summarize_knowledge_base,
)
from backend.app.models import (
    AdminDashboardResponse,
    AssessmentResponse,
    AssessmentRecordsResponse,
    DemoAssessmentRequest,
    HealthResponse,
    KnowledgeAliasesResponse,
    KnowledgeJobDetailResponse,
    KnowledgeJobsResponse,
    KnowledgeQualityResponse,
    KnowledgeSearchResponse,
    KnowledgeSummaryResponse,
    MatchAssessmentRequest,
    MatchAssessmentResponse,
    OcrSkillsRequest,
    OcrSkillsResponse,
    ScoringStandardRequest,
    ScoringStandardResponse,
)
from backend.app.ocr import ocr_skills_from_data_url
from backend.app.scoring import build_rule_match_assessment
from backend.app.scoring_standard import generate_job_scoring_standard


app = FastAPI(
    title="AI Recruitment Copilot Local API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|http://127\.0\.0\.1(?::\d+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/healthz", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    return HealthResponse(request_id=request.state.request_id)


@app.post("/v1/demo/assessment", response_model=AssessmentResponse)
async def demo_assessment(
    payload: DemoAssessmentRequest,
    request: Request,
) -> AssessmentResponse:
    return build_demo_assessment(payload.candidate_label, request.state.request_id)


@app.post("/v1/assessment/match", response_model=MatchAssessmentResponse)
async def match_assessment(
    payload: MatchAssessmentRequest,
    request: Request,
) -> MatchAssessmentResponse:
    job_detail = _match_job_detail(payload)
    candidate_hash = candidate_fingerprint(payload.candidate_profile)
    scoring_hash = scoring_context_hash(payload.scoring_weights)
    cached = load_cached_assessment(
        candidate_hash=candidate_hash,
        job_id=payload.job_id,
        scoring_hash=scoring_hash,
        request_id=request.state.request_id,
    )
    if cached:
        return cached
    try:
        assessment = build_rule_match_assessment(
            request_id=request.state.request_id,
            job_detail=job_detail,
            candidate_profile=payload.candidate_profile,
            scoring_weights=payload.scoring_weights,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    save_assessment_record(
        candidate_hash=candidate_hash,
        job_id=payload.job_id,
        scoring_hash=scoring_hash,
        assessment=assessment,
    )
    return assessment


@app.post("/v1/assessment/match/explanation", response_model=MatchAssessmentResponse)
async def match_assessment_explanation(
    payload: MatchAssessmentRequest,
    request: Request,
) -> MatchAssessmentResponse:
    job_detail = _match_job_detail(payload)
    try:
        assessment = build_rule_match_assessment(
            request_id=request.state.request_id,
            job_detail=job_detail,
            candidate_profile=payload.candidate_profile,
            scoring_weights=payload.scoring_weights,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return enhance_match_explanation(
        assessment,
        candidate_profile=payload.candidate_profile,
        job_detail=job_detail,
    )


@app.post("/v1/assessment/scoring-standard", response_model=ScoringStandardResponse)
async def scoring_standard(
    payload: ScoringStandardRequest,
    request: Request,
) -> ScoringStandardResponse:
    job_detail = _job_detail_by_id(payload.job_id)
    return ScoringStandardResponse(
        request_id=request.state.request_id,
        job_id=clean_text(job_detail.get("job_id")),
        job_title=clean_text(job_detail.get("title")) or "未知岗位",
        standard=generate_job_scoring_standard(job_detail),
    )


def _match_job_detail(payload: MatchAssessmentRequest) -> dict:
    return _job_detail_by_id(payload.job_id)


def _job_detail_by_id(job_id: str) -> dict:
    kb = load_default_knowledge_base()
    if knowledge_base_needs_rebuild(kb):
        raise HTTPException(status_code=503, detail="knowledge-base-needs-rebuild")
    job_detail = get_job_detail(job_id, kb=kb)
    if not job_detail:
        raise HTTPException(status_code=404, detail="job-not-found")
    return job_detail


@app.post("/v1/ocr/skills", response_model=OcrSkillsResponse)
async def ocr_skills(
    payload: OcrSkillsRequest,
    request: Request,
) -> OcrSkillsResponse:
    available, skills = ocr_skills_from_data_url(payload.image_data_url)
    if not available:
        return OcrSkillsResponse(
            request_id=request.state.request_id,
            available=False,
            warning="ocr-engine-unavailable",
        )
    return OcrSkillsResponse(
        request_id=request.state.request_id,
        available=True,
        engine="tesseract",
        skills=skills,
        warning=None if skills else "no-skills-found",
    )


@app.get("/v1/knowledge/summary", response_model=KnowledgeSummaryResponse)
async def knowledge_summary(request: Request) -> KnowledgeSummaryResponse:
    summary = summarize_knowledge_base(load_default_knowledge_base())
    return KnowledgeSummaryResponse(request_id=request.state.request_id, **summary)


@app.get("/v1/knowledge/quality", response_model=KnowledgeQualityResponse)
async def knowledge_quality(request: Request) -> KnowledgeQualityResponse:
    return KnowledgeQualityResponse(
        request_id=request.state.request_id,
        report=quality_report_for(load_default_knowledge_base()),
    )


@app.get("/v1/admin/dashboard", response_model=AdminDashboardResponse)
async def admin_dashboard(request: Request) -> AdminDashboardResponse:
    kb = load_default_knowledge_base()
    summary = summarize_knowledge_base(kb)
    quality = quality_report_for(kb)
    stats = assessment_statistics()
    return AdminDashboardResponse(
        request_id=request.state.request_id,
        total_jobs=summary["total_jobs"],
        total_concepts=summary["total_concepts"],
        quality_warning_count=int(quality.get("warning_count") or 0),
        total_assessment_records=stats["total_records"],
        unique_candidates=stats["unique_candidates"],
        unique_assessed_jobs=stats["unique_jobs"],
        average_score=stats["average_score"],
        top_jobs=stats["top_jobs"],
    )


@app.get("/v1/admin/assessments", response_model=AssessmentRecordsResponse)
async def admin_assessments(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
) -> AssessmentRecordsResponse:
    return AssessmentRecordsResponse(
        request_id=request.state.request_id,
        records=recent_assessment_records(limit=limit),
    )


@app.get("/v1/admin/aliases", response_model=KnowledgeAliasesResponse)
async def admin_aliases(request: Request) -> KnowledgeAliasesResponse:
    kb = load_default_knowledge_base()
    aliases = [
        {
            "canonical": concept["canonical"],
            "category": concept["category"],
            "aliases": concept.get("aliases", []),
            "frequency": concept["frequency"],
        }
        for concept in kb.get("concepts", [])
    ]
    return KnowledgeAliasesResponse(request_id=request.state.request_id, aliases=aliases)


@app.get("/v1/knowledge/search", response_model=KnowledgeSearchResponse)
async def knowledge_search(
    request: Request,
    query: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=5, ge=1, le=20),
) -> KnowledgeSearchResponse:
    result = search_knowledge_base(query, limit=limit)
    return KnowledgeSearchResponse(request_id=request.state.request_id, **result)


@app.get("/v1/knowledge/jobs", response_model=KnowledgeJobsResponse)
async def knowledge_jobs(
    request: Request,
    limit: int = Query(default=80, ge=1, le=200),
) -> KnowledgeJobsResponse:
    jobs = list_job_options(limit=limit, kb=load_default_knowledge_base())
    return KnowledgeJobsResponse(request_id=request.state.request_id, jobs=jobs)


@app.get("/v1/knowledge/jobs/{job_id}", response_model=KnowledgeJobDetailResponse)
async def knowledge_job_detail(
    job_id: str,
    request: Request,
) -> KnowledgeJobDetailResponse:
    detail = get_job_detail(job_id)
    if not detail:
        raise HTTPException(status_code=404, detail="job-not-found")
    return KnowledgeJobDetailResponse(request_id=request.state.request_id, **detail)
