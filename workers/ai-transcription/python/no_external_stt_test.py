"""T024/T025 enforcement (code-level) — chống regression cho rule offline-only.

Pipeline AI BẮT BUỘC chạy offline, KHÔNG gọi cloud STT/API ngoài, KHÔNG egress
internet lúc runtime (mục 2 plan, NFR-004, T024, T025). Test này SCAN tĩnh toàn
bộ source Python của pipeline, fail ngay nếu có ai đó (vô tình) thêm dependency
cloud STT hoặc HTTP egress — biến rule thành kiểm tra tự động thay vì chỉ review
tay.

Đây là phần T025 verify được Ở TẦNG CODE (chạy trong CI bình thường). Phần
network-isolation tầng container (exec container + curl ra ngoài phải fail) là
infra, xem quy trình trong quickstart.md mục Security Verification.
"""

import re
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent

# Các pattern bị cấm: SDK cloud STT + thư viện egress HTTP tuỳ tiện.
# (MinIO/boto cho object storage NỘI BỘ không nằm ở tầng Python — Python chỉ
# nhận file đã tải sẵn từ Node qua MinIO nội bộ, nên Python KHÔNG được có lib mạng.)
_FORBIDDEN_PATTERNS = [
    r"\bimport\s+openai\b",
    r"\bfrom\s+openai\b",
    r"google\.cloud",
    r"\bimport\s+boto3\b",
    r"\bassemblyai\b",
    r"azure\.cognitiveservices",
    r"\bdeepgram\b",
    r"speech_v1",
    r"\bimport\s+requests\b",
    r"\bimport\s+httpx\b",
    r"urllib\.request",
    r"\bimport\s+socket\b",
]

# File pipeline thật (loại trừ chính file test này + các *_test.py).
_PIPELINE_FILES = [
    p
    for p in _PY_DIR.glob("*.py")
    if not p.name.endswith("_test.py")
]


def test_no_cloud_stt_or_http_egress_import_in_pipeline():
    offenders = []
    for path in _PIPELINE_FILES:
        text = path.read_text(encoding="utf-8")
        for pattern in _FORBIDDEN_PATTERNS:
            if re.search(pattern, text):
                offenders.append(f"{path.name}: khớp pattern cấm /{pattern}/")
    assert not offenders, (
        "Phát hiện dependency cloud STT / HTTP egress trong pipeline AI "
        "(vi phạm rule offline-only T024/T025):\n" + "\n".join(offenders)
    )


def test_diarization_enforces_offline_guards():
    """diarization_runner phải: (1) chặn cứng khi PYANNOTE_LOCAL_FILES_ONLY!=true,
    (2) ép HF_HUB_OFFLINE=1 trước khi import/chạy pyannote — không cho resolve
    model nested qua mạng."""
    text = (_PY_DIR / "diarization_runner.py").read_text(encoding="utf-8")
    assert 'os.environ["HF_HUB_OFFLINE"] = "1"' in text, (
        "diarization_runner phải set HF_HUB_OFFLINE=1 để chặn egress HuggingFace."
    )
    assert "PYANNOTE_LOCAL_FILES_ONLY" in text and "DiarizationUnavailableError" in text, (
        "diarization_runner phải chặn cứng khi PYANNOTE_LOCAL_FILES_ONLY != true."
    )
