import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  GuestContentService,
  GUEST_SHARED_NOTE_VISIBILITY,
} from './guest-content.service';
import { GuestLobbyService } from './guest-lobby.service';
import { GuestAttendanceService } from './guest-attendance.service';
import { GuestLobbyStatus } from '../constants/guest-access.constants';
import { MeetingEntity } from '../../meetings/entities/meeting.entity';
import { MeetingAgendaEntity } from '../../meetings/entities/meeting-agenda.entity';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity';
import { MeetingNoteEntity } from '../../meetings/entities/meeting-note.entity';
import { RecordingSessionEntity } from '../../recording/entities/recording-session.entity';
import { MediaFileEntity } from '../../recording/entities/media-file.entity';
import { MediaFilesService } from '../../recording/services/media-files.service';

describe('GuestContentService', () => {
  let service: GuestContentService;
  let lobbyService: { getStatusWithAutoAdmit: jest.Mock; assertAdmitted: jest.Mock };
  let attendanceService: { logJoinOnce: jest.Mock };
  let mediaFilesService: { buildSignedDownloadUrl: jest.Mock };
  let repos: Map<unknown, { find: jest.Mock; findOne: jest.Mock }>;
  let dataSource: { getRepository: jest.Mock };

  const guest = {
    externalParticipantId: 'ep-1',
    meetingId: 'meeting-1',
    jti: 'jti-1',
  };

  beforeEach(async () => {
    repos = new Map<unknown, { find: jest.Mock; findOne: jest.Mock }>([
      [
        MeetingEntity,
        {
          find: jest.fn(),
          findOne: jest.fn().mockResolvedValue({
            title: 'Weekly Sync',
            startTime: new Date('2026-08-10T09:00:00Z'),
            endTime: new Date('2026-08-10T10:00:00Z'),
            status: 'in_progress',
            host: { fullName: 'Host Nguyen' },
          }),
        },
      ],
      [
        MeetingAgendaEntity,
        {
          find: jest
            .fn()
            .mockResolvedValue([
              { id: 'agenda-1', agendaOrder: 1, title: 'Item 1', status: 'planned' },
            ]),
          findOne: jest.fn(),
        },
      ],
      [
        MediaFileEntity,
        { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
      ],
      [
        MeetingParticipantEntity,
        {
          find: jest
            .fn()
            .mockResolvedValue([
              { user: { fullName: 'Nhan Vien A', email: 'a@company.com' } },
            ]),
          findOne: jest.fn(),
        },
      ],
      [
        MeetingExternalParticipantEntity,
        {
          find: jest
            .fn()
            .mockResolvedValue([
              { fullName: 'Khach B', organizationName: 'Cong ty B' },
            ]),
          findOne: jest.fn(),
        },
      ],
      [
        MeetingNoteEntity,
        {
          find: jest
            .fn()
            .mockResolvedValue([
              { content: 'Shared note', pinned: false, createdAt: new Date() },
            ]),
          findOne: jest.fn(),
        },
      ],
      [
        RecordingSessionEntity,
        { find: jest.fn(), findOne: jest.fn().mockResolvedValue(null) },
      ],
    ]);

    dataSource = {
      getRepository: jest.fn((entity: unknown) => repos.get(entity)),
    };
    lobbyService = {
      getStatusWithAutoAdmit: jest
        .fn()
        .mockResolvedValue(GuestLobbyStatus.ADMITTED),
      assertAdmitted: jest.fn(),
    };
    attendanceService = { logJoinOnce: jest.fn() };
    mediaFilesService = {
      buildSignedDownloadUrl: jest.fn().mockReturnValue('https://signed.example/file'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestContentService,
        { provide: DataSource, useValue: dataSource },
        { provide: GuestLobbyService, useValue: lobbyService },
        { provide: GuestAttendanceService, useValue: attendanceService },
        { provide: MediaFilesService, useValue: mediaFilesService },
      ],
    }).compile();

    service = module.get(GuestContentService);
  });

  it('should reject via GuestLobbyService.assertAdmitted before querying meeting content', async () => {
    lobbyService.assertAdmitted.mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(service.getGuestMeetingView(guest)).rejects.toThrow('blocked');
    expect(lobbyService.getStatusWithAutoAdmit).toHaveBeenCalledWith(
      guest.meetingId,
      guest.externalParticipantId,
      new Date('2026-08-10T09:00:00Z'),
    );
    expect(attendanceService.logJoinOnce).not.toHaveBeenCalled();
  });

  it('should log guest_join exactly once via GuestAttendanceService', async () => {
    await service.getGuestMeetingView(guest);
    expect(attendanceService.logJoinOnce).toHaveBeenCalledWith(guest);
  });

  it('should NOT expose internal employee email/department — only fullName', async () => {
    const result = await service.getGuestMeetingView(guest);
    const internal = result.participants.find(
      (p) => p.fullName === 'Nhan Vien A',
    );
    expect(internal).toBeDefined();
    expect(JSON.stringify(internal)).not.toMatch(/company\.com/);
    expect(internal?.organizationName).toBeNull();
  });

  it('should include external participants with fullName + organizationName', async () => {
    const result = await service.getGuestMeetingView(guest);
    const external = result.participants.find((p) => p.fullName === 'Khach B');
    expect(external?.organizationName).toBe('Cong ty B');
  });

  it('should only read notes with the guest_shared visibility marker', async () => {
    await service.getGuestMeetingView(guest);
    const notesRepo = repos.get(MeetingNoteEntity)!;
    expect(notesRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visibilityLevel: GUEST_SHARED_NOTE_VISIBILITY,
        }),
      }),
    );
  });

  it('should map agenda and meeting fields correctly', async () => {
    const result = await service.getGuestMeetingView(guest);
    expect(result.meetingTitle).toBe('Weekly Sync');
    expect(result.hostName).toBe('Host Nguyen');
    expect(result.agenda).toEqual([
      { order: 1, title: 'Item 1', status: 'planned', attachments: [] },
    ]);
    expect(result.recordingActive).toBe(false);
  });

  it('should NOT leak transcript/recording file fields (only a boolean indicator)', async () => {
    const result = await service.getGuestMeetingView(guest);
    expect(result).not.toHaveProperty('transcript');
    expect(result).not.toHaveProperty('recordingFileUrl');
  });

  it('should include agenda attachments with a signed download URL via MediaFilesService', async () => {
    const mediaFileRepo = repos.get(MediaFileEntity)!;
    mediaFileRepo.find.mockResolvedValue([
      {
        id: 'file-1',
        relatedEntityId: 'agenda-1',
        fileName: 'slides.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: '2048',
      },
    ]);

    const result = await service.getGuestMeetingView(guest);

    expect(mediaFileRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          relatedEntityType: 'meeting_agenda',
        }),
      }),
    );
    expect(mediaFilesService.buildSignedDownloadUrl).toHaveBeenCalled();
    expect(result.agenda[0].attachments).toEqual([
      {
        id: 'file-1',
        fileName: 'slides.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: '2048',
        downloadUrl: 'https://signed.example/file',
      },
    ]);
  });
});
