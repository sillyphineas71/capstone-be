"""T033 — AI pipeline smoke test (no-overlap).

Chạy THẬT `transcribe_pipeline.py` (preprocess -> faster-whisper -> validate
schema) trên fixture `sample-no-overlap.wav`, đúng cách Node AI Worker spawn
Python subprocess ở runtime — KHÔNG mock whisper. Sau đó validate output bằng
chính `schemas.validate_result()` (validator T013 mà Node worker cũng dùng) +
assert kỳ vọng nghiệp vụ M1 (có text, có segment).

Đây là smoke test M1 thuần STT: diarization/overlap TẮT (M1 không phụ thuộc
pyannote/HF), nên chạy được mà không cần model pyannote hay token HuggingFace.

GATE: vì chạy whisper trên CPU mất ~15-40s (chậm hơn nhiều so với unit test
~3s), test này CHỈ chạy khi đặt env `RUN_SMOKE=1` — mặc định skip để
`pytest python/` thường ngày vẫn nhanh. Chạy có chủ đích:

    RUN_SMOKE=1 python -m pytest python/transcribe_pipeline_smoke_test.py -v
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import schemas

_PY_DIR = Path(__file__).resolve().parent
_WORKER_DIR = _PY_DIR.parent
_FIXTURE = _WORKER_DIR / "tests" / "fixtures" / "sample-no-overlap.wav"

_SMOKE_ENABLED = os.environ.get("RUN_SMOKE") == "1"

pytestmark = pytest.mark.skipif(
    not _SMOKE_ENABLED,
    reason="Smoke test chậm (chạy whisper thật) — đặt RUN_SMOKE=1 để bật.",
)


@pytest.mark.skipif(
    not _FIXTURE.exists(), reason=f"Thiếu fixture {_FIXTURE.name} (T-DATA-001)."
)
def test_pipeline_no_overlap_produces_valid_transcript(tmp_path):
    # Check faster-whisper TRONG test body (không phải decorator) — decorator
    # bị đánh giá lúc pytest collection, sẽ import faster_whisper (nặng) cho cả
    # suite dù test bị skip, làm `pytest python/` thường ngày chậm hẳn lên.
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        pytest.skip("faster-whisper chưa cài trong môi trường này.")

    normalized_output = tmp_path / "normalized.wav"
    result_output = tmp_path / "result.json"

    cmd = [
        sys.executable,
        str(_PY_DIR / "transcribe_pipeline.py"),
        "--input",
        str(_FIXTURE),
        "--normalized-output",
        str(normalized_output),
        "--result-output",
        str(result_output),
        "--model",
        "small",
        "--device",
        "cpu",
        "--compute-type",
        "int8",
        "--language",
        "vi",
        # M1 thuần STT: tắt diarization/overlap để smoke không phụ thuộc
        # pyannote/HuggingFace token.
        "--diarization-enabled",
        "false",
        "--overlap-detection-enabled",
        "false",
    ]

    proc = subprocess.run(
        cmd,
        cwd=str(_PY_DIR),
        capture_output=True,
        text=True,
        timeout=300,
    )

    assert proc.returncode == 0, (
        f"Pipeline exit {proc.returncode}.\nSTDOUT:\n{proc.stdout}\n"
        f"STDERR:\n{proc.stderr}"
    )
    assert result_output.exists(), "Pipeline không sinh ra result JSON."

    with open(result_output, encoding="utf-8") as fh:
        result = json.load(fh)

    # 1) Output phải hợp lệ theo đúng schema mà Node worker validate trước khi
    #    ghi DB (T013) — không raise nghĩa là pass.
    schemas.validate_result(result)

    # 2) Kỳ vọng nghiệp vụ M1: có ngôn ngữ, có text, có ít nhất 1 segment.
    assert result["languageCode"], "Thiếu languageCode."
    assert result["rawText"].strip(), "rawText rỗng — STT không ra chữ nào."
    assert isinstance(result["segments"], list) and len(result["segments"]) > 0, (
        "Không có segment nào."
    )
    assert result["modelVersions"]["whisper"] == "small"

    # 3) M1 không bật diarization -> mọi segment speakerLabel='unknown',
    #    speakerSource='unknown' (đúng scope M1, speaker info là việc của M2).
    for seg in result["segments"]:
        assert seg["speakerSource"] in schemas.VALID_SPEAKER_SOURCE
        assert seg["text"].strip(), "Có segment text rỗng."
