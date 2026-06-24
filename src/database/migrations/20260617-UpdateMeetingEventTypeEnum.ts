import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add EXTENSION_APPROVED and EXTENSION_REJECTED event types.
 *
 * The meeting_events.event_type column uses varchar(60), not a PostgreSQL native enum.
 * The TypeScript MeetingEventType enum was already updated in the entity file.
 * No DDL changes are needed since varchar accepts any string value within length limits.
 * This migration exists to track the deployment intent and serve as documentation.
 */
export class UpdateMeetingEventTypeEnum20260617 implements MigrationInterface {
  name = 'UpdateMeetingEventTypeEnum2026061700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // meeting_events.event_type is varchar(60) — no ALTER TYPE needed.
    // EXTENSION_APPROVED = 'extension_approved' and EXTENSION_REJECTED = 'extension_rejected'
    // are already present in the TypeScript enum MeetingEventType.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No schema change to revert.
  }
}
