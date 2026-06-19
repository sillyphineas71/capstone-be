import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add GIN index for full-text search on meeting_notes.content.
 * Phuc vu UC-104 (FR-017).
 *
 * Index-only — khong thay doi schema cot/bang.
 */
export class AddMeetingNotesContentGinIndex20260618 implements MigrationInterface {
  name = 'AddMeetingNotesContentGinIndex20260618';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_content_fts
      ON meeting_notes
      USING GIN (to_tsvector('simple', content));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_meeting_notes_content_fts;
    `);
  }
}
