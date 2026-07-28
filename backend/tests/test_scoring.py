import pytest

from backend.app.scoring import calculate_total_score, validate_weights


def test_calculate_total_score() -> None:
    assert calculate_total_score([(95, 30), (90, 30), (95, 20), (88, 20)]) == 92


@pytest.mark.parametrize("weights", [[30, 30], [100, 1], [-1, 101], []])
def test_rejects_invalid_weights(weights: list[int]) -> None:
    with pytest.raises(ValueError):
        validate_weights(weights)


@pytest.mark.parametrize("score", [-1, 101])
def test_rejects_out_of_range_score(score: int) -> None:
    with pytest.raises(ValueError):
        calculate_total_score([(score, 100)])
