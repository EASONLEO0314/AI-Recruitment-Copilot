"""Deterministic scoring rules shared by demo and future assessments."""

from collections.abc import Sequence


def validate_weights(weights: Sequence[int]) -> None:
    """Validate integer percentage weights with an exact total of 100."""
    if not weights:
        raise ValueError("At least one weight is required")
    if any(isinstance(weight, bool) or not isinstance(weight, int) for weight in weights):
        raise ValueError("Weights must be integers")
    if any(weight < 0 or weight > 100 for weight in weights):
        raise ValueError("Weights must be between 0 and 100")
    if sum(weights) != 100:
        raise ValueError("Weights must add up to 100")


def calculate_total_score(weighted_scores: Sequence[tuple[int, int]]) -> int:
    """Return a rounded 0-100 weighted score after validating all inputs."""
    validate_weights([weight for _, weight in weighted_scores])
    scores = [score for score, _ in weighted_scores]
    if any(isinstance(score, bool) or not isinstance(score, int) for score in scores):
        raise ValueError("Scores must be integers")
    if any(score < 0 or score > 100 for score in scores):
        raise ValueError("Scores must be between 0 and 100")
    return round(sum(score * weight for score, weight in weighted_scores) / 100)
