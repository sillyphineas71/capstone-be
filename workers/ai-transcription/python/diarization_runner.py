"""pyannote.audio diarization runner (T016).

Load model offline từ PYANNOTE_MODEL_PATH (đã preload qua T-HF-001 — accept
license HuggingFace + tải về máy có internet, KHÔNG tải ở runtime container).
PYANNOTE_LOCAL_FILES_ONLY phải là true trong mọi profile MVP.

Mọi lỗi (model thiếu, pipeline lỗi, import lỗi) raise DiarizationUnavailableError
thay vì để exception gốc lan ra ngoài — caller (transcribe_pipeline.py) BẮT BUỘC
catch exception này và fallback toàn bộ segment về speakerLabel="unknown" +
warning "diarization_failed_fallback_unknown" (FR-026), không được fail cả job
vì STT vẫn có giá trị dùng được mà không có diarization.
"""

import contextlib
import os
from typing import Any, Dict, List


class DiarizationUnavailableError(Exception):
    """Raised khi không thể chạy diarization (model thiếu/lỗi/chưa cài lib).
    Caller phải catch và fallback, không propagate làm fail job."""


class _AudioMetaDataStub:
    """Stub thay cho `torchaudio.AudioMetaData` đã bị bỏ khỏi torchaudio mới
    — dùng chung cho cả patch `AudioMetaData` (import-time compat, xem
    `_patch_torchaudio_list_audio_backends_if_missing`) lẫn patch
    `torchaudio.info` (xem `_patch_torchaudio_info_to_use_soundfile`)."""

    def __init__(self, sample_rate=None, num_frames=None, num_channels=None, bits_per_sample=None, encoding=None):
        self.sample_rate = sample_rate
        self.num_frames = num_frames
        self.num_channels = num_channels
        self.bits_per_sample = bits_per_sample
        self.encoding = encoding


def _patch_torchaudio_list_audio_backends_if_missing() -> None:
    """Compat shim cho torchaudio mới (>=2.1) đã bỏ hẳn API backend-registry cũ
    (`list_audio_backends`/`set_audio_backend`...) để chuyển sang dispatch tự
    động. `pyannote.audio==3.4.0` (pin theo requirements.txt) vẫn gọi
    `torchaudio.list_audio_backends()` ở `pyannote/audio/core/io.py` ngay tại
    thời điểm import module (`pyannote.audio.utils.protocol`) để chọn backend
    mặc định — thiếu hàm này làm `import pyannote.audio` crash hẳn trước khi
    chạy được dòng code nào của ta.

    Shim chỉ trả về danh sách backend mà pyannote dùng để chọn ưu tiên
    "soundfile" (xem io.py: `backend = "soundfile" if "soundfile" in backends
    else backends[0]`) — soundfile đã có sẵn (dependency của pyannote.audio),
    nên giá trị trả về đúng với hành vi mà code gốc kỳ vọng, không thay đổi
    logic chọn backend thật.

    Cùng hàm này cũng patch `torchaudio.AudioMetaData` nếu thiếu — xác nhận
    thật qua T-HF-001 (2026-06-30): trên máy dev (`torch==2.12.0+cpu`,
    `torchaudio==2.11.0+cpu` — bản torchaudio mới nhất hiện có trên PyPI cho
    `torch 2.12`, KHÔNG phải lỗi version mismatch sửa được bằng pin lại), class
    `AudioMetaData` đã bị bỏ khỏi torchaudio. `pyannote/audio/tasks/segmentation/
    mixins.py` vẫn `from torchaudio import AudioMetaData` ở module level — import
    fail ngay cả khi ta chỉ dùng pipeline INFERENCE (`Pipeline.from_pretrained` +
    gọi pipeline), không hề train, vì Python import toàn bộ `pyannote.audio.tasks`
    qua chuỗi import của `pyannote.audio.pipelines`. `mixins.py` chỉ thật sự khởi
    tạo `AudioMetaData(...)` trong code path chuẩn bị dữ liệu TRAINING — không
    chạy ở runtime inference của ta — nên 1 stub class rỗng (chỉ cần nhận đúng
    kwargs, không cần hành vi thật) là đủ để qua được import-time, không ảnh hưởng
    kết quả diarization thật.
    """
    import torchaudio

    if not hasattr(torchaudio, "list_audio_backends"):
        torchaudio.list_audio_backends = lambda: ["soundfile"]  # type: ignore[attr-defined]

    if not hasattr(torchaudio, "AudioMetaData"):
        torchaudio.AudioMetaData = _AudioMetaDataStub  # type: ignore[attr-defined]

    _patch_huggingface_hub_use_auth_token_kwarg_if_needed()
    _patch_speechbrain_lazy_module_windows_path_bug_if_present()
    _patch_torchaudio_load_to_use_soundfile(torchaudio)
    _patch_torchaudio_info_to_use_soundfile(torchaudio)


def _patch_torchaudio_load_to_use_soundfile(torchaudio) -> None:
    """Compat shim cho `torchaudio` mới (xác nhận thật trên máy dev) đã đổi
    `torchaudio.load()` thành CHỈ dùng `torchcodec` để decode audio —
    docstring của chính `torchaudio.load()` ghi rõ: "the `backend` are
    ignored and accepted only for backwards compatibility". Tham số
    `backend="soundfile"` mà `pyannote/audio/core/io.py` truyền vào (qua shim
    `list_audio_backends` ở trên) bị bỏ qua hoàn toàn — không có cách nào ép
    `torchaudio.load()` dùng lại backend cũ qua tham số public.

    `torchcodec` (đã cài) cần FFmpeg shared libraries (DLL) bản "full-shared"
    — chưa có sẵn trên máy dev Windows này, lỗi load native library, KHÔNG
    phải lỗi code Python sửa được. Cài FFmpeg DLL đúng bản là việc setup môi
    trường/infra, không phải scope của task này.

    Patch thẳng `torchaudio.load` để đọc bằng `soundfile` (đã là dependency
    có sẵn của `pyannote.audio`, pure wheel không cần FFmpeg native) và tự
    chuyển đổi sang đúng contract `(waveform: Tensor[channel, time], sample_rate:
    int)` mà `pyannote/audio/core/io.py: Audio.__call__` kỳ vọng — giữ đúng
    hành vi gốc trước khi torchaudio đổi sang torchcodec-only.
    """
    if getattr(torchaudio.load, "_soundfile_shim", False):
        return  # đã patch — idempotent.

    import soundfile as sf
    import torch as _torch

    def _load_via_soundfile(
        filepath,
        frame_offset: int = 0,
        num_frames: int = -1,
        *args,
        **kwargs,
    ):
        # QUAN TRỌNG: `pyannote/audio/core/io.py: Audio.crop()` gọi
        # `torchaudio.load(file, frame_offset=..., num_frames=...)` để đọc
        # ĐÚNG 1 cửa sổ (window) ngắn của audio, không phải cả file — nhiều
        # window được crop rồi `torch.vstack()` lại thành 1 batch, nên PHẢI
        # đọc đúng `num_frames` mẫu, không được trả nguyên file (bug đã gặp
        # thật ở bản patch đầu tiên: bỏ qua 2 kwarg này, gây
        # `RuntimeError: Sizes of tensors must match` khi vstack các window
        # có độ dài lệch nhau, vì window cuối/đầu của audio bị trả về full
        # length thay vì đúng `num_frames` yêu cầu).
        stop = None if num_frames is None or num_frames < 0 else frame_offset + num_frames
        data, sample_rate = sf.read(
            filepath,
            start=frame_offset,
            stop=stop,
            dtype="float32",
            always_2d=True,
        )
        # soundfile trả (frames, channels) — torchaudio/pyannote kỳ vọng
        # (channels, frames).
        waveform = _torch.from_numpy(data.T.copy())
        return waveform, sample_rate

    _load_via_soundfile._soundfile_shim = True  # type: ignore[attr-defined]
    torchaudio.load = _load_via_soundfile  # type: ignore[assignment]


def _patch_torchaudio_info_to_use_soundfile(torchaudio) -> None:
    """Compat shim cho `torchaudio.info()` — cũng đã bị bỏ khỏi torchaudio mới
    cùng đợt với `torchaudio.load()` (xem `_patch_torchaudio_load_to_use_soundfile`),
    cùng lý do (torchcodec-only, cần FFmpeg DLL chưa có trên máy dev). Dùng
    `soundfile.info()` thay thế — `pyannote/audio/core/io.py:get_torchaudio_info`
    chỉ thật sự đọc 2 field `num_frames`/`sample_rate` từ kết quả trả về (xem
    `core/io.py:crop`), nên chỉ cần map đúng 2 field đó qua `_AudioMetaDataStub`
    là đủ cho toàn bộ code path inference.
    """
    if hasattr(torchaudio, "info") and getattr(
        torchaudio.info, "_soundfile_shim", False
    ):
        return  # đã patch — idempotent.

    import soundfile as sf

    def _info_via_soundfile(filepath, *args, **kwargs):
        sf_info = sf.info(filepath)
        return _AudioMetaDataStub(
            sample_rate=sf_info.samplerate,
            num_frames=sf_info.frames,
            num_channels=sf_info.channels,
            bits_per_sample=None,
            encoding=sf_info.subtype,
        )

    _info_via_soundfile._soundfile_shim = True  # type: ignore[attr-defined]
    torchaudio.info = _info_via_soundfile  # type: ignore[attr-defined]


def _patch_speechbrain_lazy_module_windows_path_bug_if_present() -> None:
    """Compat shim cho bug path-separator THẬT trong `speechbrain.utils.
    importutils.LazyModule.ensure_module` (xác nhận qua traceback thật khi
    chạy `Pipeline.from_pretrained()`): `pyannote.audio.pipelines.__init__`
    import cả `speech_separation.py` (dùng cho M3/SepFormer, không liên quan
    M2 diarization) — pipeline đó `import speechbrain`, và speechbrain đăng
    ký các submodule optional (vd `speechbrain.integrations.k2_fsa`, cần
    package `k2` rời không phải dependency bắt buộc) dưới dạng `LazyModule`
    (chỉ import thật khi bị truy cập attribute).

    `pytorch_lightning.utilities.model_helpers.wrapper` gọi `inspect.stack()`
    để check `is_scripting` — việc walk toàn bộ frame này vô tình chạm vào
    các `LazyModule` đang nằm trong `sys.modules` (qua `inspect.getmodule`
    kiểm tra `hasattr(module, "__file__")`), kích hoạt import thật của
    `k2_fsa` dù ta không hề dùng SepFormer ở đây.

    `LazyModule.ensure_module()` tự nó ĐÃ có cơ chế chặn đúng trường hợp này
    (raise `AttributeError` thay vì import thật khi function gọi là chính
    `inspect.py`) — nhưng check đó hard-code
    `importer_frame.filename.endswith("/inspect.py")` (dấu `/` kiểu Unix).
    Trên Windows, `filename` là `...\\Lib\\inspect.py` (dấu `\\`) nên check
    luôn `False` — cơ chế bảo vệ không bao giờ kích hoạt được trên Windows,
    đây là bug thật của speechbrain, không phải lỗi thiết kế của ta. Patch
    lại đúng logic gốc (dùng `os.path.basename` để không phụ thuộc dấu phân
    cách path của OS) thay vì tắt hẳn an toàn check.
    """
    try:
        import speechbrain.utils.importutils as sb_importutils
    except ImportError:
        return  # speechbrain không cài (optional, chỉ cần cho M3) — bỏ qua.

    if getattr(sb_importutils.LazyModule.ensure_module, "_windows_path_fix", False):
        return  # đã patch — idempotent.

    import inspect as _inspect
    import os as _os
    import sys as _sys
    import warnings as _warnings

    def _ensure_module_fixed(self, stacklevel: int):
        importer_frame = None
        try:
            importer_frame = _inspect.getframeinfo(_sys._getframe(stacklevel + 1))
        except AttributeError:
            _warnings.warn(
                "Failed to inspect frame to check if we should ignore "
                "importing a module lazily."
            )

        if importer_frame is not None and _os.path.basename(
            importer_frame.filename
        ) == "inspect.py":
            raise AttributeError()

        if self.lazy_module is None:
            try:
                if self.package is None:
                    self.lazy_module = __import__(self.target, fromlist=["_"])
                else:
                    import importlib

                    self.lazy_module = importlib.import_module(
                        f".{self.target}", self.package
                    )
            except Exception as e:
                raise ImportError(f"Lazy import of {self!r} failed") from e

        return self.lazy_module

    _ensure_module_fixed._windows_path_fix = True  # type: ignore[attr-defined]
    sb_importutils.LazyModule.ensure_module = _ensure_module_fixed  # type: ignore[assignment]


@contextlib.contextmanager
def _torch_load_default_weights_only_false():
    """Compat shim cho `torch>=2.6` (xác nhận thật: `torch==2.12.0+cpu`) đã đổi
    default `weights_only=True` cho `torch.load` (security hardening — chặn
    arbitrary code execution từ pickle không tin cậy). Checkpoint pickle cũ
    của `pyannote.audio`/`pytorch-lightning` (`pytorch_model.bin` của
    `pyannote/segmentation-3.0`) chứa nhiều custom global class
    (`torch.torch_version.TorchVersion`, `pyannote.audio.core.task.
    Specifications`, và có thể thêm class khác tuỳ phiên bản) — allowlist
    từng class một qua `add_safe_globals` là whack-a-mole không có điểm dừng
    rõ ràng (mỗi global mới lại cần 1 vòng lặp sửa-test-chạy-lại).

    Thay vào đó, default `weights_only=False` (đúng hành vi `torch.load`
    trước PyTorch 2.6) NHƯNG chỉ trong đúng cửa sổ gọi `Pipeline.from_pretrained()`
    (model-loading, không phải lúc inference thật) — patch xong PHẢI khôi phục
    `torch.load` gốc ngay trong `finally`, không để rò rỉ sang phần còn lại
    của process (vd `transcribe_pipeline.py` gọi cả `whisper_runner` trong
    cùng process). An toàn để default `False` ở đây vì checkpoint đến từ repo
    HuggingFace chính thức của `pyannote` (đã verify qua license + access
    token thật ở T-HF-001, không phải nguồn lạ/untrusted) — đúng tinh thần
    khuyến nghị của chính thông báo lỗi PyTorch khi nguồn đáng tin cậy.
    """
    import torch

    original_load = torch.load

    def _load_with_default_false(*args, **kwargs):
        # lightning_fabric truyền weights_only=None tường minh (không phải
        # thiếu key) — setdefault() không có tác dụng ở đây, phải check None
        # rõ ràng rồi ép False.
        if kwargs.get("weights_only") is None:
            kwargs["weights_only"] = False
        return original_load(*args, **kwargs)

    torch.load = _load_with_default_false  # type: ignore[assignment]
    try:
        yield
    finally:
        torch.load = original_load  # type: ignore[assignment]


def _patch_huggingface_hub_use_auth_token_kwarg_if_needed() -> None:
    """Compat shim cho `huggingface_hub` mới (xác nhận thật: v1.21.0, đã lên
    major version 1.x) đã bỏ hẳn kwarg `use_auth_token` khỏi `hf_hub_download`
    (chỉ còn `token`). `pyannote.audio==3.4.0` vẫn truyền `use_auth_token=...`
    (mặc định `None` vì ta không truyền token nào cho `Pipeline.from_pretrained`
    — model nested đã preload sẵn local qua T-HF-001) khi resolve các model
    nested khai báo trong `config.yaml` (`embedding`/`segmentation` — xem
    `core/model.py`, `core/pipeline.py`, `pipelines/utils/getter.py`) — gây
    `TypeError: hf_hub_download() got an unexpected keyword argument
    'use_auth_token'` ngay cả khi mọi model đã có sẵn trong cache local.

    `core/model.py`/`core/pipeline.py` import bằng
    `from huggingface_hub import hf_hub_download` ở module level, nên phải
    patch `huggingface_hub.hf_hub_download` TRƯỚC khi `from pyannote.audio
    import Pipeline` chạy (import của pyannote.audio mới kéo theo các module
    này) — patch sau thì không có tác dụng vì pyannote đã bind tên cũ vào
    namespace riêng của nó rồi.
    """
    import huggingface_hub

    if getattr(huggingface_hub.hf_hub_download, "_use_auth_token_shim", False):
        return  # đã patch — idempotent, tránh wrap chồng nhiều lần.

    _original_hf_hub_download = huggingface_hub.hf_hub_download

    def _hf_hub_download_compat(*args, **kwargs):
        if "use_auth_token" in kwargs:
            use_auth_token = kwargs.pop("use_auth_token")
            kwargs.setdefault("token", use_auth_token)
        return _original_hf_hub_download(*args, **kwargs)

    _hf_hub_download_compat._use_auth_token_shim = True  # type: ignore[attr-defined]
    huggingface_hub.hf_hub_download = _hf_hub_download_compat  # type: ignore[attr-defined]


def _resolve_model_path() -> str:
    """Trả về đường dẫn tới file config.yaml bên trong PYANNOTE_MODEL_PATH.

    QUAN TRỌNG: `pyannote.audio.Pipeline.from_pretrained()` chỉ load 100%
    offline khi tham số là đường dẫn tới 1 FILE tồn tại (kiểm tra bằng
    `os.path.isfile`) — nếu truyền thư mục, nó hiểu chuỗi đó là HuggingFace
    repo_id và cố gọi `hf_hub_download()` qua mạng (vi phạm rule "không
    outbound internet tại runtime", mục 2 plan). Vì vậy `PYANNOTE_MODEL_PATH`
    env var là THƯ MỤC chứa snapshot đã preload (nhất quán với
    WHISPER_MODEL_PATH_*), nhưng ta phải tự nối thêm "config.yaml" trước khi
    gọi from_pretrained().
    """
    model_dir = os.environ.get("PYANNOTE_MODEL_PATH")
    if not model_dir or not os.path.isdir(model_dir):
        raise DiarizationUnavailableError(
            f"PYANNOTE_MODEL_PATH không tồn tại hoặc chưa preload: {model_dir!r}. "
            "Xem T-HF-001 — model phải được accept license HuggingFace và preload "
            "vào volume trước khi DIARIZATION_ENABLED=true."
        )
    config_path = os.path.join(model_dir, "config.yaml")
    if not os.path.isfile(config_path):
        raise DiarizationUnavailableError(
            f"Không tìm thấy config.yaml trong PYANNOTE_MODEL_PATH={model_dir!r}. "
            "Pipeline.from_pretrained() chỉ load offline khi trỏ thẳng tới file "
            "config.yaml của snapshot pipeline đã tải qua T-HF-001."
        )
    return config_path


def diarize(audio_path: str) -> List[Dict[str, Any]]:
    """Chạy pyannote diarization trên audio_path (đã normalize 16kHz mono).

    Trả về list turn đã sort theo startMs: {startMs, endMs, speakerLabel}.
    speakerLabel được remap thành Speaker_1, Speaker_2... theo thứ tự xuất hiện
    lần đầu — KHÔNG dùng raw cluster label của pyannote (vd "SPEAKER_00") để
    giữ format nhất quán với contracts/ai-worker-result-schema.json.
    """
    local_files_only = os.environ.get("PYANNOTE_LOCAL_FILES_ONLY", "true") == "true"
    if not local_files_only:
        # Rule 10, mục 2 plan: AI worker không được tự tải model từ internet lúc
        # runtime — chặn cứng thay vì âm thầm cho phép network call.
        raise DiarizationUnavailableError(
            "PYANNOTE_LOCAL_FILES_ONLY phải là true — không cho phép pipeline tải "
            "model pyannote từ HuggingFace tại runtime container."
        )

    model_path = _resolve_model_path()

    # config.yaml của speaker-diarization-3.1 tham chiếu model nested (vd
    # pyannote/segmentation-3.0) qua Hub repo id, không phải path local — nếu
    # không ép HF_HUB_OFFLINE=1, huggingface_hub có thể vẫn thử gọi mạng để
    # check update khi resolve các model nested đó dù PYANNOTE_LOCAL_FILES_ONLY
    # đã true ở mức path top-level (_resolve_model_path() chỉ chặn được path
    # top-level, không chặn được nested resolution). Set ở đây để đảm bảo
    # KHÔNG có outbound internet nào trong toàn bộ quá trình diarize() — đúng
    # rule T025; nếu model nested chưa preload sẵn trong HF cache, lỗi sẽ rõ
    # ràng ("không tìm thấy trong cache") thay vì âm thầm gọi mạng.
    os.environ["HF_HUB_OFFLINE"] = "1"

    try:
        _patch_torchaudio_list_audio_backends_if_missing()
        from pyannote.audio import Pipeline
    except ImportError as exc:
        raise DiarizationUnavailableError(
            f"pyannote.audio chưa được cài trong môi trường này: {exc}"
        ) from exc

    try:
        with _torch_load_default_weights_only_false():
            pipeline = Pipeline.from_pretrained(model_path)
        diarization = pipeline(audio_path)
    except Exception as exc:  # noqa: BLE001 — boundary: mọi lỗi pyannote đều phải fallback, không phân loại lại
        raise DiarizationUnavailableError(f"pyannote pipeline lỗi: {exc}") from exc

    raw_turns = sorted(
        diarization.itertracks(yield_label=True), key=lambda item: item[0].start
    )

    # speaker_index gán theo thứ tự xuất hiện CHRONOLOGICAL (đã sort theo
    # turn.start ở trên) — Speaker_1 luôn là người nói đầu tiên trong audio,
    # không phụ thuộc thứ tự iterate nội bộ của pyannote.
    speaker_index: Dict[str, str] = {}
    next_index = 1
    turns: List[Dict[str, Any]] = []

    for turn, _track, raw_label in raw_turns:
        if raw_label not in speaker_index:
            speaker_index[raw_label] = f"Speaker_{next_index}"
            next_index += 1
        turns.append(
            {
                "startMs": int(round(turn.start * 1000)),
                "endMs": int(round(turn.end * 1000)),
                "speakerLabel": speaker_index[raw_label],
            }
        )

    return turns
