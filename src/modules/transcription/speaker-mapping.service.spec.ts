/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { SpeakerMappingService } from './speaker-mapping.service.js';
import {
  TranscriptEntity,
  TranscriptStatus,
} from './entities/transcript.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../meetings/entities/meeting-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
} from '../meetings/entities/meeting-event.entity.js';
import { RecordingSessionEntity } from '../recording/entities/recording-session.entity.js';
import { MeetingExternalParticipantEntity } from '../meetings/entities/meeting-external-participant.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { TRANSCRIPTION_ERROR_CODES } from './constants/transcription-error-codes.js';

describe('SpeakerMappingService (feat-speaker-tagging-post-meeting + feat-speaker-tagging-live)', () => {
  let service: SpeakerMappingService;

  let transcriptRepo: { findOne: jest.Mock; save: jest.Mock };
  let meetingRepo: { findOne: jest.Mock };
  let participantRepo: { findOne: jest.Mock };
  let meetingEventRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let recordingSessionRepo: { findOne: jest.Mock };
  let externalParticipantRepo: { findBy: jest.Mock; findOne: jest.Mock };
  let userRepo: { findBy: jest.Mock; findOne: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };

  let lastTxManager: { create: jest.Mock; save: jest.Mock };

  const meetingId = 'meeting-1';
  const userId = 'host-1';
  const transcriptId = 'tr-1';
  const recordingSessionId = 'rs-1';
  const recordingSessionStartedAt = new Date('2026-08-02T10:00:00.000Z');

  function segment(overrides: Partial<Record<string, unknown>>) {
    return {
      segmentId: 'seg-x',
      startMs: 0,
      endMs: 1000,
      text: 'text',
      speakerLabel: 'Speaker_1',
      speakerSource: 'pyannote',
      userId: null,
      channelId: null,
      roomZoneLabel: null,
      sttConfidence: 0.9,
      diarizationConfidence: 0.9,
      separationConfidence: null,
      finalConfidence: 0.9,
      overlap: false,
      lowConfidence: false,
      manualReviewRequired: false,
      notes: [],
      ...overrides,
    };
  }

  function buildTranscript(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: transcriptId,
      meetingId,
      recordingSessionId,
      status: TranscriptStatus.DRAFT,
      speakerSegmentsJson: {
        segments: [
          segment({
            segmentId: 'seg-0000',
            startMs: 0,
            endMs: 2000,
            text: 'A ngan',
            speakerLabel: 'Speaker_1',
          }),
          segment({
            segmentId: 'seg-0001',
            startMs: 2000,
            endMs: 9000,
            text: 'A dai nhat',
            speakerLabel: 'Speaker_1',
          }),
          segment({
            segmentId: 'seg-0002',
            startMs: 9000,
            endMs: 12000,
            text: 'B noi',
            speakerLabel: 'Speaker_2',
          }),
        ],
      },
      detectedSpeakersJson: {
        speakers: [
          {
            speakerLabel: 'Speaker_1',
            totalSpeakingMs: 9000,
            segmentCount: 2,
            mappedUserId: null,
            mappingSource: 'unmapped',
            confidence: 0.9,
          },
          {
            speakerLabel: 'Speaker_2',
            totalSpeakingMs: 3000,
            segmentCount: 1,
            mappedUserId: null,
            mappingSource: 'unmapped',
            confidence: 0.9,
          },
        ],
      },
      ...overrides,
    } as unknown as TranscriptEntity;
  }

  beforeEach(async () => {
    transcriptRepo = {
      findOne: jest.fn().mockResolvedValue(buildTranscript()),
      save: jest.fn((t) => Promise.resolve(t)),
    };
    meetingRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: meetingId,
        startTime: new Date(recordingSessionStartedAt.getTime() - 3600_000),
        actualStartTime: null,
      }),
    };
    participantRepo = {
      findOne: jest.fn().mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      }),
    };
    meetingEventRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: unknown) => data),
      save: jest.fn((data: unknown) =>
        Promise.resolve({ ...(data as object), id: 'live-event-1' }),
      ),
    };
    recordingSessionRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: recordingSessionId,
        meetingId,
        startedAt: recordingSessionStartedAt,
      }),
    };
    externalParticipantRepo = {
      findBy: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    userRepo = {
      findBy: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(
        async (cb: (manager: unknown) => Promise<unknown>) => {
          lastTxManager = {
            create: jest.fn((_entity: unknown, data: unknown) => data),
            save: jest.fn((data: unknown) =>
              Promise.resolve({ ...(data as object), id: 'event-1' }),
            ),
          };
          return cb(lastTxManager);
        },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeakerMappingService,
        {
          provide: getRepositoryToken(TranscriptEntity),
          useValue: transcriptRepo,
        },
        {
          provide: getRepositoryToken(MeetingEntity),
          useValue: meetingRepo,
        },
        {
          provide: getRepositoryToken(MeetingParticipantEntity),
          useValue: participantRepo,
        },
        {
          provide: getRepositoryToken(MeetingEventEntity),
          useValue: meetingEventRepo,
        },
        {
          provide: getRepositoryToken(RecordingSessionEntity),
          useValue: recordingSessionRepo,
        },
        {
          provide: getRepositoryToken(MeetingExternalParticipantEntity),
          useValue: externalParticipantRepo,
        },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(SpeakerMappingService);
  });

  // ─── listSpeakerClusters (T-TAG-003) ─────────────────────────────────

  describe('listSpeakerClusters', () => {
    it('trả về cụm, sắp theo totalSpeakingMs desc, bỏ qua unknown', async () => {
      transcriptRepo.findOne.mockResolvedValue(
        buildTranscript({
          speakerSegmentsJson: {
            segments: [
              segment({ speakerLabel: 'Speaker_1', startMs: 0, endMs: 1000 }),
              segment({
                speakerLabel: 'Speaker_2',
                startMs: 1000,
                endMs: 5000,
              }),
              segment({ speakerLabel: 'unknown', startMs: 5000, endMs: 6000 }),
            ],
          },
        }),
      );

      const result = await service.listSpeakerClusters(transcriptId, userId);

      expect(result.map((c) => c.speakerLabel)).toEqual([
        'Speaker_2',
        'Speaker_1',
      ]);
    });

    it('sampleText/sampleStartMs lấy từ segment DÀI NHẤT trong cụm', async () => {
      const result = await service.listSpeakerClusters(transcriptId, userId);
      const speaker1 = result.find((c) => c.speakerLabel === 'Speaker_1');
      expect(speaker1?.sampleText).toBe('A dai nhat');
      expect(speaker1?.sampleStartMs).toBe(2000);
      expect(speaker1?.totalSpeakingMs).toBe(9000);
      expect(speaker1?.segmentCount).toBe(2);
    });

    it('transcript không tồn tại → 404 TRANSCRIPT_NOT_FOUND', async () => {
      transcriptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.listSpeakerClusters(transcriptId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('không phải Host, không phải Admin → 403', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]); // không role nào
      await expect(
        service.listSpeakerClusters(transcriptId, 'stranger'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('không phải Host nhưng là BUSINESS_ADMIN → cho phép', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([{ role_code: 'BUSINESS_ADMIN' }]);
      const result = await service.listSpeakerClusters(transcriptId, 'admin-1');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── createSpeakerMappings (T-TAG-005/006) ───────────────────────────

  describe('createSpeakerMappings', () => {
    it('AC-001 happy path: gán 1 user + 1 khách, ghi meeting_events + áp ngay vào transcript', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-nam' }]);
      externalParticipantRepo.findBy.mockResolvedValue([
        { id: 'ext-lan', meetingId },
      ]);

      const result = await service.createSpeakerMappings(
        transcriptId,
        {
          mappings: [
            {
              speakerLabel: 'Speaker_1',
              speakerUserId: 'user-nam',
              displayName: 'Nam',
            },
            {
              speakerLabel: 'Speaker_2',
              externalParticipantId: 'ext-lan',
              displayName: 'Chi Lan (khach)',
            },
          ],
        },
        userId,
      );

      expect(result.appliedMappings).toHaveLength(2);
      expect(result.mergedClusters).toHaveLength(0);
      expect(lastTxManager.save).toHaveBeenCalledTimes(2);

      // event_time = startedAt + midpoint(segment DAI NHAT cua Speaker_1: 2000-9000 -> mid 5500)
      const savedEvents = lastTxManager.save.mock.calls.map((c) => c[0]);
      const ev1 = savedEvents.find(
        (e: any) => e.metadataJson.speakerUserId === 'user-nam',
      );
      expect(ev1.eventTime.getTime()).toBe(
        recordingSessionStartedAt.getTime() + 5500,
      );
      expect(ev1.metadataJson).toEqual({
        recordingSessionId,
        speakerUserId: 'user-nam',
        externalParticipantId: null,
        displayName: 'Nam',
        tagSource: 'post',
      });

      expect(transcriptRepo.save).toHaveBeenCalledTimes(1);
      const savedTranscript = transcriptRepo.save.mock.calls[0][0];
      const segs = savedTranscript.speakerSegmentsJson.segments;
      expect(
        segs
          .filter((s: any) => s.speakerLabel === 'Speaker_1')
          .every((s: any) => s.userId === 'user-nam'),
      ).toBe(true);
      expect(
        segs.find((s: any) => s.speakerLabel === 'Speaker_2')
          .mappedExternalParticipantId,
      ).toBe('ext-lan');
      const speakers = savedTranscript.detectedSpeakersJson.speakers;
      expect(
        speakers.find((s: any) => s.speakerLabel === 'Speaker_1').mappingSource,
      ).toBe('manual');
    });

    it('AC-002: cùng identity gán cho 2 speakerLabel -> GỘP, cả 2 label được apply', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-binh' }]);

      const result = await service.createSpeakerMappings(
        transcriptId,
        {
          mappings: [
            {
              speakerLabel: 'Speaker_1',
              speakerUserId: 'user-binh',
              displayName: 'Binh',
            },
            {
              speakerLabel: 'Speaker_2',
              speakerUserId: 'user-binh',
              displayName: 'Binh',
            },
          ],
        },
        userId,
      );

      expect(result.mergedClusters).toEqual([
        { speakerLabels: ['Speaker_1', 'Speaker_2'] },
      ]);
      expect(lastTxManager.save).toHaveBeenCalledTimes(2);
    });

    it('AC-003 (ERR-TAG-002): cùng speakerLabel, 2 identity khác nhau trong 1 request -> reject toàn bộ, KHÔNG ghi gì', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-a' }]);
      externalParticipantRepo.findBy.mockResolvedValue([
        { id: 'ext-hung', meetingId },
      ]);

      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                speakerUserId: 'user-a',
                displayName: 'A',
              },
              {
                speakerLabel: 'Speaker_1',
                externalParticipantId: 'ext-hung',
                displayName: 'Ong Hung',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(transcriptRepo.save).not.toHaveBeenCalled();
    });

    it('ERR-TAG-004: speakerLabel không tồn tại trong transcript -> 400, không ghi gì', async () => {
      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_99',
                speakerUserId: 'user-x',
                displayName: 'X',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('ERR-TAG-005: thiếu cả speakerUserId lẫn externalParticipantId -> 400', async () => {
      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [{ speakerLabel: 'Speaker_1', displayName: 'X' }],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('ERR-TAG-005: có cả speakerUserId lẫn externalParticipantId -> 400', async () => {
      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                speakerUserId: 'user-x',
                externalParticipantId: 'ext-y',
                displayName: 'X',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('speakerUserId không tồn tại -> 400 TARGET_USER_NOT_FOUND', async () => {
      userRepo.findBy.mockResolvedValue([]); // không tìm thấy user nào

      try {
        await service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                speakerUserId: 'ghost',
                displayName: 'X',
              },
            ],
          },
          userId,
        );
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.response.error.code).toBe(
          TRANSCRIPTION_ERROR_CODES.TARGET_USER_NOT_FOUND,
        );
      }
    });

    it('externalParticipantId không thuộc meeting này -> 400 EXTERNAL_PARTICIPANT_NOT_FOUND', async () => {
      externalParticipantRepo.findBy.mockResolvedValue([]); // wrong meeting hoặc không tồn tại

      try {
        await service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                externalParticipantId: 'ext-other-meeting',
                displayName: 'X',
              },
            ],
          },
          userId,
        );
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.response.error.code).toBe(
          TRANSCRIPTION_ERROR_CODES.EXTERNAL_PARTICIPANT_NOT_FOUND,
        );
      }
    });

    it('FR-008: transcript đang processing -> 409', async () => {
      transcriptRepo.findOne.mockResolvedValue(
        buildTranscript({ status: TranscriptStatus.PROCESSING }),
      );
      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                speakerUserId: 'u',
                displayName: 'X',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('transcript không có recordingSessionId -> 409', async () => {
      transcriptRepo.findOne.mockResolvedValue(
        buildTranscript({ recordingSessionId: null }),
      );
      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                speakerUserId: 'u',
                displayName: 'X',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('transcript không tồn tại -> 404', async () => {
      transcriptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                speakerUserId: 'u',
                displayName: 'X',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('không phải Host/Admin -> 403', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.createSpeakerMappings(
          transcriptId,
          {
            mappings: [
              {
                speakerLabel: 'Speaker_1',
                speakerUserId: 'u',
                displayName: 'X',
              },
            ],
          },
          'stranger',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── applySpeakerMappingsFromEvents (T-TAG-008, GA-27) ───────────────

  describe('applySpeakerMappingsFromEvents', () => {
    function buildEvent(overrides: Partial<Record<string, unknown>>) {
      return {
        id: 'evt-1',
        meetingId,
        eventTime: new Date(recordingSessionStartedAt.getTime() + 5500),
        metadataJson: {
          recordingSessionId,
          speakerUserId: 'user-nam',
          externalParticipantId: null,
          displayName: 'Nam',
          tagSource: 'post',
        },
        ...overrides,
      };
    }

    it('áp đúng mapping vào segment MỚI chứa offset tương ứng', async () => {
      meetingEventRepo.find.mockResolvedValue([buildEvent({})]);

      await service.applySpeakerMappingsFromEvents(transcriptId);

      expect(transcriptRepo.save).toHaveBeenCalledTimes(1);
      const saved = transcriptRepo.save.mock.calls[0][0];
      // offset 5500ms rơi vào segment seg-0001 (2000-9000, Speaker_1).
      const segs = saved.speakerSegmentsJson.segments;
      expect(
        segs
          .filter((s: any) => s.speakerLabel === 'Speaker_1')
          .every((s: any) => s.userId === 'user-nam'),
      ).toBe(true);
      const speaker1 = saved.detectedSpeakersJson.speakers.find(
        (s: any) => s.speakerLabel === 'Speaker_1',
      );
      expect(speaker1.mappingSource).toBe('manual');
      expect(speaker1.displayName).toBe('Nam');
    });

    it('ERR-TAG-007: offset không rơi vào segment nào -> bỏ qua, không lỗi, không đổi transcript', async () => {
      meetingEventRepo.find.mockResolvedValue([
        buildEvent({
          // 20000ms vượt khỏi mọi segment (segment cuối kết thúc ở 12000ms).
          eventTime: new Date(recordingSessionStartedAt.getTime() + 20000),
        }),
      ]);

      await expect(
        service.applySpeakerMappingsFromEvents(transcriptId),
      ).resolves.toBeUndefined();
      expect(transcriptRepo.save).not.toHaveBeenCalled();
    });

    it('ERR-TAG-003: 2 event khác identity cùng trỏ 1 speakerLabel mới -> conflict, không gán tên', async () => {
      meetingEventRepo.find.mockResolvedValue([
        buildEvent({
          eventTime: new Date(recordingSessionStartedAt.getTime() + 500), // segment seg-0000 (0-2000, Speaker_1)
          metadataJson: {
            recordingSessionId,
            speakerUserId: 'user-a',
            externalParticipantId: null,
            displayName: 'A',
            tagSource: 'post',
          },
        }),
        buildEvent({
          eventTime: new Date(recordingSessionStartedAt.getTime() + 1500), // cũng seg-0000 (0-2000, Speaker_1)
          metadataJson: {
            recordingSessionId,
            speakerUserId: null,
            externalParticipantId: 'ext-hung',
            displayName: 'Ong Hung',
            tagSource: 'post',
          },
        }),
      ]);

      await service.applySpeakerMappingsFromEvents(transcriptId);

      const saved = transcriptRepo.save.mock.calls[0][0];
      const speaker1 = saved.detectedSpeakersJson.speakers.find(
        (s: any) => s.speakerLabel === 'Speaker_1',
      );
      expect(speaker1.mappingSource).toBe('conflict');
      expect(speaker1.mappedUserId).toBeNull();
      const segs = saved.speakerSegmentsJson.segments.filter(
        (s: any) => s.speakerLabel === 'Speaker_1',
      );
      expect(segs.every((s: any) => s.userId === null)).toBe(true);
      expect(segs.every((s: any) => s.manualReviewRequired === true)).toBe(
        true,
      );
    });

    it('không có event nào khớp recordingSessionId -> không đổi gì (no-op)', async () => {
      meetingEventRepo.find.mockResolvedValue([
        buildEvent({
          metadataJson: {
            recordingSessionId: 'other-session',
            speakerUserId: 'u',
            displayName: 'X',
            tagSource: 'post',
          },
        }),
      ]);
      await service.applySpeakerMappingsFromEvents(transcriptId);
      expect(transcriptRepo.save).not.toHaveBeenCalled();
    });

    it('transcript không có recordingSessionId -> no-op an toàn', async () => {
      transcriptRepo.findOne.mockResolvedValue(
        buildTranscript({ recordingSessionId: null }),
      );
      await expect(
        service.applySpeakerMappingsFromEvents(transcriptId),
      ).resolves.toBeUndefined();
      expect(meetingEventRepo.find).not.toHaveBeenCalled();
    });

    it('recording session không tồn tại -> no-op an toàn', async () => {
      recordingSessionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.applySpeakerMappingsFromEvents(transcriptId),
      ).resolves.toBeUndefined();
    });
  });

  // ─── createStartMarker (T-LIVE-003, GA-30) ───────────────────────────

  describe('createStartMarker', () => {
    it('ghi meeting_events đúng event_type, event_time server-now, actor', async () => {
      const before = Date.now();
      const result = await service.createStartMarker(meetingId, userId);
      const after = Date.now();

      expect(meetingEventRepo.save).toHaveBeenCalledTimes(1);
      const saved = meetingEventRepo.save.mock.calls[0][0];
      expect(saved.eventType).toBe(MeetingEventType.RECORDING_START_MARKER);
      expect(saved.actorUserId).toBe(userId);
      expect(saved.eventTime.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved.eventTime.getTime()).toBeLessThanOrEqual(after);
      expect(result.eventTime).toBeInstanceOf(Date);
    });

    it('cho phép bấm nhiều lần (CLR-001) — không reject lần 2', async () => {
      await service.createStartMarker(meetingId, userId);
      await service.createStartMarker(meetingId, userId);
      expect(meetingEventRepo.save).toHaveBeenCalledTimes(2);
    });

    it('không phải Host/Admin -> 403', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.createStartMarker(meetingId, 'stranger'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── createLiveSpeakerTag (T-LIVE-004, GA-32) ────────────────────────

  describe('createLiveSpeakerTag', () => {
    it('ghi đúng metadata: recordingSessionId=null, tagSource=live', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-a' });

      await service.createLiveSpeakerTag(
        meetingId,
        { speakerUserId: 'user-a', displayName: 'A' },
        userId,
      );

      const saved = meetingEventRepo.save.mock.calls[0][0];
      expect(saved.eventType).toBe(MeetingEventType.SPEAKER_TAG);
      expect(saved.metadataJson).toEqual({
        recordingSessionId: null,
        speakerUserId: 'user-a',
        externalParticipantId: null,
        displayName: 'A',
        tagSource: 'live',
      });
    });

    it('gán khách ngoài công ty hợp lệ', async () => {
      externalParticipantRepo.findOne.mockResolvedValue({
        id: 'ext-1',
        meetingId,
      });

      await service.createLiveSpeakerTag(
        meetingId,
        { externalParticipantId: 'ext-1', displayName: 'Khach' },
        userId,
      );

      const saved = meetingEventRepo.save.mock.calls[0][0];
      expect(saved.metadataJson.externalParticipantId).toBe('ext-1');
    });

    it('thiếu cả speakerUserId lẫn externalParticipantId -> 400', async () => {
      await expect(
        service.createLiveSpeakerTag(meetingId, { displayName: 'X' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('có cả speakerUserId lẫn externalParticipantId -> 400', async () => {
      await expect(
        service.createLiveSpeakerTag(
          meetingId,
          { speakerUserId: 'u', externalParticipantId: 'e', displayName: 'X' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('speakerUserId không tồn tại -> 400 TARGET_USER_NOT_FOUND', async () => {
      userRepo.findOne.mockResolvedValue(null);
      try {
        await service.createLiveSpeakerTag(
          meetingId,
          { speakerUserId: 'ghost', displayName: 'X' },
          userId,
        );
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.response.error.code).toBe(
          TRANSCRIPTION_ERROR_CODES.TARGET_USER_NOT_FOUND,
        );
      }
    });

    it('externalParticipantId không thuộc meeting -> 400 EXTERNAL_PARTICIPANT_NOT_FOUND', async () => {
      externalParticipantRepo.findOne.mockResolvedValue(null);
      try {
        await service.createLiveSpeakerTag(
          meetingId,
          { externalParticipantId: 'ext-other', displayName: 'X' },
          userId,
        );
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.response.error.code).toBe(
          TRANSCRIPTION_ERROR_CODES.EXTERNAL_PARTICIPANT_NOT_FOUND,
        );
      }
    });

    it('không phải Host/Admin -> 403', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.createLiveSpeakerTag(
          meetingId,
          { speakerUserId: 'u', displayName: 'X' },
          'stranger',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── setManualRecordingStart (T-LIVE-005, GA-35) ─────────────────────

  describe('setManualRecordingStart', () => {
    it('happy path — tạo recording_start_marker với event_time = giá trị nhập', async () => {
      const requested = new Date(
        recordingSessionStartedAt.getTime() - 3_500_000,
      ).toISOString();

      const result = await service.setManualRecordingStart(
        meetingId,
        { startedAt: requested },
        userId,
      );

      const saved = meetingEventRepo.save.mock.calls[0][0];
      expect(saved.eventType).toBe(MeetingEventType.RECORDING_START_MARKER);
      expect(saved.eventTime.toISOString()).toBe(requested);
      expect(result.eventTime.toISOString()).toBe(requested);
    });

    it('ERR-LIVE-002: thời điểm trong tương lai -> 400', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      await expect(
        service.setManualRecordingStart(
          meetingId,
          { startedAt: future },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('ERR-LIVE-003: cách xa giờ họp thật quá ngưỡng -> 400', async () => {
      // meetingRepo mock: startTime = recordingSessionStartedAt - 1h.
      // Nhập lùi 48h so với startTime -> vượt ngưỡng ±24h.
      const tooFar = new Date(
        recordingSessionStartedAt.getTime() - 3600_000 - 48 * 3600_000,
      ).toISOString();
      await expect(
        service.setManualRecordingStart(
          meetingId,
          { startedAt: tooFar },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('meeting không tồn tại -> 404', async () => {
      meetingRepo.findOne.mockResolvedValue(null);
      await expect(
        service.setManualRecordingStart(
          meetingId,
          { startedAt: new Date().toISOString() },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('không phải Host/Admin -> 403', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.setManualRecordingStart(
          meetingId,
          { startedAt: new Date(Date.now() - 60_000).toISOString() },
          'stranger',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── createOffsetSpeakerMarks (T-REC006-003/004, REC-006) ────────────

  describe('createOffsetSpeakerMarks', () => {
    it('happy path — ghi đúng event_time = startedAt + offset, tagSource=post, recordingSessionId=sessionId', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-nam' }]);

      const result = await service.createOffsetSpeakerMarks(
        meetingId,
        recordingSessionId,
        {
          marks: [
            {
              offsetSeconds: 5.5,
              speakerUserId: 'user-nam',
              displayName: 'Nam',
            },
          ],
        },
        userId,
      );

      expect(result.savedCount).toBe(1);
      expect(lastTxManager.save).toHaveBeenCalledTimes(1);
      const saved = lastTxManager.save.mock.calls[0][0];
      expect(saved.eventType).toBe(MeetingEventType.SPEAKER_TAG);
      expect(saved.eventTime.getTime()).toBe(
        recordingSessionStartedAt.getTime() + 5500,
      );
      expect(saved.metadataJson).toEqual({
        recordingSessionId,
        speakerUserId: 'user-nam',
        externalParticipantId: null,
        displayName: 'Nam',
        tagSource: 'post',
      });
    });

    it('ghi nhiều mốc trong 1 yêu cầu — tất cả được ghi (all-or-nothing, happy path)', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-a' }]);
      externalParticipantRepo.findBy.mockResolvedValue([
        { id: 'ext-b', meetingId },
      ]);

      const result = await service.createOffsetSpeakerMarks(
        meetingId,
        recordingSessionId,
        {
          marks: [
            { offsetSeconds: 1, speakerUserId: 'user-a', displayName: 'A' },
            {
              offsetSeconds: 2,
              externalParticipantId: 'ext-b',
              displayName: 'B',
            },
          ],
        },
        userId,
      );

      expect(result.savedCount).toBe(2);
      expect(lastTxManager.save).toHaveBeenCalledTimes(2);
    });

    it('recording session không tồn tại -> 404 RECORDING_SESSION_NOT_FOUND', async () => {
      recordingSessionRepo.findOne.mockResolvedValue(null);
      try {
        await service.createOffsetSpeakerMarks(
          meetingId,
          'ghost-session',
          {
            marks: [{ offsetSeconds: 1, speakerUserId: 'u', displayName: 'X' }],
          },
          userId,
        );
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect(err.response.error.code).toBe(
          TRANSCRIPTION_ERROR_CODES.RECORDING_SESSION_NOT_FOUND,
        );
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('recording session thuộc meeting khác -> 404 RECORDING_SESSION_NOT_FOUND', async () => {
      recordingSessionRepo.findOne.mockResolvedValue({
        id: recordingSessionId,
        meetingId: 'other-meeting',
        startedAt: recordingSessionStartedAt,
      });
      await expect(
        service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [{ offsetSeconds: 1, speakerUserId: 'u', displayName: 'X' }],
          },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('1 mark thiếu cả 2 identity trong yêu cầu nhiều mark -> reject TOÀN BỘ, không ghi gì (all-or-nothing)', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-a' }]);
      await expect(
        service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [
              { offsetSeconds: 1, speakerUserId: 'user-a', displayName: 'A' },
              { offsetSeconds: 2, displayName: 'Thieu identity' },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('1 mark có cả 2 identity -> reject TOÀN BỘ', async () => {
      await expect(
        service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [
              {
                offsetSeconds: 1,
                speakerUserId: 'u',
                externalParticipantId: 'e',
                displayName: 'X',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('offsetSeconds âm -> 400 OFFSET_OUT_OF_RANGE, all-or-nothing', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-a' }]);
      try {
        await service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [
              { offsetSeconds: -1, speakerUserId: 'user-a', displayName: 'A' },
            ],
          },
          userId,
        );
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.response.error.code).toBe(
          TRANSCRIPTION_ERROR_CODES.OFFSET_OUT_OF_RANGE,
        );
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('offsetSeconds vượt duration_seconds khi có giá trị -> 400 OFFSET_OUT_OF_RANGE', async () => {
      recordingSessionRepo.findOne.mockResolvedValue({
        id: recordingSessionId,
        meetingId,
        startedAt: recordingSessionStartedAt,
        durationSeconds: 60,
      });
      userRepo.findBy.mockResolvedValue([{ id: 'user-a' }]);
      await expect(
        service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [
              { offsetSeconds: 61, speakerUserId: 'user-a', displayName: 'A' },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('P-1: duration_seconds = null -> KHÔNG chặn cận trên, chỉ chặn offset âm', async () => {
      recordingSessionRepo.findOne.mockResolvedValue({
        id: recordingSessionId,
        meetingId,
        startedAt: recordingSessionStartedAt,
        durationSeconds: null,
      });
      userRepo.findBy.mockResolvedValue([{ id: 'user-a' }]);

      const result = await service.createOffsetSpeakerMarks(
        meetingId,
        recordingSessionId,
        {
          // offset "lớn bất thường" nhưng duration null -> không có căn cứ để chặn
          marks: [
            {
              offsetSeconds: 999999,
              speakerUserId: 'user-a',
              displayName: 'A',
            },
          ],
        },
        userId,
      );
      expect(result.savedCount).toBe(1);
    });

    it('speakerUserId không tồn tại -> 400 TARGET_USER_NOT_FOUND, all-or-nothing', async () => {
      userRepo.findBy.mockResolvedValue([]);
      try {
        await service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [
              { offsetSeconds: 1, speakerUserId: 'ghost', displayName: 'X' },
            ],
          },
          userId,
        );
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.response.error.code).toBe(
          TRANSCRIPTION_ERROR_CODES.TARGET_USER_NOT_FOUND,
        );
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('externalParticipantId không thuộc meeting -> 400 EXTERNAL_PARTICIPANT_NOT_FOUND', async () => {
      externalParticipantRepo.findBy.mockResolvedValue([]);
      await expect(
        service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [
              {
                offsetSeconds: 1,
                externalParticipantId: 'ext-other',
                displayName: 'X',
              },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('không phải Host/Admin -> 403', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.createOffsetSpeakerMarks(
          meetingId,
          recordingSessionId,
          {
            marks: [{ offsetSeconds: 1, speakerUserId: 'u', displayName: 'X' }],
          },
          'stranger',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('tích hợp: event do createOffsetSpeakerMarks tạo ra được applySpeakerMappingsFromEvents áp đúng (không sửa gì ở đó)', async () => {
      userRepo.findBy.mockResolvedValue([{ id: 'user-nam' }]);

      await service.createOffsetSpeakerMarks(
        meetingId,
        recordingSessionId,
        {
          // 5.5s -> rơi vào segment seg-0001 (2000-9000ms, Speaker_1)
          marks: [
            {
              offsetSeconds: 5.5,
              speakerUserId: 'user-nam',
              displayName: 'Nam',
            },
          ],
        },
        userId,
      );
      const createdEvent = lastTxManager.save.mock.calls[0][0];

      // Mô phỏng bước tiếp theo: applySpeakerMappingsFromEvents đọc lại event vừa ghi.
      meetingEventRepo.find.mockResolvedValue([
        { id: 'evt-from-marks', meetingId, ...createdEvent },
      ]);

      await service.applySpeakerMappingsFromEvents(transcriptId);

      const saved = transcriptRepo.save.mock.calls[0][0];
      const speaker1 = saved.detectedSpeakersJson.speakers.find(
        (s: any) => s.speakerLabel === 'Speaker_1',
      );
      expect(speaker1.mappingSource).toBe('manual');
      expect(speaker1.displayName).toBe('Nam');
    });
  });

  // ─── applySpeakerMappingsFromEvents — mở rộng tagSource='live' (T-LIVE-006) ──

  describe('applySpeakerMappingsFromEvents — live tagging (feat-speaker-tagging-live)', () => {
    function liveEvent(overrides: Partial<Record<string, unknown>>) {
      return {
        id: 'live-evt-1',
        meetingId,
        eventTime: new Date(recordingSessionStartedAt.getTime() + 1_000_000), // sẽ override
        metadataJson: {
          recordingSessionId: null,
          speakerUserId: 'user-live',
          externalParticipantId: null,
          displayName: 'Nguoi Live',
          tagSource: 'live',
        },
        ...overrides,
      };
    }

    function marker(eventTime: Date) {
      return {
        id: 'marker-1',
        meetingId,
        eventType: MeetingEventType.RECORDING_START_MARKER,
        eventTime,
      };
    }

    it('AC-001: có marker -> quy chiếu bằng marker (KHÔNG dùng recording_sessions.started_at)', async () => {
      const markerTime = new Date('2026-08-03T09:00:00.000Z');
      // Offset 5500ms kể từ marker -> rơi vào seg-0001 (2000-9000ms, Speaker_1).
      const tagTime = new Date(markerTime.getTime() + 5500);

      meetingEventRepo.find.mockResolvedValue([
        liveEvent({ eventTime: tagTime }),
      ]);
      meetingEventRepo.findOne.mockResolvedValue(marker(markerTime));

      await service.applySpeakerMappingsFromEvents(transcriptId);

      expect(transcriptRepo.save).toHaveBeenCalledTimes(1);
      const saved = transcriptRepo.save.mock.calls[0][0];
      const speaker1Segs = saved.speakerSegmentsJson.segments.filter(
        (s: any) => s.speakerLabel === 'Speaker_1',
      );
      expect(speaker1Segs.every((s: any) => s.userId === 'user-live')).toBe(
        true,
      );
    });

    it('FR-007/ERR-LIVE-004: KHÔNG có marker -> bỏ qua toàn bộ event live, không lỗi', async () => {
      meetingEventRepo.find.mockResolvedValue([
        liveEvent({ eventTime: new Date() }),
      ]);
      meetingEventRepo.findOne.mockResolvedValue(null); // không có marker nào

      await expect(
        service.applySpeakerMappingsFromEvents(transcriptId),
      ).resolves.toBeUndefined();
      expect(transcriptRepo.save).not.toHaveBeenCalled();
    });

    it('AC-006: event live + event post CÙNG identity, khác speakerLabel -> gộp đúng xuyên nguồn', async () => {
      const markerTime = new Date('2026-08-03T09:00:00.000Z');
      // Live event -> offset 500ms từ marker -> seg-0000 (0-2000ms, Speaker_1).
      const liveTagTime = new Date(markerTime.getTime() + 500);
      // Post event -> offset 9500ms từ recording_sessions.started_at -> seg-0002
      // (9000-12000ms, Speaker_2).
      const postTagTime = new Date(recordingSessionStartedAt.getTime() + 9500);

      meetingEventRepo.find.mockResolvedValue([
        liveEvent({
          eventTime: liveTagTime,
          metadataJson: {
            recordingSessionId: null,
            speakerUserId: 'user-binh',
            externalParticipantId: null,
            displayName: 'Binh',
            tagSource: 'live',
          },
        }),
        {
          id: 'post-evt-1',
          meetingId,
          eventTime: postTagTime,
          metadataJson: {
            recordingSessionId,
            speakerUserId: 'user-binh',
            externalParticipantId: null,
            displayName: 'Binh',
            tagSource: 'post',
          },
        },
      ]);
      meetingEventRepo.findOne.mockResolvedValue(marker(markerTime));

      await service.applySpeakerMappingsFromEvents(transcriptId);

      const saved = transcriptRepo.save.mock.calls[0][0];
      const segs = saved.speakerSegmentsJson.segments;
      expect(
        segs
          .filter((s: any) =>
            ['Speaker_1', 'Speaker_2'].includes(s.speakerLabel),
          )
          .every((s: any) => s.userId === 'user-binh'),
      ).toBe(true);
    });

    it('event post vẫn hoạt động bình thường khi KHÔNG có event live nào (không regression GIAI ĐOẠN 2)', async () => {
      meetingEventRepo.find.mockResolvedValue([
        {
          id: 'post-evt-only',
          meetingId,
          eventTime: new Date(recordingSessionStartedAt.getTime() + 5500),
          metadataJson: {
            recordingSessionId,
            speakerUserId: 'user-nam',
            externalParticipantId: null,
            displayName: 'Nam',
            tagSource: 'post',
          },
        },
      ]);

      await service.applySpeakerMappingsFromEvents(transcriptId);

      // KHÔNG được gọi findOne (marker) vì không có event live nào cần nó.
      expect(meetingEventRepo.findOne).not.toHaveBeenCalled();
      expect(transcriptRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
