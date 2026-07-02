"""Align STT segments với diarization turns + overlap windows (T018).

Quy tắc gán speaker (theo docs/Offline Meeting Transcription Pipeline Plan.md
mục 5 và spec.md FR-026/FR-028 — KHÔNG được ép gán speaker khi không chắc):

  1. Với mỗi STT segment, tìm SPEAKER chiếm ưu thế = speaker có TỔNG thời gian
     overlap nhiều nhất (cộng dồn các turn cùng speaker — xem _dominant_speaker,
     robust khi pyannote fragment 1 speaker thành nhiều turn ngắn).
  2. overlapRatio = (tổng thời gian giao nhau của speaker thắng) / (độ dài segment).
  3. Segment nằm trong overlap window (>=2 speaker chồng tiếng, T017) → ở scope
     M2 (chưa có SepFormer tách — M3) giữ speakerLabel="unknown",
     manualReviewRequired=true, overlap=true. KHÔNG ép chọn 1 trong các speaker
     đang chồng tiếng.
  4. Segment không overlap: gán speaker CHỈ KHI overlapRatio >=
     SPEAKER_ASSIGN_MIN_OVERLAP_RATIO VÀ finalConfidence >=
     SPEAKER_ASSIGN_MIN_CONFIDENCE. Không đạt → "unknown".
  5. Không có turn nào giao với segment (không có kết quả diarization, hoặc
     segment rơi vào khoảng pyannote không gán speaker nào) → "unknown".

Ghi chú kỹ thuật về diarizationConfidence: `Pipeline.from_pretrained(...)` của
pyannote (API mặc định dùng ở T016) không expose xác suất per-turn trong output
chuẩn (`Annotation.itertracks`) — không có con số "confidence" gốc để dùng.
overlapRatio (tỷ lệ thời gian segment trùng với turn được chọn) là tín hiệu
định lượng đáng tin cậy nhất hiện có và được dùng làm proxy cho
diarizationConfidence, nhất quán với cách SPEAKER_ASSIGN_MIN_OVERLAP_RATIO
được định nghĩa trong plan (mục 5.3). Đây là giản lược có chủ đích theo nguyên
tắc "architecture-first, optimize-after-GPU-available" (plan Phase 6) — không
phải giá trị xác suất thống kê thật.
"""

import os
from typing import Any, Dict, List, Optional, Tuple

from overlap_detector import segment_overlaps_window


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _overlap_ms(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def _dominant_speaker(
    segment: Dict[str, Any], turns: List[Dict[str, Any]]
) -> Optional[Tuple[str, float]]:
    """Trả (speakerLabel, overlapRatio) của speaker CHIẾM ƯU THẾ trên segment,
    None nếu không turn nào giao với segment.

    QUAN TRỌNG — cộng dồn theo SPEAKER, không lấy 1 turn đơn (sửa 2026-07-01):
    pyannote rất hay fragment liên tục của CÙNG 1 speaker thành nhiều turn ngắn
    (vd 1 người nói 3.4s bị tách thành [31-1043]+[1111-3102] với khe hở nhỏ).
    Nếu chỉ lấy turn đơn lớn nhất, overlapRatio = 1991/3400 = 0.585 < ngưỡng
    0.65 -> bị gán "unknown" oan dù người đó rõ ràng chiếm ~88% segment. Cộng
    dồn overlap của tất cả turn cùng speaker rồi mới chia cho độ dài segment
    phản ánh đúng intent T018 ("gán speaker chiếm ưu thế") và robust với việc
    pyannote fragment turn.

    overlapRatio = tổng_overlap_của_speaker_thắng / độ_dài_segment (vẫn là proxy
    cho diarizationConfidence như mô tả ở docstring module).
    """
    seg_start, seg_end = segment["startMs"], segment["endMs"]
    seg_duration = max(1, seg_end - seg_start)  # tránh chia 0 cho segment 0ms

    overlap_by_speaker: Dict[str, int] = {}
    for turn in turns:
        overlap = _overlap_ms(seg_start, seg_end, turn["startMs"], turn["endMs"])
        if overlap > 0:
            label = turn["speakerLabel"]
            overlap_by_speaker[label] = overlap_by_speaker.get(label, 0) + overlap

    if not overlap_by_speaker:
        return None
    best_speaker = max(overlap_by_speaker, key=lambda k: overlap_by_speaker[k])
    return best_speaker, overlap_by_speaker[best_speaker] / seg_duration


def _mark_unknown(
    segment: Dict[str, Any],
    is_overlap: bool,
    reason: str,
    diarization_confidence: Optional[float] = None,
    final_confidence: Optional[float] = None,
) -> Dict[str, Any]:
    segment["speakerLabel"] = "unknown"
    segment["speakerSource"] = "unknown"
    segment["userId"] = None
    segment["overlap"] = is_overlap
    segment["diarizationConfidence"] = diarization_confidence
    if final_confidence is not None:
        segment["finalConfidence"] = final_confidence
    segment["lowConfidence"] = True
    segment["manualReviewRequired"] = True
    notes = list(segment.get("notes", []))
    if reason not in notes:
        notes.append(reason)
    segment["notes"] = notes
    return segment


def assign_speakers(
    segments: List[Dict[str, Any]],
    turns: List[Dict[str, Any]],
    overlap_windows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Gán speaker cho từng segment dựa trên diarization turns + overlap
    windows. Trả về list segment MỚI (không mutate list đầu vào). An toàn khi
    turns=[] (không có kết quả diarization) — mọi segment trả về "unknown"."""
    min_overlap_ratio = _env_float("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", 0.65)
    min_confidence = _env_float("SPEAKER_ASSIGN_MIN_CONFIDENCE", 0.70)

    result: List[Dict[str, Any]] = []
    for raw_segment in segments:
        segment = dict(raw_segment)
        is_overlap = segment_overlaps_window(segment, overlap_windows)

        match = _dominant_speaker(segment, turns)
        if match is None:
            result.append(
                _mark_unknown(segment, is_overlap, reason="no_diarization_turn_overlap")
            )
            continue

        speaker_label, overlap_ratio = match
        diarization_confidence = round(overlap_ratio, 4)
        stt_confidence = segment.get("sttConfidence") or 0.0
        final_confidence = round((diarization_confidence + stt_confidence) / 2, 4)

        if is_overlap:
            # M2 scope: SepFormer (M3) chưa chạy để tách overlap -> không ép
            # chọn 1 trong các speaker đang chồng tiếng, dù overlapRatio cao.
            result.append(
                _mark_unknown(
                    segment,
                    is_overlap=True,
                    reason="overlap_segment_no_separation_yet",
                    diarization_confidence=diarization_confidence,
                    final_confidence=final_confidence,
                )
            )
            continue

        if overlap_ratio < min_overlap_ratio or final_confidence < min_confidence:
            result.append(
                _mark_unknown(
                    segment,
                    is_overlap=False,
                    reason="below_speaker_assign_threshold",
                    diarization_confidence=diarization_confidence,
                    final_confidence=final_confidence,
                )
            )
            continue

        segment["speakerLabel"] = speaker_label
        segment["speakerSource"] = "pyannote"
        segment["overlap"] = False
        segment["diarizationConfidence"] = diarization_confidence
        segment["finalConfidence"] = final_confidence
        segment["lowConfidence"] = False
        segment["manualReviewRequired"] = False
        segment["notes"] = [n for n in segment.get("notes", []) if n != "m1_scope_no_diarization"]
        result.append(segment)

    return result


def build_detected_speakers(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Tổng hợp detected_speakers_json từ segments đã gán speaker.

    Hỗ trợ cả diarization (speakerSource=pyannote, mappingSource=diarization)
    và channel_zone (speakerSource=channel_zone, mappingSource=channel_zone,
    mappedUserId=userId từ segment)."""
    stats: Dict[str, Dict[str, Any]] = {}
    for segment in segments:
        label = segment["speakerLabel"]
        if label == "unknown":
            continue
        source = segment.get("speakerSource", "unknown")
        is_channel_zone = source == "channel_zone"
        entry = stats.setdefault(
            label,
            {
                "speakerLabel": label,
                "totalSpeakingMs": 0,
                "segmentCount": 0,
                "mappedUserId": segment.get("userId") if is_channel_zone else None,
                "mappingSource": "channel_zone" if is_channel_zone else "unmapped",
                "confidence": 0.0,
            },
        )
        entry["totalSpeakingMs"] += max(0, segment["endMs"] - segment["startMs"])
        entry["segmentCount"] += 1
        diarization_confidence = segment.get("diarizationConfidence") or 0.0
        entry["confidence"] = max(entry["confidence"], diarization_confidence)

    return list(stats.values())
