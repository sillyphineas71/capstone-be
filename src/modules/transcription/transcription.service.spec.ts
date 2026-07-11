/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { TranscriptionService } from './transcription.service.js';
import {
  TranscriptEntity,
  TranscriptStatus,
} from './entities/transcript.entity.js';
import { BackgroundJobEntity } from '../administration/entities/background-job.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../recording/entities/media-file.entity.js';
import { RecordingSessionEntity } from '../recording/entities/recording-session.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../meetings/entities/meeting-participant.entity.js';
import { QueueService } from '../queue/queue.service.js';
import { BackgroundJobsService } from '../administration/services/background-jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TRANSCRIPTION_ERROR_CODES } from './constants/transcription-error-codes.js';
import { TranscriptStatusTransition } from './dto/update-transcript-status.dto.js';

describe('TranscriptionService (T030)', () => {
  let service: TranscriptionService;
  let transcriptRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let meetingRepo: { findOne: jest.Mock };
  let recordingSessionRepo: { findOne: jest.Mock };
  let mediaFileRepo: { findOne: jest.Mock; find: jest.Mock };
  let participantRepo: { findOne: jest.Mock };
  let queueService: { addJob: jest.Mock };
  let backgroundJobsService: { createQueuedJob: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let configService: { get: jest.Mock };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: { save: jest.Mock };
  };
  let dataSource: { createQueryRunner: jest.Mock; query: jest.Mock };

  const meetingId = 'meeting-1';
  const userId = 'user-1';
  const recordingSessionId = 'rs-1';

  beforeEach(async () => {
    transcriptRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      update: jest.fn().mockResolvedValue(undefined),
    };
    meetingRepo = { findOne: jest.fn().mockResolvedValue({ id: meetingId }) };
    recordingSessionRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: recordingSessionId, meetingId }),
    };
    mediaFileRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'media-1',
          storageBucket: 'recordings',
          storageKey: 'meetings/m-1/audio.wav',
          channelUserId: null,
        },
      ]),
      findOne: jest.fn().mockResolvedValue({
        id: 'media-1',
        storageBucket: 'recordings',
        storageKey: 'meetings/m-1/audio.wav',
        channelUserId: null,
      }),
    };
    participantRepo = {
      findOne: jest.fn().mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      }),
    };
    queueService = { addJob: jest.fn().mockResolvedValue(undefined) };
    backgroundJobsService = {
      createQueuedJob: jest.fn().mockResolvedValue({ id: 'bg-1' }),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };
    configService = { get: jest.fn((_key: string, def: unknown) => def) };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        save: jest.fn((entity) =>
          Promise.resolve({ ...entity, id: 'transcript-1' }),
        ),
      },
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      query: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptionService,
        {
          provide: getRepositoryToken(TranscriptEntity),
          useValue: transcriptRepo,
        },
        { provide: getRepositoryToken(MeetingEntity), useValue: meetingRepo },
        {
          provide: getRepositoryToken(RecordingSessionEntity),
          useValue: recordingSessionRepo,
        },
        {
          provide: getRepositoryToken(MediaFileEntity),
          useValue: mediaFileRepo,
        },
        {
          provide: getRepositoryToken(MeetingParticipantEntity),
          useValue: participantRepo,
        },
        { provide: getRepositoryToken(BackgroundJobEntity), useValue: {} },
        { provide: QueueService, useValue: queueService },
        { provide: BackgroundJobsService, useValue: backgroundJobsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConfigService, useValue: configService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(TranscriptionService);
  });

  describe('createTranscriptionJob', () => {
    const dto = { recordingSessionId, language: 'vi-VN' } as never;

    it('AC: meeting không tồn tại → 404 MEETING_NOT_FOUND', async () => {
      meetingRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createTranscriptionJob(meetingId, dto, userId),
      ).rejects.toThrow(NotFoundException);
      try {
        await service.createTranscriptionJob(meetingId, dto, userId);
      } catch (err) {
        expect(
          (err as { response: { error: { code: string } } }).response.error
            .code,
        ).toBe(TRANSCRIPTION_ERROR_CODES.MEETING_NOT_FOUND);
      }
    });

    it('AC: recording session không thuộc meeting → 404 RECORDING_SESSION_NOT_FOUND', async () => {
      recordingSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createTranscriptionJob(meetingId, dto, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('AC: không có source media file hợp lệ → 404 SOURCE_MEDIA_NOT_FOUND', async () => {
      mediaFileRepo.find.mockResolvedValue([]);

      await expect(
        service.createTranscriptionJob(meetingId, dto, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('AC: đã có job đang processing + forceRerun=false → 409 TRANSCRIPTION_JOB_ALREADY_RUNNING', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: 'existing-tr',
        versionNo: 1,
        status: TranscriptStatus.PROCESSING,
      });

      await expect(
        service.createTranscriptionJob(meetingId, dto, userId),
      ).rejects.toThrow(ConflictException);
    });

    it('AC: user không phải Host và không phải Admin → 403 PERMISSION_DENIED', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.createTranscriptionJob(meetingId, dto, 'stranger-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('REGRESSION: SYSTEM_ADMIN không phải Host của meeting vẫn tạo job được (bug cũ check permission admin.all/admin.manage không tồn tại trong DB, đã fix bằng role_code)', async () => {
      participantRepo.findOne.mockResolvedValue(null); // không phải Host
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM user_roles'))
          return Promise.resolve([{ role_code: 'SYSTEM_ADMIN' }]);
        if (sql.includes('FROM permissions')) return Promise.resolve([]); // 'admin.all'/'admin.manage' không có trong DB — vẫn phải pass
        return Promise.resolve([]);
      });
      transcriptRepo.findOne.mockResolvedValue(null);

      const result = await service.createTranscriptionJob(
        meetingId,
        dto,
        'system-admin-user',
      );

      expect(result.status).toBe('queued');
    });

    it('AC: TRANSCRIPTION_ENABLED=false → 403 TRANSCRIPTION_DISABLED', async () => {
      configService.get.mockImplementation((key: string, def: unknown) =>
        key === 'TRANSCRIPTION_ENABLED' ? false : def,
      );

      await expect(
        service.createTranscriptionJob(meetingId, dto, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('happy path: tạo job thành công → enqueue BullMQ với storageBucket/storageKey, trả status=queued', async () => {
      transcriptRepo.findOne.mockResolvedValue(null);

      const result = await service.createTranscriptionJob(
        meetingId,
        dto,
        userId,
      );

      expect(result).toEqual({
        jobId: 'bg-1',
        meetingId,
        status: 'queued',
        transcriptStatus: TranscriptStatus.PROCESSING,
      });
      expect(queueService.addJob).toHaveBeenCalledWith(
        expect.any(String),
        'transcription:bg-1',
        expect.objectContaining({
          storageBucket: 'recordings',
          storageKey: 'meetings/m-1/audio.wav',
        }),
        { attempts: 3 },
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('forceRerun=true với job đang processing → vẫn tạo job mới, tăng versionNo', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: 'existing-tr',
        versionNo: 1,
        status: TranscriptStatus.PROCESSING,
      });

      const result = await service.createTranscriptionJob(
        meetingId,
        Object.assign({}, dto, { forceRerun: true }),
        userId,
      );

      expect(result.status).toBe('queued');
    });

    it('Phase 2: multi-channel (nhiều file audio) → tự động dùng channel_zone mode, truyền channels array', async () => {
      mediaFileRepo.find.mockResolvedValue([
        {
          id: 'media-1',
          storageBucket: 'recordings',
          storageKey: 'user-a/audio.wav',
          channelUserId: 'user-a',
        },
        {
          id: 'media-2',
          storageBucket: 'recordings',
          storageKey: 'user-b/audio.wav',
          channelUserId: 'user-b',
        },
      ]);
      transcriptRepo.findOne.mockResolvedValue(null);

      const result = await service.createTranscriptionJob(
        meetingId,
        dto,
        userId,
      );

      expect(result.status).toBe('queued');
      expect(queueService.addJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          speakerMappingMode: 'channel_zone',
          channels: [
            {
              storageKey: 'user-a/audio.wav',
              storageBucket: 'recordings',
              channelUserId: 'user-a',
            },
            {
              storageKey: 'user-b/audio.wav',
              storageBucket: 'recordings',
              channelUserId: 'user-b',
            },
          ],
        }),
        { attempts: 3 },
      );
    });

    it('Phase 2: single file → diarization_only mode, KHÔNG có channels array', async () => {
      mediaFileRepo.find.mockResolvedValue([
        {
          id: 'media-1',
          storageBucket: 'recordings',
          storageKey: 'meetings/m-1/audio.wav',
          channelUserId: null,
        },
      ]);
      transcriptRepo.findOne.mockResolvedValue(null);

      const result = await service.createTranscriptionJob(
        meetingId,
        dto,
        userId,
      );

      expect(result.status).toBe('queued');
      const callArgs = queueService.addJob.mock.calls[0][2];
      expect(callArgs.speakerMappingMode).toBe('diarization_only');
      expect(callArgs.channels).toBeUndefined();
    });

    it('Phase 2: client override speakerMappingMode → dùng mode do client chỉ định', async () => {
      mediaFileRepo.find.mockResolvedValue([
        {
          id: 'media-1',
          storageBucket: 'recordings',
          storageKey: 'user-a/audio.wav',
          channelUserId: 'user-a',
        },
        {
          id: 'media-2',
          storageBucket: 'recordings',
          storageKey: 'user-b/audio.wav',
          channelUserId: 'user-b',
        },
      ]);
      transcriptRepo.findOne.mockResolvedValue(null);

      const overrideDto = Object.assign({}, dto, {
        speakerMappingMode: 'diarization_only',
      });
      const result = await service.createTranscriptionJob(
        meetingId,
        overrideDto,
        userId,
      );

      expect(result.status).toBe('queued');
      const callArgs = queueService.addJob.mock.calls[0][2];
      // Client explicitly set diarization_only even with multi files → respect that.
      expect(callArgs.speakerMappingMode).toBe('diarization_only');
    });
  });

  describe('getTranscript', () => {
    const query = {} as never;

    it('participant hợp lệ xem được transcript', async () => {
      participantRepo.findOne.mockResolvedValue({ meetingId, userId });
      transcriptRepo.findOne.mockResolvedValue({
        id: 'tr-1',
        meetingId,
        status: TranscriptStatus.DRAFT,
        versionNo: 1,
        languageCode: 'vi-VN',
        cleanedText: 'Xin chao',
        confidenceScore: 0.9,
        createdAt: new Date(),
        speakerSegmentsJson: null,
      });

      const result = await service.getTranscript(meetingId, userId, query);
      expect(result.status).toBe(TranscriptStatus.DRAFT);
    });

    it('REGRESSION: SYSTEM_ADMIN không phải participant vẫn xem được (cùng bug admin.all/admin.manage đã fix)', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM user_roles'))
          return Promise.resolve([{ role_code: 'BUSINESS_ADMIN' }]);
        return Promise.resolve([]);
      });
      transcriptRepo.findOne.mockResolvedValue({
        id: 'tr-1',
        meetingId,
        status: TranscriptStatus.DRAFT,
        versionNo: 1,
        languageCode: 'vi-VN',
        cleanedText: 'Xin chao',
        confidenceScore: 0.9,
        createdAt: new Date(),
        speakerSegmentsJson: null,
      });

      const result = await service.getTranscript(
        meetingId,
        'business-admin-user',
        query,
      );
      expect(result.status).toBe(TranscriptStatus.DRAFT);
    });

    it('không phải participant, không phải Admin → 403 PERMISSION_DENIED', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.getTranscript(meetingId, 'stranger-user', query),
      ).rejects.toThrow(ForbiddenException);
    });

    it('chưa có transcript nào → 404 TRANSCRIPT_NOT_FOUND', async () => {
      participantRepo.findOne.mockResolvedValue({ meetingId, userId });
      transcriptRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getTranscript(meetingId, userId, query),
      ).rejects.toThrow(NotFoundException);
    });

    it('REGRESSION: order theo createdAt DESC trước versionNo (2 recordingSession khác nhau có thể trùng versionNo=1)', async () => {
      participantRepo.findOne.mockResolvedValue({ meetingId, userId });
      transcriptRepo.findOne.mockResolvedValue({
        id: 'tr-newest',
        meetingId,
        status: TranscriptStatus.PROCESSING,
        versionNo: 1,
        languageCode: 'vi-VN',
        cleanedText: null,
        confidenceScore: null,
        createdAt: new Date(),
        speakerSegmentsJson: null,
      });

      await service.getTranscript(meetingId, userId, query);

      expect(transcriptRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC', versionNo: 'DESC' },
        }),
      );
    });
  });

  describe('updateTranscriptResult (REGRESSION: lỗi "syntax error near {")', () => {
    it('ghi jsonb bằng object thường, KHÔNG dùng raw-SQL callback (gây syntax error near {)', async () => {
      const result = {
        languageCode: 'vi-VN',
        rawText: 'xin chao',
        cleanedText: 'Xin chào',
        confidenceScore: 0.9,
        segments: [],
        detectedSpeakers: [],
        modelVersions: { whisper: 'small', pyannote: null, sepformer: null },
        warnings: [],
      } as never;

      await service.updateTranscriptResult('tr-1', result);

      expect(transcriptRepo.update).toHaveBeenCalledTimes(1);
      const [id, payload] = transcriptRepo.update.mock.calls[0];
      expect(id).toBe('tr-1');
      // Phải là plain object — nếu là function thì TypeORM coi là raw SQL fragment
      // (chính là nguyên nhân lỗi "syntax error at or near \"{\"" thực tế gặp).
      expect(typeof payload.speakerSegmentsJson).toBe('object');
      expect(typeof payload.detectedSpeakersJson).toBe('object');
      expect(payload.status).toBe(TranscriptStatus.DRAFT);
      expect(payload.speakerSegmentsJson.segments).toEqual([]);
    });

    it('T028: đánh dấu transcript-level manualReviewRequired khi có segment low-confidence', async () => {
      const result = {
        languageCode: 'vi-VN',
        rawText: 'x',
        cleanedText: 'x',
        confidenceScore: 0.5,
        segments: [
          {
            segmentId: 'seg-0',
            manualReviewRequired: false,
            lowConfidence: false,
            startMs: 0,
            endMs: 1000,
          },
          {
            segmentId: 'seg-1',
            manualReviewRequired: true,
            lowConfidence: true,
            startMs: 1000,
            endMs: 2000,
          },
        ],
        detectedSpeakers: [],
        modelVersions: { whisper: 'small', pyannote: null, sepformer: null },
        warnings: [],
      } as never;

      await service.updateTranscriptResult('tr-1', result);

      const [, payload] = transcriptRepo.update.mock.calls[0];
      expect(payload.speakerSegmentsJson.manualReviewRequired).toBe(true);
      expect(payload.speakerSegmentsJson.manualReviewSegmentCount).toBe(1);
      expect(payload.speakerSegmentsJson.editRevisionNo).toBe(0);
    });
  });

  describe('notifyTranscriptReady (T029) — fail-safe', () => {
    it('tạo in-app notification cho Host', async () => {
      transcriptRepo.findOne.mockResolvedValue({ id: 'tr-1', meetingId });
      participantRepo.findOne.mockResolvedValue({ userId: 'host-1' });

      await service.notifyTranscriptReady('tr-1');

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: 'transcript_ready',
          channel: 'in_app',
          recipientUserIds: ['host-1'],
          relatedEntityId: meetingId,
        }),
      );
    });

    it('notification THROW → KHÔNG throw ra ngoài (fail-safe)', async () => {
      transcriptRepo.findOne.mockResolvedValue({ id: 'tr-1', meetingId });
      participantRepo.findOne.mockResolvedValue({ userId: 'host-1' });
      notificationsService.createNotification.mockRejectedValue(
        new Error('notification down'),
      );

      await expect(
        service.notifyTranscriptReady('tr-1'),
      ).resolves.toBeUndefined();
    });

    it('không có Host → bỏ qua, không tạo notification, không throw', async () => {
      transcriptRepo.findOne.mockResolvedValue({ id: 'tr-1', meetingId });
      participantRepo.findOne.mockResolvedValue(null);

      await service.notifyTranscriptReady('tr-1');

      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('updateTranscriptSegments (T-EDIT-001 / UC-127)', () => {
    const transcriptId = 'tr-1';
    const baseTranscript = {
      id: transcriptId,
      meetingId,
      speakerSegmentsJson: {
        segments: [
          {
            segmentId: 'seg-0',
            text: 'cũ',
            speakerLabel: 'Speaker_1',
            userId: null,
          },
          {
            segmentId: 'seg-1',
            text: 'cũ 2',
            speakerLabel: 'unknown',
            userId: null,
          },
        ],
        editRevisionNo: 0,
      },
    };

    it('Host sửa được text + speaker → tăng revision, set editedBy, KHÔNG đổi status', async () => {
      transcriptRepo.findOne.mockResolvedValue({ ...baseTranscript });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      const res = await service.updateTranscriptSegments(
        transcriptId,
        {
          segments: [
            { segmentId: 'seg-0', text: 'mới', speakerUserId: 'user-x' },
          ],
          revisionNote: 'sửa lần 1',
        },
        userId,
      );

      expect(res.revisionNo).toBe(1);
      expect(res.updatedSegments).toEqual(['seg-0']);
      expect(res.editedBy).toBe(userId);

      const [, payload] = transcriptRepo.update.mock.calls[0];
      expect(payload.editedBy).toBe(userId);
      expect(payload.status).toBeUndefined(); // KHÔNG đổi status
      const seg0 = payload.speakerSegmentsJson.segments.find(
        (s: any) => s.segmentId === 'seg-0',
      );
      expect(seg0.text).toBe('mới');
      expect(seg0.userId).toBe('user-x');
      expect(seg0.speakerSource).toBe('manual');
      expect(payload.speakerSegmentsJson.editRevisionNo).toBe(1);
    });

    it('transcript không tồn tại → 404 TRANSCRIPT_NOT_FOUND', async () => {
      transcriptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateTranscriptSegments(
          transcriptId,
          { segments: [{ segmentId: 'seg-0', text: 'x' }] },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('không phải Host và không phải Admin → 403 PERMISSION_DENIED', async () => {
      transcriptRepo.findOne.mockResolvedValue({ ...baseTranscript });
      participantRepo.findOne.mockResolvedValue(null); // không phải host
      dataSource.query.mockResolvedValue([]); // không có role admin

      await expect(
        service.updateTranscriptSegments(
          transcriptId,
          { segments: [{ segmentId: 'seg-0', text: 'x' }] },
          'stranger',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('segmentId không tồn tại → 404 SEGMENT_NOT_FOUND, không sửa gì', async () => {
      transcriptRepo.findOne.mockResolvedValue({ ...baseTranscript });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      await expect(
        service.updateTranscriptSegments(
          transcriptId,
          { segments: [{ segmentId: 'seg-KHONG-CO', text: 'x' }] },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(transcriptRepo.update).not.toHaveBeenCalled();
    });

    it('Admin (không phải Host) vẫn sửa được', async () => {
      transcriptRepo.findOne.mockResolvedValue({ ...baseTranscript });
      participantRepo.findOne.mockResolvedValue(null); // không host
      dataSource.query.mockResolvedValue([{ role_code: 'BUSINESS_ADMIN' }]);

      const res = await service.updateTranscriptSegments(
        transcriptId,
        {
          segments: [{ segmentId: 'seg-1', speakerLabel: 'Nguyễn A' }],
        },
        'admin-1',
      );
      expect(res.revisionNo).toBe(1);
    });
  });

  describe('updateTranscriptContent (rawText/cleanedText override)', () => {
    const transcriptId = 'tr-1';
    const baseTranscript = {
      id: transcriptId,
      meetingId,
      rawText: 'text cu',
      cleanedText: 'text cu sach',
    };

    it('Host ghi đè được cleanedText → set editedBy, KHÔNG đổi status', async () => {
      transcriptRepo.findOne.mockResolvedValue({ ...baseTranscript });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      const res = await service.updateTranscriptContent(
        transcriptId,
        { cleanedText: 'noi dung dai tu soan de test AI summarize' },
        userId,
      );

      expect(res.transcriptId).toBe(transcriptId);
      expect(res.editedBy).toBe(userId);

      const [, payload] = transcriptRepo.update.mock.calls[0];
      expect(payload.editedBy).toBe(userId);
      expect(payload.status).toBeUndefined();
      expect(payload.cleanedText).toBe(
        'noi dung dai tu soan de test AI summarize',
      );
      expect(payload.rawText).toBeUndefined();
    });

    it('không truyền rawText lẫn cleanedText → 400 BadRequest', async () => {
      await expect(
        service.updateTranscriptContent(transcriptId, {}, userId),
      ).rejects.toThrow(BadRequestException);
      expect(transcriptRepo.findOne).not.toHaveBeenCalled();
    });

    it('transcript không tồn tại → 404 TRANSCRIPT_NOT_FOUND', async () => {
      transcriptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateTranscriptContent(transcriptId, { rawText: 'x' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('không phải Host và không phải Admin → 403 PERMISSION_DENIED', async () => {
      transcriptRepo.findOne.mockResolvedValue({ ...baseTranscript });
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.updateTranscriptContent(
          transcriptId,
          { rawText: 'x' },
          'stranger',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Admin (không phải Host) vẫn sửa được', async () => {
      transcriptRepo.findOne.mockResolvedValue({ ...baseTranscript });
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([{ role_code: 'BUSINESS_ADMIN' }]);

      const res = await service.updateTranscriptContent(
        transcriptId,
        { rawText: 'raw moi', cleanedText: 'cleaned moi' },
        'admin-1',
      );
      expect(res.editedBy).toBe('admin-1');

      const [, payload] = transcriptRepo.update.mock.calls[0];
      expect(payload.rawText).toBe('raw moi');
      expect(payload.cleanedText).toBe('cleaned moi');
    });
  });

  describe('updateTranscriptStatus (Gap fix Nhóm A — draft/reviewed/approved)', () => {
    const transcriptId = 'tr-1';

    it('Host chuyển draft → reviewed thành công', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: transcriptId,
        meetingId,
        status: TranscriptStatus.DRAFT,
      });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      const res = await service.updateTranscriptStatus(
        transcriptId,
        { status: TranscriptStatusTransition.REVIEWED },
        userId,
      );

      expect(res.status).toBe(TranscriptStatus.REVIEWED);
      const [, payload] = transcriptRepo.update.mock.calls[0];
      expect(payload.status).toBe(TranscriptStatus.REVIEWED);
      expect(payload.approvedBy).toBeUndefined();
    });

    it('Host chuyển draft → approved thành công, set approvedBy/approvedAt', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: transcriptId,
        meetingId,
        status: TranscriptStatus.DRAFT,
      });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      const res = await service.updateTranscriptStatus(
        transcriptId,
        { status: TranscriptStatusTransition.APPROVED },
        userId,
      );

      expect(res.status).toBe(TranscriptStatus.APPROVED);
      const [, payload] = transcriptRepo.update.mock.calls[0];
      expect(payload.status).toBe(TranscriptStatus.APPROVED);
      expect(payload.approvedBy).toBe(userId);
      expect(payload.approvedAt).toBeInstanceOf(Date);
    });

    it('Host chuyển reviewed → approved thành công', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: transcriptId,
        meetingId,
        status: TranscriptStatus.REVIEWED,
      });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      const res = await service.updateTranscriptStatus(
        transcriptId,
        { status: TranscriptStatusTransition.APPROVED },
        userId,
      );
      expect(res.status).toBe(TranscriptStatus.APPROVED);
    });

    it('transcript không tồn tại → 404 TRANSCRIPT_NOT_FOUND', async () => {
      transcriptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateTranscriptStatus(
          transcriptId,
          { status: TranscriptStatusTransition.REVIEWED },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('không phải Host và không phải Admin → 403 PERMISSION_DENIED', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: transcriptId,
        meetingId,
        status: TranscriptStatus.DRAFT,
      });
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.updateTranscriptStatus(
          transcriptId,
          { status: TranscriptStatusTransition.REVIEWED },
          'stranger',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Admin (không phải Host) vẫn chuyển được', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: transcriptId,
        meetingId,
        status: TranscriptStatus.DRAFT,
      });
      participantRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([{ role_code: 'BUSINESS_ADMIN' }]);

      const res = await service.updateTranscriptStatus(
        transcriptId,
        { status: TranscriptStatusTransition.APPROVED },
        'admin-1',
      );
      expect(res.status).toBe(TranscriptStatus.APPROVED);
    });

    it('approved → reviewed (lùi trạng thái) → 409 INVALID_TRANSCRIPT_STATUS_TRANSITION', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: transcriptId,
        meetingId,
        status: TranscriptStatus.APPROVED,
      });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      await expect(
        service.updateTranscriptStatus(
          transcriptId,
          { status: TranscriptStatusTransition.REVIEWED },
          userId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('processing → reviewed (trạng thái hệ thống quản lý) → 409', async () => {
      transcriptRepo.findOne.mockResolvedValue({
        id: transcriptId,
        meetingId,
        status: TranscriptStatus.PROCESSING,
      });
      participantRepo.findOne.mockResolvedValue({
        meetingId,
        userId,
        participantRole: ParticipantRole.HOST,
      });

      await expect(
        service.updateTranscriptStatus(
          transcriptId,
          { status: TranscriptStatusTransition.REVIEWED },
          userId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
