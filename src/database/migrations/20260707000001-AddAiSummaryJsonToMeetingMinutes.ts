import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-ai-meeting-minutes-draft (MKM-AI-01) — T001.
 *
 * Them cot ai_summary_json (jsonb, nullable) vao meeting_minutes:
 * - NULL          -> bien ban soan thu cong (UC-MKM-01)
 * - khac NULL     -> ban nhap co nguon goc AI (keyPoints/risks/openQuestions/
 *                    uncertainParts + meta provider/model/promptVersion/jobId)
 * Day la thay doi schema DUY NHAT duoc phe duyet trong spec 5.2 —
 * khong tao bang moi, khong doi cot hien co.
 */
export class AddAiSummaryJsonToMeetingMinutes20260707000001 implements MigrationInterface {
  name = 'AddAiSummaryJsonToMeetingMinutes20260707000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE meeting_minutes ADD COLUMN IF NOT EXISTS ai_summary_json jsonb NULL;',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE meeting_minutes DROP COLUMN IF EXISTS ai_summary_json;',
    );
  }
}
