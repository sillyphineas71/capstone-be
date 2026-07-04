/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ManualAttendanceController } from '../controllers/manual-attendance.controller.js';
import { ManualAttendanceService } from '../services/manual-attendance.service.js';
import { ManualAttendanceResponseDto } from '../dto/manual-attendance-response.dto.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';

const MEETING_ID = 'meeting-uuid-1';
const RECORD_ID = 'record-uuid-1';
const ACTOR = { userId: 'actor-uuid' };

const sampleResponse = (
  over: Partial<ManualAttendanceResponseDto> = {},
): ManualAttendanceResponseDto =>
  ({
    id: RECORD_ID,
    meetingId: MEETING_ID,
    userId: 'target-user',
    participantId: 'participant-row-1',
    checkInMethod: 'manual',
    attendanceSource: 'manual',
    checkInTime: '2026-06-30T09:00:00.000Z',
    checkOutTime: null,
    isLate: false,
    lateMinutes: 0,
    leftEarly: false,
    attendanceStatus: 'present',
    verifiedBy: ACTOR.userId,
    verifiedAt: '2026-06-30T09:00:00.000Z',
    note: null,
    createdAt: '2026-06-30T09:00:00.000Z',
    updatedAt: '2026-06-30T09:00:00.000Z',
    ...over,
  }) as ManualAttendanceResponseDto;

describe('ManualAttendanceController (UC-B21)', () => {
  let controller: ManualAttendanceController;
  let service: jest.Mocked<ManualAttendanceService>;
  let reflector: Reflector;

  beforeEach(async () => {
    const mockService = {
      createManual: jest.fn(),
      updateStatus: jest.fn(),
      updateProfile: jest.fn(),
      invalidate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManualAttendanceController],
      providers: [{ provide: ManualAttendanceService, useValue: mockService }],
    })
      // Mock guard — KHÔNG resolve permission thật từ DB (độc lập seed).
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ManualAttendanceController);
    service = module.get(ManualAttendanceService);
    reflector = new Reflector();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ===== Wiring controller → service + envelope =====
  describe('create', () => {
    it('gọi service.createManual(meetingId, dto, actor.userId) + envelope success', async () => {
      const dto = { userId: 'target-user' };
      service.createManual.mockResolvedValue(sampleResponse());

      const res = await controller.create(MEETING_ID, dto, ACTOR);

      expect(service.createManual).toHaveBeenCalledWith(
        MEETING_ID,
        dto,
        ACTOR.userId,
      );
      expect(res).toEqual({
        success: true,
        message: 'Manual attendance record created successfully',
        data: sampleResponse(),
      });
    });
  });

  describe('updateStatus', () => {
    it('gọi service.updateStatus(meetingId, recordId, dto, actor.userId) + envelope', async () => {
      const dto = { attendanceStatus: 'late' as const };
      service.updateStatus.mockResolvedValue(
        sampleResponse({ attendanceStatus: 'late' as never }),
      );

      const res = await controller.updateStatus(
        MEETING_ID,
        RECORD_ID,
        dto,
        ACTOR,
      );

      expect(service.updateStatus).toHaveBeenCalledWith(
        MEETING_ID,
        RECORD_ID,
        dto,
        ACTOR.userId,
      );
      expect(res.success).toBe(true);
      expect(res.message).toBe('Attendance status updated successfully');
      expect(res.data.attendanceStatus).toBe('late');
    });
  });

  describe('updateProfile', () => {
    it('gọi service.updateProfile(meetingId, recordId, dto, actor.userId) + envelope', async () => {
      const dto = { checkOutTime: '2026-06-30T09:45:00.000Z' };
      service.updateProfile.mockResolvedValue(
        sampleResponse({ leftEarly: true }),
      );

      const res = await controller.updateProfile(
        MEETING_ID,
        RECORD_ID,
        dto,
        ACTOR,
      );

      expect(service.updateProfile).toHaveBeenCalledWith(
        MEETING_ID,
        RECORD_ID,
        dto,
        ACTOR.userId,
      );
      expect(res.message).toBe('Attendance record updated successfully');
      expect(res.data.leftEarly).toBe(true);
    });
  });

  describe('invalidate', () => {
    it('gọi service.invalidate(meetingId, recordId, dto, actor.userId) + envelope', async () => {
      const dto = { reason: 'wrong record' };
      service.invalidate.mockResolvedValue(
        sampleResponse({ attendanceStatus: 'invalidated' as never }),
      );

      const res = await controller.invalidate(
        MEETING_ID,
        RECORD_ID,
        dto,
        ACTOR,
      );

      expect(service.invalidate).toHaveBeenCalledWith(
        MEETING_ID,
        RECORD_ID,
        dto,
        ACTOR.userId,
      );
      expect(res.message).toBe('Attendance record invalidated successfully');
      expect(res.data.attendanceStatus).toBe('invalidated');
    });
  });

  // ===== AC-010: metadata @RequirePermissions đúng từng route (độc lập DB/seed) =====
  describe('@RequirePermissions metadata (AC-010)', () => {
    it('create → attendance.manual.create', () => {
      expect(
        reflector.get<string[]>(PERMISSIONS_KEY, controller.create),
      ).toEqual(['attendance.manual.create']);
    });

    it('updateStatus → attendance.manual.update', () => {
      expect(
        reflector.get<string[]>(PERMISSIONS_KEY, controller.updateStatus),
      ).toEqual(['attendance.manual.update']);
    });

    it('updateProfile → attendance.manual.update', () => {
      expect(
        reflector.get<string[]>(PERMISSIONS_KEY, controller.updateProfile),
      ).toEqual(['attendance.manual.update']);
    });

    it('invalidate → attendance.invalidate (chỉ System Admin)', () => {
      expect(
        reflector.get<string[]>(PERMISSIONS_KEY, controller.invalidate),
      ).toEqual(['attendance.invalidate']);
    });
  });
});
