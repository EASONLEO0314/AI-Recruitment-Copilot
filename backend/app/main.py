"""FastAPI entry point for the local M1 service."""

from uuid import uuid4

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.app.demo import build_demo_assessment
from backend.app.knowledge_base import (
    load_default_knowledge_base,
    search_knowledge_base,
    summarize_knowledge_base,
)
from backend.app.models import (
    AssessmentResponse,
    DemoAssessmentRequest,
    HealthResponse,
    KnowledgeSearchResponse,
    KnowledgeSummaryResponse,
    OcrSkillsRequest,
    OcrSkillsResponse,
)
from backend.app.ocr import ocr_skills_from_data_url


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


@app.get("/v1/knowledge/search", response_model=KnowledgeSearchResponse)
async def knowledge_search(
    request: Request,
    query: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=5, ge=1, le=20),
) -> KnowledgeSearchResponse:
    result = search_knowledge_base(query, limit=limit)
    return KnowledgeSearchResponse(request_id=request.state.request_id, **result)
