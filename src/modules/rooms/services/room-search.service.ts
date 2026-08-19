import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchRoomsQueryDto } from '../dto/search-rooms-query.dto.js';
import { RoomSearchItemDto } from '../dto/room-search-item.dto.js';
import { AvailableRoomsQueryDto } from '../dto/available-rooms-query.dto.js';
import { AvailableRoomItemDto } from '../dto/available-room-item.dto.js';
import { RoomStatus } from '../entities/room.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

interface RoomSearchRow {
  id: string;
  room_code: string;
  room_name: string;
  site_name: string | null;
  area_name: string | null;
  location_description: string | null;
  capacity: number;
  room_type: string;
  current_status: string;
  administrative_status: string;
  latest_occupancy_count: number | null;
  has_current_booking: boolean;
  has_camera: boolean;
  has_microphone: boolean;
  has_display: boolean;
  allow_recording: boolean;
  faulty_count: string | number;
  warning_count: string | number;
}

/** Correlated scalar subquery dung chung cho SELECT + WHERE (khong can LATERAL join). */
const LATEST_OCCUPANCY_SUBQUERY = `(
  SELECT re.occupancy_count FROM room_events re
  WHERE re.room_id = r.id AND re.occupancy_count IS NOT NULL
  ORDER BY re.event_time DESC LIMIT 1
)`;
const HAS_CURRENT_BOOKING_SUBQUERY = `EXISTS (
  SELECT 1 FROM room_bookings rb
  WHERE rb.room_id = r.id
    AND rb.status IN ('approved', 'active')
    AND rb.reserved_start_time <= now() AND rb.reserved_end_time >= now()
)`;
/** Cung logic uu tien voi computeStatus() (JS) — dung de filter theo `status` trong WHERE. */
const COMPUTED_STATUS_SQL = `(CASE
  WHEN r.administrative_status IN ('maintenance', 'inactive') THEN r.administrative_status
  WHEN COALESCE(${LATEST_OCCUPANCY_SUBQUERY}, 0) > 0 THEN 'occupied'
  WHEN ${HAS_CURRENT_BOOKING_SUBQUERY} THEN 'reserved'
  ELSE 'available'
END)`;

interface AvailableRoomRow {
  id: string;
  room_code: string;
  room_name: string;
  site_name: string | null;
  area_name: string | null;
  capacity: number;
  current_status: RoomStatus;
  has_camera: boolean;
  has_microphone: boolean;
  has_display: boolean;
}

export interface RoomSearchResult {
  rooms: RoomSearchItemDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    appliedFilters: Record<string, unknown>;
  };
}

/**
 * RoomSearchService (UC-ROOM-04) — read-only, mo cho moi user da dang nhap.
 *
 * Khong tai dung response cua RoomStatusService (RMS-001) — co tinh cat bo cac field
 * van hanh noi bo (occupancyCount/lastPresenceAt/noShowStatus/currentBooking), chi
 * tra du lieu catalog phu hop browse chung (SEC: du lieu nhay cam theo CLAUDE.md §20.2).
 */
@Injectable()
export class RoomSearchService {
  constructor(private readonly dataSource: DataSource) {}

  async search(query: SearchRoomsQueryDto): Promise<RoomSearchResult> {
    const capacityMin = query.capacityMin ?? null;
    const capacityMax = query.capacityMax ?? null;
    const areaName = query.areaName ?? null;
    const onlyAvailable = query.onlyAvailable ?? null;
    const q = query.q?.trim() || null;
    const status = query.status ?? null;
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    if (
      capacityMin !== null &&
      capacityMax !== null &&
      capacityMin > capacityMax
    ) {
      throw new BadRequestException({
        success: false,
        message: 'capacityMin khong duoc lon hon capacityMax',
        error: {
          code: 'VALIDATION_ERROR',
          details: { capacityMin, capacityMax },
        },
      });
    }

    // [FIX 2026-08-19] onlyAvailable/status nay tinh theo trang thai REAL-TIME
    // (giong computeStatus()), khong con tin thang r.current_status (cot bi
    // OccupancyPersistenceService flip 1 chieu sang 'occupied', khong bao gio
    // tu reset). Dung chung cac scalar subquery voi SELECT list ben duoi.
    // q: tim theo roomName/roomCode (ILIKE, param hoa an toan qua $5).
    const whereClause = `
      WHERE r.is_active = true
        AND r.deleted_at IS NULL
        AND ($1::int IS NULL OR r.capacity >= $1)
        AND ($2::int IS NULL OR r.capacity <= $2)
        AND ($3::text IS NULL OR r.area_name = $3)
        AND ($4::boolean IS NULL OR $4 = false OR ${COMPUTED_STATUS_SQL} = 'available')
        AND ($5::text IS NULL OR r.room_name ILIKE '%' || $5 || '%' OR r.room_code ILIKE '%' || $5 || '%')
        AND ($6::text IS NULL OR ${COMPUTED_STATUS_SQL} = $6)
    `;
    const whereParams = [
      capacityMin,
      capacityMax,
      areaName,
      onlyAvailable,
      q,
      status,
    ];

    const offset = (page - 1) * limit;
    const rows: RoomSearchRow[] = await this.dataSource.manager.query(
      `SELECT r.id, r.room_code, r.room_name, r.site_name, r.area_name,
              r.location_description, r.capacity, r.room_type, r.current_status,
              r.administrative_status,
              ${LATEST_OCCUPANCY_SUBQUERY} AS latest_occupancy_count,
              ${HAS_CURRENT_BOOKING_SUBQUERY} AS has_current_booking,
              r.has_camera, r.has_microphone, r.has_display, r.allow_recording,
              COALESCE(eq.faulty_count, 0) AS faulty_count,
              COALESCE(eq.warning_count, 0) AS warning_count
       FROM rooms r
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE health_status IN ('faulty','offline')) AS faulty_count,
           COUNT(*) FILTER (WHERE health_status = 'warning') AS warning_count
         FROM equipments e
         WHERE e.current_room_id = r.id AND e.deleted_at IS NULL
       ) eq ON true
       ${whereClause}
       ORDER BY r.room_code ASC
       LIMIT $7 OFFSET $8`,
      [...whereParams, limit, offset],
    );

    const countRows: { count: string }[] = await this.dataSource.manager.query(
      `SELECT COUNT(*) AS count FROM rooms r ${whereClause}`,
      whereParams,
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const appliedFilters: Record<string, unknown> = {};
    if (capacityMin !== null) appliedFilters.capacityMin = capacityMin;
    if (capacityMax !== null) appliedFilters.capacityMax = capacityMax;
    if (areaName !== null) appliedFilters.areaName = areaName;
    if (onlyAvailable !== null) appliedFilters.onlyAvailable = onlyAvailable;
    if (q !== null) appliedFilters.q = q;
    if (status !== null) appliedFilters.status = status;

    return {
      rooms: rows.map((row) => this.toItem(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
        appliedFilters,
      },
    };
  }

  /**
   * GET /rooms/available (yeu cau FE, xem
   * Docs/Nam_Sent/backend_api_requirements_available_rooms.md). Loai tru
   * phong dang co booking overlap khung gio yeu cau.
   *
   * Deviation so voi SQL de xuat trong tai lieu FE (da xac thuc voi code hien
   * tai truoc khi sua, xem BAO_CAO_BE tuong ung):
   * - Chi status approved/active moi tinh la "bung", KHONG loai tru theo
   *   kieu "khac cancelled/released" (tuc la KHONG coi pending la bung) —
   *   dung dung quy tac da chot o MeetingsService.getRoomAvailability va
   *   SchedulingService.getRoomSuggestions (Nhom A, 2026-08-08), la quy tac
   *   THAT SU duoc dung khi xac nhan dat phong o POST /meetings.
   * - Co cong them buffer tu system_configs.room_booking_buffer_minutes,
   *   giong POST /meetings, de tranh tinh trang phong hien "trong" o day
   *   nhung van bi tu choi do dinh buffer khi bam xac nhan dat phong.
   * - Bang du lieu that la `room_bookings` (reserved_start_time /
   *   reserved_end_time), khong phai `meetings`/`bookings` chung chung.
   */
  async getAvailableRooms(
    query: AvailableRoomsQueryDto,
  ): Promise<AvailableRoomItemDto[]> {
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new BadRequestException({
        success: false,
        message: 'startTime hoac endTime khong dung dinh dang',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    if (endTime <= startTime) {
      throw new BadRequestException({
        success: false,
        message: 'endTime phai sau startTime',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    const minCapacity = query.minCapacity ?? null;
    const bufferMs = await this.getRoomBookingBufferMs();
    const bufferedStart = new Date(startTime.getTime() - bufferMs);
    const bufferedEnd = new Date(endTime.getTime() + bufferMs);

    const rows: AvailableRoomRow[] = await this.dataSource.manager.query(
      `SELECT r.id, r.room_code, r.room_name, r.site_name, r.area_name,
              r.capacity, r.current_status, r.has_camera, r.has_microphone,
              r.has_display
       FROM rooms r
       WHERE r.is_active = true
         AND r.deleted_at IS NULL
         AND ($1::int IS NULL OR r.capacity >= $1)
         AND NOT EXISTS (
           SELECT 1 FROM room_bookings rb
           WHERE rb.room_id = r.id
             AND rb.status IN ('approved', 'active')
             AND rb.reserved_start_time < $3
             AND rb.reserved_end_time > $2
         )
       ORDER BY r.room_code ASC`,
      [minCapacity, bufferedStart, bufferedEnd],
    );

    return rows.map((row) => ({
      id: row.id,
      roomName: row.room_name,
      roomCode: row.room_code,
      capacity: row.capacity,
      status: row.current_status,
      siteName: row.site_name,
      areaName: row.area_name,
      hasCamera: row.has_camera,
      hasMicrophone: row.has_microphone,
      hasScreen: row.has_display,
    }));
  }

  /**
   * Doc `system_configs.room_booking_buffer_minutes` (mac dinh 15 phut neu
   * thieu config/gia tri khong hop le). ORDER BY updated_at DESC vi
   * config_key khong co unique constraint tren RDS that. Sao chep tu
   * SchedulingService/MeetingsService (khong tach shared helper — quy uoc da
   * co san trong repo o 2 noi khac).
   */
  private async getRoomBookingBufferMs(): Promise<number> {
    const DEFAULT_MINUTES = 15;
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: { configKey: 'room_booking_buffer_minutes' },
          order: { updatedAt: 'DESC' },
        });
      if (!config) return DEFAULT_MINUTES * 60_000;
      const parsed = parseInt(config.configValue ?? '', 10);
      if (isNaN(parsed) || parsed < 0) {
        return DEFAULT_MINUTES * 60_000;
      }
      return parsed * 60_000;
    } catch {
      return DEFAULT_MINUTES * 60_000;
    }
  }

  /**
   * [FIX 2026-08-19] Tinh trang thai HIEN THI real-time thay vi doc thang
   * `r.current_status` — cot do OccupancyPersistenceService flip mot chieu
   * sang 'occupied' va KHONG BAO GIO tu reset ve 'available', nen doc truc
   * tiep se "dung yen" nhu du lieu tinh/mock. Uu tien giong RoomStatusService:
   * 1. administrative_status (admin dat qua PATCH .../administrative-status)
   *    neu la 'maintenance'/'inactive' — luon thang.
   * 2. 'occupied' neu tin hieu occupancy gan nhat (room_events) > 0.
   * 3. 'reserved' neu co booking approved/active dang trong khung gio hien tai.
   * 4. 'available' con lai.
   */
  private computeStatus(row: RoomSearchRow): RoomStatus {
    if (
      row.administrative_status === RoomStatus.MAINTENANCE ||
      row.administrative_status === RoomStatus.INACTIVE
    ) {
      return row.administrative_status as RoomStatus;
    }
    if ((row.latest_occupancy_count ?? 0) > 0) return RoomStatus.OCCUPIED;
    if (row.has_current_booking) return RoomStatus.RESERVED;
    return RoomStatus.AVAILABLE;
  }

  private toItem(row: RoomSearchRow): RoomSearchItemDto {
    const faultyCount = Number(row.faulty_count);
    const warningCount = Number(row.warning_count);
    return {
      roomId: row.id,
      roomCode: row.room_code,
      roomName: row.room_name,
      siteName: row.site_name,
      areaName: row.area_name,
      locationDescription: row.location_description,
      capacity: row.capacity,
      roomType: row.room_type as RoomSearchItemDto['roomType'],
      currentStatus: this.computeStatus(row),
      hasCamera: row.has_camera,
      hasMicrophone: row.has_microphone,
      hasDisplay: row.has_display,
      allowRecording: row.allow_recording,
      hasFaultyEquipment: faultyCount > 0,
      faultyEquipmentCount: faultyCount,
      hasEquipmentWarning: warningCount > 0,
    };
  }
}
