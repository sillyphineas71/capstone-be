import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChildProcess } from 'child_process';
import {
  RecordingSessionEntity,
  RecordingSessionStatus,
} from '../entities/recording-session.entity.js';
import { spawnFfmpeg, redactUrl } from '../utils/ffmpeg.util.js';

interface ProcEntry {
  proc: ChildProcess;
  stopping: boolean;
  stderrTail: string[];
}

/**
 * RecordingProcessManager (REC-002) — singleton quản lý tiến trình ffmpeg theo session.
 *
 * SEC-01: KHÔNG log url/args. stderr giữ ≤ MAX_TAIL dòng đã redact để chẩn lỗi.
 * Khi process thoát/lỗi ngoài ý muốn (chưa stop chủ động) → đánh dấu session 'failed'.
 */
@Injectable()
export class RecordingProcessManager {
  private readonly logger = new Logger(RecordingProcessManager.name);
  private readonly procs = new Map<string, ProcEntry>();
  private static readonly MAX_TAIL = 20;
  /** Thời gian chờ ffmpeg tự thoát sau khi gửi 'q' trước khi SIGKILL (REC-003). */
  static readonly STOP_TIMEOUT_MS = 3000;

  constructor(private readonly dataSource: DataSource) {}

  /** Spawn ffmpeg cho session, gắn handler exit/error + thu stderr (redact). */
  start(sessionId: string, url: string, outPath: string): void {
    const proc = spawnFfmpeg(url, outPath);
    const entry: ProcEntry = { proc, stopping: false, stderrTail: [] };
    this.procs.set(sessionId, entry);

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = redactUrl(chunk.toString());
      entry.stderrTail.push(line);
      if (entry.stderrTail.length > RecordingProcessManager.MAX_TAIL) {
        entry.stderrTail.shift();
      }
    });

    proc.on('error', (err: Error) => {
      if (entry.stopping) return;
      void this.markFailed(sessionId, redactUrl(`spawn error: ${err.message}`));
    });

    proc.on('exit', (code) => {
      if (entry.stopping) return;
      const tail = redactUrl(entry.stderrTail.join('').slice(-1000));
      void this.markFailed(sessionId, `ffmpeg exited code=${code}; ${tail}`);
    });
  }

  /**
   * Đợi grace-window: 'alive' nếu process còn sống sau ms, 'dead' nếu exit/error trước đó.
   */
  waitForGrace(sessionId: string, ms = 2000): Promise<'alive' | 'dead'> {
    const entry = this.procs.get(sessionId);
    if (!entry) return Promise.resolve('dead');
    const { proc } = entry;
    if (proc.exitCode !== null || proc.killed) {
      return Promise.resolve('dead');
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = (r: 'alive' | 'dead') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => done('alive'), ms);
      proc.once('exit', () => done('dead'));
      proc.once('error', () => done('dead'));
    });
  }

  has(sessionId: string): boolean {
    return this.procs.has(sessionId);
  }

  get(sessionId: string): ChildProcess | undefined {
    return this.procs.get(sessionId)?.proc;
  }

  /** Đánh dấu stop chủ động (cho #24) để exit không bị coi là failed. */
  markStopping(sessionId: string): void {
    const entry = this.procs.get(sessionId);
    if (entry) entry.stopping = true;
  }

  /**
   * Dừng ÊM tiến trình ffmpeg (REC-003):
   * markStopping → ghi 'q' vào stdin → đợi 'exit'. Quá timeoutMs → SIGKILL.
   * Trả 'orphan' nếu không còn handle, 'exited' nếu tự thoát, 'killed' nếu phải kill.
   * KHÔNG treo promise; luôn dọn Map khi kết thúc.
   */
  async stop(
    sessionId: string,
    timeoutMs = RecordingProcessManager.STOP_TIMEOUT_MS,
  ): Promise<'exited' | 'killed' | 'orphan'> {
    const entry = this.procs.get(sessionId);
    if (!entry) return 'orphan';
    this.markStopping(sessionId);
    const { proc } = entry;

    // Đã thoát trước đó (race) → dọn Map và coi như exited.
    if (proc.exitCode !== null || proc.killed) {
      this.procs.delete(sessionId);
      return 'exited';
    }

    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      const finish = (r: 'exited' | 'killed') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.procs.delete(sessionId);
        resolve(r);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill('SIGKILL');
        } catch {
          // process có thể đã thoát; 'exit' sẽ xử lý.
        }
      }, timeoutMs);
      proc.once('exit', () => finish(timedOut ? 'killed' : 'exited'));
      proc.once('error', () => finish(timedOut ? 'killed' : 'exited'));
      try {
        proc.stdin?.write('q');
      } catch {
        // stdin đã đóng → dựa vào timeout → kill.
      }
    });
  }

  private async markFailed(
    sessionId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.dataSource.manager.update(RecordingSessionEntity, sessionId, {
        status: RecordingSessionStatus.FAILED,
        errorMessage: errorMessage.slice(0, 2000),
        stoppedAt: new Date(),
      });
    } catch (e) {
      this.logger.error(
        `Failed to mark session ${sessionId} as failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    } finally {
      this.procs.delete(sessionId);
    }
  }
}
