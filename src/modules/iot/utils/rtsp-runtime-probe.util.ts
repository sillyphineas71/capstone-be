import { spawn } from 'child_process';

/**
 * rtsp-runtime-probe.util (A5 / IOT-005) — probe RTSP runtime bằng ffprobe + phân loại.
 *
 * Hàm THUẦN (không phụ thuộc Nest). Mirror cách spawn của REC-005 (recording/utils/ffprobe.util.ts)
 * nhưng KHÔNG tái dùng `probeMedia` (nó nuốt mọi lỗi → null) vì A5 cần PHÂN LOẠI 7 nhóm (spec §8.2).
 * KHÔNG sửa REC-005. KHÔNG đụng probeTcp IOT-014.
 *
 * BEST-EFFORT (spec §8.2): ưu tiên `exit code`, `stderr` chỉ phụ để phân nhánh; mọi kết quả không
 * khớp dấu hiệu → nhóm Default an toàn (`RTSP_PROBE_FAILED`), KHÔNG đoán bừa thành alive.
 *
 * SEC (spec §8.4): `url` có thể chứa credential → util KHÔNG log url, KHÔNG trả `stderr` thô ra ngoài.
 * Hàm KHÔNG bao giờ ném/không reject — mọi nhánh resolve một group.
 */
export type RtspProbeGroup =
  | 'alive'
  | 'unreachable'
  | 'timeout'
  | 'auth_fail'
  | 'not_a_stream'
  | 'tool_unavailable'
  | 'default';

export type RtspProbeStatusAction = 'set_online' | 'set_offline' | 'keep';

export type RtspProbeHealth = 'healthy' | 'warning' | 'faulty' | 'unknown';

export interface RtspProbeResult {
  group: RtspProbeGroup;
  reasonCode: string | null;
  isAvailable: boolean;
  runtimeVerified: boolean;
  healthStatus: RtspProbeHealth;
  statusAction: RtspProbeStatusAction;
}

/** Bảng map group → fields, đúng taxonomy spec §8.2. */
const GROUP_RESULT: Record<RtspProbeGroup, Omit<RtspProbeResult, 'group'>> = {
  alive: {
    reasonCode: null,
    isAvailable: true,
    runtimeVerified: true,
    healthStatus: 'healthy',
    statusAction: 'set_online',
  },
  unreachable: {
    reasonCode: 'RTSP_UNREACHABLE',
    isAvailable: false,
    runtimeVerified: true,
    healthStatus: 'faulty',
    statusAction: 'set_offline',
  },
  timeout: {
    reasonCode: 'RTSP_PROBE_TIMEOUT',
    isAvailable: false,
    runtimeVerified: true,
    healthStatus: 'faulty',
    statusAction: 'set_offline',
  },
  auth_fail: {
    reasonCode: 'RTSP_AUTH_FAILED',
    isAvailable: false,
    runtimeVerified: true,
    healthStatus: 'warning',
    statusAction: 'keep',
  },
  not_a_stream: {
    reasonCode: 'RTSP_INVALID_STREAM',
    isAvailable: false,
    runtimeVerified: true,
    healthStatus: 'warning',
    statusAction: 'keep',
  },
  tool_unavailable: {
    reasonCode: 'PROBE_TOOL_UNAVAILABLE',
    isAvailable: false,
    runtimeVerified: false,
    healthStatus: 'unknown',
    statusAction: 'keep',
  },
  default: {
    reasonCode: 'RTSP_PROBE_FAILED',
    isAvailable: false,
    runtimeVerified: true,
    healthStatus: 'faulty',
    statusAction: 'keep',
  },
};

function buildResult(group: RtspProbeGroup): RtspProbeResult {
  return { group, ...GROUP_RESULT[group] };
}

/** stdout ffprobe (`-show_streams` json) có chứa ít nhất một video stream? */
function hasVideoStream(stdout: string): boolean {
  try {
    const json = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string }>;
    };
    return (json.streams ?? []).some((s) => s.codec_type === 'video');
  } catch {
    return false;
  }
}

/** Phân loại stderr (best-effort, lowercase) khi exit != 0. */
function classifyStderr(stderr: string): RtspProbeGroup {
  const s = stderr.toLowerCase();
  if (/401|403|unauthorized|authoriz/.test(s)) return 'auth_fail';
  if (
    /connection refused|no route to host|network is unreachable|name or service not known|could not resolve|failed to resolve/.test(
      s,
    )
  ) {
    return 'unreachable';
  }
  if (
    /invalid data|404 not found|not found|no stream|does not contain any stream|could not find codec/.test(
      s,
    )
  ) {
    return 'not_a_stream';
  }
  return 'default';
}

/**
 * Probe RTSP URL bằng ffprobe (`-rtsp_transport tcp`), phân loại 7 nhóm §8.2.
 * @param url RTSP URL ĐÃ dựng credential (service lo decrypt; util không chạm DB/secret).
 * @param timeoutMs Thời gian chờ tối đa (ms) trước khi kill ffprobe.
 */
export function probeRtspRuntime(
  url: string,
  timeoutMs: number,
): Promise<RtspProbeResult> {
  const bin = process.env.FFPROBE_PATH || 'ffprobe';
  const args = [
    '-rtsp_transport',
    'tcp',
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    url,
  ];

  return new Promise((resolve) => {
    let settled = false;
    const done = (group: RtspProbeGroup): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(buildResult(group));
    };

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // process có thể đã thoát.
      }
      done('timeout');
    }, timeoutMs);

    const proc = spawn(bin, args, { windowsHide: true });

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      // Thiếu binary ffprobe → tool-unavailable; lỗi spawn khác → default an toàn.
      done(err?.code === 'ENOENT' ? 'tool_unavailable' : 'default');
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // exit 0: có video → alive; không có video stream → not-a-stream.
        done(hasVideoStream(stdout) ? 'alive' : 'not_a_stream');
        return;
      }
      // exit != 0: phân loại theo stderr (best-effort) → catch-all default.
      done(classifyStderr(stderr));
    });
  });
}
