import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { FreeBusyService, Interval } from './free-busy.service.js';
import { SuggestTimeSlotDto } from '../dto/suggest-time-slot.dto.js';
import {
  BusyParticipantDto,
  TimeSuggestionItemDto,
} from '../dto/time-suggestion-item.dto.js';
import {
  TimeSuggestionMetaDto,
  TimeSuggestionResponseDto,
} from '../dto/time-suggestion-response.dto.js';

const CANDIDATE_GRANULARITY_MINUTES = 15;
const MAX_TOTAL_PARTICIPANTS = 50;
const DEFAULT_MAX_SUGGESTIONS = 5;
/** Chặn số candidate quét tối đa để tránh quét vô hạn nếu search range rất dài. */
const MAX_CANDIDATES_EVALUATED = 2000;

@Injectable()
export class TimeSuggestionService {
  constructor(
    private readonly freeBusyService: FreeBusyService,
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  async suggestTimeSlots(
    dto: SuggestTimeSlotDto,
    currentUserId: string,
  ): Promise<{ result: TimeSuggestionResponseDto; message: string }> {
    const searchRangeStart = new Date(dto.searchRangeStart);
    const searchRangeEnd = new Date(dto.searchRangeEnd);

    this.validateTimeRange(searchRangeStart, searchRangeEnd);
    this.validateSearchRangeMaxDays(searchRangeStart, searchRangeEnd);

    const requiredRaw = dto.requiredParticipantUserIds ?? [];
    const optionalRaw = dto.optionalParticipantUserIds ?? [];

    // FR-021: khong duoc trung giua required va optional
    const overlap = requiredRaw.filter((id) => optionalRaw.includes(id));
    if (overlap.length > 0) {
      throw new BadRequestException({
        success: false,
        message:
          'Một người dùng không thể vừa là khách mời bắt buộc vừa là tùy chọn.',
        error: { code: 'VALIDATION_ERROR', details: { duplicated: overlap } },
      });
    }

    // FR-001: organizer luon la Required ngam dinh
    const requiredUserIds = Array.from(
      new Set([currentUserId, ...requiredRaw]),
    );
    const optionalUserIds = Array.from(new Set(optionalRaw));
    const allInternalUserIds = Array.from(
      new Set([...requiredUserIds, ...optionalUserIds]),
    );

    // FR-019: toi thieu 2 nguoi tham gia noi bo (bao gom organizer)
    if (allInternalUserIds.length < 2) {
      throw new BadRequestException({
        success: false,
        message: 'Cần ít nhất 2 người tham gia.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    // NFR-002: gioi han tong participants
    if (allInternalUserIds.length > MAX_TOTAL_PARTICIPANTS) {
      throw new BadRequestException({
        success: false,
        message: `Tổng số khách mời không được vượt quá ${MAX_TOTAL_PARTICIPANTS} người.`,
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    await this.validateUsersExist(allInternalUserIds);

    if (dto.excludeMeetingId) {
      await this.validateExcludeMeetingAccess(
        dto.excludeMeetingId,
        currentUserId,
      );
    }

    const busyByUser = await this.freeBusyService.getBusyIntervalsByUser(
      allInternalUserIds,
      searchRangeStart,
      searchRangeEnd,
      dto.excludeMeetingId ?? null,
    );

    // FR-004: intersect free-interval cua toan bo Required (hard filter)
    const requiredFreeSets = requiredUserIds.map((userId) =>
      this.freeBusyService.complement(
        busyByUser.get(userId) ?? [],
        searchRangeStart,
        searchRangeEnd,
      ),
    );
    const requiredFreeWindows =
      this.freeBusyService.intersectAll(requiredFreeSets);

    const durationMs = dto.durationMinutes * 60_000;
    const granularityMs = CANDIDATE_GRANULARITY_MINUTES * 60_000;

    const candidates: { start: Date; end: Date }[] = [];
    outer: for (const window of requiredFreeWindows) {
      const windowLenMs = window.end.getTime() - window.start.getTime();
      if (windowLenMs < durationMs) continue;

      let slotStartMs = window.start.getTime();
      const latestStartMs = window.end.getTime() - durationMs;
      while (slotStartMs <= latestStartMs) {
        candidates.push({
          start: new Date(slotStartMs),
          end: new Date(slotStartMs + durationMs),
        });
        if (candidates.length >= MAX_CANDIDATES_EVALUATED) break outer;
        slotStartMs += granularityMs;
      }
    }

    const maxSuggestions = dto.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
    const requiredTotal = requiredUserIds.length;
    const optionalTotal = optionalUserIds.length;
    const totalInternalParticipants = requiredTotal + optionalTotal;

    const scored: TimeSuggestionItemDto[] = candidates.map((c) => {
      const busyOptional = optionalUserIds.filter((userId) =>
        this.freeBusyService.overlapsAny(
          busyByUser.get(userId) ?? [],
          c.start,
          c.end,
        ),
      );
      const optionalFreeCount = optionalTotal - busyOptional.length;
      const matchScore =
        totalInternalParticipants > 0
          ? Math.round(
              ((requiredTotal + optionalFreeCount) /
                totalInternalParticipants) *
                100,
            )
          : 100;

      const busyParticipants: BusyParticipantDto[] = busyOptional.map(
        (userId) => {
          const slots = (busyByUser.get(userId) ?? []).filter(
            (iv) =>
              iv.start.getTime() < c.end.getTime() &&
              iv.end.getTime() > c.start.getTime(),
          );
          const merged = this.mergeForDisplay(slots);
          return {
            userId,
            busyFrom: merged.start.toISOString(),
            busyTo: merged.end.toISOString(),
          };
        },
      );

      return {
        startTime: c.start.toISOString(),
        endTime: c.end.toISOString(),
        matchScore,
        requiredFreeCount: requiredTotal,
        requiredTotal,
        optionalFreeCount,
        optionalTotal,
        busyParticipants,
      };
    });

    // FR-029: sort matchScore DESC, startTime ASC
    scored.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.startTime.localeCompare(b.startTime);
    });

    const limited = scored.slice(0, maxSuggestions);

    const meta: TimeSuggestionMetaDto = {
      searchRangeStart: searchRangeStart.toISOString(),
      searchRangeEnd: searchRangeEnd.toISOString(),
      durationMinutes: dto.durationMinutes,
      totalCandidatesEvaluated: candidates.length,
      resultLimit: maxSuggestions,
    };

    const message =
      limited.length === 0
        ? 'Không tìm thấy khung giờ chung nào phù hợp. Vui lòng thử mở rộng khoảng thời gian tìm kiếm hoặc giảm bớt số lượng khách mời.'
        : 'Danh sách khung giờ đề xuất';

    return { result: { data: limited, meta }, message };
  }

  // ── Validation helpers ──────────────────────────────────────────────────

  private validateTimeRange(start: Date, end: Date): void {
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException({
        success: false,
        message: 'searchRangeStart hoặc searchRangeEnd không đúng định dạng',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException({
        success: false,
        message: 'searchRangeEnd phải sau searchRangeStart',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    if (start.getTime() < Date.now()) {
      throw new BadRequestException({
        success: false,
        message: 'searchRangeStart không được ở quá khứ',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
  }

  private validateSearchRangeMaxDays(start: Date, end: Date): void {
    const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (diffDays > 30) {
      throw new BadRequestException({
        success: false,
        message: 'Khoảng thời gian tìm kiếm không được vượt quá 30 ngày.',
        error: { code: 'SCHEDULING_SEARCH_RANGE_TOO_LONG', details: {} },
      });
    }
  }

  private async validateUsersExist(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const result: { cnt: number }[] = await this.entityManager.query(
      `SELECT COUNT(*)::int AS cnt FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [userIds],
    );
    const foundCount = result[0]?.cnt ?? 0;
    if (foundCount !== userIds.length) {
      throw new BadRequestException({
        success: false,
        message:
          'Một hoặc nhiều participantUserId không tồn tại hoặc đã bị xóa',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
  }

  private async validateExcludeMeetingAccess(
    meetingId: string,
    requestingUserId: string,
  ): Promise<void> {
    const meeting: { id: string; organizer_id: string }[] =
      await this.entityManager.query(
        `SELECT id, organizer_id FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
        [meetingId],
      );
    if (meeting.length === 0) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp với excludeMeetingId',
        error: { code: 'RESOURCE_NOT_FOUND', details: {} },
      });
    }

    const isOrganizer = meeting[0].organizer_id === requestingUserId;
    const participantCheck: unknown[] = await this.entityManager.query(
      `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
      [meetingId, requestingUserId],
    );
    const isParticipant = participantCheck.length > 0;

    if (!isOrganizer && !isParticipant) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền truy cập cuộc họp này',
        error: { code: 'PERMISSION_DENIED', details: {} },
      });
    }
  }

  /** Gộp các khoảng bận overlap 1 candidate slot thành 1 khoảng [min start, max end] để hiển thị. */
  private mergeForDisplay(intervals: Interval[]): Interval {
    const start = intervals.reduce(
      (min, iv) => (iv.start.getTime() < min.getTime() ? iv.start : min),
      intervals[0].start,
    );
    const end = intervals.reduce(
      (max, iv) => (iv.end.getTime() > max.getTime() ? iv.end : max),
      intervals[0].end,
    );
    return { start, end };
  }
}
