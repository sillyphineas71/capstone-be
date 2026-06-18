
# Research: UC-IMM-08 View Participant Attendance Status

**Date**: 2026-06-17
**Feature**: UC-IMM-08

## Codebase Analysis

Module live-meeting da implement: start-meeting, end-meeting, extension-request, view-live-participants.
Patterns co san: constants files, DTOs, service methods, controller endpoints, types.

Key reuse:
- Error constants pattern: MEETING_START_ERRORS, MEETING_END_ERRORS
- Response DTO pattern: class + constructor
- Audit log: em.create() + em.save() non-blocking
- Permission guard: @RequirePermissions + JwtAuthGuard

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data source | attendance_records | Authoritative, khong query presence_snapshots |
| Check-in time | Earliest (MIN) | FR-037 clarify |
| Threshold config | system_configs key attendance.late_threshold | FR-017 |
| Pagination param | pageSize (default 20 max 100) | Spec clarify |
| Removed participant | Include only if has attendance | FR-038b |
| Field-level auth | NOT needed | Participant bi chan 403 o service layer |
