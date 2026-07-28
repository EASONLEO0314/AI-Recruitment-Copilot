"""FastAPI entry point for the local M1 service."""

from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.app.demo import build_demo_assessment
from backend.app.models import AssessmentResponse, DemoAssessmentRequest, HealthResponse


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
