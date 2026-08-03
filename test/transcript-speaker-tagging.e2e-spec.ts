import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { TranscriptionService } from '../src/modules/transcription/transcription.service.js';
import { SpeakerMappingService } from '../src/modules/transcription/speaker-mapping.service.js';
import { TranscriptionResult } from '../src/modules/transcription/types/transcript-segment.type.js';
import { StorageService } from '../src/modules/storage/storage.service.js';

/**
 * T-TAG-010 (feat-speaker-tagging-post-meeting) — AC-005: "gán rồi chạy lại
 * không mất công" — mục tiêu CỐT LÕI của cả GIAI ĐOẠN 2. Đây LÀ bằng chứng
 * thực nghiệm cho thiết kế `meeting_events` làm nguồn sự thật (plan tổng mục
 * 4.1): mapping phải sống sót qua việc transcript được ghi lại (version mới).
 *
 * Chạy THẬT qua Postgres live (không mock DB) — theo đúng pattern
 * transcription-job-lifecycle.e2e-spec.ts (T032). KHÔNG cần chạy migration
 * mới trước (T-TAG-001/002) — test này dùng thẳng service, không qua HTTP/
 * permission guard, và `meeting_events.event_type` là varchar(60) nên giá trị
 * 'speaker_tag' ghi được ngay cả khi migration tài liệu hoá chưa chạy.
 *
 * GATE: chỉ chạy khi `RUN_INTEGRATION=1`.
 *   RUN_INTEGRATION=1 npx jest --config ./test/jest-e2e.json transcript-speaker-tagging
 */
const RUN = process.env.RUN_INTEGRATION === '1';
const suite = RUN ? describe : describe.skip;

suite('Speaker tagging — sống sót qua rerun (integration, DB thật)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let transcriptionService: TranscriptionService;
  let speakerMappingService: SpeakerMappingService;

  const ids = {
    user: randomUUID(),
    speakerUser: randomUUID(),
    meeting: randomUUID(),
    session: randomUUID(),
    participant: randomUUID(),
    transcriptV1: randomUUID(),
    transcriptV2: randomUUID(),
  };
  const tag = Date.now();
  const recordingSessionStartedAt = new Date();

  function segmentsResultV1(): TranscriptionResult {
    return {
      languageCode: 'vi-VN',
      rawText: 'a noi truoc b noi sau',
      cleanedText: 'a noi truoc b noi sau',
      confidenceScore: 0.9,
      segments: [
        {
          segmentId: 'seg-0000',
          startMs: 0,
          endMs: 4000,
          text: 'a noi truoc',
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
        },
        {
          segmentId: 'seg-0001',
          startMs: 4000,
          endMs: 8000,
          text: 'b noi sau',
          speakerLabel: 'Speaker_2',
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
        },
      ],
      detectedSpeakers: [
        {
          speakerLabel: 'Speaker_1',
          totalSpeakingMs: 4000,
          segmentCount: 1,
          mappedUserId: null,
          mappingSource: 'unmapped',
          confidence: 0.9,
        },
        {
          speakerLabel: 'Speaker_2',
          totalSpeakingMs: 4000,
          segmentCount: 1,
          mappedUserId: null,
          mappingSource: 'unmapped',
          confidence: 0.9,
        },
      ],
      modelVersions: {
        whisper: 'medium',
        pyannote: 'pyannote-local',
        sepformer: null,
      },
      warnings: [],
    };
  }

  // Lần chạy lại (v2) — ranh giới segment ĐỔI CHÚT (mốc cũ 2000ms của Speaker_1
  // vẫn phải rơi đúng vào segment mới 0-3500ms), mô phỏng đúng thực tế: đổi
  // model/tham số làm ranh giới lệch nhưng KHÔNG lệch quá xa.
  function segmentsResultV2(): TranscriptionResult {
    return {
      languageCode: 'vi-VN',
      rawText: 'a noi truoc (v2) b noi sau (v2)',
      cleanedText: 'a noi truoc (v2) b noi sau (v2)',
      confidenceScore: 0.92,
      segments: [
        {
          segmentId: 'seg-0000',
          startMs: 0,
          endMs: 3500,
          text: 'a noi truoc (v2)',
          speakerLabel: 'Speaker_1',
          speakerSource: 'pyannote',
          userId: null,
          channelId: null,
          roomZoneLabel: null,
          sttConfidence: 0.92,
          diarizationConfidence: 0.9,
          separationConfidence: null,
          finalConfidence: 0.92,
          overlap: false,
          lowConfidence: false,
          manualReviewRequired: false,
          notes: [],
        },
        {
          segmentId: 'seg-0001',
          startMs: 3500,
          endMs: 8200,
          text: 'b noi sau (v2)',
          speakerLabel: 'Speaker_2',
          speakerSource: 'pyannote',
          userId: null,
          channelId: null,
          roomZoneLabel: null,
          sttConfidence: 0.92,
          diarizationConfidence: 0.9,
          separationConfidence: null,
          finalConfidence: 0.92,
          overlap: false,
          lowConfidence: false,
          manualReviewRequired: false,
          notes: [],
        },
      ],
      detectedSpeakers: [
        {
          speakerLabel: 'Speaker_1',
          totalSpeakingMs: 3500,
          segmentCount: 1,
          mappedUserId: null,
          mappingSource: 'unmapped',
          confidence: 0.9,
        },
        {
          speakerLabel: 'Speaker_2',
          totalSpeakingMs: 4700,
          segmentCount: 1,
          mappedUserId: null,
          mappingSource: 'unmapped',
          confidence: 0.9,
        },
      ],
      modelVersions: {
        whisper: 'medium',
        pyannote: 'pyannote-local',
        sepformer: null,
      },
      warnings: [],
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({ onModuleInit: async () => undefined })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ds = app.get(DataSource);
    transcriptionService = app.get(TranscriptionService);
    speakerMappingService = app.get(SpeakerMappingService);

    await ds.query(
      `INSERT INTO users (id, username, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
      [
        ids.user,
        `it_tag_host_${tag}`,
        `it_tag_host_${tag}@test.local`,
        'x',
        'Integration Host',
        ids.speakerUser,
        `it_tag_speaker_${tag}`,
        `it_tag_speaker_${tag}@test.local`,
        'x',
        'Nguoi Noi A',
      ],
    );
    await ds.query(
      `INSERT INTO meetings (id, meeting_code, title, organizer_id, start_time, end_time)
       VALUES ($1, $2, $3, $4, now(), now() + interval '1 hour')`,
      [
        ids.meeting,
        `IT_TAG_MTG_${tag}`,
        'Integration Speaker Tagging Meeting',
        ids.user,
      ],
    );
    await ds.query(
      `INSERT INTO recording_sessions (id, meeting_id, session_type, source_type, started_at)
       VALUES ($1, $2, 'audio', 'upload', $3)`,
      [ids.session, ids.meeting, recordingSessionStartedAt],
    );
    await ds.query(
      `INSERT INTO meeting_participants (id, meeting_id, user_id, participant_role)
       VALUES ($1, $2, $3, 'host')`,
      [ids.participant, ids.meeting, ids.user],
    );

    // Transcript v1 — mô phỏng kết quả pipeline lần 1 (giống updateTranscriptResult
    // do TranscriptionWorkerProcessor gọi thật, nhưng ở đây gọi trực tiếp để
    // không phụ thuộc BullMQ/Redis — chỉ cần verify tầng DB/service).
    await ds.query(
      `INSERT INTO transcripts (id, meeting_id, recording_session_id, version_no, status)
       VALUES ($1, $2, $3, 1, 'processing')`,
      [ids.transcriptV1, ids.meeting, ids.session],
    );
    await transcriptionService.updateTranscriptResult(
      ids.transcriptV1,
      segmentsResultV1(),
    );
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(
        `DELETE FROM meeting_events WHERE meeting_id = $1 AND event_type = 'speaker_tag'`,
        [ids.meeting],
      );
      await ds.query(`DELETE FROM transcripts WHERE meeting_id = $1`, [
        ids.meeting,
      ]);
      await ds.query(
        `DELETE FROM notifications WHERE related_entity_type = 'meeting' AND related_entity_id = $1`,
        [ids.meeting],
      );
      await ds.query(`DELETE FROM meeting_participants WHERE id = $1`, [
        ids.participant,
      ]);
      await ds.query(`DELETE FROM recording_sessions WHERE id = $1`, [
        ids.session,
      ]);
      await ds.query(`DELETE FROM meetings WHERE id = $1`, [ids.meeting]);
      await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [ids.user, ids.speakerUser],
      ]);
    }
    await app?.close();
  });

  it('AC-005: gán tên ở v1 → chạy lại (v2) → tên tự động áp lại KHÔNG cần gán lại', async () => {
    // Bước 1 — Host gán tên cho Speaker_1 ở transcript v1.
    const mapResult = await speakerMappingService.createSpeakerMappings(
      ids.transcriptV1,
      {
        mappings: [
          {
            speakerLabel: 'Speaker_1',
            speakerUserId: ids.speakerUser,
            displayName: 'Nguoi Noi A',
          },
        ],
      },
      ids.user,
    );
    expect(mapResult.appliedMappings).toHaveLength(1);

    // meeting_events phải có đúng 1 bản ghi speaker_tag cho recording session này.
    const events = await ds.query(
      `SELECT event_type, metadata_json FROM meeting_events WHERE meeting_id = $1 AND event_type = 'speaker_tag'`,
      [ids.meeting],
    );
    expect(events).toHaveLength(1);
    const meta =
      typeof events[0].metadata_json === 'string'
        ? JSON.parse(events[0].metadata_json)
        : events[0].metadata_json;
    expect(meta.recordingSessionId).toBe(ids.session);
    expect(meta.speakerUserId).toBe(ids.speakerUser);
    expect(meta.tagSource).toBe('post');

    // v1 phải thấy tên NGAY (GA-22, áp ngay lập tức).
    const v1Row = await ds.query(
      `SELECT speaker_segments_json FROM transcripts WHERE id = $1`,
      [ids.transcriptV1],
    );
    const v1Segments = (
      typeof v1Row[0].speaker_segments_json === 'string'
        ? JSON.parse(v1Row[0].speaker_segments_json)
        : v1Row[0].speaker_segments_json
    ).segments;
    expect(
      v1Segments.find(
        (s: { speakerLabel: string }) => s.speakerLabel === 'Speaker_1',
      ).userId,
    ).toBe(ids.speakerUser);

    // Bước 2 — mô phỏng CHẠY LẠI transcription cho CÙNG recording session:
    // tạo transcript v2 mới (version_no tăng), ranh giới segment đổi chút.
    await ds.query(
      `INSERT INTO transcripts (id, meeting_id, recording_session_id, version_no, status)
       VALUES ($1, $2, $3, 2, 'processing')`,
      [ids.transcriptV2, ids.meeting, ids.session],
    );
    // updateTranscriptResult tự gọi applySpeakerMappingsFromEvents (GA-27) —
    // KHÔNG gọi lại createSpeakerMappings, đây chính là điều cần chứng minh.
    await transcriptionService.updateTranscriptResult(
      ids.transcriptV2,
      segmentsResultV2(),
    );

    const v2Row = await ds.query(
      `SELECT speaker_segments_json, detected_speakers_json FROM transcripts WHERE id = $1`,
      [ids.transcriptV2],
    );
    const v2Segments = (
      typeof v2Row[0].speaker_segments_json === 'string'
        ? JSON.parse(v2Row[0].speaker_segments_json)
        : v2Row[0].speaker_segments_json
    ).segments;
    const v2Speakers = (
      typeof v2Row[0].detected_speakers_json === 'string'
        ? JSON.parse(v2Row[0].detected_speakers_json)
        : v2Row[0].detected_speakers_json
    ).speakers;

    // Mốc đại diện gốc = midpoint(seg-0000 v1, 0-4000) = 2000ms -> rơi đúng
    // vào seg-0000 v2 (0-3500ms, Speaker_1) dù ranh giới đã đổi (4000->3500).
    const speaker1SegV2 = v2Segments.find(
      (s: { speakerLabel: string }) => s.speakerLabel === 'Speaker_1',
    );
    expect(speaker1SegV2.userId).toBe(ids.speakerUser);

    const speaker1DetectedV2 = v2Speakers.find(
      (s: { speakerLabel: string }) => s.speakerLabel === 'Speaker_1',
    );
    expect(speaker1DetectedV2.mappingSource).toBe('manual');
    expect(speaker1DetectedV2.mappedUserId).toBe(ids.speakerUser);
    expect(speaker1DetectedV2.displayName).toBe('Nguoi Noi A');

    // Speaker_2 (chưa từng gán) phải giữ nguyên unmapped — GA-27 không đoán bừa.
    const speaker2DetectedV2 = v2Speakers.find(
      (s: { speakerLabel: string }) => s.speakerLabel === 'Speaker_2',
    );
    expect(speaker2DetectedV2.mappingSource).toBe('unmapped');
  }, 60000);
});
