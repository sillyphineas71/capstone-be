"""T-MERGE-005 (feat-transcript-segment-merge/tasks.md) — đo lại benchmark trên
`test_audio/04_ClimateDiscussion_10min.mp3` SAU khi có VAD tuning (GA-10) +
segment merge (GA-11/12), so với mốc gốc đo 2026-08-02 (TRƯỚC feature này):

    Tổng segment: 97 | unknown: 6 (6.2%) | RTF: 1.726 | RAM đỉnh: 2612.9 MB

KHÔNG phải unit test (tên không kết thúc `_test.py`, pytest không collect) —
công cụ đo đạc thủ công, cùng tinh thần `benchmark_resources.py` (T-BENCH-001).
Audio 600s thật (10 phút) + medium + pyannote CPU/int8 -> chạy CHẬM (~15-20
phút theo mốc gốc), không phải test tự động trong CI.

Chạy:
    python python/bench_climate.py
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import psutil

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

_PY_DIR = Path(__file__).resolve().parent
_WORKER_DIR = _PY_DIR.parent
_REPO_ROOT = _WORKER_DIR.parent.parent.parent  # workers/ai-transcription -> workers -> capstone-be -> repo root
_FIXTURE = _REPO_ROOT / "test_audio" / "04_ClimateDiscussion_10min.mp3"
_MODELS = _WORKER_DIR / "models" / "pyannote" / "speaker-diarization-3.1"
_HF_CACHE = Path.home() / ".cache" / "huggingface" / "hub"
_AUDIO_DURATION_SECONDS = 600.0  # 04_ClimateDiscussion_10min.mp3, đã biết trước

MB = 1024 * 1024

BASELINE = {
    "totalSegments": 97,
    "unknownSegments": 6,
    "unknownRatio": 6 / 97,
    "rtf": 1.726,
    "peakRamMb": 2612.9,
}


def _peak_rss_bytes(proc: subprocess.Popen) -> int:
    peak = 0
    try:
        ps_proc = psutil.Process(proc.pid)
    except psutil.NoSuchProcess:
        return 0
    while proc.poll() is None:
        try:
            rss = ps_proc.memory_info().rss
            for child in ps_proc.children(recursive=True):
                try:
                    rss += child.memory_info().rss
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            peak = max(peak, rss)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            break
        time.sleep(0.5)
    return peak


def main() -> None:
    if not _FIXTURE.exists():
        print(f"Thiếu fixture {_FIXTURE} — bỏ qua.", file=sys.stderr)
        sys.exit(1)

    tmp_dir = _PY_DIR / "_bench_tmp"
    tmp_dir.mkdir(exist_ok=True)
    normalized_output = tmp_dir / "norm-climate.wav"
    result_output = tmp_dir / "result-climate.json"

    env = dict(os.environ)
    env["PYANNOTE_MODEL_PATH"] = str(_MODELS)
    env["PYANNOTE_LOCAL_FILES_ONLY"] = "true"
    env["PYANNOTE_CACHE"] = str(_HF_CACHE)

    cmd = [
        sys.executable,
        str(_PY_DIR / "transcribe_pipeline.py"),
        "--input", str(_FIXTURE),
        "--normalized-output", str(normalized_output),
        "--result-output", str(result_output),
        "--model", "medium",
        "--device", "cpu",
        "--compute-type", "int8",
        "--language", "vi",
        "--diarization-enabled", "true",
        "--overlap-detection-enabled", "true",
    ]

    print(f"[bench] input={_FIXTURE}")
    print(f"[bench] cmd={' '.join(cmd)}")
    print("[bench] running (dự kiến ~15-20 phút theo mốc gốc)...", flush=True)

    t0 = time.time()
    proc = subprocess.Popen(
        cmd, cwd=str(_PY_DIR),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True,
    )
    peak_bytes = _peak_rss_bytes(proc)
    stdout, stderr = proc.communicate()
    elapsed = time.time() - t0

    if proc.returncode != 0:
        print(f"[bench] FAILED exit={proc.returncode}", file=sys.stderr)
        print("--- stdout ---", stdout[-4000:], file=sys.stderr)
        print("--- stderr ---", stderr[-4000:], file=sys.stderr)
        sys.exit(1)

    result = json.loads(result_output.read_text(encoding="utf-8"))
    segments = result["segments"]
    total = len(segments)
    unknown = sum(1 for s in segments if s["speakerLabel"] == "unknown")
    unknown_ratio = (unknown / total) if total else 0.0
    rtf = elapsed / _AUDIO_DURATION_SECONDS
    peak_mb = round(peak_bytes / MB, 1)

    print("\n=== T-MERGE-005 BENCHMARK RESULT (04_ClimateDiscussion_10min.mp3) ===")
    print(f"{'metric':<20} {'baseline (2026-08-02)':>22} {'this run':>12}")
    print(f"{'totalSegments':<20} {BASELINE['totalSegments']:>22} {total:>12}")
    baseline_unknown_str = f"{BASELINE['unknownSegments']} ({BASELINE['unknownRatio']:.1%})"
    this_unknown_str = f"{unknown} ({unknown_ratio:.1%})"
    print(f"{'unknownSegments':<20} {baseline_unknown_str:>22} {this_unknown_str:>12}")
    print(f"{'rtf':<20} {BASELINE['rtf']:>22} {rtf:>12.3f}")
    print(f"{'peakRamMb':<20} {BASELINE['peakRamMb']:>22} {peak_mb:>12}")
    print(f"\nprocessing time: {elapsed:.1f}s ({elapsed / 60:.1f} phút)")

    print("\n=== ĐÁNH GIÁ (spec.md NFR-001/NFR-003/NFR-004) ===")
    rtf_ok = rtf <= BASELINE["rtf"] * 1.10
    unknown_ok = unknown_ratio <= BASELINE["unknownRatio"] + 1e-9
    segment_reduced = total < BASELINE["totalSegments"]
    print(f"RTF không tăng quá 10% ({BASELINE['rtf'] * 1.1:.3f}): {'PASS' if rtf_ok else 'FAIL'}")
    print(f"Tỷ lệ unknown không tăng: {'PASS' if unknown_ok else 'FAIL'}")
    print(f"Tổng segment giảm rõ rệt: {'PASS' if segment_reduced else 'FAIL'} ({BASELINE['totalSegments']} -> {total})")

    (tmp_dir / "bench_climate_stderr.log").write_text(stderr, encoding="utf-8")
    print(f"\nLog pipeline (log_event) đã lưu: {tmp_dir / 'bench_climate_stderr.log'}")


if __name__ == "__main__":
    main()
