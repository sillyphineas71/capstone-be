import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { FaceDeviceProviderFactory } from '../face-device-provider.factory.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';

interface MeetingRow {
  id: string;
  room_id: string | null;
  start_time: Date | string;
  end_time: Date | string;
}
interface DeviceRow {
  id: string;
  ip_address: string | null;
  metadata_json: Record<string, unknown> | null;
}
interface MappingRow {
  id: string;
  device_id: string;
  device_person_id: string | null;
  sync_status: string;
  metadata_json: Record<string, unknown> | null;
}

/**
 * FaceProvisioningService (FMP-001 / Ticket B) — đẩy/gỡ khuôn mặt theo cuộc họp.
 *
 * Qua FaceDeviceProviderFactory (Ticket A) + FaceProfileService.getPortraitBytes (Ticket D).
 * Idempotent per (user, device, bookingId=meetingId). SEC-03 parameterized. DATA-01 no migration.
 * Per-participant try/catch (ARCH-02 no-hang nhờ timeout của port).
 */
@Injectable()
export class FaceProvisioningService {
  private readonly logger = new Logger(FaceProvisioningService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly factory: FaceDeviceProviderFactory,
    private readonly faceProfileService: FaceProfileService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * device uname đẩy lên cam: `${userId}:${meetingId}` (73 ký tự) vượt giới hạn field
   * uname FaceGate (~47) → cam cắt cụt → findUidByName trượt. Dùng hash 32-hex
   * deterministic (< 47, đủ entropy chống trùng, re-provision idempotent). Cặp gốc
   * userId:meetingId lưu ở metadata.userMeeting để debug/đảo ngược.
   */
  private unameOf(userId: string, meetingId: string): string {
    return createHash('sha256')
      .update(`${userId}:${meetingId}`)
      .digest('hex')
      .slice(0, 32);
  }

  // ── PROVISION ──────────────────────────────────────────────────────────
  async provisionUpcomingMeetings(): Promise<{ scanned: number }> {
    const lead = this.configService.get<number>('FACE_SYNC_LEAD_MINUTES', 5);
    const meetings: MeetingRow[] = await this.dataSource.manager.query(
      `SELECT id, room_id, start_time, end_time FROM meetings
       WHERE room_id IS NOT NULL AND status IN ('scheduled','in_progress')
         AND start_time <= now() + ($1 * interval '1 minute')
         AND end_time > now()`,
      [lead],
    );
    for (const m of meetings) {
      try {
        await this.provisionMeeting(m);
      } catch (e) {
        this.logger.error(`provisionMeeting ${m.id} failed: ${this.msg(e)}`);
      }
    }
    return { scanned: meetings.length };
  }

  async provisionMeeting(meeting: MeetingRow): Promise<void> {
    if (!meeting.room_id) return;
    const device = await this.findFaceDevice(meeting.room_id);
    if (!device) {
      this.logger.warn(
        `No face_server device in room ${meeting.room_id} (meeting ${meeting.id}).`,
      );
      return;
    }

    const participants: Array<{ user_id: string }> =
      await this.dataSource.manager.query(
        `SELECT user_id FROM meeting_participants WHERE meeting_id = $1`,
        [meeting.id],
      );

    for (const p of participants) {
      try {
        await this.provisionParticipant(meeting, device, p.user_id);
      } catch (e) {
        await this.upsertMapping({
          deviceId: device.id,
          userId: p.user_id,
          uid: null,
          uname: this.unameOf(p.user_id, meeting.id),
          bookingId: meeting.id,
          validFrom: meeting.start_time,
          validTo: meeting.end_time,
          status: 'failed',
          error: this.msg(e),
        });
        this.logger.error(
          `provision participant ${p.user_id} (meeting ${meeting.id}) failed: ${this.msg(e)}`,
        );
      }
    }
  }

  private async provisionParticipant(
    meeting: MeetingRow,
    device: DeviceRow,
    userId: string,
  ): Promise<void> {
    const uname = this.unameOf(userId, meeting.id);

    // Idempotency: đã synced cho (user, device, bookingId) → bỏ qua.
    const existing: Array<{ sync_status: string }> =
      await this.dataSource.manager.query(
        `SELECT sync_status FROM device_user_mappings
         WHERE user_id = $1 AND device_id = $2 AND metadata_json->>'bookingId' = $3
         LIMIT 1`,
        [userId, device.id, meeting.id],
      );
    if (existing[0]?.sync_status === 'synced') return;

    const bytes = await this.faceProfileService.getPortraitBytes(userId);
    if (!bytes) {
      this.logger.warn(
        `No portrait for user ${userId} (meeting ${meeting.id}) — skip enroll.`,
      );
      return;
    }

    const provider = this.factory.create({
      ipAddress: device.ip_address,
      metadataJson: device.metadata_json,
    });
    const ref = await provider.uploadFace(bytes);
    await provider.addPerson({
      uname,
      faceRef: ref,
      validFrom: new Date(meeting.start_time),
      validTo: new Date(meeting.end_time),
    });
    const uid = await provider.findUidByName(uname);
    if (!uid) {
      this.logger.warn(
        `addPerson succeeded but uid not found for ${uname} (meeting ${meeting.id}) — entry only removable via validity expiry.`,
      );
    }

    await this.upsertMapping({
      deviceId: device.id,
      userId,
      uid,
      uname,
      bookingId: meeting.id,
      validFrom: meeting.start_time,
      validTo: meeting.end_time,
      status: 'synced',
      error: null,
    });
  }

  // ── DEPROVISION ────────────────────────────────────────────────────────
  /**
   * Mapping-driven: gỡ MỌI mapping synced mà họp đã kết thúc ≥ grace phút (JOIN qua
   * metadata.bookingId). Thay cách lọc cũ "họp vừa kết thúc trong grace phút" — vốn tạo
   * cửa sổ bỏ sót vĩnh viễn (họp trôi quá grace không bao giờ được quét lại).
   */
  async deprovisionEndedMeetings(): Promise<{ scanned: number }> {
    const grace = this.configService.get<number>('FACE_SYNC_GRACE_MINUTES', 5);
    const maps: MappingRow[] = await this.dataSource.manager.query(
      `SELECT mp.id, mp.device_id, mp.device_person_id, mp.sync_status, mp.metadata_json
       FROM device_user_mappings mp
       JOIN meetings me ON me.id = (mp.metadata_json->>'bookingId')::uuid
       WHERE mp.sync_status = 'synced' AND mp.deleted_at IS NULL
         AND me.status <> 'cancelled'
         AND me.end_time <= now() - ($1 * interval '1 minute')
       LIMIT 500`,
      [grace],
    );
    let scanned = 0;
    for (const mp of maps) {
      try {
        await this.removeMapping(mp);
        scanned++;
      } catch (e) {
        this.logger.error(
          `deprovision mapping ${mp.id} failed: ${this.msg(e)}`,
        );
      }
    }
    return { scanned };
  }

  async deprovisionMeeting(meeting: MeetingRow): Promise<void> {
    const maps: MappingRow[] = await this.dataSource.manager.query(
      `SELECT id, device_id, device_person_id, sync_status, metadata_json
       FROM device_user_mappings
       WHERE metadata_json->>'bookingId' = $1 AND sync_status = 'synced'`,
      [meeting.id],
    );
    for (const mp of maps) {
      try {
        await this.removeMapping(mp);
      } catch (e) {
        this.logger.error(
          `deprovision mapping ${mp.id} failed: ${this.msg(e)}`,
        );
      }
    }
  }

  // ── RECONCILE ──────────────────────────────────────────────────────────
  async reconcile(): Promise<{ stale: number; deduped: number }> {
    const grace = this.configService.get<number>('FACE_SYNC_GRACE_MINUTES', 5);
    let stale = 0;
    let deduped = 0;

    // STALE: synced nhưng meeting đã kết thúc ≥ grace phút (cùng grace với deprovision
    // để reconcile không gỡ sớm trong cửa sổ grace).
    const staleMaps: MappingRow[] = await this.dataSource.manager.query(
      `SELECT mp.id, mp.device_id, mp.device_person_id, mp.sync_status, mp.metadata_json
       FROM device_user_mappings mp
       JOIN meetings me ON me.id = (mp.metadata_json->>'bookingId')::uuid
       WHERE mp.sync_status = 'synced' AND me.end_time <= now() - ($1 * interval '1 minute')
       LIMIT 500`,
      [grace],
    );
    for (const mp of staleMaps) {
      try {
        await this.removeMapping(mp);
        stale++;
      } catch (e) {
        this.logger.error(`reconcile stale ${mp.id} failed: ${this.msg(e)}`);
      }
    }

    // DEDUP: uid trùng uname trên cùng device.
    const synced: Array<{
      device_id: string;
      device_person_id: string | null;
      device_person_code: string | null;
      metadata_json: Record<string, unknown> | null;
    }> = await this.dataSource.manager.query(
      `SELECT device_id, device_person_id, device_person_code, metadata_json
       FROM device_user_mappings WHERE sync_status = 'synced' LIMIT 500`,
    );
    for (const mp of synced) {
      try {
        const uname = mp.device_person_code;
        if (!uname || !mp.device_person_id) continue;
        const device = await this.findDeviceById(mp.device_id);
        if (!device) continue;
        const provider = this.factory.create({
          ipAddress: device.ip_address,
          metadataJson: device.metadata_json,
        });
        // findUidByName trả uid mới nhất; nếu khác uid đã lưu → xoá uid cũ (trùng).
        const latest = await provider.findUidByName(uname);
        if (latest && latest !== mp.device_person_id) {
          await provider.deletePerson(mp.device_person_id);
          await this.dataSource.manager.query(
            `UPDATE device_user_mappings SET device_person_id = $2 WHERE device_id = $1 AND device_person_code = $3`,
            [mp.device_id, latest, uname],
          );
          deduped++;
        }
      } catch (e) {
        this.logger.error(`reconcile dedup failed: ${this.msg(e)}`);
      }
    }

    return { stale, deduped };
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private async removeMapping(mp: MappingRow): Promise<void> {
    if (mp.device_person_id) {
      const device = await this.findDeviceById(mp.device_id);
      if (device) {
        const provider = this.factory.create({
          ipAddress: device.ip_address,
          metadataJson: device.metadata_json,
        });
        await provider.deletePerson(mp.device_person_id);
      }
    }
    await this.dataSource.manager.query(
      `UPDATE device_user_mappings SET sync_status = 'deleted', last_synced_at = now() WHERE id = $1`,
      [mp.id],
    );
  }

  private async findFaceDevice(roomId: string): Promise<DeviceRow | null> {
    const rows: DeviceRow[] = await this.dataSource.manager.query(
      `SELECT id, ip_address, metadata_json FROM iot_devices
       WHERE room_id = $1 AND device_type = 'face_server' LIMIT 1`,
      [roomId],
    );
    return rows?.[0] ?? null;
  }

  private async findDeviceById(deviceId: string): Promise<DeviceRow | null> {
    const rows: DeviceRow[] = await this.dataSource.manager.query(
      `SELECT id, ip_address, metadata_json FROM iot_devices WHERE id = $1 LIMIT 1`,
      [deviceId],
    );
    return rows?.[0] ?? null;
  }

  private async upsertMapping(params: {
    deviceId: string;
    userId: string;
    uid: string | null;
    uname: string;
    bookingId: string;
    validFrom?: Date | string;
    validTo?: Date | string;
    status: string;
    error: string | null;
  }): Promise<void> {
    const metadata = {
      bookingId: params.bookingId,
      validFrom: params.validFrom ?? null,
      validTo: params.validTo ?? null,
      // Cặp gốc để đảo ngược device uname (hash) → debug.
      userMeeting: `${params.userId}:${params.bookingId}`,
    };
    const existing: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM device_user_mappings
       WHERE user_id = $1 AND device_id = $2 AND metadata_json->>'bookingId' = $3 LIMIT 1`,
      [params.userId, params.deviceId, params.bookingId],
    );
    const synced = params.status === 'synced';
    if (existing[0]) {
      await this.dataSource.manager.query(
        `UPDATE device_user_mappings SET
           device_person_id = $2, device_person_code = $3, device_person_name = $3,
           face_registered = $4, sync_status = $5, last_synced_at = now(),
           last_sync_error = $6, registered_at = COALESCE(registered_at, $7),
           metadata_json = $8
         WHERE id = $1`,
        [
          existing[0].id,
          params.uid,
          params.uname,
          synced,
          params.status,
          params.error,
          synced ? new Date() : null,
          JSON.stringify(metadata),
        ],
      );
    } else {
      await this.dataSource.manager.query(
        `INSERT INTO device_user_mappings
           (device_id, user_id, device_person_id, device_person_code, device_person_name,
            face_registered, sync_status, last_synced_at, last_sync_error, registered_at, metadata_json)
         VALUES ($1,$2,$3,$4,$4,$5,$6,now(),$7,$8,$9)`,
        [
          params.deviceId,
          params.userId,
          params.uid,
          params.uname,
          synced,
          params.status,
          params.error,
          synced ? new Date() : null,
          JSON.stringify(metadata),
        ],
      );
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : 'unknown';
  }
}
