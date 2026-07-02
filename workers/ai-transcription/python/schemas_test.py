"""pytest cho schemas.py (T013)."""

import pytest

from schemas import (
    SchemaValidationError,
    new_segment,
    validate_result,
)


def _valid_result():
    return {
        "languageCode": "vi-VN",
        "rawText": "xin chao",
        "cleanedText": "Xin chào",
        "confidenceScore": 0.9,
        "segments": [
            new_segment("seg-0001", 0, 1000, "Xin chào", 0.9),
        ],
        "detectedSpeakers": [],
        "modelVersions": {"whisper": "small", "pyannote": None, "sepformer": None},
        "warnings": [],
    }


def test_valid_result_passes():
    validate_result(_valid_result())  # không raise


def test_missing_top_level_field_raises():
    result = _valid_result()
    del result["rawText"]
    with pytest.raises(SchemaValidationError, match="rawText"):
        validate_result(result)


def test_invalid_speaker_source_raises():
    result = _valid_result()
    result["segments"][0]["speakerSource"] = "made_up_source"
    with pytest.raises(SchemaValidationError, match="speakerSource"):
        validate_result(result)


def test_unknown_speaker_with_user_id_raises():
    result = _valid_result()
    result["segments"][0]["userId"] = "11111111-1111-1111-1111-111111111111"
    with pytest.raises(SchemaValidationError, match="userId"):
        validate_result(result)


def test_unknown_warning_code_raises():
    result = _valid_result()
    result["warnings"] = ["not_a_real_warning"]
    with pytest.raises(SchemaValidationError, match="Unknown warning code"):
        validate_result(result)


def test_missing_model_versions_whisper_raises():
    result = _valid_result()
    result["modelVersions"] = {}
    with pytest.raises(SchemaValidationError, match="whisper"):
        validate_result(result)


def test_new_segment_marks_low_confidence_for_manual_review():
    segment = new_segment("seg-0002", 0, 500, "ờ ờ", 0.2)
    assert segment["lowConfidence"] is True
    assert segment["manualReviewRequired"] is True
    assert segment["speakerLabel"] == "unknown"
    assert segment["userId"] is None


def test_new_segment_high_confidence_not_flagged():
    segment = new_segment("seg-0003", 0, 500, "Chào mọi người", 0.95)
    assert segment["lowConfidence"] is False
    assert segment["manualReviewRequired"] is False
