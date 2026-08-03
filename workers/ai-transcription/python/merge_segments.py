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

SENTENCE_END_CHARS = (".", "!", "?")


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
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


def merge_fragmented_segments(
    segments: List[Dict[str, Any]],
    turns: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """GA-11 (2026-08-02, feat-transcript-segment-merge/spec.md FR-001..FR-003):
    gộp các segment STT liền kề thuộc CÙNG một lượt nói thành một segment hoàn
    chỉnh hơn, chạy TRƯỚC assign_speakers() (transcribe_pipeline.py).

    Chỉ gộp segment[i] vào segment gộp trước đó khi CẢ BA điều kiện đúng:
      1. Cả hai overlap với CÙNG một turn/speaker chiếm ưu thế theo
         _dominant_speaker() (tái dùng logic đã có, không viết lại). Segment
         không overlap turn nào -> _dominant_speaker trả None -> tự động
         KHÔNG đủ điều kiện gộp (khớp FR-009).
      2. Khoảng cách giữa endMs của cụm đang gộp và startMs segment kế tiếp <
         SEGMENT_MERGE_MAX_GAP_MS (env, mặc định 800ms — plan tổng GIAI ĐOẠN 1).
      3. Text của cụm đang gộp KHÔNG kết thúc bằng dấu kết câu (. ! ?) — coi
         là câu chưa xong, không phải hai câu độc lập của cùng người.

    AN TOÀN TUYỆT ĐỐI (spec.md ERR-GA-001): điều kiện (1) luôn được kiểm tra
    ĐẦU TIÊN trong `can_merge` — không có nhánh nào bỏ qua nó. Không bao giờ
    gộp hai segment khác turn/speaker chiếm ưu thế, dù khoảng cách gần đến đâu.

    Trả về danh sách MỚI, không mutate `segments` đầu vào. An toàn khi
    segments=[] hoặc turns=[] (trả nguyên segments, không gộp gì — khớp FR-007:
    caller chỉ gọi hàm này khi turns không rỗng, nhưng hàm tự vệ thêm ở đây).
    """
    if not segments or not turns:
        return list(segments)

    max_gap_ms = _env_int("SEGMENT_MERGE_MAX_GAP_MS", 800)

    merged: List[Dict[str, Any]] = [dict(segments[0])]
    prev_speaker = _dominant_speaker(segments[0], turns)

    for raw_segment in segments[1:]:
        segment = dict(raw_segment)
        current_speaker = _dominant_speaker(segment, turns)

        prev = merged[-1]
        prev_text = (prev.get("text") or "").strip()
        gap_ms = segment["startMs"] - prev["endMs"]
        ends_with_sentence_punct = prev_text.endswith(SENTENCE_END_CHARS)

        can_merge = (
            prev_speaker is not None
            and current_speaker is not None
            and prev_speaker[0] == current_speaker[0]
            and gap_ms < max_gap_ms
            and not ends_with_sentence_punct
        )

        if can_merge:
            merged[-1] = _merge_two_segments(prev, segment)
        else:
            merged.append(segment)

        prev_speaker = current_speaker

    return merged


def _merge_two_segments(prev: Dict[str, Any], nxt: Dict[str, Any]) -> Dict[str, Any]:
    """Gộp `nxt` vào `prev`, trả về segment MỚI (không mutate input). Trọng số
    trung bình theo độ dài GỐC của từng mảnh — tính TRƯỚC khi endMs bị đổi,
    tránh lệch trọng số (FR-003, spec.md)."""
    prev_duration = max(1, prev["endMs"] - prev["startMs"])
    nxt_duration = max(1, nxt["endMs"] - nxt["startMs"])
    total_duration = prev_duration + nxt_duration

    def _weighted_avg(a: Optional[float], b: Optional[float]) -> Optional[float]:
        a_val = a if a is not None else 0.0
        b_val = b if b is not None else 0.0
        return round((a_val * prev_duration + b_val * nxt_duration) / total_duration, 4)

    result = dict(prev)
    prev_text = (prev.get("text") or "").strip()
    result["text"] = (prev_text + " " + nxt["text"].strip()).strip()
    result["endMs"] = nxt["endMs"]
    result["sttConfidence"] = _weighted_avg(prev.get("sttConfidence"), nxt.get("sttConfidence"))
    result["finalConfidence"] = _weighted_avg(prev.get("finalConfidence"), nxt.get("finalConfidence"))
    # OR các cờ cảnh báo — không được để việc gộp âm thầm xoá cờ low-confidence/
    # manualReview của một trong hai mảnh gốc.
    result["lowConfidence"] = bool(prev.get("lowConfidence") or nxt.get("lowConfidence"))
    result["manualReviewRequired"] = bool(
        prev.get("manualReviewRequired") or nxt.get("manualReviewRequired")
    )
    merged_notes = list(prev.get("notes", []))
    for note in nxt.get("notes", []):
        if note not in merged_notes:
            merged_notes.append(note)
    if "segment_merged_same_turn" not in merged_notes:
        merged_notes.append("segment_merged_same_turn")
    result["notes"] = merged_notes
    return result


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
