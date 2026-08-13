import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchRoomsQueryDto } from '../dto/search-rooms-query.dto.js';
import { RoomSearchItemDto } from '../dto/room-search-item.dto.js';

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
  has_camera: boolean;
  has_microphone: boolean;
  has_display: boolean;
  allow_recording: boolean;
  faulty_count: string | number;
  warning_count: string | number;
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

    const whereClause = `
      WHERE r.is_active = true
        AND r.deleted_at IS NULL
        AND ($1::int IS NULL OR r.capacity >= $1)
        AND ($2::int IS NULL OR r.capacity <= $2)
        AND ($3::text IS NULL OR r.area_name = $3)
        AND ($4::boolean IS NULL OR $4 = false OR r.current_status = 'available')
    `;
    const whereParams = [capacityMin, capacityMax, areaName, onlyAvailable];

    const offset = (page - 1) * limit;
    const rows: RoomSearchRow[] = await this.dataSource.manager.query(
      `SELECT r.id, r.room_code, r.room_name, r.site_name, r.area_name,
              r.location_description, r.capacity, r.room_type, r.current_status,
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
       LIMIT $5 OFFSET $6`,
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
      currentStatus: row.current_status as RoomSearchItemDto['currentStatus'],
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
