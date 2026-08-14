from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.knowledge_base import (
    KNOWLEDGE_BASE_SCHEMA_VERSION,
    build_knowledge_base,
    get_job_detail,
    knowledge_base_needs_rebuild,
    list_job_options,
    load_knowledge_base_from_sqlite,
    quality_report_for,
    search_knowledge_base,
    write_knowledge_base_to_sqlite,
)
from backend.app.main import app


client = TestClient(app)


def test_build_knowledge_base_extracts_concepts_from_jd() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、LangChain、RAG、MySQL，参与 AI Agent 应用开发。",
                "岗位关键词（必备技能）": "Python、RAG",
                "入职部门": "AI4S模型研究院",
                "所属项目": "科研智能体",
                "需求数量": 1,
                "招聘类型": "正职",
                "岗位状态": "招聘中",
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    assert kb["source"] == {
        "file_name": "fixture.xlsx",
        "row_count": 1,
        "job_count": 1,
    }
    assert kb["jobs"][0]["required_keywords"] == ["Python", "RAG"]
    assert set(kb["jobs"][0]["concepts"]) >= {
        "AI4S",
        "AI智能体",
        "Python",
        "LangChain",
        "RAG",
        "MySQL",
    }
    assert {document["kind"] for document in kb["documents"]} >= {"profile", "jd"}
    assert set(kb["jobs"][0]["profile"]["required_concepts"]) >= {
        "AI4S",
        "AI智能体",
        "Python",
        "RAG",
    }
    assert kb["quality_report"]["imported_jobs"] == 1


def test_build_knowledge_base_adds_bio_authority_evaluation_materials() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 生物信息学科学家",
                "岗位jd": "负责生命科学、药物研发和生物信息学方向的 AI4S 模型评估。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    material = next(
        item for item in profile["evaluation_materials"]
        if item["material_id"] == "bio-authoritative-publications"
    )
    assert {"Nature", "Cell", "Science"}.issubset(set(material["signals"]))
    assert any(document["kind"] == "evaluation_materials" for document in kb["documents"])


def test_search_knowledge_base_returns_relevant_jobs() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "负责 Java、Spring Boot、Redis、Kafka 高并发系统开发。",
                "需求数量": 1,
            },
            {
                "_source_row": 3,
                "岗位名称": "视觉设计师",
                "岗位jd": "负责 Figma、UI设计、品牌视觉设计。",
                "需求数量": 1,
            },
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    result = search_knowledge_base("SpringBoot Redis", limit=3, kb=kb)

    assert result["jobs"][0]["title"] == "后端工程师"
    assert result["jobs"][0]["matched_concepts"] == ["Redis", "Spring Boot"]
    assert {concept["canonical"] for concept in result["concepts"]} >= {
        "Redis",
        "Spring Boot",
    }


def test_build_knowledge_base_splits_required_and_preferred_profile() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": (
                    "任职要求 本科及以上学历，3年以上经验，熟悉 Java、Spring Boot、Redis。"
                    "加分项 有 RAG 或 AI Agent 项目经验。"
                ),
                "需求数量": 1,
                "岗位状态": "招聘中",
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    assert set(profile["required_concepts"]) >= {"Java", "Spring Boot", "Redis"}
    assert set(profile["preferred_concepts"]) >= {"RAG", "AI智能体"}
    assert profile["experience_years_min"] == 3
    assert profile["education_keywords"] == ["本科"]


def test_build_knowledge_base_adds_related_and_bonus_profile_concepts() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "全栈开发工程师",
                "岗位jd": "本科及以上学历，熟悉 JavaScript、Node.js、React。",
                "岗位关键词（必备技能）": "JavaScript、Node.js、React",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    assert set(profile["required_concepts"]) >= {"JavaScript", "Node.js", "React"}
    assert set(profile["related_concepts"]) >= {"TypeScript", "Vue", "Java", "REST API"}
    assert set(profile["bonus_concepts"]) >= {"Docker", "CI/CD", "接口测试"}
    assert not set(profile["related_concepts"]).intersection(profile["required_concepts"])
    assert not set(profile["bonus_concepts"]).intersection(profile["required_concepts"])


def test_profile_education_and_years_ignore_preferred_segment() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": (
                    "任职要求 本科及以上学历，熟悉 Java、Spring Boot。"
                    "加分项 博士优先，5年以上经验优先，有 RAG 项目经验。"
                ),
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    assert profile["education_keywords"] == ["本科"]
    assert profile["experience_years_min"] is None
    assert set(profile["preferred_concepts"]) >= {"RAG"}


def test_profile_education_and_years_ignore_local_preferred_phrases() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "本科及以上学历，博士优先，5年以上经验优先，熟悉 Java、Spring Boot。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    assert profile["education_keywords"] == ["本科"]
    assert profile["experience_years_min"] is None


def test_profile_education_and_years_ignore_prefix_preferred_phrases() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "本科及以上学历，优先考虑博士，优先考虑 5 年以上经验，熟悉 Java。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    assert profile["education_keywords"] == ["本科"]
    assert profile["experience_years_min"] is None
    assert set(profile["required_concepts"]) >= {"Java"}


def test_profile_local_preferred_degree_does_not_hide_required_degree() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "本科及以上学历博士优先，熟悉 Java。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    assert kb["jobs"][0]["profile"]["education_keywords"] == ["本科"]


def test_profile_splits_title_style_youxiangkaolu_marker() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": (
                    "本科及以上学历，熟悉 Java、Spring Boot。"
                    "优先考虑：有 RAG 项目经验。"
                ),
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    profile = kb["jobs"][0]["profile"]
    assert set(profile["required_concepts"]) >= {"Java", "Spring Boot"}
    assert set(profile["preferred_concepts"]) >= {"RAG"}


def test_profile_extracts_dazhuan_education_keyword() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "测试工程师",
                "岗位jd": "大专及以上学历，熟悉接口测试和自动化测试。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    assert kb["jobs"][0]["profile"]["education_keywords"] == ["大专"]


def test_engineering_aliases_cover_common_resume_and_jd_phrases() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "全栈测试开发工程师",
                "岗位jd": "熟悉 NodeJS、Vue.js、React Hooks、RESTful 接口和测开经验。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    concepts = set(kb["jobs"][0]["concepts"])
    assert {"Node.js", "Vue", "React", "REST API", "自动化测试"}.issubset(concepts)
    aliases = {
        concept["canonical"]: set(concept["aliases"])
        for concept in kb["concepts"]
    }
    assert "NodeJS" in aliases["Node.js"]
    assert "测开" in aliases["自动化测试"]


def test_quality_report_surfaces_unrecognized_high_frequency_terms() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "平台工程师",
                "岗位jd": "负责 GraphQL 网关和 Playwright 自动化。",
                "需求数量": 1,
            },
            {
                "_source_row": 3,
                "岗位名称": "前端工程师",
                "岗位jd": "负责 GraphQL BFF、Playwright 测试和 React 页面。",
                "需求数量": 1,
            },
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    terms = {item["term"]: item for item in quality_report_for(kb)["unrecognized_terms"]}
    assert terms["GraphQL"]["frequency"] == 2
    assert terms["Playwright"]["frequency"] == 2


def test_ai4s_domain_terms_are_recognized_as_standard_concepts() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 分子模拟工程师",
                "岗位jd": (
                    "熟悉 GROMACS、AMBER、FEP、AutoDock、PDB、RFdiffusion、"
                    "AlphaFold、OpenFold、RoseTTAFold、ProteinMPNN、BoltzGen、ESM、RDKit、PyMOL、"
                    "Biopython、pdbfixer、MolStar、ADMET、OpenMM、Sponge、"
                    "MSA、FASTA、VASP、LAMMPS、NAMD、ORCA、Gaussian、CP2K、ABACUS、"
                    "RNA-seq、CDMO、ADC、C++、MATLAB、FAISS、Transformer、JAX、TensorFlow、YOLO、DDP、DeepSpeed、"
                    "Slurm、HPC、Apptainer 和 GPU 计算。"
                ),
                "需求数量": 1,
            },
            {
                "_source_row": 3,
                "岗位名称": "AI4Science 计算平台工程师",
                "岗位jd": (
                    "负责 AI4Science 平台、Shell 脚本、GitHub 协作、MUI 页面、"
                    "REST API、JSON、Docker Compose、DevOps、UAT、Workflow、Axure 原型、"
                    "Excel 数据整理、PPT 汇报、Canva 视觉物料、KOC 内容增长、"
                    "Cursor、ChatGPT、PMP 项目管理和 CRO 行业 Demo/PoC 方案，"
                    "内部平台 Mokda、GaliLeo 与 Engineering/AI+ 泛词不作为候选人能力。"
                ),
                "需求数量": 1,
            },
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    concepts = set(kb["jobs"][0]["concepts"]) | set(kb["jobs"][1]["concepts"])
    assert {
        "AI4S",
        "GROMACS",
        "AMBER",
        "FEP",
        "AutoDock",
        "PDB",
        "RFdiffusion",
        "AlphaFold",
        "OpenFold",
        "RoseTTAFold",
        "ESM",
        "ProteinMPNN",
        "BoltzGen",
        "RDKit",
        "Biopython",
        "pdbfixer",
        "PyMOL",
        "MolStar",
        "ADMET",
        "MSA",
        "FASTA",
        "OpenMM",
        "VASP",
        "LAMMPS",
        "Sponge",
        "NAMD",
        "ORCA",
        "Gaussian",
        "CP2K",
        "ABACUS",
        "组学分析",
        "CRO行业",
        "ADC药物",
        "C++",
        "MATLAB",
        "AI辅助编程",
        "FAISS",
        "Transformer",
        "JAX",
        "TensorFlow",
        "计算机视觉",
        "分布式训练",
        "DeepSpeed",
        "Slurm",
        "HPC集群",
        "Apptainer",
        "GPU计算",
        "Shell",
        "REST API",
        "JSON",
        "Docker",
        "CI/CD",
        "UAT",
        "MUI",
        "GitHub",
        "工作流",
        "Axure",
        "Excel",
        "PPT",
        "Canva",
        "PMP",
        "KOC运营",
        "PoC验证",
        "CRO行业",
    }.issubset(concepts)
    terms = {item["term"] for item in quality_report_for(kb)["unrecognized_terms"]}
    assert not {
        "GROMACS",
        "AMBER",
        "FEP",
        "AutoDock",
        "VASP",
        "LAMMPS",
        "OpenFold",
        "RoseTTAFold",
        "ProteinMPNN",
        "BoltzGen",
        "RDKit",
        "Biopython",
        "pdbfixer",
        "PyMol",
        "MolStar",
        "ADMET",
        "OpenMM",
        "Sponge",
        "NAMD",
        "ORCA",
        "Gaussian",
        "CP2K",
        "ABACUS",
        "RNA-seq",
        "CDMO",
        "ADC",
        "C++",
        "MATLAB",
        "Transformer",
        "JAX",
        "TensorFlow",
        "YOLO",
        "DDP",
        "Slurm",
        "HPC",
        "Apptainer",
        "REST",
        "DevOps",
        "UAT",
        "Compose",
        "JSON",
        "Workflow",
        "MUI",
        "GitHub",
        "Axure",
        "Excel",
        "PPT",
        "Canva",
        "PMP",
        "KOC",
        "PoC",
        "Demo",
        "Cursor",
        "ChatGPT",
        "Mokda",
        "GaliLeo",
        "AI+",
        "Engineering",
        "Models",
    }.intersection(terms)


def test_search_knowledge_base_has_fixed_alias_eval_for_engineering_query() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "全栈测试开发工程师",
                "岗位jd": "熟悉 NodeJS、Vue.js、RESTful 接口和测开经验。",
                "需求数量": 1,
            },
            {
                "_source_row": 3,
                "岗位名称": "视觉设计师",
                "岗位jd": "负责 Figma、视觉设计和品牌物料。",
                "需求数量": 1,
            },
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    result = search_knowledge_base("NodeJS Vue.js 测开", limit=2, kb=kb)

    assert result["jobs"][0]["title"] == "全栈测试开发工程师"
    assert set(result["jobs"][0]["matched_concepts"]) >= {"Node.js", "Vue", "自动化测试"}


def test_quality_report_summarizes_import_warnings() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "重复岗位",
                "岗位jd": "需要 Python。",
                "岗位状态": "招聘中",
            },
            {
                "_source_row": 3,
                "岗位名称": "重复岗位",
                "岗位jd": "需要 Redis。",
                "岗位状态": "暂停招聘",
            },
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    report = quality_report_for(kb)

    assert report["total_rows"] == 2
    assert report["imported_jobs"] == 2
    assert report["status_counts"] == {"招聘中": 1, "暂停招聘": 1}
    assert [job["title"] for job in report["missing_required_keyword_jobs"]] == ["重复岗位", "重复岗位"]
    assert report["missing_required_keyword_jobs"][0]["source_row"] == 2
    assert report["missing_required_keyword_jobs"][0]["suggested_keywords"] == ["Python"]
    assert any(warning["code"] == "duplicate_title" for warning in report["warnings"])
    assert any(warning["code"] == "missing_required_keywords" for warning in report["warnings"])


def test_sqlite_storage_round_trips_knowledge_base(tmp_path) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "负责 Java、Spring Boot、Redis、Kafka 高并发系统开发。",
                "需求数量": 1,
                "岗位状态": "招聘中",
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    db_path = tmp_path / "job_knowledge_base.sqlite3"

    write_knowledge_base_to_sqlite(kb, db_path=db_path)
    loaded = load_knowledge_base_from_sqlite(db_path)

    assert loaded["source"] == {
        "file_name": "fixture.xlsx",
        "row_count": 1,
        "job_count": 1,
    }
    assert loaded["schema_version"] == KNOWLEDGE_BASE_SCHEMA_VERSION
    assert not knowledge_base_needs_rebuild(loaded)
    assert loaded["jobs"][0]["title"] == "后端工程师"
    assert set(loaded["jobs"][0]["concepts"]) >= {"Java", "Spring Boot", "Redis", "Kafka"}
    assert set(loaded["jobs"][0]["profile"]["required_concepts"]) >= {
        "Java",
        "Spring Boot",
        "Redis",
        "Kafka",
    }
    assert loaded["documents"][0]["job_id"] == "job-001"
    assert loaded["quality_report"]["imported_jobs"] == 1


def test_knowledge_base_schema_guard_marks_old_sqlite_as_stale(tmp_path) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "负责 Java 开发。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    kb["schema_version"] = KNOWLEDGE_BASE_SCHEMA_VERSION - 1
    db_path = tmp_path / "old_job_knowledge_base.sqlite3"

    write_knowledge_base_to_sqlite(kb, db_path=db_path)
    loaded = load_knowledge_base_from_sqlite(db_path)

    assert knowledge_base_needs_rebuild(loaded)


def test_get_job_detail_includes_documents_and_profile() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    detail = get_job_detail("job-001", kb=kb)

    assert detail is not None
    assert detail["title"] == "AI4S 工程师"
    assert detail["profile"]["required_concepts"]
    assert {document["kind"] for document in detail["documents"]} >= {"profile", "jd"}
    assert get_job_detail("job-999", kb=kb) is None


def test_list_job_options_returns_lightweight_job_rows() -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "后端工程师",
                "岗位jd": "熟悉 Java。",
                "入职部门": "工程中心",
                "所属项目": "平台",
                "岗位状态": "招聘中",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    assert list_job_options(limit=5, kb=kb) == [
        {
            "job_id": "job-001",
            "title": "后端工程师",
            "department": "工程中心",
            "project": "平台",
            "status": "招聘中",
        }
    ]


def test_knowledge_summary_endpoint_returns_loaded_kb(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "load_default_knowledge_base",
        lambda: build_knowledge_base(
            [
                {
                    "_source_row": 2,
                    "岗位名称": "AI4S 工程师",
                    "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                    "需求数量": 1,
                }
            ],
            source_name="fixture.xlsx",
            generated_at="2026-08-11T00:00:00+00:00",
        ),
    )

    response = client.get(
        "/v1/knowledge/summary",
        headers={"X-Request-ID": "kb-summary-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-summary-1"
    assert body["source"]["file_name"] == "fixture.xlsx"
    assert body["total_jobs"] == 1
    assert body["total_concepts"] >= 3
    assert body["top_concepts"]


def test_knowledge_quality_endpoint_returns_loaded_report(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "load_default_knowledge_base",
        lambda: build_knowledge_base(
            [
                {
                    "_source_row": 2,
                    "岗位名称": "AI4S 工程师",
                    "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                    "需求数量": 1,
                }
            ],
            source_name="fixture.xlsx",
            generated_at="2026-08-11T00:00:00+00:00",
        ),
    )

    response = client.get(
        "/v1/knowledge/quality",
        headers={"X-Request-ID": "kb-quality-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-quality-1"
    assert body["report"]["imported_jobs"] == 1
    assert body["report"]["warning_count"] >= 1


def test_knowledge_search_endpoint_returns_matches(monkeypatch) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )

    monkeypatch.setattr(
        main,
        "search_knowledge_base",
        lambda query, limit: search_knowledge_base(query, limit=limit, kb=kb),
    )

    response = client.get(
        "/v1/knowledge/search",
        headers={"X-Request-ID": "kb-search-1"},
        params={"query": "AI4S RAG Python", "limit": 5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-search-1"
    assert body["query"] == "AI4S RAG Python"
    assert body["jobs"]
    assert any(concept["canonical"] == "Python" for concept in body["concepts"])


def test_knowledge_jobs_endpoint_returns_job_options(monkeypatch) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                "入职部门": "AI4S模型研究院",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    monkeypatch.setattr(main, "load_default_knowledge_base", lambda: kb)

    response = client.get(
        "/v1/knowledge/jobs",
        headers={"X-Request-ID": "kb-jobs-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-jobs-1"
    assert body["jobs"] == [
        {
            "job_id": "job-001",
            "title": "AI4S 工程师",
            "department": "AI4S模型研究院",
            "project": None,
            "status": None,
        }
    ]


def test_knowledge_job_detail_endpoint_returns_profile(monkeypatch) -> None:
    kb = build_knowledge_base(
        [
            {
                "_source_row": 2,
                "岗位名称": "AI4S 工程师",
                "岗位jd": "熟悉 Python、RAG 和 AI智能体。",
                "需求数量": 1,
            }
        ],
        source_name="fixture.xlsx",
        generated_at="2026-08-11T00:00:00+00:00",
    )
    monkeypatch.setattr(main, "get_job_detail", lambda job_id: get_job_detail(job_id, kb=kb))

    response = client.get(
        "/v1/knowledge/jobs/job-001",
        headers={"X-Request-ID": "kb-job-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "kb-job-1"
    assert body["title"] == "AI4S 工程师"
    assert body["profile"]["required_concepts"]
    assert {document["kind"] for document in body["documents"]} >= {"profile", "jd"}

    missing = client.get("/v1/knowledge/jobs/job-999")
    assert missing.status_code == 404
