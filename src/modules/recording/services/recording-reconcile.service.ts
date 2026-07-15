import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import { RecordingProcessManager } from './recording-process-manager.js';
import { RecordingSessionService } from './recording-session.service.js';
import { RecordingSessionStatus } from '../entities/recording-session.entity.js';

interface OrphanRow {
  id: string;
  meeting_id: string;
  status: string;
  storage_path: string | null;
  started_at: string | Date;
  paused_duration_seconds: number | null;
  metadata_json: Record<string, unknown> | null;
}

/**
 * RecordingReconcileService (REC-004 Phần B) — crash recovery lúc boot.
 *
 * GIẢ ĐỊNH SINGLE-INSTANCE: `RecordingProcessManager` giữ Map process IN-MEMORY cục bộ.
 * Sau restart Map rỗng ⇒ mọi session DB còn 'recording' & stopped_at NULL là mồ côi (zombie).
 * Reconcile hybrid: file hợp lệ → finalize-as-stopped (cứu bản ghi); else → failed.
 *
 * CẢNH BÁO: môi trường MULTI-INSTANCE, một session không có handle ở instance này CÓ THỂ
 * đang được instance khác ghi thật → reconcile mù sẽ SAI. Production cần ownership/heartbeat
 * (vd recording_sessions.instance_id + last_heartbeat_at). Ngoài scope #25.
 */
@Injectable()
export class RecordingReconcileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecordingReconcileService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly processManager: RecordingProcessManager,
    private readonly recordingSessionService: RecordingSessionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let orphans: OrphanRow[] = [];
    try {
      orphans = await this.dataSource.manager.query(
        `SELECT id, meeting_id, status, storage_path, started_at,
                paused_duration_seconds, metadata_json
         FROM recording_sessions
         WHERE status IN ('starting','recording','paused') AND stopped_at IS NULL`,
      );
    } catch (e) {
      this.logger.error(
        `reconcile query failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
      return; // KHÔNG chặn boot.
    }

    let recovered = 0;
    let failed = 0;
    let skipped = 0;

    for (const s of orphans) {
      try {
        // Đang ghi thật trong instance hiện tại (reconcile chạy lại runtime) → bỏ qua.
        if (this.processManager.has(s.id)) {
          skipped++;
          continue;
        }
        // TODO(UC-114/115 C6 — ngoài scope): nếu session crash giữa chừng có nhiều segment
        // (metadata_json.segments[] do pause/resume), reconcile hiện CHỈ finalize storage_path
        // (segment cuối), CHƯA concat các segment mồ côi. Mở rộng concat ở đây khi cần.
        const storagePath = s.storage_path;
        const exists = !!storagePath && fs.existsSync(storagePath);
        const size = exists ? fs.statSync(storagePath).size : 0;
        if (exists && storagePath && size > 0) {
          await this.recordingSessionService.finalizeFileToStopped({
            sessionId: s.id,
            meetingId: s.meeting_id,
            storagePath,
            startedAt: new Date(s.started_at),
            paused: s.paused_duration_seconds ?? 0,
            userId: null,
            baseMetadata: s.metadata_json ?? {},
            recovered: true,
          });
          recovered++;
        } else {
          await this.markFailed(s);
          failed++;
        }
      } catch (e) {
        // Lỗi 1 session KHÔNG chặn các session khác / không chặn app start.
        this.logger.error(
          `reconcile session ${s.id} failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }

    if (orphans.length > 0) {
      this.logger.log(
        `[Reconcile] orphan sessions=${orphans.length} recovered=${recovered} failed=${failed} skipped=${skipped}`,
      );
    }
  }

  /** Đánh dấu session mồ côi không cứu được là failed (interrupted by restart). */
  private async markFailed(s: OrphanRow): Promise<void> {
    const metadata = { ...(s.metadata_json ?? {}), recovered: true };
    await this.dataSource.manager.query(
      `UPDATE recording_sessions
       SET status = $1, stopped_at = $2, error_message = $3, metadata_json = $4
       WHERE id = $5`,
      [
        RecordingSessionStatus.FAILED,
        new Date(),
        'interrupted by restart',
        JSON.stringify(metadata),
        s.id,
      ],
    );
  }
}
