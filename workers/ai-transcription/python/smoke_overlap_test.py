"""T034 — Overlap smoke test (M2 Independent Test).

Chạy THẬT pipeline đầy đủ M2 (whisper + pyannote diarization + overlap
detection) trên fixture `sample-overlap.wav` (2 giọng tiếng Việt có đoạn chồng
tiếng), xác nhận hành vi best-effort M2:
  - phát hiện >= 2 speaker (detectedSpeakers),
  - segment trong vùng chồng tiếng được đánh dấu overlap=true + manualReview,
  - KHÔNG crash khi SepFormer tắt (M3 chưa làm).

Đây chính là "M2 Independent Test" trong tasks.md — trước đây chưa từng chạy
thật lần nào vì thiếu fixture đa speaker.

GATE: chỉ chạy khi `RUN_SMOKE=1` (chậm — whisper + pyannote CPU ~2-3 phút) VÀ
model pyannote đã preload (T-HF-001). Mặc định skip.

    RUN_SMOKE=1 python -m pytest python/smoke_overlap_test.py -v
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
_FIXTURE = _WORKER_DIR / "tests" / "fixtures" / "sample-overlap.wav"
_PYANNOTE_MODEL = _WORKER_DIR / "models" / "pyannote" / "speaker-diarization-3.1"
_HF_CACHE = Path.home() / ".cache" / "huggingface" / "hub"

_SMOKE_ENABLED = os.environ.get("RUN_SMOKE") == "1"

pytestmark = pytest.mark.skipif(
    not _SMOKE_ENABLED,
    reason="Smoke test chậm (whisper+pyannote thật) — đặt RUN_SMOKE=1 để bật.",
)


@pytest.mark.skipif(
    not _FIXTURE.exists(), reason=f"Thiếu fixture {_FIXTURE.name} (T-DATA-001)."
)
@pytest.mark.skipif(
    not (_PYANNOTE_MODEL / "config.yaml").exists(),
    reason="pyannote model chưa preload (T-HF-001) — bỏ qua overlap smoke.",
)
def test_overlap_pipeline_detects_multiple_speakers_and_overlap(tmp_path):
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        pytest.skip("faster-whisper chưa cài.")

    env = dict(os.environ)
    env["PYANNOTE_MODEL_PATH"] = str(_PYANNOTE_MODEL)
    env["PYANNOTE_LOCAL_FILES_ONLY"] = "true"
    env["PYANNOTE_CACHE"] = str(_HF_CACHE)

    result_output = tmp_path / "result.json"
    cmd = [
        sys.executable,
        str(_PY_DIR / "transcribe_pipeline.py"),
        "--input", str(_FIXTURE),
        "--normalized-output", str(tmp_path / "norm.wav"),
        "--result-output", str(result_output),
        "--model", "small",
        "--device", "cpu",
        "--compute-type", "int8",
        "--language", "vi",
        "--diarization-enabled", "true",
        "--overlap-detection-enabled", "true",
    ]

    proc = subprocess.run(
        cmd, cwd=str(_PY_DIR), capture_output=True, text=True, timeout=300, env=env
    )
    assert proc.returncode == 0, (
        f"Pipeline exit {proc.returncode} (best-effort không được crash).\n"
        f"STDERR:\n{proc.stderr[-2000:]}"
    )

    with open(result_output, encoding="utf-8") as fh:
        result = json.load(fh)

    # Output vẫn phải đúng schema.
    schemas.validate_result(result)

    # M2 Independent Test: >= 2 speaker phát hiện.
    labels = [s["speakerLabel"] for s in result["detectedSpeakers"]]
    assert len(result["detectedSpeakers"]) >= 2, (
        f"Kỳ vọng >=2 speaker, chỉ có {labels}."
    )

    # Có ít nhất 1 segment trong vùng chồng tiếng -> overlap=true + best-effort
    # giữ unknown/manualReview (chưa có SepFormer M3).
    overlap_segs = [s for s in result["segments"] if s["overlap"]]
    assert overlap_segs, "Không segment nào được đánh dấu overlap=true."
    for s in overlap_segs:
        assert s["speakerLabel"] == "unknown"
        assert s["manualReviewRequired"] is True
        assert "overlap_segment_no_separation_yet" in s["notes"]
