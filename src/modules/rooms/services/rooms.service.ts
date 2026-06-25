import {
  Injectable,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RoomEntity, RoomStatus } from '../entities/room.entity.js';
import { AuditLogEntity, AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';
import { CreateRoomDto } from '../dto/create-room.dto.js';
import { CreateRoomResponseDto } from '../dto/create-room-response.dto.js';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomRepo: Repository<RoomEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Kiem tra roomCode da ton tai trong DB (ke ca soft delete).
   */
  private async checkDuplicateRoomCode(code: string): Promise<void> {
    const existing = await this.roomRepo.findOne({
      where: { roomCode: code },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Ma phong da ton tai',
        error: { code: 'ROOM_CODE_ALREADY_EXISTS', details: { roomCode: code } },
        timestamp: new Date().toISOString(),
        path: '/api/v1/rooms',
      });
    }
  }

  /**
   * Kiem tra roomName da ton tai trong so phong chua bi soft delete (case-insensitive, trim).
   */
  private async checkDuplicateRoomName(name: string): Promise<void> {
    const trimmed = name.trim();
    const existing = await this.roomRepo
      .createQueryBuilder('room')
      .where('LOWER(TRIM(room.roomName)) = LOWER(:name)', { name: trimmed })
      .andWhere('room.deletedAt IS NULL')
      .getOne();
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Ten phong da ton tai',
        error: { code: 'ROOM_NAME_ALREADY_EXISTS', details: { roomName: name } },
        timestamp: new Date().toISOString(),
        path: '/api/v1/rooms',
      });
    }
  }

  /**
   * Tao phong hop moi.
   * Transaction: tao room trong transaction, audit log ben ngoai
   * de dam bao FR-019: audit log fail khong rollback room.
   */
  async create(dto: CreateRoomDto, userId: string, ipAddress?: string): Promise<CreateRoomResponseDto> {
    // Normalize input
    const roomCode = dto.roomCode.toUpperCase().trim();
    const roomName = dto.roomName.trim();

    // Check duplicates
    await this.checkDuplicateRoomCode(roomCode);
    await this.checkDuplicateRoomName(roomName);

    // Tao room trong transaction
    const saved = await this.dataSource.transaction(async (em) => {
      const room = em.create(RoomEntity, {
        roomCode,
        roomName,
        siteName: dto.siteName ?? null,
        areaName: dto.areaName ?? null,
        locationDescription: dto.locationDescription ?? null,
        capacity: dto.capacity,
        roomType: dto.roomType ?? undefined,
        hasCamera: dto.hasCamera ?? false,
        hasMicrophone: dto.hasMicrophone ?? false,
        hasDisplay: dto.hasDisplay ?? false,
        allowRecording: dto.allowRecording ?? false,
        currentStatus: RoomStatus.AVAILABLE,
        isActive: true,
        createdBy: userId,
        updatedBy: userId,
      });
      return em.save(RoomEntity, room);
    });

    // Ghi audit log BEN NGOAI transaction — fail-separate
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'create',
          entityType: 'room',
          entityId: saved.id,
          newValueJson: {
            roomCode: saved.roomCode,
            roomName: saved.roomName,
            capacity: saved.capacity,
            roomType: saved.roomType,
            currentStatus: saved.currentStatus,
            isActive: saved.isActive,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      // FR-019: audit log fail KHONG rollback room creation
      this.logger.error(`Failed to write audit log for room ${saved.id}: ${err instanceof Error ? err.message : "Unknown"}`);
    }

    return new CreateRoomResponseDto({
      id: saved.id,
      roomCode: saved.roomCode,
      roomName: saved.roomName,
      capacity: saved.capacity,
      currentStatus: saved.currentStatus,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
    });
  }
}

