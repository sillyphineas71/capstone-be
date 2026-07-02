"""ffmpeg audio normalization (T012).

Convert input audio/video (.wav/.mp3/.m4a/.mp4/...) sang WAV 16kHz cho
faster-whisper. Dùng ffprobe để phát hiện stream audio thật (không chỉ dựa vào
extension) — input không có audio stream hợp lệ -> UnsupportedMediaFormatError.
"""

import json
import os
import subprocess
from typing import Any, Dict


class UnsupportedMediaFormatError(Exception):
    pass


def _ffprobe_metadata(input_path: str) -> Dict[str, Any]:
    ffprobe_bin = os.environ.get("AI_WORKER_FFPROBE_BIN", "ffprobe")
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise UnsupportedMediaFormatError(
            f"ffprobe không đọc được file: {result.stderr.strip()[-300:]}"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise UnsupportedMediaFormatError(f"ffprobe output không hợp lệ: {exc}") from exc


def preprocess_audio(
    input_path: str,
    output_path: str,
    keep_channels: bool = False,
) -> Dict[str, Any]:
    """Normalize audio về WAV 16kHz. Trả về metadata (duration/sample_rate/channels).

    keep_channels=True giữ nguyên số channel gốc (cần cho speakerMappingMode=
    channel_zone ở milestone sau) — M1 mặc định downmix mono.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input audio not found: {input_path}")

    metadata = _ffprobe_metadata(input_path)
    audio_streams = [
        s for s in metadata.get("streams", []) if s.get("codec_type") == "audio"
    ]
    if not audio_streams:
        raise UnsupportedMediaFormatError(f"Không có audio stream trong {input_path}")

    original_channels = int(audio_streams[0].get("channels", 1))
    duration_seconds = float(metadata.get("format", {}).get("duration", 0.0))

    ffmpeg_bin = os.environ.get("AI_WORKER_FFMPEG_BIN", "ffmpeg")
    cmd = [ffmpeg_bin, "-y", "-i", input_path, "-ar", "16000"]
    if not keep_channels:
        cmd += ["-ac", "1"]
    cmd += [output_path]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise UnsupportedMediaFormatError(
            f"ffmpeg normalize thất bại: {result.stderr.strip()[-500:]}"
        )

    return {
        "durationSeconds": duration_seconds,
        "sampleRate": 16000,
        "channels": original_channels if keep_channels else 1,
        "originalChannels": original_channels,
    }
