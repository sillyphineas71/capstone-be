"""pytest cho diarization_runner.py (T016).

Mock pyannote.audio qua sys.modules — KHÔNG phụ thuộc package pyannote.audio
thật được cài hay không, vì model gated/HuggingFace token là việc của
T-HF-001 (thủ công, ngoài CI). Test chỉ xác nhận hợp đồng (contract) giữa
diarization_runner và pyannote.audio.Pipeline, cộng các nhánh fail-safe.
"""

import contextlib
import sys
import types
from unittest.mock import patch

import pytest

import diarization_runner
from diarization_runner import DiarizationUnavailableError, diarize


@pytest.fixture(autouse=True)
def _no_real_torch_import(monkeypatch):
    """Mọi test trong file này mock pyannote.audio qua sys.modules — không cần
    torch/torchaudio thật. No-op shim thật (`_patch_torchaudio_list_audio_backends_if_missing`,
    `_torch_load_default_weights_only_false`) để tránh import torch lặp lại
    nhiều lần trong cùng 1 pytest process: đã quan sát lỗi instability không
    ổn định (kể cả "Windows fatal exception: access violation", hoặc decode
    error lạ) khi torch bị import xen kẽ nhiều lần trong cùng process trên
    môi trường Python 3.14 + torch 2.12.0 (cpu) — đây là vấn đề native/môi
    trường, không phải bug logic của diarization_runner. Hành vi shim thật +
    Pipeline.from_pretrained với model pyannote thật (preload qua T-HF-001) đã
    được verify thủ công riêng ngoài pytest, từng process độc lập — xem
    changelog `tasks.md` 2026-06-30 (T-HF-001/T016 readiness)."""
    monkeypatch.setattr(
        diarization_runner,
        "_patch_torchaudio_list_audio_backends_if_missing",
        lambda: None,
    )
    monkeypatch.setattr(
        diarization_runner,
        "_torch_load_default_weights_only_false",
        contextlib.contextmanager(lambda: iter([None])),
    )


def _set_pyannote_env(monkeypatch, model_dir):
    """Set PYANNOTE_MODEL_PATH + tạo file config.yaml giả bên trong (bắt buộc —
    _resolve_model_path() chỉ chấp nhận thư mục có config.yaml, xem
    diarization_runner._resolve_model_path)."""
    import pathlib

    config_path = pathlib.Path(model_dir) / "config.yaml"
    config_path.write_text("pipeline:\n  name: fake\n", encoding="utf-8")
    monkeypatch.setenv("PYANNOTE_MODEL_PATH", str(model_dir))
    monkeypatch.setenv("PYANNOTE_LOCAL_FILES_ONLY", "true")
    return str(config_path)


class _FakeTurn:
    def __init__(self, start, end):
        self.start = start
        self.end = end


class _FakeAnnotation:
    def __init__(self, tracks):
        self._tracks = tracks

    def itertracks(self, yield_label=False):
        for track in self._tracks:
            yield track


def _install_fake_pyannote(tracks=None, from_pretrained_error=None, call_error=None):
    """Cài 1 fake module pyannote.audio vào sys.modules, trả về context patch
    có thể dùng trong `with`."""

    class _FakePipeline:
        received_model_path = None

        @classmethod
        def from_pretrained(cls, model_path):
            cls.received_model_path = model_path
            if from_pretrained_error:
                raise from_pretrained_error
            return cls()

        def __call__(self, audio_path):
            if call_error:
                raise call_error
            return _FakeAnnotation(tracks or [])

    fake_audio_module = types.ModuleType("pyannote.audio")
    fake_audio_module.Pipeline = _FakePipeline
    fake_pyannote_pkg = types.ModuleType("pyannote")
    fake_pyannote_pkg.audio = fake_audio_module

    return patch.dict(
        sys.modules,
        {"pyannote": fake_pyannote_pkg, "pyannote.audio": fake_audio_module},
    ), _FakePipeline


def test_raises_when_model_path_missing(monkeypatch):
    monkeypatch.delenv("PYANNOTE_MODEL_PATH", raising=False)
    monkeypatch.setenv("PYANNOTE_LOCAL_FILES_ONLY", "true")

    with pytest.raises(DiarizationUnavailableError, match="PYANNOTE_MODEL_PATH"):
        diarize("fake-audio.wav")


def test_raises_when_model_path_not_a_directory(monkeypatch, tmp_path):
    not_a_dir = tmp_path / "does-not-exist"
    monkeypatch.setenv("PYANNOTE_MODEL_PATH", str(not_a_dir))
    monkeypatch.setenv("PYANNOTE_LOCAL_FILES_ONLY", "true")

    with pytest.raises(DiarizationUnavailableError):
        diarize("fake-audio.wav")


def test_raises_when_local_files_only_is_false(monkeypatch, tmp_path):
    monkeypatch.setenv("PYANNOTE_MODEL_PATH", str(tmp_path))
    monkeypatch.setenv("PYANNOTE_LOCAL_FILES_ONLY", "false")

    with pytest.raises(DiarizationUnavailableError, match="LOCAL_FILES_ONLY"):
        diarize("fake-audio.wav")


def test_raises_when_config_yaml_missing_in_model_dir(monkeypatch, tmp_path):
    # Thư mục tồn tại nhưng KHÔNG có config.yaml bên trong — phải fail rõ ràng
    # thay vì để Pipeline.from_pretrained() âm thầm hiểu nhầm path thành
    # HuggingFace repo_id rồi cố gọi mạng (regression đã gặp thật khi build T016).
    monkeypatch.setenv("PYANNOTE_MODEL_PATH", str(tmp_path))
    monkeypatch.setenv("PYANNOTE_LOCAL_FILES_ONLY", "true")

    with pytest.raises(DiarizationUnavailableError, match="config.yaml"):
        diarize("fake-audio.wav")


def test_raises_when_pyannote_audio_not_installed(monkeypatch, tmp_path):
    _set_pyannote_env(monkeypatch, str(tmp_path))
    # Ép import "pyannote.audio" raise ImportError, không phụ thuộc môi trường
    # CI có cài package thật hay không.
    with patch.dict(sys.modules, {"pyannote.audio": None}):
        with pytest.raises(DiarizationUnavailableError, match="chưa được cài"):
            diarize("fake-audio.wav")


def test_raises_when_pipeline_call_fails(monkeypatch, tmp_path):
    _set_pyannote_env(monkeypatch, str(tmp_path))
    patcher, _ = _install_fake_pyannote(call_error=RuntimeError("boom"))

    with patcher:
        with pytest.raises(DiarizationUnavailableError, match="pyannote pipeline lỗi"):
            diarize("fake-audio.wav")


def test_returns_turns_sorted_chronologically_with_remapped_labels(monkeypatch, tmp_path):
    config_path = _set_pyannote_env(monkeypatch, str(tmp_path))
    tracks = [
        (_FakeTurn(2.0, 4.0), None, "SPEAKER_01"),
        (_FakeTurn(0.0, 1.5), None, "SPEAKER_00"),
        (_FakeTurn(4.0, 5.0), None, "SPEAKER_01"),
    ]
    patcher, fake_pipeline_cls = _install_fake_pyannote(tracks=tracks)

    with patcher:
        turns = diarize("fake-audio.wav")

    # Pipeline.from_pretrained() phải nhận đúng path tới FILE config.yaml, không
    # phải thư mục — xem _resolve_model_path().
    assert fake_pipeline_cls.received_model_path == config_path
    assert turns == [
        {"startMs": 0, "endMs": 1500, "speakerLabel": "Speaker_1"},
        {"startMs": 2000, "endMs": 4000, "speakerLabel": "Speaker_2"},
        {"startMs": 4000, "endMs": 5000, "speakerLabel": "Speaker_2"},
    ]
