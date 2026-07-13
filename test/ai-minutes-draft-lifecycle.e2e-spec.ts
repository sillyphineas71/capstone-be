/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { MinutesAiDraftService } from '../src/modules/minutes/services/minutes-ai-draft.service.js';
import { StorageService } from '../src/modules/storage/storage.service.js';

/**
 * T020 (MKM-AI-01) — Integration test AI draft lifecycle (BullMQ + DB).
 *
 * Chạy THẬT qua hạ tầng live (Postgres + Redis), KHÔNG mock DB/queue/processor:
 *   bật config (provider=mock) → seed meeting + transcript + host →
 *   MinutesAiDraftService.createAiDraftJob() (enqueue BullMQ thật) →
 *   MinutesAiDraftProcessor consume từ Redis thật + MockLlmProvider (không cần
 *   Ollama) → ghi meeting_minutes draft + background_job completed + audit →
 *   assert toàn bộ lifecycle trong DB (AC-001, AC-012).
 *
 * GATE: chỉ chạy khi RUN_INTEGRATION=1 (cần Postgres 5432 + Redis up). Mặc định
 * SKIP để npm test/test:e2e không vỡ khi thiếu hạ tầng.
 *
 *   RUN_INTEGRATION=1 npx jest --config ./test/jest-e2e.json ai-minutes-draft-lifecycle
 */
const RUN = process.env.RUN_INTEGRATION === '1';
const suite = RUN ? describe : describe.skip;

suite('AI minutes draft lifecycle (integration, BullMQ + DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: MinutesAiDraftService;

  const ids = {
    user: randomUUID(),
    meeting: randomUUID(),
    transcript: randomUUID(),
  };
  const tag = Date.now();
  let prevConfig: unknown;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // StorageService.onModuleInit() gọi dynamic import('minio') — override
      // no-op để app.init() không crash dưới ts-jest CommonJS (không test này
      // đụng storage).
      .overrideProvider(StorageService)
      .useValue({ onModuleInit: () => Promise.resolve() })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ds = app.get(DataSource);
    service = app.get(MinutesAiDraftService);

    // Bật flag + provider=mock (lưu lại config cũ để khôi phục).
    const cfg = await ds.query(
      `SELECT config_json FROM system_configs WHERE config_key = 'ai.minutes_summary'`,
    );
    prevConfig = cfg[0]?.config_json ?? null;
    await ds.query(
      `UPDATE system_configs SET config_json = config_json || '{"enabled": true, "provider": "mock"}'::jsonb WHERE config_key = 'ai.minutes_summary'`,
    );

    // Seed FK-valid bằng raw SQL.
    await ds.query(
      `INSERT INTO users (id, username, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        ids.user,
        `ai_it_user_${tag}`,
        `ai_it_user_${tag}@test.local`,
        'x',
        'AI Integration Host',
      ],
    );
    await ds.query(
      `INSERT INTO meetings (id, meeting_code, title, organizer_id, host_id, start_time, end_time)
       VALUES ($1, $2, $3, $4, $4, now() - interval '2 hour', now() - interval '1 hour')`,
      [ids.meeting, `AI_IT_MTG_${tag}`, 'AI Integration Meeting', ids.user],
    );
    await ds.query(
      `INSERT INTO transcripts (id, meeting_id, language_code, raw_text, cleaned_text, status, security_status)
       VALUES ($1, $2, 'vi-VN', $3, $3, 'draft', 'safe')`,
      [
        ids.transcript,
        ids.meeting,
        'Xin chao, hom nay hop ve tien do du an capstone.',
      ],
    );
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(
        `DELETE FROM audit_logs WHERE metadata_json->>'meetingId' = $1`,
        [ids.meeting],
      );
      await ds.query(`DELETE FROM meeting_minutes WHERE meeting_id = $1`, [
        ids.meeting,
      ]);
      await ds.query(
        `DELETE FROM background_jobs WHERE related_entity_id = $1 AND related_entity_type = 'meeting'`,
        [ids.meeting],
      );
      await ds.query(`DELETE FROM transcripts WHERE id = $1`, [ids.transcript]);
      await ds.query(`DELETE FROM meetings WHERE id = $1`, [ids.meeting]);
      await ds.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
      // Khôi phục config cũ.
      await ds.query(
        `UPDATE system_configs SET config_json = $1::jsonb WHERE config_key = 'ai.minutes_summary'`,
        [JSON.stringify(prevConfig)],
      );
    }
    await app?.close();
  });

  it('tao job -> BullMQ consume (mock LLM) -> minutes draft + job completed + audit', async () => {
    const res = await service.createAiDraftJob(
      ids.meeting,
      { transcriptId: ids.transcript },
      { userId: ids.user },
    );
    expect(res.status).toBe('queued');
    expect(res.jobId).toBeDefined();

    // Poll DB cho worker thật xử lý xong (mock provider -> nhanh).
    const deadline = Date.now() + 30000;
    let bgStatus = '';
    let outputJson: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      const bg = await ds.query(
        `SELECT status, output_json FROM background_jobs WHERE id = $1`,
        [res.jobId],
      );
      bgStatus = bg[0]?.status ?? '';
      outputJson = bg[0]?.output_json ?? null;
      if (bgStatus === 'completed' || bgStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(bgStatus).toBe('completed');
    expect(outputJson?.minutesId).toBeDefined();

    // meeting_minutes: draft, đúng schema, ai_summary_json.meta đầy đủ.
    const minutes = await ds.query(
      `SELECT status, version_no, prepared_by, linked_transcript_id,
              minutes_content, decisions_json, action_items_json, ai_summary_json
         FROM meeting_minutes WHERE meeting_id = $1`,
      [ids.meeting],
    );
    expect(minutes[0]?.status).toBe('draft');
    expect(minutes[0]?.version_no).toBe(1);
    expect(minutes[0]?.prepared_by).toBe(ids.user);
    expect(minutes[0]?.linked_transcript_id).toBe(ids.transcript);
    expect(typeof minutes[0]?.minutes_content).toBe('string');
    const aiJson = minutes[0]?.ai_summary_json as {
      meta?: Record<string, unknown>;
    };
    expect(aiJson?.meta?.promptVersion).toBe('mvp-v1');
    expect(aiJson?.meta?.generatedByJobId).toBe(res.jobId);
    expect(aiJson?.meta?.provider).toBe('mock');

    // audit log.
    const audit = await ds.query(
      `SELECT action_type FROM audit_logs
        WHERE action_type = 'minutes.ai_draft.generated'
          AND metadata_json->>'meetingId' = $1`,
      [ids.meeting],
    );
    expect(audit.length).toBeGreaterThan(0);
  }, 40000);
});
