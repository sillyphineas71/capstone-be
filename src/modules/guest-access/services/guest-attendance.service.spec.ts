import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GuestAttendanceService } from './guest-attendance.service';
import { GuestAccessCacheService } from './guest-access-cache.service';
import { AttendanceEventEntity } from '../../attendance/entities/attendance-event.entity';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity';

describe('GuestAttendanceService', () => {
  let service: GuestAttendanceService;
  let attendanceSave: jest.Mock;
  let epFindOne: jest.Mock;
  let dataSource: { getRepository: jest.Mock };
  let cache: {
    hasAttendanceLogged: jest.Mock;
    markAttendanceLogged: jest.Mock;
  };

  const guest = {
    externalParticipantId: 'ep-1',
    meetingId: 'meeting-1',
    jti: 'jti-1',
  };

  beforeEach(async () => {
    attendanceSave = jest.fn().mockResolvedValue(undefined);
    epFindOne = jest
      .fn()
      .mockResolvedValue({ fullName: 'Khach A', organizationName: 'Org A' });
    dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === AttendanceEventEntity) return { save: attendanceSave };
        if (entity === MeetingExternalParticipantEntity)
          return { findOne: epFindOne };
        throw new Error('unexpected entity');
      }),
    };
    cache = {
      hasAttendanceLogged: jest.fn().mockResolvedValue(false),
      markAttendanceLogged: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestAttendanceService,
        { provide: DataSource, useValue: dataSource },
        { provide: GuestAccessCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(GuestAttendanceService);
  });

  describe('logJoinOnce', () => {
    it('should write a guest_join event with user_id null and event_type != check_in', async () => {
      await service.logJoinOnce(guest);
      expect(attendanceSave).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 'meeting-1',
          userId: null,
          eventType: 'guest_join',
          sourceType: 'guest_portal',
          metadataJson: expect.objectContaining({
            externalParticipantId: 'ep-1',
            fullName: 'Khach A',
            organizationName: 'Org A',
          }),
        }),
      );
      expect(attendanceSave.mock.calls[0][0].eventType).not.toBe('check_in');
      expect(cache.markAttendanceLogged).toHaveBeenCalledWith('jti-1');
    });

    it('should NOT write a second time when already logged for this session', async () => {
      cache.hasAttendanceLogged.mockResolvedValue(true);
      await service.logJoinOnce(guest);
      expect(attendanceSave).not.toHaveBeenCalled();
    });

    it('should swallow errors (best-effort) instead of throwing', async () => {
      attendanceSave.mockRejectedValue(new Error('DB down'));
      await expect(service.logJoinOnce(guest)).resolves.toBeUndefined();
    });
  });

  describe('logLeave', () => {
    it('should write a guest_leave event', async () => {
      await service.logLeave(guest);
      expect(attendanceSave).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'guest_leave', userId: null }),
      );
    });

    it('should swallow errors (best-effort)', async () => {
      attendanceSave.mockRejectedValue(new Error('DB down'));
      await expect(service.logLeave(guest)).resolves.toBeUndefined();
    });
  });
});
