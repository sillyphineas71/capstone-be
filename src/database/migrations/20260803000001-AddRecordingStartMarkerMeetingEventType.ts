import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-speaker-tagging-live (T-LIVE-001): Migration: Add RECORDING_START_MARKER
 * event type.
 *
 * The meeting_events.event_type column uses varchar(60), not a PostgreSQL native
 * enum. The TypeScript MeetingEventType enum was already updated in the entity
 * file (meeting-event.entity.ts). No DDL changes are needed since varchar
 * accepts any string value within length limits. This migration exists to
 * track the deployment intent and serve as documentation — same pattern as
 * 20260617-UpdateMeetingEventTypeEnum.ts / 20260802000001-AddSpeakerTagMeetingEventType.ts.
 */
export class AddRecordingStartMarkerMeetingEventType20260803000001 implements MigrationInterface {
  name = 'AddRecordingStartMarkerMeetingEventType20260803000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // meeting_events.event_type is varchar(60) — no ALTER TYPE needed.
    // RECORDING_START_MARKER = 'recording_start_marker' is already present in
    // the TypeScript enum MeetingEventType.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No schema change to revert.
  }
}
