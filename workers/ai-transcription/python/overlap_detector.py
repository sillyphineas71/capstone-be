"""Overlap detection từ diarization turns (T017).

Một "overlap window" là khoảng thời gian có >= 2 speaker turn (khác speaker)
chồng lấn nhau. Input là output của diarization_runner.diarize() — danh sách
turn đã sort theo startMs. Dùng sweep-line (duyệt theo mốc thời gian) để gộp
các overlap liên tiếp thành 1 window, tránh tạo nhiều window rời rạc cho cùng
một đoạn chồng tiếng kéo dài.

Output dùng để:
  1. Đánh dấu overlap=true cho STT segment chồng lấn (merge_segments.py, T018).
  2. Làm input cắt audio overlap cho SepFormer (sepformer_runner.py, M3/T019) —
     KHÔNG chạy SepFormer cho đoạn không overlap (FR-010).
"""

from typing import Any, Dict, List, Set


def detect_overlaps(turns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Trả về list overlap window {startMs, endMs, speakerLabels} đã gộp.

    turns không cần tự sort trước — hàm tự sort lại theo startMs để an toàn dù
    diarization_runner đã sort sẵn.
    """
    if len(turns) < 2:
        return []

    # Sự kiện mốc thời gian: (time, delta, speakerLabel). delta=+1 lúc turn bắt
    # đầu, -1 lúc kết thúc. Khi cùng mốc thời gian, xử lý "end" trước "start"
    # (delta tăng dần: -1 trước +1) để 2 turn liền kề (không thật sự overlap)
    # không bị tính nhầm thành overlap tức thời.
    events = []
    for turn in turns:
        events.append((turn["startMs"], 1, turn["speakerLabel"]))
        events.append((turn["endMs"], -1, turn["speakerLabel"]))
    events.sort(key=lambda e: (e[0], e[1]))

    active_count: Dict[str, int] = {}
    overlaps: List[Dict[str, Any]] = []
    window_start = None
    window_speakers: Set[str] = set()

    for time_ms, delta, speaker in events:
        was_overlapping = len(active_count) >= 2

        if delta == 1:
            active_count[speaker] = active_count.get(speaker, 0) + 1
        else:
            remaining = active_count.get(speaker, 0) - 1
            if remaining <= 0:
                active_count.pop(speaker, None)
            else:
                active_count[speaker] = remaining

        is_overlapping = len(active_count) >= 2

        if is_overlapping and not was_overlapping:
            window_start = time_ms
            window_speakers = set(active_count.keys())
        elif is_overlapping and was_overlapping:
            window_speakers |= set(active_count.keys())
        elif not is_overlapping and was_overlapping:
            overlaps.append(
                {
                    "startMs": window_start,
                    "endMs": time_ms,
                    "speakerLabels": sorted(window_speakers),
                }
            )
            window_start = None
            window_speakers = set()

    return overlaps


def detect_overlaps_from_segments(
    segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Phát hiện overlap từ danh sách segments đã gộp (channel_zone mode).

    Chuyển mỗi segment thành pseudo-turn rồi dùng lại detect_overlaps().
    Chỉ tạo turn cho segment có speakerLabel khác "unknown".
    """
    turns: List[Dict[str, Any]] = []
    for seg in segments:
        label = seg.get("speakerLabel", "unknown")
        if label == "unknown":
            continue
        turns.append(
            {
                "startMs": seg["startMs"],
                "endMs": seg["endMs"],
                "speakerLabel": label,
            }
        )
    return detect_overlaps(turns)


def mark_overlapping_segments(
    segments: List[Dict[str, Any]],
    overlap_windows: List[Dict[str, Any]],
) -> None:
    """Đánh dấu overlap=True cho segments nằm trong overlap windows (in-place)."""
    for seg in segments:
        if segment_overlaps_window(seg, overlap_windows):
            seg["overlap"] = True


def segment_overlaps_window(
    segment: Dict[str, Any], overlap_windows: List[Dict[str, Any]]
) -> bool:
    """True nếu khoảng [startMs, endMs) của segment giao với bất kỳ overlap
    window nào (so sánh nửa-mở để 2 khoảng liền kề không bị tính là giao nhau)."""
    seg_start, seg_end = segment["startMs"], segment["endMs"]
    for window in overlap_windows:
        if seg_start < window["endMs"] and seg_end > window["startMs"]:
            return True
    return False
