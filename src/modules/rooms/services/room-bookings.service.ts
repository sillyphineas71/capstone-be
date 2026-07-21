import { Injectable, Logger } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { RoomBookingEntity } from '../entities/room-booking.entity.js';
import { DepartmentEntity } from '../../accounts/entities/department.entity.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { RoomBookingQueryDto } from '../dto/room-booking-query.dto.js';
import { RoomBookingListItemDto } from '../dto/room-booking-list-item.dto.js';
import { UserSummaryDto } from '../dto/user-summary.dto.js';
import { RoomSummaryDto } from '../dto/room-summary.dto.js';
import { MeetingSummaryDto } from '../dto/meeting-summary.dto.js';

export interface RoomBookingsResult {
  items: RoomBookingListItemDto[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class RoomBookingsService {
  private readonly logger = new Logger(RoomBookingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authzReadRepository: AuthzReadRepository,
  ) {}

  async findRoomBookings(
    queryDto: RoomBookingQueryDto,
    authUser: { userId: string; roles?: string[] },
  ): Promise<RoomBookingsResult> {
    const page = queryDto.page ?? 1;
    const limit = queryDto.limit ?? 20;
    const sortBy = queryDto.sortBy ?? 'reserved_start_time';
    const sortOrder = queryDto.sortOrder ?? 'desc';

    const qb = this.dataSource
      .getRepository(RoomBookingEntity)
      .createQueryBuilder('rb')
      .leftJoin('rb.room', 'room')
      .leftJoin('rb.meeting', 'meeting')
      .leftJoin('rb.bookedByUser', 'bookedBy')
      .leftJoin('rb.approvedByUser', 'approvedBy')
      .select([
        'rb.id',
        'rb.bookingCode',
        'rb.bookingType',
        'rb.status',
        'rb.roomId',
        'rb.meetingId',
        'rb.bookedBy',
        'rb.reservedStartTime',
        'rb.reservedEndTime',
        'rb.approvedBy',
        'rb.approvedAt',
        'rb.cancellationReason',
        'rb.createdAt',
        'rb.updatedAt',
        'room.id',
        'room.roomName',
        'meeting.id',
        'meeting.title',
        'bookedBy.id',
        'bookedBy.fullName',
        'bookedBy.email',
        'approvedBy.id',
        'approvedBy.fullName',
        'approvedBy.email',
      ]);

    // Filters
    if (queryDto.roomId) {
      qb.andWhere('rb.roomId = :roomId', { roomId: queryDto.roomId });
    }

    if (queryDto.status) {
      qb.andWhere('rb.status = :status', { status: queryDto.status });
    }

    if (queryDto.bookingType) {
      qb.andWhere('rb.bookingType = :bookingType', {
        bookingType: queryDto.bookingType,
      });
    }

    if (queryDto.from && queryDto.to) {
      qb.andWhere('rb.reservedStartTime BETWEEN :from AND :to', {
        from: new Date(queryDto.from),
        to: new Date(queryDto.to),
      });
    } else if (queryDto.from) {
      qb.andWhere('rb.reservedStartTime >= :from', {
        from: new Date(queryDto.from),
      });
    } else if (queryDto.to) {
      qb.andWhere('rb.reservedStartTime <= :to', { to: new Date(queryDto.to) });
    }

    if (queryDto.q) {
      qb.andWhere('rb.bookingCode ILIKE :q', { q: '%' + queryDto.q + '%' });
    }

    // Data scope filter
    const { roles } =
      await this.authzReadRepository.getEffectiveRolesAndPermissions(
        authUser.userId,
      );

    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    if (!isAdmin) {
      const depts = await this.dataSource.getRepository(DepartmentEntity).find({
        where: {
          managerUserId: authUser.userId,
          isActive: true,
          deletedAt: IsNull(),
        },
      });
      const deptIds = depts.map((d) => d.id);

      const conditions: string[] = ['bookedBy.directManagerId = :userId'];
      const params: Record<string, unknown> = { userId: authUser.userId };

      if (deptIds.length > 0) {
        conditions.push('bookedBy.departmentId IN (:...deptIds)');
        params['deptIds'] = deptIds;
      }

      qb.andWhere('(' + conditions.join(' OR ') + ')', params);
    }

    // Sort
    const allowlist = ['reserved_start_time', 'created_at', 'status'];
    const sortField = allowlist.includes(sortBy)
      ? sortBy
      : 'reserved_start_time';
    const sortDir = sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy('rb.' + sortField, sortDir);

    // Pagination
    const skip = (page - 1) * limit;
    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    // Map to DTOs
    const listItems = items.map((item) => this.mapToDto(item));

    return { items: listItems, page, limit, total };
  }

  private mapToDto(item: RoomBookingEntity): RoomBookingListItemDto {
    const dto = new RoomBookingListItemDto();
    dto.id = item.id;
    dto.bookingCode = item.bookingCode;
    dto.bookingType = item.bookingType;
    dto.status = item.status;
    dto.roomId = item.roomId;
    dto.meetingId = item.meetingId;
    dto.bookedBy = item.bookedBy;
    dto.reservedStartTime = item.reservedStartTime;
    dto.reservedEndTime = item.reservedEndTime;
    dto.approvedBy = item.approvedBy;
    dto.approvedAt = item.approvedAt;
    dto.cancellationReason = item.cancellationReason;
    dto.createdAt = item.createdAt;
    dto.updatedAt = item.updatedAt;

    // Relations
    if (item.room) {
      const roomDto = new RoomSummaryDto();
      roomDto.id = item.room.id;
      roomDto.roomName = item.room.roomName;
      dto.room = roomDto;
    }

    if (item.meeting) {
      const meetingDto = new MeetingSummaryDto();
      meetingDto.id = item.meeting.id;
      meetingDto.title = item.meeting.title;
      dto.meeting = meetingDto;
    } else {
      dto.meeting = null;
    }

    if (item.bookedByUser) {
      const userDto = new UserSummaryDto();
      userDto.id = item.bookedByUser.id;
      userDto.fullName = item.bookedByUser.fullName;
      userDto.email = item.bookedByUser.email;
      dto.bookedByUser = userDto;
    }

    if (item.approvedByUser) {
      const userDto = new UserSummaryDto();
      userDto.id = item.approvedByUser.id;
      userDto.fullName = item.approvedByUser.fullName;
      userDto.email = item.approvedByUser.email;
      dto.approvedByUser = userDto;
    } else {
      dto.approvedByUser = null;
    }

    return dto;
  }
}
