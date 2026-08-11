"""Local job knowledge base helpers.

The runtime API reads a generated SQLite database. Excel parsing lives in the
build script so the local service can stay lightweight.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any


DATA_PATH = Path(__file__).parent / "data" / "job_knowledge_base.sqlite3"


CONCEPT_DEFINITIONS: list[dict[str, Any]] = [
    {
        "canonical": "AI4S",
        "category": "ai_llm",
        "aliases": ["AI4S", "AI for Science", "AI科学", "科学智能"],
    },
    {
        "canonical": "AI智能体",
        "category": "ai_llm",
        "aliases": ["AI智能体", "智能体", "AI Agent", "LLM Agent", "Agent应用"],
    },
    {
        "canonical": "大模型",
        "category": "ai_llm",
        "aliases": ["大模型", "LLM", "生成式AI", "AIGC"],
    },
    {
        "canonical": "LangChain",
        "category": "ai_llm",
        "aliases": ["LangChain"],
    },
    {
        "canonical": "RAG",
        "category": "ai_llm",
        "aliases": ["RAG", "检索增强生成", "RAG检索"],
    },
    {
        "canonical": "Prompt Engineering",
        "category": "ai_llm",
        "aliases": ["Prompt Engineering", "Prompt工程", "提示词工程"],
    },
    {
        "canonical": "Function Calling",
        "category": "ai_llm",
        "aliases": ["Function Calling", "FunctionCalling", "函数调用"],
    },
    {
        "canonical": "机器学习",
        "category": "ai_llm",
        "aliases": ["机器学习", "Machine Learning", "ML"],
    },
    {
        "canonical": "深度学习",
        "category": "ai_llm",
        "aliases": ["深度学习", "Deep Learning", "DL"],
    },
    {
        "canonical": "生物信息学",
        "category": "bio_ai",
        "aliases": ["生物信息学", "生物信息", "Bioinformatics"],
    },
    {
        "canonical": "计算生物学",
        "category": "bio_ai",
        "aliases": ["计算生物学", "Computational Biology"],
    },
    {
        "canonical": "蛋白结构预测",
        "category": "bio_ai",
        "aliases": ["蛋白结构预测", "蛋白质结构预测", "蛋白结构"],
    },
    {
        "canonical": "分子动力学",
        "category": "bio_ai",
        "aliases": ["分子动力学", "Molecular Dynamics", "MD模拟"],
    },
    {
        "canonical": "药物研发",
        "category": "bio_ai",
        "aliases": ["药物研发", "医药研发", "新药研发"],
    },
    {
        "canonical": "生命科学",
        "category": "bio_ai",
        "aliases": ["生命科学", "生物医药"],
    },
    {
        "canonical": "生物反应器",
        "category": "bio_ai",
        "aliases": ["生物反应器", "生物反应体系"],
    },
    {
        "canonical": "CFD",
        "category": "simulation",
        "aliases": ["CFD", "计算流体力学"],
    },
    {
        "canonical": "流体力学建模",
        "category": "simulation",
        "aliases": ["流体力学建模", "流体建模", "流体力学"],
    },
    {
        "canonical": "多物理场仿真",
        "category": "simulation",
        "aliases": ["多物理场", "多物理场仿真", "物理仿真", "仿真建模"],
    },
    {
        "canonical": "Python",
        "category": "programming_language",
        "aliases": ["Python"],
    },
    {
        "canonical": "Java",
        "category": "programming_language",
        "aliases": ["Java", "Java后端"],
    },
    {
        "canonical": "C语言",
        "category": "programming_language",
        "aliases": ["C语言", "C 语言"],
    },
    {
        "canonical": "JavaScript",
        "category": "programming_language",
        "aliases": ["JavaScript", "JS"],
    },
    {
        "canonical": "TypeScript",
        "category": "programming_language",
        "aliases": ["TypeScript", "TS"],
    },
    {
        "canonical": "SQL",
        "category": "database_middleware",
        "aliases": ["SQL"],
    },
    {
        "canonical": "MySQL",
        "category": "database_middleware",
        "aliases": ["MySQL", "MySQL优化"],
    },
    {
        "canonical": "PostgreSQL",
        "category": "database_middleware",
        "aliases": ["PostgreSQL", "Postgres"],
    },
    {
        "canonical": "Redis",
        "category": "database_middleware",
        "aliases": ["Redis"],
    },
    {
        "canonical": "Kafka",
        "category": "database_middleware",
        "aliases": ["Kafka"],
    },
    {
        "canonical": "RabbitMQ",
        "category": "database_middleware",
        "aliases": ["RabbitMQ"],
    },
    {
        "canonical": "ClickHouse",
        "category": "database_middleware",
        "aliases": ["ClickHouse"],
    },
    {
        "canonical": "消息队列",
        "category": "database_middleware",
        "aliases": ["消息队列", "MQ", "Pub/Sub", "消息中间件"],
    },
    {
        "canonical": "数据库设计",
        "category": "database_middleware",
        "aliases": ["数据库设计", "索引调优", "SQL优化", "事务处理"],
    },
    {
        "canonical": "Spring Boot",
        "category": "backend",
        "aliases": ["Spring Boot", "SpringBoot", "Spring 后端"],
    },
    {
        "canonical": "Spring Cloud",
        "category": "backend",
        "aliases": ["Spring Cloud", "SpringCloud", "SpringCloud微服务"],
    },
    {
        "canonical": "Spring AI",
        "category": "backend",
        "aliases": ["Spring AI", "SpringAI"],
    },
    {
        "canonical": "MyBatis",
        "category": "backend",
        "aliases": ["MyBatis"],
    },
    {
        "canonical": "Flask",
        "category": "backend",
        "aliases": ["Flask"],
    },
    {
        "canonical": "FastAPI",
        "category": "backend",
        "aliases": ["FastAPI"],
    },
    {
        "canonical": "微服务",
        "category": "backend",
        "aliases": ["微服务", "微服务架构"],
    },
    {
        "canonical": "REST API",
        "category": "backend",
        "aliases": ["REST API", "接口开发", "API开发"],
    },
    {
        "canonical": "高并发调优",
        "category": "backend",
        "aliases": ["高并发", "高并发调优", "性能调优", "系统调优"],
    },
    {
        "canonical": "Vue",
        "category": "frontend",
        "aliases": ["Vue", "Vue3"],
    },
    {
        "canonical": "React",
        "category": "frontend",
        "aliases": ["React"],
    },
    {
        "canonical": "HTML/CSS",
        "category": "frontend",
        "aliases": ["HTML", "CSS", "HTML/CSS", "HTML/CSS/JS"],
    },
    {
        "canonical": "UniApp",
        "category": "frontend",
        "aliases": ["uni-app", "UniApp", "跨端开发"],
    },
    {
        "canonical": "Node.js",
        "category": "frontend",
        "aliases": ["Node.js", "nodejs", "node"],
    },
    {
        "canonical": "Linux",
        "category": "devops",
        "aliases": ["Linux"],
    },
    {
        "canonical": "Docker",
        "category": "devops",
        "aliases": ["Docker", "容器化"],
    },
    {
        "canonical": "Kubernetes",
        "category": "devops",
        "aliases": ["Kubernetes", "K8s"],
    },
    {
        "canonical": "Git",
        "category": "devops",
        "aliases": ["Git", "版本管理", "代码版本管理"],
    },
    {
        "canonical": "CI/CD",
        "category": "devops",
        "aliases": ["CI/CD", "Jenkins", "GitLab CI", "自动化部署"],
    },
    {
        "canonical": "Maven",
        "category": "devops",
        "aliases": ["Maven"],
    },
    {
        "canonical": "Nginx",
        "category": "devops",
        "aliases": ["Nginx"],
    },
    {
        "canonical": "自动化测试",
        "category": "testing",
        "aliases": ["自动化测试", "测试自动化"],
    },
    {
        "canonical": "接口测试",
        "category": "testing",
        "aliases": ["接口测试", "接口调试"],
    },
    {
        "canonical": "性能测试",
        "category": "testing",
        "aliases": ["性能测试", "压测"],
    },
    {
        "canonical": "Selenium",
        "category": "testing",
        "aliases": ["Selenium", "Python+Selenium"],
    },
    {
        "canonical": "JMeter",
        "category": "testing",
        "aliases": ["JMeter"],
    },
    {
        "canonical": "Postman",
        "category": "testing",
        "aliases": ["Postman"],
    },
    {
        "canonical": "Apifox",
        "category": "testing",
        "aliases": ["Apifox"],
    },
    {
        "canonical": "Pytest",
        "category": "testing",
        "aliases": ["Pytest"],
    },
    {
        "canonical": "JUnit",
        "category": "testing",
        "aliases": ["JUnit"],
    },
    {
        "canonical": "Allure",
        "category": "testing",
        "aliases": ["Allure"],
    },
    {
        "canonical": "项目管理",
        "category": "product_pm",
        "aliases": ["项目管理", "项目全流程", "项目生命周期", "交付管理"],
    },
    {
        "canonical": "需求分析",
        "category": "product_pm",
        "aliases": ["需求分析", "需求调研", "需求拆解", "PRD", "产品需求"],
    },
    {
        "canonical": "风险管理",
        "category": "product_pm",
        "aliases": ["风险管理", "风险识别", "风险控制"],
    },
    {
        "canonical": "解决方案",
        "category": "sales_solution",
        "aliases": ["解决方案", "解决方案专家", "方案设计", "售前方案"],
    },
    {
        "canonical": "售前",
        "category": "sales_solution",
        "aliases": ["售前", "售前支持", "售前顾问"],
    },
    {
        "canonical": "大客户销售",
        "category": "sales_solution",
        "aliases": ["大客户销售", "KA销售", "重点客户"],
    },
    {
        "canonical": "商务谈判",
        "category": "sales_solution",
        "aliases": ["商务谈判", "合同谈判", "客情维护"],
    },
    {
        "canonical": "客户开拓",
        "category": "sales_solution",
        "aliases": ["客户开拓", "客户开发", "线索挖掘"],
    },
    {
        "canonical": "CRM",
        "category": "sales_solution",
        "aliases": ["CRM", "客户关系管理"],
    },
    {
        "canonical": "视觉设计",
        "category": "design",
        "aliases": ["视觉设计", "平面设计", "创意设计"],
    },
    {
        "canonical": "UI设计",
        "category": "design",
        "aliases": ["UI设计", "界面设计", "交互设计"],
    },
    {
        "canonical": "Figma",
        "category": "design",
        "aliases": ["Figma"],
    },
    {
        "canonical": "Photoshop",
        "category": "design",
        "aliases": ["Photoshop", "PS"],
    },
    {
        "canonical": "Illustrator",
        "category": "design",
        "aliases": ["Illustrator", "AI软件"],
    },
]


FIELD_LABELS = {
    "job_title": "岗位名称",
    "written_test_required": "是否需要笔试题",
    "jd": "岗位jd",
    "required_keywords": "岗位关键词（必备技能）",
    "expected_outputs": "预期核心产出目标",
    "department": "入职部门",
    "manager": "直属负责人",
    "project": "所属项目",
    "headcount": "需求数量",
    "change_type": "新增or替换",
    "hiring_type": "招聘类型",
    "salary_min": "薪资下限（元）",
    "salary_max": "薪资上限（元）",
    "salary_months": "固定月薪（12-15）",
    "start_time": "开始时间",
    "recruiting_cost": "招聘成本记录",
    "recruiter": "招聘负责人",
    "status": "岗位状态",
    "platform": "招聘平台",
}


def clean_cell(value: Any) -> str | int | float | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, str):
        cleaned = re.sub(r"\s+", " ", value.replace("\u3000", " ")).strip()
        if not cleaned or cleaned.lower() in {"nan", "none", "null"}:
            return None
        return cleaned
    return value


def clean_text(value: Any) -> str:
    cleaned = clean_cell(value)
    if cleaned is None:
        return ""
    if isinstance(cleaned, float) and cleaned.is_integer():
        return str(int(cleaned))
    return str(cleaned).strip()


def clean_int(value: Any) -> int | None:
    cleaned = clean_cell(value)
    if cleaned is None or cleaned == "":
        return None
    try:
        return int(float(str(cleaned).replace(",", "")))
    except ValueError:
        return None


def split_keywords(value: Any) -> list[str]:
    text = clean_text(value)
    if not text:
        return []
    parts = re.split(r"[、,，;；/\n\r]+", text)
    return [part.strip(" .。:：-") for part in parts if part.strip(" .。:：-")]


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).lower()


def compact_text(value: str) -> str:
    return re.sub(r"[\s_\-./]+", "", normalize_text(value))


def _contains_ascii_alias(text: str, alias: str) -> bool:
    pieces = re.split(r"[\s_\-./]+", normalize_text(alias))
    pattern = r"[\s_\-./]*".join(re.escape(piece) for piece in pieces if piece)
    if not pattern:
        return False
    return re.search(rf"(?<![a-z0-9]){pattern}(?![a-z0-9])", text) is not None


def _contains_alias(text: str, alias: str) -> bool:
    normalized = normalize_text(text)
    if re.fullmatch(r"[A-Za-z0-9+#.\-_/ ]+", alias):
        return _contains_ascii_alias(normalized, alias)
    return compact_text(alias) in compact_text(text)


def extract_concepts_from_text(text: str) -> list[str]:
    concepts: list[str] = []
    for definition in CONCEPT_DEFINITIONS:
        aliases = [definition["canonical"], *definition.get("aliases", [])]
        if any(_contains_alias(text, alias) for alias in aliases):
            concepts.append(definition["canonical"])
    return concepts


def _first_snippet(text: str, query: str, max_length: int = 160) -> str:
    compact_query = query.strip()
    if not text:
        return ""
    normalized = normalize_text(text)
    query_index = normalized.find(normalize_text(compact_query)) if compact_query else -1
    start = max(0, query_index - 50) if query_index >= 0 else 0
    snippet = text[start : start + max_length].strip()
    return re.sub(r"\s+", " ", snippet)


def _row_to_job(row: dict[str, Any], row_number: int, ordinal: int) -> dict[str, Any] | None:
    title = clean_text(row.get(FIELD_LABELS["job_title"]))
    jd = clean_text(row.get(FIELD_LABELS["jd"]))
    if not title and not jd:
        return None

    required_keywords = split_keywords(row.get(FIELD_LABELS["required_keywords"]))
    department = clean_text(row.get(FIELD_LABELS["department"])) or None
    project = clean_text(row.get(FIELD_LABELS["project"])) or None
    expected_outputs = clean_text(row.get(FIELD_LABELS["expected_outputs"])) or None
    all_text = "\n".join(
        part
        for part in [
            title,
            department or "",
            project or "",
            jd,
            expected_outputs or "",
            " ".join(required_keywords),
        ]
        if part
    )
    concepts = extract_concepts_from_text(all_text)

    return {
        "job_id": f"job-{ordinal:03d}",
        "source_row": row_number,
        "title": title,
        "department": department,
        "project": project,
        "headcount": clean_int(row.get(FIELD_LABELS["headcount"])),
        "change_type": clean_text(row.get(FIELD_LABELS["change_type"])) or None,
        "hiring_type": clean_text(row.get(FIELD_LABELS["hiring_type"])) or None,
        "salary_min": clean_int(row.get(FIELD_LABELS["salary_min"])),
        "salary_max": clean_int(row.get(FIELD_LABELS["salary_max"])),
        "salary_months": clean_text(row.get(FIELD_LABELS["salary_months"])) or None,
        "start_time": clean_text(row.get(FIELD_LABELS["start_time"])) or None,
        "status": clean_text(row.get(FIELD_LABELS["status"])) or None,
        "platform": clean_text(row.get(FIELD_LABELS["platform"])) or None,
        "written_test_required": clean_text(row.get(FIELD_LABELS["written_test_required"])) or None,
        "required_keywords": required_keywords,
        "expected_outputs": expected_outputs,
        "jd": jd,
        "concepts": concepts,
    }


def _build_documents(job: dict[str, Any]) -> list[dict[str, Any]]:
    profile_parts = [
        f"岗位: {job['title']}",
        f"部门: {job['department']}" if job.get("department") else "",
        f"项目: {job['project']}" if job.get("project") else "",
        f"招聘类型: {job['hiring_type']}" if job.get("hiring_type") else "",
        f"岗位状态: {job['status']}" if job.get("status") else "",
        f"必备技能: {'、'.join(job['required_keywords'])}"
        if job.get("required_keywords")
        else "",
    ]
    documents = [
        {
            "doc_id": f"{job['job_id']}:profile",
            "job_id": job["job_id"],
            "title": f"{job['title']} 基本信息",
            "kind": "profile",
            "text": "\n".join(part for part in profile_parts if part),
            "concepts": job["concepts"],
        },
        {
            "doc_id": f"{job['job_id']}:jd",
            "job_id": job["job_id"],
            "title": f"{job['title']} JD",
            "kind": "jd",
            "text": job.get("jd") or "",
            "concepts": job["concepts"],
        },
    ]
    if job.get("expected_outputs"):
        documents.append(
            {
                "doc_id": f"{job['job_id']}:outputs",
                "job_id": job["job_id"],
                "title": f"{job['title']} 核心产出",
                "kind": "expected_outputs",
                "text": job["expected_outputs"],
                "concepts": job["concepts"],
            }
        )
    return [document for document in documents if document["text"]]


def build_knowledge_base(
    rows: list[dict[str, Any]],
    *,
    source_name: str,
    generated_at: str,
) -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []
    concept_job_ids: dict[str, set[str]] = defaultdict(set)

    for ordinal, row in enumerate(rows, start=1):
        row_number = int(row.get("_source_row") or ordinal + 1)
        job = _row_to_job(row, row_number, ordinal)
        if job is None:
            continue
        jobs.append(job)
        documents.extend(_build_documents(job))
        for concept in job["concepts"]:
            concept_job_ids[concept].add(job["job_id"])

    definitions_by_name = {
        definition["canonical"]: definition for definition in CONCEPT_DEFINITIONS
    }
    concepts = [
        {
            "canonical": canonical,
            "category": definitions_by_name[canonical]["category"],
            "aliases": sorted(set(definitions_by_name[canonical].get("aliases", []))),
            "frequency": len(job_ids),
            "job_ids": sorted(job_ids),
        }
        for canonical, job_ids in concept_job_ids.items()
    ]
    concepts.sort(key=lambda item: (-item["frequency"], item["category"], item["canonical"]))

    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "source": {
            "file_name": source_name,
            "row_count": len(rows),
            "job_count": len(jobs),
        },
        "jobs": jobs,
        "concepts": concepts,
        "documents": documents,
    }


def _empty_knowledge_base() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "generated_at": None,
        "source": {"file_name": None, "row_count": 0, "job_count": 0},
        "jobs": [],
        "concepts": [],
        "documents": [],
    }


def write_knowledge_base_to_sqlite(
    kb: dict[str, Any],
    *,
    db_path: Path | None = None,
) -> None:
    path = db_path or DATA_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    if temp_path.exists():
        temp_path.unlink()

    with sqlite3.connect(temp_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            """
            DROP TABLE IF EXISTS document_concepts;
            DROP TABLE IF EXISTS documents;
            DROP TABLE IF EXISTS job_concepts;
            DROP TABLE IF EXISTS concepts;
            DROP TABLE IF EXISTS jobs;
            DROP TABLE IF EXISTS metadata;

            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE jobs (
                job_id TEXT PRIMARY KEY,
                source_row INTEGER NOT NULL,
                title TEXT NOT NULL,
                department TEXT,
                project TEXT,
                headcount INTEGER,
                change_type TEXT,
                hiring_type TEXT,
                salary_min INTEGER,
                salary_max INTEGER,
                salary_months TEXT,
                start_time TEXT,
                status TEXT,
                platform TEXT,
                written_test_required TEXT,
                required_keywords_json TEXT NOT NULL,
                expected_outputs TEXT,
                jd TEXT NOT NULL
            );

            CREATE TABLE concepts (
                canonical TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                aliases_json TEXT NOT NULL,
                frequency INTEGER NOT NULL
            );

            CREATE TABLE job_concepts (
                job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
                canonical TEXT NOT NULL REFERENCES concepts(canonical) ON DELETE CASCADE,
                PRIMARY KEY (job_id, canonical)
            );

            CREATE TABLE documents (
                doc_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                kind TEXT NOT NULL,
                text TEXT NOT NULL
            );

            CREATE TABLE document_concepts (
                doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
                canonical TEXT NOT NULL REFERENCES concepts(canonical) ON DELETE CASCADE,
                PRIMARY KEY (doc_id, canonical)
            );

            CREATE INDEX idx_jobs_title ON jobs(title);
            CREATE INDEX idx_documents_job_id ON documents(job_id);
            CREATE INDEX idx_job_concepts_canonical ON job_concepts(canonical);
            """
        )

        source = kb.get("source", {})
        metadata = {
            "schema_version": str(kb.get("schema_version", 1)),
            "generated_at": str(kb.get("generated_at") or ""),
            "source_file_name": str(source.get("file_name") or ""),
            "source_row_count": str(source.get("row_count") or 0),
            "source_job_count": str(source.get("job_count") or 0),
        }
        connection.executemany(
            "INSERT INTO metadata (key, value) VALUES (?, ?)",
            metadata.items(),
        )

        connection.executemany(
            """
            INSERT INTO jobs (
                job_id, source_row, title, department, project, headcount,
                change_type, hiring_type, salary_min, salary_max, salary_months,
                start_time, status, platform, written_test_required,
                required_keywords_json, expected_outputs, jd
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    job["job_id"],
                    job["source_row"],
                    job["title"],
                    job.get("department"),
                    job.get("project"),
                    job.get("headcount"),
                    job.get("change_type"),
                    job.get("hiring_type"),
                    job.get("salary_min"),
                    job.get("salary_max"),
                    job.get("salary_months"),
                    job.get("start_time"),
                    job.get("status"),
                    job.get("platform"),
                    job.get("written_test_required"),
                    json.dumps(job.get("required_keywords", []), ensure_ascii=False),
                    job.get("expected_outputs"),
                    job.get("jd", ""),
                )
                for job in kb.get("jobs", [])
            ],
        )

        connection.executemany(
            """
            INSERT INTO concepts (canonical, category, aliases_json, frequency)
            VALUES (?, ?, ?, ?)
            """,
            [
                (
                    concept["canonical"],
                    concept["category"],
                    json.dumps(concept.get("aliases", []), ensure_ascii=False),
                    concept.get("frequency", 0),
                )
                for concept in kb.get("concepts", [])
            ],
        )
        connection.executemany(
            "INSERT INTO job_concepts (job_id, canonical) VALUES (?, ?)",
            [
                (job["job_id"], concept)
                for job in kb.get("jobs", [])
                for concept in job.get("concepts", [])
            ],
        )

        connection.executemany(
            """
            INSERT INTO documents (doc_id, job_id, title, kind, text)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    document["doc_id"],
                    document["job_id"],
                    document["title"],
                    document["kind"],
                    document["text"],
                )
                for document in kb.get("documents", [])
            ],
        )
        connection.executemany(
            "INSERT INTO document_concepts (doc_id, canonical) VALUES (?, ?)",
            [
                (document["doc_id"], concept)
                for document in kb.get("documents", [])
                for concept in document.get("concepts", [])
            ],
        )

    temp_path.replace(path)


def load_knowledge_base_from_sqlite(db_path: Path | None = None) -> dict[str, Any]:
    path = db_path or DATA_PATH
    if not path.exists():
        return _empty_knowledge_base()

    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        metadata = {
            row["key"]: row["value"]
            for row in connection.execute("SELECT key, value FROM metadata")
        }

        job_concepts: dict[str, list[str]] = defaultdict(list)
        concept_job_ids: dict[str, list[str]] = defaultdict(list)
        for row in connection.execute(
            "SELECT job_id, canonical FROM job_concepts ORDER BY canonical"
        ):
            job_concepts[row["job_id"]].append(row["canonical"])
            concept_job_ids[row["canonical"]].append(row["job_id"])

        document_concepts: dict[str, list[str]] = defaultdict(list)
        for row in connection.execute(
            "SELECT doc_id, canonical FROM document_concepts ORDER BY canonical"
        ):
            document_concepts[row["doc_id"]].append(row["canonical"])

        jobs = [
            {
                "job_id": row["job_id"],
                "source_row": row["source_row"],
                "title": row["title"],
                "department": row["department"],
                "project": row["project"],
                "headcount": row["headcount"],
                "change_type": row["change_type"],
                "hiring_type": row["hiring_type"],
                "salary_min": row["salary_min"],
                "salary_max": row["salary_max"],
                "salary_months": row["salary_months"],
                "start_time": row["start_time"],
                "status": row["status"],
                "platform": row["platform"],
                "written_test_required": row["written_test_required"],
                "required_keywords": json.loads(row["required_keywords_json"]),
                "expected_outputs": row["expected_outputs"],
                "jd": row["jd"],
                "concepts": job_concepts[row["job_id"]],
            }
            for row in connection.execute("SELECT * FROM jobs ORDER BY job_id")
        ]
        concepts = [
            {
                "canonical": row["canonical"],
                "category": row["category"],
                "aliases": json.loads(row["aliases_json"]),
                "frequency": row["frequency"],
                "job_ids": concept_job_ids[row["canonical"]],
            }
            for row in connection.execute(
                """
                SELECT * FROM concepts
                ORDER BY frequency DESC, category ASC, canonical ASC
                """
            )
        ]
        documents = [
            {
                "doc_id": row["doc_id"],
                "job_id": row["job_id"],
                "title": row["title"],
                "kind": row["kind"],
                "text": row["text"],
                "concepts": document_concepts[row["doc_id"]],
            }
            for row in connection.execute("SELECT * FROM documents ORDER BY doc_id")
        ]

    return {
        "schema_version": int(metadata.get("schema_version") or 1),
        "generated_at": metadata.get("generated_at") or None,
        "source": {
            "file_name": metadata.get("source_file_name") or None,
            "row_count": int(metadata.get("source_row_count") or 0),
            "job_count": int(metadata.get("source_job_count") or 0),
        },
        "jobs": jobs,
        "concepts": concepts,
        "documents": documents,
    }


def load_default_knowledge_base() -> dict[str, Any]:
    return load_knowledge_base_from_sqlite()



def summarize_knowledge_base(kb: dict[str, Any]) -> dict[str, Any]:
    concepts = kb.get("concepts", [])
    return {
        "schema_version": kb.get("schema_version", 1),
        "generated_at": kb.get("generated_at"),
        "source": kb.get("source", {}),
        "total_jobs": len(kb.get("jobs", [])),
        "total_concepts": len(concepts),
        "top_concepts": concepts[:12],
    }


def _query_terms(query: str) -> list[str]:
    normalized_query = normalize_text(query)
    raw_terms = re.split(r"[\s,，、;；/|]+", normalized_query)
    terms = [term for term in raw_terms if len(term) >= 2]
    if query.strip():
        terms.insert(0, query.strip())
    return list(dict.fromkeys(terms))


def _score_text(text: str, terms: list[str]) -> int:
    normalized = normalize_text(text)
    compact = compact_text(text)
    score = 0
    for term in terms:
        term_normalized = normalize_text(term)
        if term_normalized in normalized:
            score += 3
        elif compact_text(term) in compact:
            score += 2
    return score


def search_knowledge_base(
    query: str,
    *,
    limit: int,
    kb: dict[str, Any] | None = None,
) -> dict[str, Any]:
    kb = kb or load_default_knowledge_base()
    terms = _query_terms(query)
    query_concepts = set(extract_concepts_from_text(query))
    documents_by_job: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for document in kb.get("documents", []):
        documents_by_job[document["job_id"]].append(document)

    concept_hits = []
    for concept in kb.get("concepts", []):
        aliases = [concept["canonical"], *concept.get("aliases", [])]
        if concept["canonical"] in query_concepts or any(
            _contains_alias(query, alias) for alias in aliases
        ):
            concept_hits.append(concept)

    job_hits = []
    for job in kb.get("jobs", []):
        matched_concepts = sorted(set(job.get("concepts", [])) & query_concepts)
        score = 8 * len(matched_concepts)
        score += _score_text(job.get("title", ""), terms) * 2
        score += _score_text(" ".join(job.get("required_keywords", [])), terms) * 2
        best_document = None
        best_document_score = 0
        for document in documents_by_job.get(job["job_id"], []):
            document_score = _score_text(document.get("text", ""), terms)
            document_score += 2 * len(set(document.get("concepts", [])) & query_concepts)
            if document_score > best_document_score:
                best_document_score = document_score
                best_document = document
        score += best_document_score
        if score <= 0:
            continue
        snippet_source = best_document.get("text", "") if best_document else job.get("jd", "")
        job_hits.append(
            {
                "job_id": job["job_id"],
                "title": job["title"],
                "department": job.get("department"),
                "project": job.get("project"),
                "status": job.get("status"),
                "score": score,
                "matched_concepts": matched_concepts,
                "required_keywords": job.get("required_keywords", []),
                "snippet": _first_snippet(snippet_source, query),
            }
        )

    job_hits.sort(key=lambda item: (-item["score"], item["job_id"]))
    return {
        "query": query,
        "concepts": concept_hits[:limit],
        "jobs": job_hits[:limit],
    }
