import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import * as ExcelJS from 'exceljs';

import {
  MeetingsService,
  AuthUser,
  ClientContext,
} from './meetings.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { buildMeetingInviteEmail } from '../../mail/templates/builders.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import {
  MeetingEntity,
  MeetingStatus,
  MeetingVisibilityLevel,
} from '../entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

import {
  MAX_IMPORT_ROWS,
  MAX_IMPORT_FILE_BYTES,
  XLSX_MIME,
  IMPORT_PARTICIPANTS_HEADERS,
  IMPORT_PARTICIPANTS_COLUMNS,
  IMPORT_PARTICIPANT_TYPE_ALIASES,
  ImportParticipantType,
  ImportRowStatus,
  ImportRowReason,
  ImportRequestError,
} from '../constants/import-participants.constants.js';
import {
  ImportParticipantsReportDto,
  ImportRowResult,
} from '../dto/import-participants-response.dto.js';

interface ParsedRow {
  row: number;
  type: string;
  email: string;
  employeeCode: string;
  fullName: string;
  organizationName: string;
  phoneNumber: string;
}

interface RowState {
  parsed: ParsedRow;
  result: ImportRowResult;
  kind: ImportParticipantType | null;
  resolvedUserId?: string;
  isHardError: boolean;
  isWarning: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ParticipantImportService {
  private readonly logger = new Logger(ParticipantImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly meetingsService: MeetingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  //  Template generation
  // ════════════════════════════════════════════════════════════════

  async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartTracking System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Participants');
    sheet.columns = IMPORT_PARTICIPANTS_COLUMNS.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.key === 'stt' ? 8 : 24,
    }));
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCE6F1' },
      };
      cell.border = { bottom: { style: 'thin' } };
    });

    sheet.addRow({
      stt: 1,
      type: 'internal',
      email: 'nhanvien@company.com',
      employee_code: '',
      full_name: '',
      organization_name: '',
      phone_number: '',
    });
    sheet.addRow({
      stt: 2,
      type: 'internal',
      email: '',
      employee_code: 'EMP0123',
      full_name: '',
      organization_name: '',
      phone_number: '',
    });
    sheet.addRow({
      stt: 3,
      type: 'external',
      email: 'khach@doitac.com',
      employee_code: '',
      full_name: 'Nguyen Van B',
      organization_name: 'Cong ty ABC',
      phone_number: '0900000000',
    });

    const guide = workbook.addWorksheet('Huong dan');
    guide.columns = [{ width: 24 }, { width: 70 }];
    const guideRows: [string, string][] = [
      ['Cột', 'Mô tả'],
      ['STT', 'Số thứ tự dòng (tùy chọn, chỉ để tham khảo)'],
      [
        'Loại',
        'Bắt buộc: Nội bộ / internal (nhân viên nội bộ) hoặc Khách ngoài / external (khách ngoài)',
      ],
      [
        'Email',
        'Internal: định danh chính (ưu tiên). External: email liên hệ (bắt buộc)',
      ],
      ['Mã nhân viên', 'Internal: fallback khi Email trống'],
      ['Họ và tên', 'External: bắt buộc'],
      ['Tổ chức', 'External: tùy chọn'],
      ['Số điện thoại', 'External: tùy chọn'],
    ];
    guideRows.forEach((r, idx) => {
      const row = guide.addRow(r);
      if (idx === 0) row.font = { bold: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ════════════════════════════════════════════════════════════════
  //  Import orchestration
  // ════════════════════════════════════════════════════════════════

  async importParticipants(
    meetingId: string,
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
    options: { forceAddWithWarnings?: boolean },
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<ImportParticipantsReportDto> {
    // ── Step 0: File validation ──
    this.validateFile(file);

    // ── Meeting validation + authorization ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }
    if (
      meeting.status !== MeetingStatus.SCHEDULED &&
      meeting.status !== MeetingStatus.IN_PROGRESS
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Cuộc họp không ở trạng thái cho phép thêm thành viên',
        error: {
          code: 'INVALID_MEETING_STATUS',
          details: {
            currentStatus: meeting.status,
            allowedStatuses: ['scheduled', 'in_progress'],
          },
        },
      });
    }
    await this.assertCanManageParticipants(meeting, authUser.userId);

    // ── Step 1: Parse ──
    const rows = await this.parseWorkbook(file!.buffer);

    // ── Step 2: Static per-row validation ──
    const states: RowState[] = rows.map((parsed) =>
      this.staticValidate(parsed),
    );

    // ── Step 3: Resolve internal + duplicate detection ──
    await this.resolveAndDetectDuplicates(meetingId, states);

    // ── Step 4: Warning evaluation ──
    await this.evaluateWarnings(meeting, states, authUser.userId);

    // ── Step 5: Two-step gate ──
    const hasWarnings = states.some((s) => s.isWarning);
    if (hasWarnings && options.forceAddWithWarnings !== true) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Có dòng cảnh báo. Vui lòng xem lại và xác nhận.',
        error: {
          code: ImportRequestError.WARNING_CONFIRMATION_REQUIRED,
          details: {
            totalRows: states.length,
            warningCount: states.filter((s) => s.isWarning).length,
            errorCount: states.filter((s) => s.isHardError).length,
            results: states.map((s) => s.result),
          },
        },
      });
    }

    // ── Step 6: Commit (per-row transaction) ──
    const addedInternalUserIds: string[] = [];
    const addedExternalEmails: string[] = [];

    for (const state of states) {
      if (state.isHardError) {
        state.result.status = ImportRowStatus.FAILED;
        continue;
      }
      try {
        if (state.kind === ImportParticipantType.INTERNAL) {
          const participantId = await this.dataSource.transaction((em) =>
            this.meetingsService.persistInternalParticipantCore(
              em,
              meetingId,
              state.resolvedUserId!,
              authUser.userId,
              clientContext,
            ),
          );
          state.result.status = ImportRowStatus.SUCCESS;
          state.result.participantId = participantId;
          state.result.reason = undefined;
          addedInternalUserIds.push(state.resolvedUserId!);
        } else {
          const participantId = await this.dataSource.transaction((em) =>
            this.meetingsService.persistExternalParticipantCore(
              em,
              meetingId,
              {
                fullName: state.parsed.fullName,
                email: state.parsed.email,
                organizationName: state.parsed.organizationName || null,
                phoneNumber: state.parsed.phoneNumber || null,
              },
              authUser.userId,
              clientContext,
            ),
          );
          state.result.status = ImportRowStatus.SUCCESS;
          state.result.participantId = participantId;
          state.result.reason = undefined;
          addedExternalEmails.push(state.parsed.email);
        }
      } catch (error: unknown) {
        state.result.status = ImportRowStatus.FAILED;
        state.result.reason = this.extractErrorCode(error);
        this.logger.error(
          `[ParticipantImport] Row ${state.result.row} failed: ${(error as Error).message}`,
        );
      }
    }

    // ── Step 7: Notifications (best-effort) ──
    await this.dispatchNotifications(
      meeting,
      addedInternalUserIds,
      addedExternalEmails,
      authUser.userId,
    );

    // ── Step 8: Audit tổng + return ──
    const successCount = states.filter(
      (s) => s.result.status === ImportRowStatus.SUCCESS,
    ).length;
    const failedCount = states.filter(
      (s) => s.result.status === ImportRowStatus.FAILED,
    ).length;
    const warningCount = states.filter((s) => s.isWarning).length;

    await this.writeImportAudit(meetingId, authUser.userId, clientContext, {
      totalRows: states.length,
      successCount,
      failedCount,
      warningCount,
    });

    return new ImportParticipantsReportDto({
      totalRows: states.length,
      successCount,
      failedCount,
      warningCount,
      results: states.map((s) => s.result),
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════════════════

  private validateFile(
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
  ): void {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        success: false,
        message: 'Vui lòng tải lên tệp Excel (.xlsx)',
        error: { code: ImportRequestError.INVALID_FILE_FORMAT, details: {} },
      });
    }
    const isXlsxMime = file.mimetype === XLSX_MIME;
    const isXlsxName = (file.originalname ?? '')
      .toLowerCase()
      .endsWith('.xlsx');
    if (!isXlsxMime && !isXlsxName) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp không đúng định dạng .xlsx',
        error: { code: ImportRequestError.INVALID_FILE_FORMAT, details: {} },
      });
    }
    if ((file.size ?? file.buffer.length) > MAX_IMPORT_FILE_BYTES) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp vượt quá dung lượng cho phép',
        error: {
          code: ImportRequestError.FILE_TOO_LARGE,
          details: { maxBytes: MAX_IMPORT_FILE_BYTES },
        },
      });
    }
  }

  private async assertCanManageParticipants(
    meeting: MeetingEntity,
    actorId: string,
  ): Promise<void> {
    if (meeting.visibilityLevel !== MeetingVisibilityLevel.PRIVATE) {
      return;
    }
    const isOwner =
      meeting.organizerId === actorId || meeting.hostId === actorId;
    if (isOwner) {
      return;
    }
    const isAdmin = await this.meetingsService.checkUserPermission(
      actorId,
      'admin.all',
    );
    if (!isAdmin) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thêm thành viên vào cuộc họp này',
        error: {
          code: 'FORBIDDEN_ACCESS',
          details: {
            reason: 'Meeting là Private và bạn không phải Organizer/Host/Admin',
          },
        },
      });
    }
  }

  private async parseWorkbook(buffer: Buffer): Promise<ParsedRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({
        success: false,
        message: 'Không đọc được tệp Excel',
        error: { code: ImportRequestError.INVALID_FILE_FORMAT, details: {} },
      });
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp Excel không có sheet dữ liệu',
        error: { code: ImportRequestError.INVALID_TEMPLATE, details: {} },
      });
    }

    // Validate header: đúng số cột (7) và đúng tên cột theo thứ tự chuẩn.
    const headerRow = sheet.getRow(1);
    const actualHeaders = IMPORT_PARTICIPANTS_HEADERS.map((_, idx) =>
      this.cellString(headerRow.getCell(idx + 1)).toLowerCase(),
    );
    const headerMatches = IMPORT_PARTICIPANTS_HEADERS.every(
      (expected, idx) => actualHeaders[idx] === expected.toLowerCase(),
    );
    if (
      sheet.columnCount > IMPORT_PARTICIPANTS_HEADERS.length ||
      !headerMatches
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Sai nguyên mẫu. Vui lòng không tự ý thêm cột.',
        error: {
          code: ImportRequestError.INVALID_TEMPLATE,
          details: {
            expectedHeaders: IMPORT_PARTICIPANTS_HEADERS,
            actualColumnCount: sheet.columnCount,
          },
        },
      });
    }

    const rows: ParsedRow[] = [];
    const lastRow = sheet.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const excelRow = sheet.getRow(r);
      // Cột 1 = STT (chỉ tham khảo, không dùng trong logic).
      const rawType = this.cellString(excelRow.getCell(2)).toLowerCase();
      const type = IMPORT_PARTICIPANT_TYPE_ALIASES[rawType] ?? rawType;
      const email = this.cellString(excelRow.getCell(3)).toLowerCase();
      const employeeCode = this.cellString(excelRow.getCell(4));
      const fullName = this.cellString(excelRow.getCell(5));
      const organizationName = this.cellString(excelRow.getCell(6));
      const phoneNumber = this.cellString(excelRow.getCell(7));

      // Bỏ qua dòng hoàn toàn trống, hoặc chỉ điền mỗi STT mà các cột khác trống
      if (
        !type &&
        !email &&
        !employeeCode &&
        !fullName &&
        !organizationName &&
        !phoneNumber
      ) {
        continue;
      }

      rows.push({
        row: r,
        type,
        email,
        employeeCode,
        fullName,
        organizationName,
        phoneNumber,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp không có dữ liệu',
        error: { code: ImportRequestError.INVALID_TEMPLATE, details: {} },
      });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        success: false,
        message: `Tệp vượt quá số dòng tối đa (${MAX_IMPORT_ROWS})`,
        error: {
          code: ImportRequestError.IMPORT_ROW_LIMIT_EXCEEDED,
          details: { maxRows: MAX_IMPORT_ROWS, actual: rows.length },
        },
      });
    }

    return rows;
  }

  private staticValidate(parsed: ParsedRow): RowState {
    const isInternal =
      parsed.type === (ImportParticipantType.INTERNAL as string);
    const isExternal =
      parsed.type === (ImportParticipantType.EXTERNAL as string);
    const identifier =
      parsed.email || parsed.employeeCode || parsed.fullName || '';

    const result: ImportRowResult = {
      row: parsed.row,
      type: isInternal
        ? ImportParticipantType.INTERNAL
        : isExternal
          ? ImportParticipantType.EXTERNAL
          : 'unknown',
      identifier,
      status: ImportRowStatus.VALID,
    };
    const state: RowState = {
      parsed,
      result,
      kind: isInternal
        ? ImportParticipantType.INTERNAL
        : isExternal
          ? ImportParticipantType.EXTERNAL
          : null,
      isHardError: false,
      isWarning: false,
    };

    if (!isInternal && !isExternal) {
      return this.markError(state, ImportRowReason.INVALID_ROW_TYPE);
    }

    if (isInternal) {
      if (!parsed.email && !parsed.employeeCode) {
        return this.markError(state, ImportRowReason.MISSING_IDENTIFIER);
      }
      if (parsed.email && !EMAIL_REGEX.test(parsed.email)) {
        return this.markError(state, ImportRowReason.INVALID_EMAIL);
      }
    } else {
      // external
      if (
        !parsed.fullName ||
        !parsed.email ||
        !EMAIL_REGEX.test(parsed.email)
      ) {
        return this.markError(state, ImportRowReason.INVALID_EXTERNAL_ROW);
      }
    }

    return state;
  }

  private async resolveAndDetectDuplicates(
    meetingId: string,
    states: RowState[],
  ): Promise<void> {
    const internalStates = states.filter(
      (s) => !s.isHardError && s.kind === ImportParticipantType.INTERNAL,
    );
    const externalStates = states.filter(
      (s) => !s.isHardError && s.kind === ImportParticipantType.EXTERNAL,
    );

    // ── Resolve internal users (batch) ──
    if (internalStates.length > 0) {
      const emails = internalStates
        .map((s) => s.parsed.email)
        .filter((e) => !!e);
      const codes = internalStates
        .map((s) => s.parsed.employeeCode)
        .filter((c) => !!c);

      const users = await this.dataSource.getRepository(UserEntity).find({
        where: [
          ...(emails.length ? [{ email: In(emails) }] : []),
          ...(codes.length ? [{ employeeCode: In(codes) }] : []),
        ],
      });
      const activeUsers = users.filter(
        (u) => u.accountStatus === AccountStatus.ACTIVE && !u.deletedAt,
      );
      const byEmail = new Map<string, UserEntity>();
      const byCode = new Map<string, UserEntity>();
      for (const u of activeUsers) {
        if (u.email) byEmail.set(u.email.toLowerCase(), u);
        if (u.employeeCode) byCode.set(u.employeeCode, u);
      }

      for (const s of internalStates) {
        const user =
          (s.parsed.email && byEmail.get(s.parsed.email)) ||
          (s.parsed.employeeCode && byCode.get(s.parsed.employeeCode)) ||
          null;
        if (!user) {
          this.markError(s, ImportRowReason.USER_NOT_FOUND);
        } else {
          s.resolvedUserId = user.id;
        }
      }

      // Duplicate-in-file (internal) theo resolvedUserId
      const seenUserIds = new Set<string>();
      for (const s of internalStates) {
        if (s.isHardError || !s.resolvedUserId) continue;
        if (seenUserIds.has(s.resolvedUserId)) {
          this.markError(s, ImportRowReason.DUPLICATE_IN_FILE);
        } else {
          seenUserIds.add(s.resolvedUserId);
        }
      }

      // Duplicate-in-DB (internal)
      const resolvedIds = internalStates
        .filter((s) => !s.isHardError && s.resolvedUserId)
        .map((s) => s.resolvedUserId!);
      if (resolvedIds.length > 0) {
        const existing = await this.dataSource
          .getRepository(MeetingParticipantEntity)
          .find({ where: { meetingId, userId: In(resolvedIds) } });
        const existingSet = new Set(existing.map((p) => p.userId));
        for (const s of internalStates) {
          if (
            !s.isHardError &&
            s.resolvedUserId &&
            existingSet.has(s.resolvedUserId)
          ) {
            this.markError(s, ImportRowReason.PARTICIPANT_ALREADY_EXISTS);
          }
        }
      }
    }

    // ── External duplicate detection ──
    if (externalStates.length > 0) {
      // Duplicate-in-file (external) theo email
      const seenEmails = new Set<string>();
      for (const s of externalStates) {
        if (s.isHardError) continue;
        if (seenEmails.has(s.parsed.email)) {
          this.markError(s, ImportRowReason.DUPLICATE_IN_FILE);
        } else {
          seenEmails.add(s.parsed.email);
        }
      }

      // Duplicate-in-DB (external)
      const emails = externalStates
        .filter((s) => !s.isHardError)
        .map((s) => s.parsed.email);
      if (emails.length > 0) {
        const existing = await this.dataSource
          .getRepository(MeetingExternalParticipantEntity)
          .createQueryBuilder('ep')
          .where('ep.meetingId = :meetingId', { meetingId })
          .andWhere('LOWER(ep.email) IN (:...emails)', { emails })
          .getMany();
        const existingSet = new Set(
          existing.map((p) => (p.email ?? '').toLowerCase()),
        );
        for (const s of externalStates) {
          if (!s.isHardError && existingSet.has(s.parsed.email)) {
            this.markError(s, ImportRowReason.PARTICIPANT_ALREADY_EXISTS);
          }
        }
      }
    }
  }

  private async evaluateWarnings(
    meeting: MeetingEntity,
    states: RowState[],
    actorId: string,
  ): Promise<void> {
    const validInternal = states.filter(
      (s) =>
        !s.isHardError &&
        s.kind === ImportParticipantType.INTERNAL &&
        s.resolvedUserId,
    );
    if (validInternal.length === 0) return;

    // ── Schedule conflict ──
    const userIds = validInternal.map((s) => s.resolvedUserId!);
    const conflictResult = await this.meetingsService.checkParticipantConflicts(
      userIds,
      meeting.startTime,
      meeting.endTime,
    );
    const conflictUserIds = new Set(
      conflictResult.conflicts.map((c) => c.userId),
    );
    for (const s of validInternal) {
      if (conflictUserIds.has(s.resolvedUserId!)) {
        this.markWarning(s, ImportRowReason.SCHEDULE_CONFLICT);
      }
    }

    // ── Room capacity (cumulative) ──
    if (!meeting.roomId) return;
    const room = await this.dataSource
      .getRepository(RoomEntity)
      .findOne({ where: { id: meeting.roomId } });
    if (!room) return;

    const currentCount = await this.meetingsService.getAttendeeCount(
      meeting.id,
    );
    const capacity = room.capacity;
    if (currentCount + validInternal.length <= capacity) {
      return;
    }

    const policy = await this.getCapacityPolicy();
    const canOverride =
      policy === 'warning'
        ? await this.meetingsService.checkUserPermission(
            actorId,
            'meeting.participant.override_capacity',
          )
        : false;

    // Đánh dấu các dòng vượt sức chứa theo thứ tự xuất hiện
    let seat = currentCount;
    for (const s of validInternal) {
      seat += 1;
      if (seat <= capacity) continue;
      if (policy === 'block' || !canOverride) {
        this.markError(s, ImportRowReason.ROOM_CAPACITY_EXCEEDED);
      } else {
        this.markWarning(s, ImportRowReason.ROOM_CAPACITY_WARNING);
      }
    }
  }

  private async getCapacityPolicy(): Promise<string> {
    const config = await this.dataSource
      .getRepository(SystemConfigEntity)
      .findOne({
        where: { configKey: 'meeting.capacity_policy', isActive: true },
      });
    return (config?.configValue as string) ?? 'warning';
  }

  private async dispatchNotifications(
    meeting: MeetingEntity,
    internalUserIds: string[],
    externalEmails: string[],
    actorId: string,
  ): Promise<void> {
    // Internal: 1 in-app notification gom, KHÔNG email
    if (internalUserIds.length > 0) {
      try {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_INVITE,
          channel: NotificationChannel.IN_APP,
          subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
          content: `Bạn đã được thêm vào cuộc họp "${meeting.title}".`,
          relatedEntityType: 'meeting',
          relatedEntityId: meeting.id,
          recipientScope: 'user_list',
          recipientUserIds: internalUserIds,
          payloadJson: { invitedBy: actorId, source: 'excel_import' },
          createdBy: actorId,
        });
      } catch (err: unknown) {
        this.logger.error(
          `[ParticipantImport] Failed to create in-app notification: ${(err as Error).message}`,
        );
      }
    }

    // External: email riêng từng khách
    for (const email of externalEmails) {
      try {
        await this.notificationsService.enqueueEmailNotification({
          notificationType: NotificationType.MEETING_INVITE,
          channel: NotificationChannel.EMAIL,
          subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
          content: `Bạn được mời tham gia cuộc họp "${meeting.title}".`,
          emailHtml: buildMeetingInviteEmail({
            meetingTitle: meeting.title,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
          }),
          toEmails: [email],
          relatedEntityType: 'meeting',
          relatedEntityId: meeting.id,
          recipientScope: 'user_list',
          payloadJson: { invitedBy: actorId, source: 'excel_import' },
          createdBy: actorId,
        });
      } catch (err: unknown) {
        this.logger.error(
          `[ParticipantImport] Failed to enqueue external email to ${email}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async writeImportAudit(
    meetingId: string,
    actorId: string,
    clientContext: ClientContext,
    summary: {
      totalRows: number;
      successCount: number;
      failedCount: number;
      warningCount: number;
    },
  ): Promise<void> {
    try {
      await this.dataSource.manager.save(AuditLogEntity, {
        userId: actorId,
        actionType: 'IMPORT_PARTICIPANTS',
        entityType: 'meeting',
        entityId: meetingId,
        newValueJson: summary,
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        severity: AuditLogSeverity.INFO,
      });
    } catch (err: unknown) {
      this.logger.error(
        `[ParticipantImport] Failed to write import audit: ${(err as Error).message}`,
      );
    }
  }

  // ── Small utilities ──

  private markError(state: RowState, reason: ImportRowReason): RowState {
    state.isHardError = true;
    state.isWarning = false;
    state.result.status = ImportRowStatus.ERROR;
    state.result.reason = reason;
    return state;
  }

  private markWarning(state: RowState, reason: ImportRowReason): void {
    if (state.isHardError || state.isWarning) return;
    state.isWarning = true;
    state.result.status = ImportRowStatus.WARNING;
    state.result.reason = reason;
  }

  private cellString(cell: ExcelJS.Cell | undefined): string {
    if (!cell) return '';
    // ExcelJS Cell.text trả về biểu diễn văn bản đã format (kể cả hyperlink/rich text).
    const text = cell.text;
    return (typeof text === 'string' ? text : '')
      .replace(/^mailto:/i, '')
      .trim();
  }

  private extractErrorCode(error: unknown): string {
    const resp = (error as { response?: { error?: { code?: string } } })
      ?.response;
    return resp?.error?.code ?? 'IMPORT_ROW_FAILED';
  }
}
