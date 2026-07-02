"""T-BENCH-001 — đo RAM peak + thời gian xử lý thật của pipeline trên máy local.

KHÔNG phải unit test (pytest không collect file này vì tên không kết thúc
`_test.py`) — là công cụ đo đạc thủ công, đúng tinh thần T-BENCH-001/T014B
("hoạt động đo đạc thủ công, kết quả dùng để cập nhật threshold").

Cách đo: spawn `transcribe_pipeline.py` như Node worker làm, rồi sample RSS
(process + toàn bộ child) mỗi 150ms qua psutil, lấy peak. Kết quả dùng để thay
giá trị đoán `AI_WORKER_MIN_FREE_RAM_MB=2048` bằng số đo thật.

Chạy:
    python python/benchmark_resources.py
(cần psutil — đã có trong requirements.txt)
"""

import os
import subprocess
import sys
import time
from pathlib import Path

import psutil

# Console Windows mặc định cp1252 không in được tiếng Việt có dấu — ép UTF-8
# để bảng kết quả + dòng đề xuất không crash UnicodeEncodeError.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

_PY_DIR = Path(__file__).resolve().parent
_WORKER_DIR = _PY_DIR.parent
_FIXTURE = _WORKER_DIR / "tests" / "fixtures" / "sample-no-overlap.wav"
_MODELS = _WORKER_DIR / "models" / "pyannote" / "speaker-diarization-3.1"
_HF_CACHE = Path.home() / ".cache" / "huggingface" / "hub"

MB = 1024 * 1024


def _peak_rss_bytes(proc: subprocess.Popen) -> int:
    """Sample RSS (process + children) tới khi proc kết thúc, trả peak bytes."""
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
        time.sleep(0.15)
    return peak


def run_one(label: str, model: str, diarization: bool, tmp_dir: Path) -> dict:
    env = dict(os.environ)
    if diarization:
        env["PYANNOTE_MODEL_PATH"] = str(_MODELS)
        env["PYANNOTE_LOCAL_FILES_ONLY"] = "true"
        env["PYANNOTE_CACHE"] = str(_HF_CACHE)

    cmd = [
        sys.executable,
        str(_PY_DIR / "transcribe_pipeline.py"),
        "--input", str(_FIXTURE),
        "--normalized-output", str(tmp_dir / f"norm-{label}.wav"),
        "--result-output", str(tmp_dir / f"result-{label}.json"),
        "--model", model,
        "--device", "cpu",
        "--compute-type", "int8",
        "--language", "vi",
        "--diarization-enabled", "true" if diarization else "false",
        "--overlap-detection-enabled", "true" if diarization else "false",
    ]

    t0 = time.time()
    proc = subprocess.Popen(
        cmd, cwd=str(_PY_DIR),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
    )
    peak = _peak_rss_bytes(proc)
    proc.wait()
    elapsed = time.time() - t0

    return {
        "label": label,
        "peakMb": round(peak / MB, 1),
        "seconds": round(elapsed, 1),
        "returncode": proc.returncode,
    }


def main() -> None:
    if not _FIXTURE.exists():
        print(f"Thiếu fixture {_FIXTURE} — bỏ qua.", file=sys.stderr)
        sys.exit(1)

    tmp_dir = _PY_DIR / "_bench_tmp"
    tmp_dir.mkdir(exist_ok=True)

    configs = [
        ("small-stt", "small", False),
        ("medium-stt", "medium", False),
        ("medium-diar", "medium", True),
    ]

    results = []
    for label, model, diar in configs:
        print(f"[bench] running {label} ...", flush=True)
        results.append(run_one(label, model, diar, tmp_dir))

    print("\n=== T-BENCH-001 RESULTS (máy dev, CPU/int8) ===")
    print(f"{'config':<14} {'peak RAM (MB)':>14} {'time (s)':>10} {'exit':>6}")
    for r in results:
        print(f"{r['label']:<14} {r['peakMb']:>14} {r['seconds']:>10} {r['returncode']:>6}")

    ok = [r for r in results if r["returncode"] == 0]
    if ok:
        max_peak = max(r["peakMb"] for r in ok)
        # Đề xuất ngưỡng: peak nặng nhất + ~50% headroom, làm tròn lên bội số 512.
        suggested = int(((max_peak * 1.5) // 512 + 1) * 512)
        print(f"\nPeak nặng nhất: {max_peak} MB")
        print(f"Đề xuất AI_WORKER_MIN_FREE_RAM_MB (peak*1.5, làm tròn 512): {suggested} MB")


if __name__ == "__main__":
    main()
