import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-speaker-tagging-post-meeting (T-TAG-001): Migration: Add SPEAKER_TAG
 * event type.
 *
 * The meeting_events.event_type column uses varchar(60), not a PostgreSQL native
 * enum. The TypeScript MeetingEventType enum was already updated in the entity
 * file (meeting-event.entity.ts). No DDL changes are needed since varchar
 * accepts any string value within length limits. This migration exists to
 * track the deployment intent and serve as documentation — same pattern as
 * 20260617-UpdateMeetingEventTypeEnum.ts.
 */
export class AddSpeakerTagMeetingEventType20260802000001 implements MigrationInterface {
  name = 'AddSpeakerTagMeetingEventType20260802000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // meeting_events.event_type is varchar(60) — no ALTER TYPE needed.
    // SPEAKER_TAG = 'speaker_tag' is already present in the TypeScript enum
    // MeetingEventType.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No schema change to revert.
  }
}
