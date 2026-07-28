"""Stable, clearly labelled demo content for the M1 vertical slice."""

from backend.app.models import AssessmentResponse, DimensionResult, MessageSuggestion
from backend.app.scoring import calculate_total_score


def build_demo_assessment(candidate_label: str, request_id: str) -> AssessmentResponse:
    dimensions = [
        DimensionResult(
            key="research_direction",
            name="研究方向匹配",
            score=95,
            weight=30,
            confidence=0.95,
            reason="演示资料中的研究方向与 AI4S 岗位高度相关。",
            evidence=["演示资料：参与蛋白结构预测研究", "演示资料：具有 AI for Science 项目经验"],
        ),
        DimensionResult(
            key="skills",
            name="技能经验匹配",
            score=90,
            weight=30,
            confidence=0.90,
            reason="演示资料覆盖岗位所需的核心算法与工具。",
            evidence=["演示资料：熟悉 AlphaFold、Rosetta 与分子动力学"],
        ),
        DimensionResult(
            key="education",
            name="教育背景匹配",
            score=95,
            weight=20,
            confidence=0.96,
            reason="演示资料中的博士研究方向与岗位要求一致。",
            evidence=["演示资料：计算生物学博士"],
        ),
        DimensionResult(
            key="potential",
            name="综合潜力评估",
            score=88,
            weight=20,
            confidence=0.82,
            reason="演示资料体现较好的科研能力，产业落地经验仍需确认。",
            evidence=["演示资料：参与跨学科研究项目"],
        ),
    ]
    total_score = calculate_total_score(
        [(dimension.score, dimension.weight) for dimension in dimensions]
    )

    return AssessmentResponse(
        request_id=request_id,
        candidate_label=candidate_label,
        job_title="AI4S 工程师（演示岗位）",
        total_score=total_score,
        recommendation="非常匹配，建议联系",
        dimensions=dimensions,
        highlights=[
            "演示资料显示研究方向与岗位高度相关",
            "具备蛋白结构预测与 AI for Science 项目经验",
            "教育背景与核心技能组合较完整",
        ],
        risk_flags=["工业化落地经验需要进一步确认"],
        follow_up_questions=[
            "是否参与过面向业务交付的 AI4S 项目？",
            "期望到岗时间和当前求职状态如何？",
        ],
        messages=[
            MessageSuggestion(
                type="greeting",
                label="打招呼话术",
                content=(
                    f"您好，{candidate_label}。我们正在招聘 AI4S 工程师，"
                    "看到您在蛋白结构预测和 AI for Science 方面的经历与岗位很匹配，"
                    "想和您进一步沟通一下，不知道您近期是否方便？"
                ),
            ),
            MessageSuggestion(
                type="interview_invitation",
                label="邀约面试话术",
                content=(
                    f"您好，{candidate_label}。感谢您的回复，我们希望邀请您参加一次线上交流，"
                    "重点聊聊 AI4S 项目经验和岗位方向。您本周有哪些方便的时间？"
                ),
            ),
            MessageSuggestion(
                type="phone_script",
                label="电话沟通提纲",
                content=(
                    "1. 简要介绍团队与 AI4S 岗位；\n"
                    "2. 了解候选人的蛋白结构预测项目职责；\n"
                    "3. 确认产业落地经验和求职动机；\n"
                    "4. 沟通到岗时间及下一步安排。"
                ),
            ),
        ],
    )
