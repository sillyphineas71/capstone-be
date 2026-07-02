"""pytest cho merge_segments.py (T018) — 4 case bắt buộc theo tasks.md T031:
1 speaker rõ, 2 speaker gần nhau (không overlap), overlap, không có kết quả
diarization. Dùng schemas.new_segment để tạo segment input giống hệt output
thật của whisper_runner/new_segment (speakerLabel mặc định "unknown")."""

from merge_segments import assign_speakers, build_detected_speakers
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
