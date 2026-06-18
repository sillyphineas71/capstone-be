import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ListUnmappedQueryDto } from '../dto/list-unmapped.query.dto.js';
import { MapUnmappedDto } from '../dto/map-unmapped.dto.js';

interface UnmappedRow {
  device_id: string;
  person_id: string;
  last_seen: Date | string;
  hit_count: number;
  person_name: string | null;
  room_id: string | null;
}

/**
 * UnmappedReviewService (UMR-001 / #50) — admin xử lý verify không khớp mapping.
 *
 * list(): verify gần đây (iot_device_events) mà person KHÔNG có mapping còn sống.
 * map(): tạo device_user_mappings (per-meeting, sync_status='synced') — face ĐÃ trên
 * cam nên KHÔNG đẩy thiết bị (không factory/upload). DATA-01 no migration, SEC-03 raw param.
 */
@Injectable()
export class UnmappedReviewService {
  private readonly logger = new Logger(UnmappedReviewService.name);
  private static readonly DEFAULT_WINDOW_MINUTES = 1440;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async list(query: ListUnmappedQueryDto): Promise<{
    data: Array<{
      deviceId: string;
      personId: string;
      personName: string | null;
      roomId: string | null;
      lastSeen: Date | string;
      hitCount: number;
    }>;
    meta: { page: number; limit: number };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const window =
      query.windowMinutes ??
      this.configService.get<number>(
        'FACE_UNMAPPED_WINDOW_MINUTES',
        UnmappedReviewService.DEFAULT_WINDOW_MINUTES,
      );
    const offset = (page - 1) * limit;

    const rows: UnmappedRow[] = await this.dataSource.manager.query(
      `SELECT e.device_id,
              e.payload_json->'extracted_fields'->>'person_id'  AS person_id,
              MAX(e.created_at)                                  AS last_seen,
              COUNT(*)::int                                      AS hit_count,
              (array_agg(e.payload_json->'extracted_fields'->>'person_name'
                         ORDER BY e.created_at DESC))[1]         AS person_name,
              (array_agg(e.room_id ORDER BY e.created_at DESC))[1] AS room_id
         FROM iot_device_events e
        WHERE e.event_type = 'face_verify'
          AND e.created_at >= now() - ($1 * interval '1 minute')
          AND e.payload_json->'extracted_fields'->>'person_id' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM device_user_mappings m
             WHERE m.device_id = e.device_id
               AND m.device_person_id = e.payload_json->'extracted_fields'->>'person_id'
               AND m.sync_status = 'synced' AND m.deleted_at IS NULL)
        GROUP BY e.device_id, person_id
        ORDER BY last_seen DESC
        LIMIT $2 OFFSET $3`,
      [window, limit, offset],
    );

    // SEC-02: chỉ field cho phép (KHÔNG base64/SanpPic/secret).
    return {
      data: rows.map((r) => ({
        deviceId: r.device_id,
        personId: r.person_id,
        personName: r.person_name,
        roomId: r.room_id,
        lastSeen: r.last_seen,
        hitCount: Number(r.hit_count),
      })),
      meta: { page, limit },
    };
  }

  async map(
    dto: MapUnmappedDto,
    adminId: string | null,
  ): Promise<{
    mappingId: string;
    deviceId: string;
    personId: string;
    userId: string;
    meetingId: string;
    syncStatus: string;
  }> {
    // 1. Validate device (phải là face_server).
    const devices: Array<{ id: string; device_type: string }> =
      await this.dataSource.manager.query(
        `SELECT id, device_type FROM iot_devices WHERE id = $1 LIMIT 1`,
        [dto.deviceId],
      );
    const device = devices[0];
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'Device not found.',
      });
    }
    if (device.device_type !== 'face_server') {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message: 'Only face_server devices can be mapped.',
      });
    }

    // 2. Validate user + meeting tồn tại.
    const users: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM users WHERE id = $1 LIMIT 1`,
      [dto.userId],
    );
    if (!users[0]) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }
    const meetings: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM meetings WHERE id = $1 LIMIT 1`,
      [dto.meetingId],
    );
    if (!meetings[0]) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }

    // 3. person_name mới nhất từ verify (sample) → device_person_code/name.
    const samples: Array<{ person_name: string | null }> =
      await this.dataSource.manager.query(
        `SELECT e.payload_json->'extracted_fields'->>'person_name' AS person_name
           FROM iot_device_events e
          WHERE e.event_type = 'face_verify' AND e.device_id = $1
            AND e.payload_json->'extracted_fields'->>'person_id' = $2
          ORDER BY e.created_at DESC LIMIT 1`,
        [dto.deviceId, dto.personId],
      );
    const personName = samples[0]?.person_name ?? null;

    // 4. Ghi device_user_mappings (revive/repoint — DB cho 1 mapping sống / (device,user)
    //    và / (device,person)). KHÔNG factory/upload/đẩy thiết bị — face đã trên cam
    //    (verify gửi PersonID). sync_status='synced' = ghi nhận.
    const metadata = {
      bookingId: dto.meetingId,
      source: 'manual_map',
      mappedBy: adminId,
    };
    // Reconcile theo partial-unique của DB: ux (device_id,user_id) WHERE deleted_at IS NULL
    // và ux (device_id,device_person_id) WHERE device_person_id IS NOT NULL AND deleted_at IS NULL.
    // Deprovision đặt sync_status='deleted' nhưng deleted_at VẪN NULL → row "deleted" vẫn chiếm
    // slot unique → phải REVIVE (UPDATE), KHÔNG INSERT mới (tránh vi phạm constraint).
    // (1) Row sống theo face (device, personId): cùng user → revive; khác user → 409.
    const byPerson: Array<{ id: string; user_id: string }> =
      await this.dataSource.manager.query(
        `SELECT id, user_id FROM device_user_mappings
          WHERE device_id = $1 AND device_person_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [dto.deviceId, dto.personId],
      );
    let targetId: string | null = null;
    if (byPerson[0]) {
      if (byPerson[0].user_id !== dto.userId) {
        throw new ConflictException({
          code: 'PERSON_MAPPED_TO_OTHER_USER',
          message:
            'This device person is already mapped to another user; resolve that mapping first.',
        });
      }
      targetId = byPerson[0].id;
    } else {
      // (2) Không có row theo face → dùng slot sống của user (device, user) nếu có → repoint.
      const byUser: Array<{ id: string }> = await this.dataSource.manager.query(
        `SELECT id FROM device_user_mappings
          WHERE device_id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [dto.deviceId, dto.userId],
      );
      targetId = byUser[0]?.id ?? null;
    }

    let mappingId: string;
    if (targetId) {
      mappingId = targetId;
      await this.dataSource.manager.query(
        `UPDATE device_user_mappings SET
           device_person_id = $2, device_person_code = $3, device_person_name = $3,
           face_registered = true, sync_status = 'synced', last_synced_at = now(),
           last_sync_error = NULL, registered_at = COALESCE(registered_at, now()),
           registered_by = COALESCE(registered_by, $4), deleted_at = NULL,
           metadata_json = $5, updated_at = now()
         WHERE id = $1`,
        [
          mappingId,
          dto.personId,
          personName,
          adminId,
          JSON.stringify(metadata),
        ],
      );
    } else {
      const inserted: Array<{ id: string }> =
        await this.dataSource.manager.query(
          `INSERT INTO device_user_mappings
             (device_id, user_id, device_person_id, device_person_code, device_person_name,
              face_registered, sync_status, last_synced_at, registered_at, registered_by, metadata_json)
           VALUES ($1,$2,$3,$4,$4,true,'synced',now(),now(),$5,$6)
           RETURNING id`,
          [
            dto.deviceId,
            dto.userId,
            dto.personId,
            personName,
            adminId,
            JSON.stringify(metadata),
          ],
        );
      mappingId = inserted[0].id;
    }

    // 5. Audit (hành động admin nhạy cảm).
    await this.dataSource.manager.query(
      `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
       VALUES ($1,'face.unmapped.map','device_user_mapping',$2,'info',$3)`,
      [
        adminId,
        mappingId,
        JSON.stringify({
          deviceId: dto.deviceId,
          personId: dto.personId,
          userId: dto.userId,
          meetingId: dto.meetingId,
        }),
      ],
    );

    this.logger.log(
      `unmapped map: device=${dto.deviceId} person=${dto.personId} → user=${dto.userId} meeting=${dto.meetingId} (mapping ${mappingId}).`,
    );

    return {
      mappingId,
      deviceId: dto.deviceId,
      personId: dto.personId,
      userId: dto.userId,
      meetingId: dto.meetingId,
      syncStatus: 'synced',
    };
  }
}
