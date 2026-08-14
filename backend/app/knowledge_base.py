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
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


DATA_PATH = Path(__file__).parent / "data" / "job_knowledge_base.sqlite3"
KNOWLEDGE_BASE_SCHEMA_VERSION = 13


CONCEPT_DEFINITIONS: list[dict[str, Any]] = [
    {
        "canonical": "AI4S",
        "category": "ai_llm",
        "aliases": ["AI4S", "AI for Science", "AI4Science", "AI科学", "科学智能"],
    },
    {
        "canonical": "AI智能体",
        "category": "ai_llm",
        "aliases": ["AI智能体", "智能体", "Agent", "AI Agent", "LLM Agent", "Agent应用"],
    },
    {
        "canonical": "大模型",
        "category": "ai_llm",
        "aliases": [
            "大模型",
            "大语言模型",
            "LLM",
            "Large Language Model",
            "Large Language Models",
            "生成式AI",
            "AIGC",
            "ChatGPT",
        ],
    },
    {
        "canonical": "AI辅助编程",
        "category": "ai_llm",
        "aliases": ["AI辅助编程", "AI 编程", "Cursor", "GitHub Copilot"],
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
        "canonical": "Transformer",
        "category": "ai_llm",
        "aliases": ["Transformer", "Transformer模型", "Transformer Model", "Transformer Models"],
    },
    {
        "canonical": "PyTorch",
        "category": "ai_llm",
        "aliases": ["PyTorch", "torch"],
    },
    {
        "canonical": "JAX",
        "category": "ai_llm",
        "aliases": ["JAX"],
    },
    {
        "canonical": "TensorFlow",
        "category": "ai_llm",
        "aliases": ["TensorFlow"],
    },
    {
        "canonical": "计算机视觉",
        "category": "ai_llm",
        "aliases": ["计算机视觉", "Computer Vision", "CV", "YOLO", "UNet", "U-Net", "ResNet"],
    },
    {
        "canonical": "分布式训练",
        "category": "ai_llm",
        "aliases": ["分布式训练", "DDP", "DistributedDataParallel", "Distributed Data Parallel"],
    },
    {
        "canonical": "DeepSpeed",
        "category": "ai_llm",
        "aliases": ["DeepSpeed"],
    },
    {
        "canonical": "FAISS",
        "category": "ai_llm",
        "aliases": ["FAISS", "向量检索", "向量索引"],
    },
    {
        "canonical": "扩散模型",
        "category": "ai_llm",
        "aliases": ["Diffusion", "Diffusion Model", "扩散模型"],
    },
    {
        "canonical": "GPU计算",
        "category": "ai_llm",
        "aliases": ["GPU", "GPU计算", "GPU 加速", "CUDA"],
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
        "canonical": "组学分析",
        "category": "bio_ai",
        "aliases": ["组学分析", "RNA-seq", "单细胞", "空间转录组", "ATAC", "GWAS", "甲基化", "蛋白组", "代谢组"],
    },
    {
        "canonical": "蛋白结构预测",
        "category": "bio_ai",
        "aliases": ["蛋白结构预测", "蛋白质结构预测", "蛋白结构"],
    },
    {
        "canonical": "蛋白质",
        "category": "bio_ai",
        "aliases": ["蛋白质", "Protein"],
    },
    {
        "canonical": "AlphaFold",
        "category": "bio_ai",
        "aliases": ["AlphaFold", "AlphaFold2"],
    },
    {
        "canonical": "OpenFold",
        "category": "bio_ai",
        "aliases": ["OpenFold"],
    },
    {
        "canonical": "RoseTTAFold",
        "category": "bio_ai",
        "aliases": ["RoseTTAFold"],
    },
    {
        "canonical": "ESM",
        "category": "bio_ai",
        "aliases": ["ESM", "ESMFold", "ESM-2"],
    },
    {
        "canonical": "ProteinMPNN",
        "category": "bio_ai",
        "aliases": ["ProteinMPNN", "Protein MPNN"],
    },
    {
        "canonical": "BoltzGen",
        "category": "bio_ai",
        "aliases": ["BoltzGen"],
    },
    {
        "canonical": "RFdiffusion",
        "category": "bio_ai",
        "aliases": ["RFdiffusion", "RF diffusion"],
    },
    {
        "canonical": "BindCraft",
        "category": "bio_ai",
        "aliases": ["BindCraft"],
    },
    {
        "canonical": "AutoDock",
        "category": "bio_ai",
        "aliases": ["AutoDock", "AutoDock Vina", "Vina", "分子对接"],
    },
    {
        "canonical": "RDKit",
        "category": "bio_ai",
        "aliases": ["RDKit"],
    },
    {
        "canonical": "Biopython",
        "category": "bio_ai",
        "aliases": ["Biopython", "BioPython"],
    },
    {
        "canonical": "pdbfixer",
        "category": "bio_ai",
        "aliases": ["pdbfixer", "PDBFixer"],
    },
    {
        "canonical": "PyMOL",
        "category": "bio_ai",
        "aliases": ["PyMOL", "PyMol"],
    },
    {
        "canonical": "MolStar",
        "category": "bio_ai",
        "aliases": ["MolStar", "MolStar plugin"],
    },
    {
        "canonical": "ADMET",
        "category": "bio_ai",
        "aliases": ["ADMET", "虚拟筛选", "SMILES", "SDF"],
    },
    {
        "canonical": "PDB",
        "category": "bio_ai",
        "aliases": ["PDB", "Protein Data Bank", "蛋白质结构数据库"],
    },
    {
        "canonical": "MSA",
        "category": "bio_ai",
        "aliases": ["MSA", "多序列比对", "Multiple Sequence Alignment"],
    },
    {
        "canonical": "FASTA",
        "category": "bio_ai",
        "aliases": ["FASTA"],
    },
    {
        "canonical": "分子动力学",
        "category": "bio_ai",
        "aliases": ["分子动力学", "Molecular Dynamics", "MD模拟"],
    },
    {
        "canonical": "OpenMM",
        "category": "simulation",
        "aliases": ["OpenMM"],
    },
    {
        "canonical": "药物研发",
        "category": "bio_ai",
        "aliases": ["药物研发", "医药研发", "新药研发"],
    },
    {
        "canonical": "ADC药物",
        "category": "bio_ai",
        "aliases": ["ADC", "ADC药物", "抗体偶联药物"],
    },
    {
        "canonical": "CRO行业",
        "category": "sales_solution",
        "aliases": ["CRO", "CRO行业", "医药CRO", "CDMO"],
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
        "canonical": "GROMACS",
        "category": "simulation",
        "aliases": ["GROMACS", "Gromacs"],
    },
    {
        "canonical": "AMBER",
        "category": "simulation",
        "aliases": ["AMBER", "Amber"],
    },
    {
        "canonical": "FEP",
        "category": "simulation",
        "aliases": ["FEP", "自由能微扰", "Free Energy Perturbation"],
    },
    {
        "canonical": "VASP",
        "category": "simulation",
        "aliases": ["VASP"],
    },
    {
        "canonical": "LAMMPS",
        "category": "simulation",
        "aliases": ["LAMMPS"],
    },
    {
        "canonical": "Sponge",
        "category": "simulation",
        "aliases": ["Sponge", "SPONGE"],
    },
    {
        "canonical": "NAMD",
        "category": "simulation",
        "aliases": ["NAMD"],
    },
    {
        "canonical": "DFT计算",
        "category": "simulation",
        "aliases": ["DFT", "DFT计算", "密度泛函理论", "第一性原理", "量子化学计算"],
    },
    {
        "canonical": "ORCA",
        "category": "simulation",
        "aliases": ["ORCA"],
    },
    {
        "canonical": "Gaussian",
        "category": "simulation",
        "aliases": ["Gaussian"],
    },
    {
        "canonical": "CP2K",
        "category": "simulation",
        "aliases": ["CP2K"],
    },
    {
        "canonical": "ABACUS",
        "category": "simulation",
        "aliases": ["ABACUS"],
    },
    {
        "canonical": "Python",
        "category": "programming_language",
        "aliases": ["Python"],
    },
    {
        "canonical": "Java",
        "category": "programming_language",
        "aliases": ["Java", "Java后端", "Java 后端", "Java开发", "Java 开发", "J2EE"],
    },
    {
        "canonical": "C语言",
        "category": "programming_language",
        "aliases": ["C语言", "C 语言"],
    },
    {
        "canonical": "C++",
        "category": "programming_language",
        "aliases": ["C++", "C/C++", "CPP"],
    },
    {
        "canonical": "MATLAB",
        "category": "programming_language",
        "aliases": ["MATLAB"],
    },
    {
        "canonical": "JavaScript",
        "category": "programming_language",
        "aliases": ["JavaScript", "JS", "ECMAScript", "ES6"],
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
        "aliases": ["REST", "REST API", "RESTful", "接口开发", "API开发", "API 接口", "API接口", "接口联调"],
    },
    {
        "canonical": "JSON",
        "category": "backend",
        "aliases": ["JSON"],
    },
    {
        "canonical": "高并发调优",
        "category": "backend",
        "aliases": ["高并发", "高并发调优", "性能调优", "系统调优"],
    },
    {
        "canonical": "Vue",
        "category": "frontend",
        "aliases": ["Vue", "Vue.js", "Vue2", "Vue 2", "Vue3", "Vue 3"],
    },
    {
        "canonical": "React",
        "category": "frontend",
        "aliases": ["React", "React.js", "ReactJS", "React Hooks"],
    },
    {
        "canonical": "HTML/CSS",
        "category": "frontend",
        "aliases": ["HTML", "CSS", "HTML/CSS", "HTML/CSS/JS"],
    },
    {
        "canonical": "Web开发",
        "category": "frontend",
        "aliases": ["Web", "Web开发", "Web前端", "Web应用"],
    },
    {
        "canonical": "MUI",
        "category": "frontend",
        "aliases": ["MUI", "Material UI", "Material-UI"],
    },
    {
        "canonical": "UniApp",
        "category": "frontend",
        "aliases": ["uni-app", "UniApp", "跨端开发"],
    },
    {
        "canonical": "Node.js",
        "category": "frontend",
        "aliases": ["Node.js", "nodejs", "node", "NodeJS", "Node 服务", "Node后端"],
    },
    {
        "canonical": "Linux",
        "category": "devops",
        "aliases": ["Linux"],
    },
    {
        "canonical": "Shell",
        "category": "devops",
        "aliases": ["Shell", "Shell脚本", "Bash"],
    },
    {
        "canonical": "Docker",
        "category": "devops",
        "aliases": ["Docker", "Docker Compose", "Compose", "容器化"],
    },
    {
        "canonical": "Kubernetes",
        "category": "devops",
        "aliases": ["Kubernetes", "K8s"],
    },
    {
        "canonical": "HPC集群",
        "category": "devops",
        "aliases": ["HPC", "高性能计算", "计算集群"],
    },
    {
        "canonical": "Slurm",
        "category": "devops",
        "aliases": ["Slurm"],
    },
    {
        "canonical": "Apptainer",
        "category": "devops",
        "aliases": ["Apptainer", "Singularity"],
    },
    {
        "canonical": "Git",
        "category": "devops",
        "aliases": ["Git", "版本管理", "代码版本管理"],
    },
    {
        "canonical": "GitHub",
        "category": "devops",
        "aliases": ["GitHub"],
    },
    {
        "canonical": "CI/CD",
        "category": "devops",
        "aliases": ["CI/CD", "DevOps", "Jenkins", "GitLab CI", "自动化部署"],
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
        "aliases": ["自动化测试", "测试自动化", "测试开发", "测开", "接口自动化", "自动化用例"],
    },
    {
        "canonical": "接口测试",
        "category": "testing",
        "aliases": ["接口测试", "接口调试", "接口自动化", "API测试", "API 测试", "接口联调"],
    },
    {
        "canonical": "UAT",
        "category": "testing",
        "aliases": ["UAT", "用户验收测试", "验收测试"],
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
        "canonical": "工作流",
        "category": "product_pm",
        "aliases": ["Workflow", "工作流", "业务流程"],
    },
    {
        "canonical": "PoC验证",
        "category": "product_pm",
        "aliases": ["PoC", "POC", "PoC验证", "POC验证", "概念验证", "Demo", "产品演示"],
    },
    {
        "canonical": "PMP",
        "category": "product_pm",
        "aliases": ["PMP", "PMP认证"],
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
        "canonical": "KOC运营",
        "category": "sales_solution",
        "aliases": ["KOC", "KOC运营", "达人运营", "内容增长"],
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
        "canonical": "Axure",
        "category": "design",
        "aliases": ["Axure", "原型设计", "墨刀", "Sketch"],
    },
    {
        "canonical": "Canva",
        "category": "design",
        "aliases": ["Canva"],
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
    {
        "canonical": "Excel",
        "category": "office_productivity",
        "aliases": ["Excel", "Excel表格"],
    },
    {
        "canonical": "PPT",
        "category": "office_productivity",
        "aliases": ["PPT", "PowerPoint", "演示文稿"],
    },
]


CONCEPT_CATEGORY_BY_NAME = {
    definition["canonical"]: definition["category"] for definition in CONCEPT_DEFINITIONS
}

RELATED_CONCEPTS_BY_CANONICAL: dict[str, list[str]] = {
    "Python": ["FastAPI", "Flask", "Pytest", "自动化测试", "机器学习", "深度学习", "Biopython", "Java"],
    "C++": ["C语言", "Python", "MATLAB", "分子动力学", "CFD"],
    "MATLAB": ["Python", "C++", "CFD", "流体力学建模"],
    "Java": ["Spring Boot", "Spring Cloud", "MyBatis", "REST API", "微服务", "JUnit"],
    "JavaScript": ["TypeScript", "Vue", "React", "Node.js", "HTML/CSS", "Web开发", "UniApp"],
    "TypeScript": ["JavaScript", "Vue", "React", "Node.js", "HTML/CSS", "Web开发"],
    "React": ["Vue", "JavaScript", "TypeScript", "HTML/CSS", "Web开发", "UniApp"],
    "Vue": ["React", "JavaScript", "TypeScript", "HTML/CSS", "Web开发", "UniApp"],
    "Node.js": ["JavaScript", "TypeScript", "Java", "Spring Boot", "REST API", "微服务"],
    "Spring Boot": ["Java", "Spring Cloud", "MyBatis", "REST API", "微服务"],
    "Spring Cloud": ["Java", "Spring Boot", "微服务", "REST API"],
    "REST API": ["接口测试", "Postman", "Apifox", "Java", "Spring Boot", "Node.js", "FastAPI"],
    "JSON": ["REST API", "JavaScript", "Node.js"],
    "自动化测试": ["接口测试", "性能测试", "Selenium", "Pytest", "JMeter", "Python"],
    "接口测试": ["REST API", "Postman", "Apifox", "自动化测试", "JMeter", "UAT"],
    "UAT": ["接口测试", "自动化测试", "项目管理"],
    "性能测试": ["JMeter", "高并发调优", "接口测试", "自动化测试"],
    "MySQL": ["SQL", "数据库设计", "PostgreSQL", "Redis"],
    "Redis": ["MySQL", "数据库设计", "高并发调优"],
    "Web开发": ["HTML/CSS", "JavaScript", "TypeScript", "React", "Vue", "MUI"],
    "MUI": ["React", "Web开发", "HTML/CSS"],
    "Docker": ["Linux", "Kubernetes", "CI/CD", "Nginx", "Apptainer"],
    "Kubernetes": ["Docker", "Linux", "CI/CD", "微服务"],
    "HPC集群": ["Linux", "Slurm", "GPU计算", "Apptainer"],
    "Slurm": ["HPC集群", "Linux", "GPU计算"],
    "Apptainer": ["Docker", "Linux", "HPC集群"],
    "GitHub": ["Git", "CI/CD"],
    "CI/CD": ["GitHub", "Docker", "Kubernetes"],
    "大模型": ["RAG", "LangChain", "Prompt Engineering", "AI智能体", "AI辅助编程", "机器学习", "深度学习", "Transformer", "DeepSpeed", "GPU计算"],
    "AI辅助编程": ["大模型", "Prompt Engineering", "GitHub"],
    "RAG": ["大模型", "LangChain", "Prompt Engineering", "AI智能体", "FAISS"],
    "LangChain": ["RAG", "大模型", "AI智能体", "Function Calling"],
    "Transformer": ["大模型", "深度学习", "PyTorch", "JAX", "TensorFlow"],
    "PyTorch": ["深度学习", "机器学习", "JAX", "TensorFlow", "分布式训练", "DeepSpeed", "GPU计算"],
    "JAX": ["深度学习", "机器学习", "PyTorch", "TensorFlow", "分布式训练", "GPU计算"],
    "TensorFlow": ["深度学习", "机器学习", "PyTorch", "计算机视觉"],
    "计算机视觉": ["深度学习", "PyTorch", "TensorFlow"],
    "分布式训练": ["PyTorch", "JAX", "DeepSpeed", "GPU计算", "Slurm"],
    "FAISS": ["RAG", "大模型", "Python"],
    "DeepSpeed": ["PyTorch", "分布式训练", "深度学习", "GPU计算"],
    "AI4S": ["机器学习", "深度学习", "计算生物学", "生物信息学", "组学分析", "蛋白结构预测", "分子动力学", "GPU计算"],
    "组学分析": ["生物信息学", "计算生物学", "Python", "Biopython"],
    "蛋白质": ["蛋白结构预测", "PDB", "PyMOL"],
    "蛋白结构预测": ["AlphaFold", "OpenFold", "RoseTTAFold", "ESM", "ProteinMPNN", "RFdiffusion", "PDB", "MSA", "FASTA", "计算生物学"],
    "AlphaFold": ["蛋白结构预测", "OpenFold", "RoseTTAFold", "PDB", "MSA", "FASTA"],
    "OpenFold": ["AlphaFold", "蛋白结构预测", "PDB", "MSA"],
    "RoseTTAFold": ["AlphaFold", "蛋白结构预测", "PDB"],
    "ESM": ["蛋白结构预测", "蛋白质", "深度学习"],
    "ProteinMPNN": ["蛋白质", "蛋白结构预测", "RFdiffusion"],
    "BoltzGen": ["蛋白结构预测", "蛋白质", "深度学习"],
    "RFdiffusion": ["蛋白结构预测", "扩散模型", "BindCraft", "ProteinMPNN"],
    "BindCraft": ["RFdiffusion", "蛋白结构预测", "ProteinMPNN"],
    "AutoDock": ["药物研发", "PDB", "RDKit", "ADMET", "分子动力学"],
    "RDKit": ["药物研发", "AutoDock", "ADMET", "Biopython", "分子动力学"],
    "Biopython": ["生物信息学", "Python", "RDKit", "组学分析"],
    "pdbfixer": ["PDB", "PyMOL", "Biopython"],
    "PyMOL": ["PDB", "蛋白质", "蛋白结构预测", "MolStar"],
    "MolStar": ["PyMOL", "PDB", "Web开发"],
    "ADMET": ["药物研发", "AutoDock", "RDKit", "ADC药物"],
    "ADC药物": ["药物研发", "ADMET", "CRO行业"],
    "OpenMM": ["分子动力学", "GROMACS", "AMBER", "Sponge"],
    "分子动力学": ["GROMACS", "AMBER", "OpenMM", "Sponge", "NAMD", "LAMMPS", "FEP", "AutoDock", "药物研发"],
    "GROMACS": ["分子动力学", "OpenMM", "GPU计算"],
    "AMBER": ["分子动力学", "FEP"],
    "FEP": ["分子动力学", "AMBER", "药物研发"],
    "DFT计算": ["VASP", "ORCA", "Gaussian", "CP2K", "ABACUS", "GPU计算"],
    "VASP": ["DFT计算", "多物理场仿真", "GPU计算"],
    "LAMMPS": ["分子动力学", "Sponge", "多物理场仿真"],
    "Sponge": ["分子动力学", "GROMACS", "AMBER", "LAMMPS"],
    "NAMD": ["分子动力学", "GROMACS", "AMBER"],
    "ORCA": ["DFT计算", "Gaussian", "CP2K"],
    "Gaussian": ["DFT计算", "ORCA", "CP2K"],
    "CP2K": ["DFT计算", "ORCA", "Gaussian"],
    "ABACUS": ["DFT计算", "VASP", "CP2K"],
    "CRO行业": ["药物研发", "解决方案", "大客户销售"],
    "工作流": ["需求分析", "AI智能体", "PoC验证"],
    "PoC验证": ["解决方案", "售前", "需求分析", "工作流", "PPT"],
    "PMP": ["项目管理", "风险管理"],
    "Axure": ["Figma", "UI设计", "需求分析"],
    "Canva": ["视觉设计", "UI设计"],
    "KOC运营": ["客户开拓", "Canva"],
    "PPT": ["售前", "解决方案", "PoC验证"],
}

ENGINEERING_PROFILE_CATEGORIES = {
    "programming_language",
    "backend",
    "frontend",
    "database_middleware",
    "devops",
    "testing",
    "ai_llm",
}

ENGINEERING_BONUS_CONCEPTS = [
    "REST API",
    "数据库设计",
    "微服务",
    "高并发调优",
    "Docker",
    "Kubernetes",
    "CI/CD",
    "Linux",
    "Git",
    "Nginx",
    "接口测试",
    "自动化测试",
    "性能测试",
]

UNRECOGNIZED_TERM_STOPWORDS = {
    "ai",
    "ai+",
    "api",
    "app",
    "b",
    "boss",
    "crm",
    "engineering",
    "galileo",
    "hr",
    "jd",
    "ka",
    "mokda",
    "model",
    "models",
    "pc",
    "saas",
    "science",
    "tob",
    "ui",
    "ux",
}


EVALUATION_MATERIAL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "material_id": "bio-authoritative-publications",
        "label": "生命科学权威论文/期刊成果",
        "category": "research_publication",
        "applies_to_categories": ["bio_ai"],
        "signals": [
            "Nature",
            "Science",
            "Cell",
            "Nature Biotechnology",
            "Nature Methods",
            "Nature Medicine",
            "Cell Systems",
            "Genome Biology",
            "Nucleic Acids Research",
            "Bioinformatics",
            "PNAS",
            "PDB",
            "AlphaFold",
            "OpenFold",
            "RoseTTAFold",
            "ProteinMPNN",
            "BoltzGen",
            "RDKit",
            "Biopython",
            "RNA-seq",
            "ADMET",
            "ADC",
        ],
        "guidance": "生命科学、AI4S、生物信息学、药物研发岗位可优先核实高水平论文、共同一作/通讯作者、方法学贡献和可复现实验数据。",
    },
    {
        "material_id": "ai-top-conferences-and-artifacts",
        "label": "AI 顶会/开源成果",
        "category": "research_engineering_artifact",
        "applies_to_categories": ["ai_llm"],
        "signals": [
            "NeurIPS",
            "ICML",
            "ICLR",
            "ACL",
            "EMNLP",
            "AAAI",
            "KDD",
            "CVPR",
            "Hugging Face",
            "GitHub",
            "arXiv",
        ],
        "guidance": "AI、大模型、RAG、Agent 岗位可核实顶会论文、开源模型/数据集、线上指标、复现实验和工程落地材料。",
    },
    {
        "material_id": "engineering-delivery-artifacts",
        "label": "工程交付证明材料",
        "category": "delivery_artifact",
        "applies_to_categories": [
            "programming_language",
            "backend",
            "frontend",
            "database_middleware",
            "devops",
            "testing",
        ],
        "signals": [
            "线上系统",
            "生产环境",
            "CI/CD",
            "自动化测试报告",
            "压测报告",
            "故障复盘",
            "监控告警",
            "代码评审",
            "GitHub",
        ],
        "guidance": "研发、测试、实施、运维岗位可核实上线系统、代码仓库、测试报告、性能指标、故障复盘和项目交付材料。",
    },
    {
        "material_id": "scientific-computing-artifacts",
        "label": "科学计算/分子模拟验证材料",
        "category": "simulation_artifact",
        "applies_to_categories": ["simulation"],
        "signals": [
            "GROMACS",
            "AMBER",
            "LAMMPS",
            "VASP",
            "ORCA",
            "Gaussian",
            "CP2K",
            "ABACUS",
            "FEP",
            "AutoDock",
            "PyMOL",
            "OpenMM",
            "Sponge",
            "NAMD",
            "Slurm",
            "计算报告",
            "模拟参数",
            "复现实验",
        ],
        "guidance": "科学计算、分子模拟、仿真岗位可核实模拟体系、参数设置、收敛性验证、计算资源、复现实验和产出报告。",
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
    left_boundary = r"(?<![a-z0-9.])" if len("".join(pieces)) <= 2 else r"(?<![a-z0-9])"
    return re.search(rf"{left_boundary}{pattern}(?![a-z0-9])", text) is not None


def _contains_alias(text: str, alias: str) -> bool:
    normalized = normalize_text(text)
    if re.fullmatch(r"[A-Za-z0-9+#.\-_/ ]+", alias):
        return _contains_ascii_alias(normalized, alias)
    return compact_text(alias) in compact_text(text)


def concept_aliases_for(canonical: str) -> list[str]:
    for definition in CONCEPT_DEFINITIONS:
        if definition["canonical"] == canonical:
            aliases = [canonical, *definition.get("aliases", [])]
            return list(dict.fromkeys(alias for alias in aliases if alias))
    return [canonical] if canonical else []


def related_concepts_for(canonical: str) -> list[str]:
    return [
        concept
        for concept in RELATED_CONCEPTS_BY_CANONICAL.get(canonical, [])
        if concept in CONCEPT_CATEGORY_BY_NAME
    ]


def bonus_concepts_for_categories(categories: list[str]) -> list[str]:
    if not set(categories).intersection(ENGINEERING_PROFILE_CATEGORIES):
        return []
    return [
        concept
        for concept in ENGINEERING_BONUS_CONCEPTS
        if concept in CONCEPT_CATEGORY_BY_NAME
    ]


def evaluation_materials_for_categories(categories: list[str]) -> list[dict[str, Any]]:
    category_set = set(categories)
    materials = []
    for definition in EVALUATION_MATERIAL_DEFINITIONS:
        if not category_set.intersection(definition["applies_to_categories"]):
            continue
        materials.append({
            "material_id": definition["material_id"],
            "label": definition["label"],
            "category": definition["category"],
            "signals": definition["signals"],
            "guidance": definition["guidance"],
        })
    return materials


def contains_concept_alias(text: str, alias: str) -> bool:
    return _contains_alias(text, alias)


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


def _first_preferred_marker_index(text: str) -> int:
    markers = ["加分项", "优先条件", "加分条件", "以下经验优先"]
    indexes = [text.find(marker) for marker in markers if marker in text]
    indexes.extend(
        match.start()
        for match in re.finditer(r"优先考虑\s*[:：\n\r]", text)
    )
    return min(indexes) if indexes else -1


def _has_preferred_prefix(text: str, start_index: int) -> bool:
    head = re.split(r"[，,。；;\n\r]+", text[:start_index])[-1]
    return re.search(r"(?:优先考虑|优先)\s*$", head) is not None


def _clause_tail(text: str, end_index: int) -> str:
    return re.split(r"[，,。；;\n\r]+", text[end_index:], maxsplit=1)[0]


def _is_preferred_experience_expression(text: str, start_index: int, end_index: int) -> bool:
    if _has_preferred_prefix(text, start_index):
        return True
    return re.match(r"^\s*(?:(?:相关|工作)?经验)?\s*优先", _clause_tail(text, end_index)) is not None


def _is_preferred_education_expression(text: str, start_index: int, end_index: int) -> bool:
    if _has_preferred_prefix(text, start_index):
        return True
    return re.match(r"^\s*(?:及以上|以上)?(?:学历|学位)?\s*优先", _clause_tail(text, end_index)) is not None


def extract_experience_years_min(text: str) -> int | None:
    years: list[int] = []
    patterns = [
        r"(\d{1,2})\s*年(?:及以上|以上|经验)",
        r"(\d{1,2})\s*年以上",
        r"(\d{1,2})\s*-\s*\d{1,2}\s*年",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            if _is_preferred_experience_expression(text, match.start(), match.end()):
                continue
            value = int(match.group(1))
            if 0 < value <= 20:
                years.append(value)
    return min(years) if years else None


def extract_education_keywords(text: str) -> list[str]:
    ordered = ["大专", "专科", "本科", "研究生", "硕士", "博士"]
    keywords = []
    for keyword in ordered:
        for match in re.finditer(re.escape(keyword), text):
            if not _is_preferred_education_expression(text, match.start(), match.end()):
                keywords.append(keyword)
                break
    return keywords


def build_job_profile(job: dict[str, Any]) -> dict[str, Any]:
    jd = clean_text(job.get("jd"))
    profile_context = " ".join(
        clean_text(job.get(key))
        for key in ["title", "department", "project"]
        if clean_text(job.get(key))
    )
    preferred_index = _first_preferred_marker_index(jd)
    required_text = jd[:preferred_index] if preferred_index >= 0 else jd
    preferred_text = jd[preferred_index:] if preferred_index >= 0 else ""
    keyword_text = " ".join(job.get("required_keywords", []))

    required_concepts = set(extract_concepts_from_text(
        f"{profile_context}\n{keyword_text}\n{required_text}"
    ))
    preferred_concepts = set(extract_concepts_from_text(preferred_text))
    all_concepts = set(job.get("concepts", []))
    if not required_concepts:
        required_concepts = all_concepts - preferred_concepts

    concept_categories = sorted({
        CONCEPT_CATEGORY_BY_NAME[concept]
        for concept in all_concepts
        if concept in CONCEPT_CATEGORY_BY_NAME
    })
    required_profile_concepts = sorted(required_concepts & all_concepts)
    preferred_profile_concepts = sorted(preferred_concepts - required_concepts)
    profile_target_concepts = set(required_profile_concepts) | set(preferred_profile_concepts)
    related_profile_concepts = sorted({
        related
        for concept in profile_target_concepts
        for related in related_concepts_for(concept)
        if related not in profile_target_concepts
    })
    bonus_profile_concepts = sorted({
        concept
        for concept in bonus_concepts_for_categories(concept_categories)
        if concept not in profile_target_concepts
        and concept not in related_profile_concepts
    })
    return {
        "required_concepts": required_profile_concepts,
        "preferred_concepts": preferred_profile_concepts,
        "related_concepts": related_profile_concepts,
        "bonus_concepts": bonus_profile_concepts,
        "all_concepts": sorted(all_concepts),
        "concept_categories": concept_categories,
        "education_keywords": extract_education_keywords(required_text),
        "experience_years_min": extract_experience_years_min(required_text),
        "evaluation_materials": evaluation_materials_for_categories(concept_categories),
    }


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

    job = {
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
    job["profile"] = build_job_profile(job)
    return job


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
    evaluation_materials = job.get("profile", {}).get("evaluation_materials", [])
    if evaluation_materials:
        documents.append(
            {
                "doc_id": f"{job['job_id']}:evaluation_materials",
                "job_id": job["job_id"],
                "title": f"{job['title']} 评估资料信号",
                "kind": "evaluation_materials",
                "text": "\n".join(
                    (
                        f"{material['label']}: "
                        f"可核实 {'、'.join(material.get('signals', []))}；"
                        f"{material.get('guidance', '')}"
                    )
                    for material in evaluation_materials
                ),
                "concepts": job["concepts"],
            }
        )
    return [document for document in documents if document["text"]]


def _quality_warning(
    code: str,
    message: str,
    *,
    severity: str = "warning",
    job: dict[str, Any] | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    warning = {
        "code": code,
        "severity": severity,
        "message": message,
        "job_id": job.get("job_id") if job else None,
        "source_row": job.get("source_row") if job else None,
        "title": job.get("title") if job else title,
    }
    return {key: value for key, value in warning.items() if value is not None}


def _quality_job_issue(job: dict[str, Any]) -> dict[str, Any]:
    issue = {
        "job_id": job.get("job_id"),
        "title": job.get("title"),
        "source_row": job.get("source_row"),
        "department": job.get("department"),
        "suggested_keywords": _suggested_required_keywords_for_job(job),
    }
    return {key: value for key, value in issue.items() if value is not None}


def _suggested_required_keywords_for_job(job: dict[str, Any]) -> list[str]:
    profile = job.get("profile") if isinstance(job.get("profile"), dict) else {}
    concepts = profile.get("required_concepts") or job.get("concepts") or []
    return list(dict.fromkeys(clean_text(concept) for concept in concepts if clean_text(concept)))[:12]


def build_quality_report(rows: list[dict[str, Any]], jobs: list[dict[str, Any]]) -> dict[str, Any]:
    warnings: list[dict[str, Any]] = []
    missing_required_keyword_jobs: list[dict[str, Any]] = []
    status_counts: dict[str, int] = defaultdict(int)
    department_counts: dict[str, int] = defaultdict(int)
    jobs_by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for job in jobs:
        status_counts[job.get("status") or "未填写"] += 1
        department_counts[job.get("department") or "未填写"] += 1
        jobs_by_title[job["title"]].append(job)

        if not job.get("jd"):
            warnings.append(_quality_warning("missing_jd", "岗位缺少 JD 正文。", job=job))
        if not job.get("required_keywords"):
            missing_required_keyword_jobs.append(_quality_job_issue(job))
            warnings.append(_quality_warning(
                "missing_required_keywords",
                "岗位关键词列为空，当前只依赖 JD 自动抽取。",
                severity="info",
                job=job,
            ))
        if not job.get("concepts"):
            warnings.append(_quality_warning(
                "no_concepts_extracted",
                "未从 JD 或关键词中识别出标准概念。",
                job=job,
            ))
        if not job.get("department"):
            warnings.append(_quality_warning(
                "missing_department",
                "岗位缺少入职部门。",
                severity="info",
                job=job,
            ))

    for title, duplicated_jobs in sorted(jobs_by_title.items()):
        if len(duplicated_jobs) <= 1:
            continue
        warnings.append(_quality_warning(
            "duplicate_title",
            f"发现 {len(duplicated_jobs)} 个同名岗位，后续后台管理需要人工确认是否合并。",
            severity="info",
            title=title,
        ))

    return {
        "total_rows": len(rows),
        "imported_jobs": len(jobs),
        "warning_count": len(warnings),
        "status_counts": dict(sorted(status_counts.items())),
        "department_counts": dict(sorted(department_counts.items())),
        "unrecognized_terms": _unrecognized_high_frequency_terms(jobs),
        "missing_required_keyword_jobs": missing_required_keyword_jobs,
        "warnings": warnings[:80],
    }


def _unrecognized_high_frequency_terms(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    known_aliases = {
        compact_text(alias)
        for definition in CONCEPT_DEFINITIONS
        for alias in [definition["canonical"], *definition.get("aliases", [])]
        if alias
    }
    counts: Counter[str] = Counter()
    samples: dict[str, list[str]] = defaultdict(list)
    for job in jobs:
        text = "\n".join(
            clean_text(value)
            for value in [
                job.get("title"),
                job.get("jd"),
                job.get("expected_outputs"),
                " ".join(job.get("required_keywords", [])),
            ]
            if clean_text(value)
        )
        terms = {
            term
            for term in re.findall(r"(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9+#.\-]{2,31}(?![A-Za-z0-9])", text)
            if _is_unknown_technical_term(term, known_aliases)
        }
        for term in terms:
            canonical = _canonical_unknown_term(term)
            counts[canonical] += 1
            if len(samples[canonical]) < 3:
                samples[canonical].append(clean_text(job.get("title")) or job["job_id"])
    return [
        {
            "term": term,
            "frequency": frequency,
            "sample_titles": samples[term],
        }
        for term, frequency in counts.most_common(20)
        if frequency >= 2
    ]


def _is_unknown_technical_term(term: str, known_aliases: set[str]) -> bool:
    normalized = compact_text(term)
    if normalized in known_aliases:
        return False
    if normalized.lower() in UNRECOGNIZED_TERM_STOPWORDS:
        return False
    if normalized.lower() == "asterfire":
        return False
    return any(char.isupper() for char in term) or any(char in term for char in "+#.-")


def _canonical_unknown_term(term: str) -> str:
    return term.strip(" .。:：-")


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
        "schema_version": KNOWLEDGE_BASE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source": {
            "file_name": source_name,
            "row_count": len(rows),
            "job_count": len(jobs),
        },
        "jobs": jobs,
        "concepts": concepts,
        "documents": documents,
        "quality_report": build_quality_report(rows, jobs),
    }


def _empty_knowledge_base() -> dict[str, Any]:
    return {
        "schema_version": KNOWLEDGE_BASE_SCHEMA_VERSION,
        "generated_at": None,
        "source": {"file_name": None, "row_count": 0, "job_count": 0},
        "jobs": [],
        "concepts": [],
        "documents": [],
        "quality_report": {
            "total_rows": 0,
            "imported_jobs": 0,
            "warning_count": 0,
            "status_counts": {},
            "department_counts": {},
            "unrecognized_terms": [],
            "missing_required_keyword_jobs": [],
            "warnings": [],
        },
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
                profile_json TEXT NOT NULL,
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
            "schema_version": str(kb.get("schema_version", KNOWLEDGE_BASE_SCHEMA_VERSION)),
            "generated_at": str(kb.get("generated_at") or ""),
            "source_file_name": str(source.get("file_name") or ""),
            "source_row_count": str(source.get("row_count") or 0),
            "source_job_count": str(source.get("job_count") or 0),
            "quality_report_json": json.dumps(
                kb.get("quality_report", _empty_knowledge_base()["quality_report"]),
                ensure_ascii=False,
            ),
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
                required_keywords_json, profile_json, expected_outputs, jd
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    json.dumps(job.get("profile", {}), ensure_ascii=False),
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
                "profile": json.loads(row["profile_json"]),
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
        "quality_report": json.loads(metadata.get("quality_report_json") or "{}")
        or _empty_knowledge_base()["quality_report"],
    }


def load_default_knowledge_base() -> dict[str, Any]:
    return load_knowledge_base_from_sqlite()


def knowledge_base_needs_rebuild(kb: dict[str, Any]) -> bool:
    return int(kb.get("schema_version") or 0) < KNOWLEDGE_BASE_SCHEMA_VERSION


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


def quality_report_for(kb: dict[str, Any]) -> dict[str, Any]:
    report = dict(kb.get("quality_report") or _empty_knowledge_base()["quality_report"])
    missing_keyword_jobs = report.get("missing_required_keyword_jobs")
    if not isinstance(missing_keyword_jobs, list) or any(
        "suggested_keywords" not in item
        for item in missing_keyword_jobs
        if isinstance(item, dict)
    ):
        report["missing_required_keyword_jobs"] = [
            _quality_job_issue(job)
            for job in kb.get("jobs", [])
            if not job.get("required_keywords")
        ]
    report.setdefault("unrecognized_terms", _unrecognized_high_frequency_terms(kb.get("jobs", [])))
    return report


def list_job_options(
    *,
    limit: int,
    kb: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    kb = kb or load_default_knowledge_base()
    return [
        {
            "job_id": job["job_id"],
            "title": job["title"],
            "department": job.get("department"),
            "project": job.get("project"),
            "status": job.get("status"),
        }
        for job in kb.get("jobs", [])[:limit]
    ]


def get_job_detail(job_id: str, kb: dict[str, Any] | None = None) -> dict[str, Any] | None:
    kb = kb or load_default_knowledge_base()
    job = next((item for item in kb.get("jobs", []) if item.get("job_id") == job_id), None)
    if not job:
        return None
    documents = [
        document
        for document in kb.get("documents", [])
        if document.get("job_id") == job_id
    ]
    return {
        **job,
        "documents": documents,
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
