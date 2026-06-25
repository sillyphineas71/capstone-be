import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { RoomEntity, RoomType } from '../../rooms/entities/room.entity.js';
import { RoomBookingEntity, RoomBookingStatus } from '../../rooms/entities/room-booking.entity.js';
import { EquipmentEntity, EquipmentType, AssetStatus, HealthStatus } from '../../equipment/entities/equipment.entity.js';
import { RoomSuggestionQueryDto } from '../dto/room-suggestion-query.dto.js';
import { RoomSuggestionItemDto } from '../dto/room-suggestion-item.dto.js';

@Injectable()
export class SchedulingService {
  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  /**
   * Lọc theo equipment_type mapping từ boolean query params.
   */
  private readonly equipmentTypeMap: Record<string, EquipmentType> = {
    hasCamera: EquipmentType.CAMERA,
    hasMicrophone: EquipmentType.MICROPHONE,
    hasDisplay: EquipmentType.DISPLAY,
  };

  /**
   * Core method: trả về danh sách phòng họp đề xuất.
   */
  async getRoomSuggestions(dto: RoomSuggestionQueryDto): Promise<{
    data: RoomSuggestionItemDto[];
    totalRoomsFound: number;
  }> {
    this.validateTimeRange(dto.startTime, dto.endTime);

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    const attendeeCount = dto.attendeeCount;

    // ──────────────────────────────────────────────
    // Base query: rooms active, đủ capacity, không maintenance/inactive
    // ──────────────────────────────────────────────
    const query = this.entityManager
      .createQueryBuilder(RoomEntity, 'room')
      .where('room.is_active = :isActive', { isActive: true })
      .andWhere('room.deleted_at IS NULL')
      .andWhere('room.capacity >= :attendeeCount', { attendeeCount })
      .andWhere('room.current_status NOT IN (:...excludedStatuses)', {
        excludedStatuses: ['maintenance', 'inactive'],
      });

    // ──────────────────────────────────────────────
    // Optional filters (FR-010, FR-011, FR-012)
    // ──────────────────────────────────────────────
    if (dto.roomType) {
      query.andWhere('room.room_type = :roomType', { roomType: dto.roomType });
    }

    if (dto.siteName) {
      query.andWhere('room.site_name = :siteName', { siteName: dto.siteName });
    }

    if (dto.areaName) {
      query.andWhere('room.area_name = :areaName', { areaName: dto.areaName });
    }

    // Chỉ filter allow_recording khi giá trị là true (FR-012)
    if (dto.allowRecording === true) {
      query.andWhere('room.allow_recording = :allowRecording', { allowRecording: true });
    }

    // ──────────────────────────────────────────────
    // Booking overlap exclusion (FR-009, FR-023)
    // Chỉ tính conflict với pending/approved/active
    // Back-to-back booking OK (không buffer time) (FR-023, AC-016)
    // ──────────────────────────────────────────────
    query.andWhere((qb) => {
      const subQuery = qb
        .subQuery()
        .select('1')
        .from(RoomBookingEntity, 'booking')
        .where('booking.room_id = room.id')
        .andWhere('booking.reserved_start_time < :endTime')
        .andWhere('booking.reserved_end_time > :startTime')
        .andWhere('booking.status IN (:...conflictingStatuses)', {
          conflictingStatuses: [
            RoomBookingStatus.PENDING,
            RoomBookingStatus.APPROVED,
            RoomBookingStatus.ACTIVE,
          ],
        })
        .getQuery();
      return 'NOT EXISTS (' + subQuery + ')';
    })
      .setParameter('startTime', startTime)
      .setParameter('endTime', endTime);

    // ──────────────────────────────────────────────
    // Equipment EXISTS filter (FR-013)
    // Chỉ filter khi boolean = true; bỏ qua khi false/null (AC-017)
    // ──────────────────────────────────────────────
    const requestedEquipment: EquipmentType[] = [];

    for (const [param, eqType] of Object.entries(this.equipmentTypeMap)) {
      const value = (dto as unknown as Record<string, unknown>)[param];
      if (value === true) {
        requestedEquipment.push(eqType);
        query.andWhere((qb) => {
          const sub = qb
            .subQuery()
            .select('1')
            .from(EquipmentEntity, 'eq')
            .where('eq.current_room_id = room.id')
            .andWhere('eq.equipment_type = :eqType')
            .andWhere('eq.asset_status = :assetStatus')
            .andWhere('eq.health_status = :healthStatus')
            .andWhere('eq.deleted_at IS NULL')
            .getQuery();
          return 'EXISTS (' + sub + ')';
        })
          .setParameter('eqType', eqType)
          .setParameter('assetStatus', AssetStatus.ASSIGNED)
          .setParameter('healthStatus', HealthStatus.HEALTHY);
      }
    }

    // ──────────────────────────────────────────────
    // Sort: capacity - attendeeCount ASC → room_name ASC → room_code ASC (FR-003, FR-024)
    // ──────────────────────────────────────────────
    query
      .orderBy('room.capacity - :attendeeCount', 'ASC')
      .addOrderBy('room.room_name', 'ASC')
      .addOrderBy('room.room_code', 'ASC');

    // ──────────────────────────────────────────────
    // Execute query
    // ──────────────────────────────────────────────
    const allMatchingRooms = await query.getMany();
    const totalRoomsFound = allMatchingRooms.length;

    // Limit 20 rooms (FR-025)
    const limitedRooms = allMatchingRooms.slice(0, 20);

    // ──────────────────────────────────────────────
    // Build response items with score + matchedFeatures + warnings
    // ──────────────────────────────────────────────
    const roomIds = limitedRooms.map((r) => r.id);

    // Get healthy equipment per room (batch query)
    let equipmentByRoom: Map<string, EquipmentType[]> = new Map();
    if (roomIds.length > 0) {
      const eqQuery = this.entityManager
        .createQueryBuilder(EquipmentEntity, 'eq')
        .select(['eq.current_room_id', 'eq.equipment_type'])
        .where('eq.current_room_id IN (:...roomIds)', { roomIds })
        .andWhere('eq.asset_status = :assetStatus', { assetStatus: AssetStatus.ASSIGNED })
        .andWhere('eq.health_status = :healthStatus', { healthStatus: HealthStatus.HEALTHY })
        .andWhere('eq.deleted_at IS NULL');

      const equipmentList = await eqQuery.getMany();

      equipmentByRoom = new Map();
      for (const eq of equipmentList) {
        const roomId = eq.currentRoomId;
        if (!roomId) continue;
        if (!equipmentByRoom.has(roomId)) {
          equipmentByRoom.set(roomId, []);
        }
        const types = equipmentByRoom.get(roomId)!;
        if (!types.includes(eq.equipmentType)) {
          types.push(eq.equipmentType);
        }
      }
    }

    // Build response
    const data: RoomSuggestionItemDto[] = limitedRooms.map((room) => {
      const roomEquipment = equipmentByRoom.get(room.id) || [];
      const score = this.calculateScore(room.capacity, attendeeCount);

      // matchedFeatures: intersection of requested equipment + actual healthy equipment
      const matchedFeatures = requestedEquipment.filter((reqType) =>
        roomEquipment.includes(reqType),
      ).map((t) => t.toString());

      // warnings: requested equipment but not found healthy in this room
      const warnings = requestedEquipment
        .filter((reqType) => !roomEquipment.includes(reqType))
        .map((t) => `Room does not have ${t}`);

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        roomName: room.roomName,
        capacity: room.capacity,
        score,
        available: true,
        matchedFeatures,
        warnings,
      };
    });

    return { data, totalRoomsFound };
  }

  /**
   * Validate thời gian: end > start, duration <= 24h, start không trong quá khứ.
   * (FR-014, FR-015, FR-016)
   */
  private validateTimeRange(startTimeStr: string, endTimeStr: string): void {
    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new BadRequestException({
        statusCode: 422,
        message: 'startTime hoặc endTime không đúng định dạng',
        error: { code: 'VALIDATION_ERROR', details: {} },
        timestamp: new Date().toISOString(),
      });
    }

    // startTime không trong quá khứ (FR-016)
    if (startTime <= new Date()) {
      throw new BadRequestException({
        statusCode: 422,
        message: 'startTime không được nằm trong quá khứ',
        error: { code: 'VALIDATION_ERROR', details: {} },
        timestamp: new Date().toISOString(),
      });
    }

    // endTime > startTime và duration <= 24h (FR-015)
    if (endTime <= startTime) {
      throw new BadRequestException({
        statusCode: 422,
        message: 'endTime phải sau startTime',
        error: { code: 'SCHEDULING_DURATION_TOO_LONG', details: {} },
        timestamp: new Date().toISOString(),
      });
    }

    const durationMs = endTime.getTime() - startTime.getTime();
    const maxDurationMs = 24 * 60 * 60 * 1000; // 24h

    if (durationMs > maxDurationMs) {
      throw new BadRequestException({
        statusCode: 422,
        message: 'Thời lượng tìm phòng không được vượt quá 24 giờ.',
        error: { code: 'SCHEDULING_DURATION_TOO_LONG', details: {} },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Tính score dựa trên độ vừa vặn sức chứa (FR-003).
   * 100 = capacity khớp attendeeCount, giảm dần khi diff tăng.
   */
  private calculateScore(capacity: number, attendeeCount: number): number {
    const diff = capacity - attendeeCount;
    if (diff === 0) return 100;
    // score giảm dần, tối thiểu 0
    return Math.max(0, Math.round((100 - (diff / capacity) * 100) * 100) / 100);
  }
}

