import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { RoomEntity, RoomStatus } from '../entities/room.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { CreateRoomDto } from '../dto/create-room.dto.js';
import { CreateRoomResponseDto } from '../dto/create-room-response.dto.js';
import { UpdateRoomDto } from '../dto/update-room.dto.js';
import { UpdateRoomResponseDto } from '../dto/update-room-response.dto.js';
import { DeletionImpactResponseDto } from '../dto/deletion-impact-response.dto.js';
import { DeleteRoomResponseDto } from '../dto/delete-room-response.dto.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../entities/room-booking.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../meetings/entities/meeting-event.entity.js';
import { RoomEventEntity } from '../entities/room-event.entity.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { RoomDeleteNotificationProcessor } from './room-delete-notification.processor.js';

const ACTIVE_ROOM_BOOKING_STATUSES = [
  RoomBookingStatus.PENDING,
  RoomBookingStatus.APPROVED,
  RoomBookingStatus.ACTIVE,
];

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomRepo: Repository<RoomEntity>,
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly roomDeleteNotificationProcessor: RoomDeleteNotificationProcessor,
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
        error: {
          code: 'ROOM_CODE_ALREADY_EXISTS',
          details: { roomCode: code },
        },
        timestamp: new Date().toISOString(),
        path: '/api/v1/rooms',
      });
    }
  }

  /**
   * Kiem tra roomName da ton tai trong so phong chua bi soft delete (case-insensitive, trim).
   * excludeRoomId: loai tru chinh ban ghi dang sua (dung cho update()), khong truyen khi tao moi.
   */
  private async checkDuplicateRoomName(
    name: string,
    excludeRoomId?: string,
  ): Promise<void> {
    const trimmed = name.trim();
    const qb = this.roomRepo
      .createQueryBuilder('room')
      .where('LOWER(TRIM(room.roomName)) = LOWER(:name)', { name: trimmed })
      .andWhere('room.deletedAt IS NULL');
    if (excludeRoomId) {
      qb.andWhere('room.id != :excludeRoomId', { excludeRoomId });
    }
    const existing = await qb.getOne();
    if (existing) {
      throw new ConflictException({
        success: false,
        message:
          'Ten phong hop nay da ton tai. Vui long chon mot ten goi khac.',
        error: {
          code: 'ROOM_NAME_ALREADY_EXISTS',
          details: { roomName: name },
        },
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
  async create(
    dto: CreateRoomDto,
    userId: string,
    ipAddress?: string,
  ): Promise<CreateRoomResponseDto> {
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
      this.logger.error(
        `Failed to write audit log for room ${saved.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
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

  /**
   * Cap nhat thong tin phong hop (UC-ROOM-02).
   * roomCode/currentStatus/isActive bat bien qua endpoint nay.
   */
  async update(
    roomId: string,
    dto: UpdateRoomDto,
    userId: string,
    ipAddress?: string,
  ): Promise<UpdateRoomResponseDto> {
    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Phong hop khong ton tai',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId } },
        timestamp: new Date().toISOString(),
        path: `/api/v1/rooms/${roomId}`,
      });
    }

    const roomName = dto.roomName.trim();
    const areaName = dto.areaName.trim();

    // BR1: ten phong phai duy nhat, loai tru chinh ban ghi dang sua
    await this.checkDuplicateRoomName(roomName, roomId);

    const oldValueJson = {
      roomName: room.roomName,
      siteName: room.siteName,
      areaName: room.areaName,
      locationDescription: room.locationDescription,
      capacity: room.capacity,
      roomType: room.roomType,
      hasCamera: room.hasCamera,
      hasMicrophone: room.hasMicrophone,
      hasDisplay: room.hasDisplay,
      allowRecording: room.allowRecording,
    };

    const saved = await this.dataSource.transaction(async (em) => {
      room.roomName = roomName;
      room.areaName = areaName;
      room.capacity = dto.capacity;
      if (dto.siteName !== undefined) room.siteName = dto.siteName;
      if (dto.locationDescription !== undefined)
        room.locationDescription = dto.locationDescription;
      if (dto.roomType !== undefined) room.roomType = dto.roomType;
      if (dto.hasCamera !== undefined) room.hasCamera = dto.hasCamera;
      if (dto.hasMicrophone !== undefined)
        room.hasMicrophone = dto.hasMicrophone;
      if (dto.hasDisplay !== undefined) room.hasDisplay = dto.hasDisplay;
      if (dto.allowRecording !== undefined)
        room.allowRecording = dto.allowRecording;
      room.updatedBy = userId;
      // roomCode/currentStatus/isActive/createdBy/createdAt: khong dong den
      return em.save(RoomEntity, room);
    });

    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'room',
          entityId: saved.id,
          oldValueJson,
          newValueJson: {
            roomName: saved.roomName,
            siteName: saved.siteName,
            areaName: saved.areaName,
            locationDescription: saved.locationDescription,
            capacity: saved.capacity,
            roomType: saved.roomType,
            hasCamera: saved.hasCamera,
            hasMicrophone: saved.hasMicrophone,
            hasDisplay: saved.hasDisplay,
            allowRecording: saved.allowRecording,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      // Audit log fail KHONG rollback update (dong nhat pattern create())
      this.logger.error(
        `Failed to write audit log for room update ${saved.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    this.websocketService.broadcast('room.updated', {
      roomId: saved.id,
      roomName: saved.roomName,
      siteName: saved.siteName,
      areaName: saved.areaName,
      locationDescription: saved.locationDescription,
      capacity: saved.capacity,
      roomType: saved.roomType,
      hasCamera: saved.hasCamera,
      hasMicrophone: saved.hasMicrophone,
      hasDisplay: saved.hasDisplay,
      allowRecording: saved.allowRecording,
      updatedAt: saved.updatedAt,
    });

    return new UpdateRoomResponseDto({
      id: saved.id,
      roomCode: saved.roomCode,
      roomName: saved.roomName,
      siteName: saved.siteName,
      areaName: saved.areaName,
      locationDescription: saved.locationDescription,
      capacity: saved.capacity,
      roomType: saved.roomType,
      currentStatus: saved.currentStatus,
      hasCamera: saved.hasCamera,
      hasMicrophone: saved.hasMicrophone,
      hasDisplay: saved.hasDisplay,
      allowRecording: saved.allowRecording,
      isActive: saved.isActive,
      updatedAt: saved.updatedAt,
    });
  }

  /**
   * Danh sach cuoc hop tuong lai bi anh huong boi viec xoa phong (UC-ROOM-03).
   * Dung chung cho ca preview (getDeletionImpact) va xoa that (deleteRoom) —
   * NEN tinh lai tai dung thoi diem, khong tai su dung ket qua preview cu.
   */
  private async findFutureAffectedMeetings(
    roomId: string,
    manager?: EntityManager,
  ): Promise<MeetingEntity[]> {
    const em = manager ?? this.dataSource.manager;
    return em
      .createQueryBuilder(MeetingEntity, 'meeting')
      .where('meeting.roomId = :roomId', { roomId })
      .andWhere('meeting.startTime > :now', { now: new Date() })
      .andWhere('meeting.status NOT IN (:...excluded)', {
        excluded: [MeetingStatus.CANCELLED, MeetingStatus.COMPLETED],
      })
      .getMany();
  }

  /**
   * EX1: chan xoa neu phong dang co cuoc hop "dang dien ra" tai thoi diem hien tai.
   * Chan theo CA 2 tin hieu: status=in_progress HOAC (status=scheduled va now
   * nam trong [startTime,endTime]) — khong bo sot cuoc hop dang trong gio nhung
   * chua ai bam Start tren live-meeting.
   */
  private async hasBlockingInProgressMeeting(
    roomId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const em = manager ?? this.dataSource.manager;
    const now = new Date();
    const count = await em
      .createQueryBuilder(MeetingEntity, 'meeting')
      .where('meeting.roomId = :roomId', { roomId })
      .andWhere(
        '(meeting.status = :inProgress OR (meeting.status = :scheduled AND meeting.startTime <= :now AND meeting.endTime >= :now))',
        {
          inProgress: MeetingStatus.IN_PROGRESS,
          scheduled: MeetingStatus.SCHEDULED,
          now,
        },
      )
      .getCount();
    return count > 0;
  }

  /**
   * Xem truoc tac dong cua viec xoa phong (UC-ROOM-03, preview — read-only).
   */
  async getDeletionImpact(roomId: string): Promise<DeletionImpactResponseDto> {
    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Phong hop khong ton tai',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId } },
      });
    }

    const [affectedMeetings, blockedByInProgressMeeting] = await Promise.all([
      this.findFutureAffectedMeetings(roomId),
      this.hasBlockingInProgressMeeting(roomId),
    ]);

    return new DeletionImpactResponseDto({
      roomId: room.id,
      roomName: room.roomName,
      affectedMeetingCount: affectedMeetings.length,
      blockedByInProgressMeeting,
    });
  }

  /**
   * Xoa phong hop (soft-delete, UC-ROOM-03). Khong huy meeting (BR2), khong dung
   * du lieu qua khu (BR1). Transaction dong bo cho phan DB write; goi y phong
   * thay the + gui email chay bat dong bo qua background job (khong block response).
   */
  async deleteRoom(
    roomId: string,
    userId: string,
    ipAddress?: string,
  ): Promise<DeleteRoomResponseDto> {
    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Phong hop khong ton tai',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId } },
      });
    }

    // EX1: tinh lai tai dung thoi diem xoa, KHONG tin ket qua preview cu.
    const blocked = await this.hasBlockingInProgressMeeting(roomId);
    if (blocked) {
      throw new ConflictException({
        success: false,
        message:
          'Phòng họp đang được sử dụng ở thời điểm hiện tại. Vui lòng chờ cuộc họp kết thúc trước khi thực hiện thao tác xóa.',
        error: { code: 'ROOM_IN_USE', details: { roomId } },
      });
    }

    const affectedMeetingIds = await this.dataSource.transaction(async (em) => {
      const affectedMeetings = await this.findFutureAffectedMeetings(
        roomId,
        em,
      );

      // (a) soft-delete rooms
      await em.softRemove(RoomEntity, room);

      const meetingIds: string[] = [];
      for (const meeting of affectedMeetings) {
        // (b) release cac room_bookings tuong lai lien quan (chi status con hop le)
        const bookings = await em
          .createQueryBuilder(RoomBookingEntity, 'booking')
          .where('booking.meetingId = :meetingId', { meetingId: meeting.id })
          .andWhere('booking.roomId = :roomId', { roomId })
          .andWhere('booking.status IN (:...statuses)', {
            statuses: ACTIVE_ROOM_BOOKING_STATUSES,
          })
          .getMany();
        for (const booking of bookings) {
          booking.status = RoomBookingStatus.RELEASED;
          await em.save(RoomBookingEntity, booking);
        }

        // (c) null hoa roomId cua meeting — KHONG doi status (BR2)
        meeting.roomId = null;
        await em.save(MeetingEntity, meeting);

        // (d) ghi MeetingEventEntity cho tung meeting
        const meetingEvent = em.create(MeetingEventEntity, {
          meetingId: meeting.id,
          eventType: MeetingEventType.ROOM_CHANGED,
          actorUserId: userId,
          sourceType: MeetingEventSourceType.SYSTEM,
          description:
            'Phòng họp đã bị xóa khỏi hệ thống, cần chọn lại địa điểm.',
          oldValueJson: { roomId },
          newValueJson: { roomId: null },
        });
        await em.save(MeetingEventEntity, meetingEvent);

        meetingIds.push(meeting.id);
      }

      // (e) ghi 1 RoomEventEntity cho phong
      const roomEvent = em.create(RoomEventEntity, {
        roomId,
        meetingId: null,
        bookingId: null,
        eventType: 'room_deleted',
        sourceType: 'admin',
      });
      await em.save(RoomEventEntity, roomEvent);

      return meetingIds;
    });

    // (f) audit log — ngoai transaction, fail khong rollback
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'delete',
          entityType: 'room',
          entityId: roomId,
          newValueJson: { deletedAt: new Date(), affectedMeetingIds },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for room delete ${roomId}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    const deletedAt = new Date();

    // WebSocket broadcast — ngay sau audit, KHONG cho background job (§0.9)
    this.websocketService.broadcast('room.deleted', { roomId, deletedAt });

    // Enqueue background job de xu ly bat dong bo (goi y phong + gui email)
    let notificationJobId: string | null = null;
    if (affectedMeetingIds.length > 0) {
      const job = await this.backgroundJobsService.createQueuedJob({
        jobType: BackgroundJobType.ROOM_DELETE_NOTIFY,
        relatedEntityType: 'room',
        relatedEntityId: roomId,
        requestedBy: userId,
        inputJson: { affectedMeetingIds },
      });
      notificationJobId = job.id;
      // Fire-and-forget: KHONG await — khong duoc block response DELETE (NFR-002/OOS-005).
      this.roomDeleteNotificationProcessor
        .process(job.id, affectedMeetingIds)
        .catch((err) => {
          this.logger.error(
            `[RoomDeleteNotify] Unhandled error processing job ${job.id}: ${
              err instanceof Error ? err.message : 'Unknown error'
            }`,
          );
        });
    }

    return new DeleteRoomResponseDto({
      roomId,
      deletedAt,
      affectedMeetingCount: affectedMeetingIds.length,
      notificationJobId,
    });
  }
}
