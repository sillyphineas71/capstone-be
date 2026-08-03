"""pytest cho merge_segments.py (T018) — 4 case bắt buộc theo tasks.md T031:
1 speaker rõ, 2 speaker gần nhau (không overlap), overlap, không có kết quả
diarization. Dùng schemas.new_segment để tạo segment input giống hệt output
thật của whisper_runner/new_segment (speakerLabel mặc định "unknown")."""

from merge_segments import assign_speakers, build_detected_speakers, merge_fragmented_segments
from schemas import new_segment


def _turn(start_ms, end_ms, speaker):
    return {"startMs": start_ms, "endMs": end_ms, "speakerLabel": speaker}


def test_case_1_single_clear_speaker_gets_assigned(monkeypatch):
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    segments = [new_segment("seg-0000", 0, 2000, "Chào mọi người", stt_confidence=0.9)]
    turns = [_turn(0, 2000, "Speaker_1")]

    result = assign_speakers(segments, turns, overlap_windows=[])

    assert result[0]["speakerLabel"] == "Speaker_1"
    assert result[0]["speakerSource"] == "pyannote"
    assert result[0]["overlap"] is False
    assert result[0]["manualReviewRequired"] is False
    assert result[0]["diarizationConfidence"] == 1.0


def test_case_2_two_speakers_close_but_not_overlapping(monkeypatch):
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    segments = [
        new_segment("seg-0000", 0, 2000, "Xin chào", stt_confidence=0.9),
        new_segment("seg-0001", 2000, 4000, "Chào bạn", stt_confidence=0.9),
    ]
    turns = [
        _turn(0, 2000, "Speaker_1"),
        _turn(2000, 4000, "Speaker_2"),
    ]

    result = assign_speakers(segments, turns, overlap_windows=[])

    assert result[0]["speakerLabel"] == "Speaker_1"
    assert result[1]["speakerLabel"] == "Speaker_2"
    assert result[0]["overlap"] is False
    assert result[1]["overlap"] is False


def test_case_3_overlap_segment_kept_unknown_and_flagged_for_review(monkeypatch):
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    segments = [new_segment("seg-0000", 2000, 3000, "chồng tiếng", stt_confidence=0.8)]
    turns = [
        _turn(0, 3000, "Speaker_1"),
        _turn(2000, 5000, "Speaker_2"),
    ]
    overlap_windows = [{"startMs": 2000, "endMs": 3000, "speakerLabels": ["Speaker_1", "Speaker_2"]}]

    result = assign_speakers(segments, turns, overlap_windows)

    assert result[0]["speakerLabel"] == "unknown"
    assert result[0]["speakerSource"] == "unknown"
    assert result[0]["userId"] is None
    assert result[0]["overlap"] is True
    assert result[0]["lowConfidence"] is True
    assert result[0]["manualReviewRequired"] is True
    assert "overlap_segment_no_separation_yet" in result[0]["notes"]


def test_case_4_no_diarization_result_keeps_everything_unknown(monkeypatch):
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    segments = [new_segment("seg-0000", 0, 2000, "Không có diarization", stt_confidence=0.9)]

    result = assign_speakers(segments, turns=[], overlap_windows=[])

    assert result[0]["speakerLabel"] == "unknown"
    assert result[0]["speakerSource"] == "unknown"
    assert result[0]["manualReviewRequired"] is True
    assert "no_diarization_turn_overlap" in result[0]["notes"]


def test_below_overlap_ratio_threshold_stays_unknown(monkeypatch):
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    # Segment 0-2000ms, turn chỉ giao 1000ms (overlapRatio=0.5 < 0.65) -> unknown.
    segments = [new_segment("seg-0000", 0, 2000, "một phần", stt_confidence=0.9)]
    turns = [_turn(1000, 3000, "Speaker_1")]

    result = assign_speakers(segments, turns, overlap_windows=[])

    assert result[0]["speakerLabel"] == "unknown"
    assert "below_speaker_assign_threshold" in result[0]["notes"]


def test_does_not_mutate_input_segments(monkeypatch):
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    segments = [new_segment("seg-0000", 0, 2000, "test", stt_confidence=0.9)]
    original_speaker_label = segments[0]["speakerLabel"]

    assign_speakers(segments, [_turn(0, 2000, "Speaker_1")], overlap_windows=[])

    assert segments[0]["speakerLabel"] == original_speaker_label


def test_build_detected_speakers_aggregates_per_speaker(monkeypatch):
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    segments = [
        new_segment("seg-0000", 0, 2000, "a", stt_confidence=0.9),
        new_segment("seg-0001", 2000, 5000, "b", stt_confidence=0.9),
        new_segment("seg-0002", 5000, 6000, "c", stt_confidence=0.9),
    ]
    turns = [
        _turn(0, 2000, "Speaker_1"),
        _turn(2000, 5000, "Speaker_2"),
        _turn(5000, 6000, "Speaker_1"),
    ]

    assigned = assign_speakers(segments, turns, overlap_windows=[])
    detected = build_detected_speakers(assigned)
    by_label = {d["speakerLabel"]: d for d in detected}

    assert set(by_label.keys()) == {"Speaker_1", "Speaker_2"}
    assert by_label["Speaker_1"]["totalSpeakingMs"] == 3000  # 2000 + 1000
    assert by_label["Speaker_1"]["segmentCount"] == 2
    assert by_label["Speaker_2"]["totalSpeakingMs"] == 3000
    assert by_label["Speaker_2"]["segmentCount"] == 1
    assert all(d["mappedUserId"] is None for d in detected)
    assert all(d["mappingSource"] == "unmapped" for d in detected)


def test_fragmented_same_speaker_turns_aggregate_and_assign(monkeypatch):
    """REGRESSION (2026-07-01): pyannote fragment 1 speaker thành nhiều turn
    ngắn có khe hở. Trước đây lấy turn đơn lớn nhất -> overlapRatio dưới ngưỡng
    -> gán "unknown" oan. Sau khi cộng dồn theo speaker, segment phải được gán
    đúng speaker chiếm ưu thế. Mô phỏng đúng case fixture sample-overlap.wav."""
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_OVERLAP_RATIO", "0.65")
    monkeypatch.setenv("SPEAKER_ASSIGN_MIN_CONFIDENCE", "0.70")

    # Segment 0-3400ms; Speaker_1 bị tách thành 2 turn (khe hở 1043-1111).
    # Turn đơn lớn nhất = 1991ms -> ratio 0.585 < 0.65 (cũ: unknown).
    # Cộng dồn = 1012 + 1991 = 3003ms -> ratio 0.88 > 0.65 (mới: Speaker_1).
    segments = [new_segment("seg-0000", 0, 3400, "một người nói liên tục", stt_confidence=0.9)]
    turns = [
        _turn(31, 1043, "Speaker_1"),
        _turn(1111, 3102, "Speaker_1"),
    ]

    result = assign_speakers(segments, turns, overlap_windows=[])

    assert result[0]["speakerLabel"] == "Speaker_1"
    assert result[0]["speakerSource"] == "pyannote"
    assert result[0]["manualReviewRequired"] is False
    assert result[0]["diarizationConfidence"] >= 0.65


def test_build_detected_speakers_excludes_unknown():
    segments = [
        {"speakerLabel": "unknown", "startMs": 0, "endMs": 2000, "diarizationConfidence": None},
    ]
    assert build_detected_speakers(segments) == []


# ─── merge_fragmented_segments (GA-11, feat-transcript-segment-merge/spec.md) ──
# 4 case bắt buộc theo tasks.md T-MERGE-004: gộp đúng (AC-001), AN TOÀN không
# gộp qua 2 speaker khác nhau (AC-002/ERR-GA-001 — quan trọng nhất), không gộp
# khi cách xa (AC-003), không gộp khi có dấu kết câu (AC-004).


def test_ac001_merges_two_fragments_same_turn_close_gap_no_sentence_end(monkeypatch):
    monkeypatch.setenv("SEGMENT_MERGE_MAX_GAP_MS", "800")

    segments = [
        new_segment("seg-0000", 0, 4900, "Chủ đề của chúng ta là biến đổi khí hậu", stt_confidence=0.9),
        new_segment("seg-0001", 5100, 7500, "và tình trạng nóng lên toàn cầu", stt_confidence=0.85),
    ]
    turns = [_turn(0, 7500, "Speaker_1")]

    result = merge_fragmented_segments(segments, turns)

    assert len(result) == 1
    assert result[0]["text"] == "Chủ đề của chúng ta là biến đổi khí hậu và tình trạng nóng lên toàn cầu"
    assert result[0]["startMs"] == 0
    assert result[0]["endMs"] == 7500
    assert "segment_merged_same_turn" in result[0]["notes"]


def test_ac002_safety_never_merges_across_two_different_speakers(monkeypatch):
    """AN TOÀN TUYỆT ĐỐI (ERR-GA-001) — case quan trọng nhất của cả feature.
    Dù khoảng cách rất gần (0.1s, dưới mọi ngưỡng hợp lý), hai segment thuộc
    hai turn/speaker chiếm ưu thế KHÁC NHAU không bao giờ được gộp."""
    monkeypatch.setenv("SEGMENT_MERGE_MAX_GAP_MS", "800")

    segments = [
        new_segment("seg-0000", 0, 2000, "Xin chào mọi người", stt_confidence=0.9),
        new_segment("seg-0001", 2100, 4000, "Chào bạn tôi khoẻ", stt_confidence=0.9),
    ]
    turns = [
        _turn(0, 2000, "Speaker_1"),
        _turn(2100, 4000, "Speaker_2"),
    ]

    result = merge_fragmented_segments(segments, turns)

    assert len(result) == 2
    assert result[0]["text"] == "Xin chào mọi người"
    assert result[1]["text"] == "Chào bạn tôi khoẻ"


def test_ac003_does_not_merge_when_gap_exceeds_threshold(monkeypatch):
    monkeypatch.setenv("SEGMENT_MERGE_MAX_GAP_MS", "800")

    segments = [
        new_segment("seg-0000", 0, 2000, "Một câu", stt_confidence=0.9),
        # Khoảng cách 3000ms > ngưỡng 800ms, dù cùng Speaker_1.
        new_segment("seg-0001", 5000, 6000, "câu khác", stt_confidence=0.9),
    ]
    turns = [_turn(0, 6000, "Speaker_1")]

    result = merge_fragmented_segments(segments, turns)

    assert len(result) == 2


def test_ac004_does_not_merge_when_previous_ends_with_sentence_punctuation(monkeypatch):
    monkeypatch.setenv("SEGMENT_MERGE_MAX_GAP_MS", "800")

    segments = [
        new_segment("seg-0000", 0, 2000, "Được rồi.", stt_confidence=0.9),
        new_segment("seg-0001", 2300, 3000, "Tiếp theo là", stt_confidence=0.9),
    ]
    turns = [_turn(0, 3000, "Speaker_1")]

    result = merge_fragmented_segments(segments, turns)

    assert len(result) == 2
    assert result[0]["text"] == "Được rồi."


def test_fr009_segment_with_no_turn_overlap_never_merges(monkeypatch):
    monkeypatch.setenv("SEGMENT_MERGE_MAX_GAP_MS", "800")

    segments = [
        new_segment("seg-0000", 0, 2000, "trong vùng có turn", stt_confidence=0.9),
        # 2000-2500ms không giao turn nào (turn duy nhất kết thúc ở 2000ms).
        new_segment("seg-0001", 2000, 2500, "ngoài vùng turn", stt_confidence=0.9),
    ]
    turns = [_turn(0, 2000, "Speaker_1")]

    result = merge_fragmented_segments(segments, turns)

    assert len(result) == 2


def test_empty_turns_returns_segments_unchanged(monkeypatch):
    segments = [new_segment("seg-0000", 0, 2000, "test", stt_confidence=0.9)]

    result = merge_fragmented_segments(segments, turns=[])

    assert result == segments


def test_merge_does_not_mutate_input_segments(monkeypatch):
    monkeypatch.setenv("SEGMENT_MERGE_MAX_GAP_MS", "800")

    segments = [
        new_segment("seg-0000", 0, 2000, "Một câu", stt_confidence=0.9),
        new_segment("seg-0001", 2100, 3000, "chưa xong", stt_confidence=0.9),
    ]
    original_first_text = segments[0]["text"]
    turns = [_turn(0, 3000, "Speaker_1")]

    merge_fragmented_segments(segments, turns)

    assert segments[0]["text"] == original_first_text
    assert len(segments) == 2
