"""pytest cho overlap_detector.py (T017)."""

from overlap_detector import detect_overlaps, segment_overlaps_window


def _turn(start_ms, end_ms, speaker):
    return {"startMs": start_ms, "endMs": end_ms, "speakerLabel": speaker}


def test_no_overlap_with_single_turn():
    turns = [_turn(0, 2000, "Speaker_1")]
    assert detect_overlaps(turns) == []


def test_no_overlap_when_turns_sequential():
    turns = [
        _turn(0, 2000, "Speaker_1"),
        _turn(2000, 4000, "Speaker_2"),
    ]
    assert detect_overlaps(turns) == []


def test_detects_simple_overlap_between_two_speakers():
    turns = [
        _turn(0, 3000, "Speaker_1"),
        _turn(2000, 5000, "Speaker_2"),
    ]
    overlaps = detect_overlaps(turns)

    assert overlaps == [
        {"startMs": 2000, "endMs": 3000, "speakerLabels": ["Speaker_1", "Speaker_2"]}
    ]


def test_merges_continuous_overlap_across_three_speakers():
    # Speaker_1: 0-4000, Speaker_2: 2000-6000 (overlap 2000-4000 với Speaker_1),
    # Speaker_3: 3500-7000 (overlap với cả 2 trong khoảng 3500-4000) -> phải gộp
    # thành 1 window liên tục [2000, 6000), không tách rời.
    turns = [
        _turn(0, 4000, "Speaker_1"),
        _turn(2000, 6000, "Speaker_2"),
        _turn(3500, 7000, "Speaker_3"),
    ]
    overlaps = detect_overlaps(turns)

    assert len(overlaps) == 1
    assert overlaps[0]["startMs"] == 2000
    assert overlaps[0]["endMs"] == 6000
    assert overlaps[0]["speakerLabels"] == ["Speaker_1", "Speaker_2", "Speaker_3"]


def test_two_separate_overlap_windows_not_merged():
    turns = [
        _turn(0, 2000, "Speaker_1"),
        _turn(1000, 1500, "Speaker_2"),  # overlap window 1: [1000,1500)
        _turn(5000, 7000, "Speaker_1"),
        _turn(6000, 6500, "Speaker_2"),  # overlap window 2: [6000,6500)
    ]
    overlaps = detect_overlaps(turns)

    assert len(overlaps) == 2
    assert overlaps[0] == {"startMs": 1000, "endMs": 1500, "speakerLabels": ["Speaker_1", "Speaker_2"]}
    assert overlaps[1] == {"startMs": 6000, "endMs": 6500, "speakerLabels": ["Speaker_1", "Speaker_2"]}


def test_segment_overlaps_window_true_when_intersecting():
    windows = [{"startMs": 2000, "endMs": 4000, "speakerLabels": ["Speaker_1", "Speaker_2"]}]
    segment = {"startMs": 3000, "endMs": 5000}
    assert segment_overlaps_window(segment, windows) is True


def test_segment_overlaps_window_false_when_just_touching_boundary():
    windows = [{"startMs": 2000, "endMs": 4000, "speakerLabels": ["Speaker_1", "Speaker_2"]}]
    # Segment kết thúc đúng lúc window bắt đầu -> không thật sự giao nhau.
    segment = {"startMs": 0, "endMs": 2000}
    assert segment_overlaps_window(segment, windows) is False


def test_segment_overlaps_window_false_when_no_windows():
    assert segment_overlaps_window({"startMs": 0, "endMs": 1000}, []) is False
