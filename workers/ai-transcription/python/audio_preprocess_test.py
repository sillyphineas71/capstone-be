"""pytest cho audio_preprocess.py (T012). Dùng ffmpeg sinh audio test ngắn
(sine wave, không phải recording thật) — không commit audio thật vào git."""

import os
import subprocess
import tempfile

import pytest

from audio_preprocess import UnsupportedMediaFormatError, preprocess_audio


@pytest.fixture
def sample_wav(tmp_path):
    """Sinh 2 giây audio sine wave 44.1kHz stereo bằng ffmpeg (lavfi) — không
    phải recording thật, chỉ dùng để test pipeline normalize."""
    path = tmp_path / "sample.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-ar",
            "44100",
            "-ac",
            "2",
            str(path),
        ],
        capture_output=True,
        check=True,
    )
    return str(path)


def test_normalize_to_16khz_mono(sample_wav, tmp_path):
    output_path = str(tmp_path / "normalized.wav")
    metadata = preprocess_audio(sample_wav, output_path)

    assert os.path.exists(output_path)
    assert metadata["sampleRate"] == 16000
    assert metadata["channels"] == 1
    assert metadata["originalChannels"] == 2
    assert metadata["durationSeconds"] == pytest.approx(2.0, abs=0.2)


def test_keep_channels_true_preserves_original_channel_count(sample_wav, tmp_path):
    output_path = str(tmp_path / "normalized-multi.wav")
    metadata = preprocess_audio(sample_wav, output_path, keep_channels=True)

    assert metadata["channels"] == 2


def test_missing_input_file_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        preprocess_audio(str(tmp_path / "missing.wav"), str(tmp_path / "out.wav"))


def test_unsupported_format_raises(tmp_path):
    bad_file = tmp_path / "not-audio.txt"
    bad_file.write_text("this is not an audio file")

    with pytest.raises(UnsupportedMediaFormatError):
        preprocess_audio(str(bad_file), str(tmp_path / "out.wav"))
