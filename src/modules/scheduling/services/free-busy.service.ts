import { Injectable } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

export interface Interval {
  start: Date;
  end: Date;
}

interface BusyRow {
  user_id: string;
  start_time: Date;
  end_time: Date;
}

/**
 * FreeBusyService — thuật toán merge-interval / intersection cho UC-SM-02.
 *
 * Quyết định thiết kế (research.md §3): viết mới, KHÔNG tái dùng
 * ParticipantConflictService.mergeBusySlots — module scheduling đó có bug
 * SQL placeholder đã biết (tách task riêng), và UC-SM-02 cần intersect
 * nhiều tập free-interval (không chỉ merge 1 tập), là bài toán khác hẳn
 * "validate 1 khung giờ đã cho" của UC-SM-04.
 */
@Injectable()
export class FreeBusyService {
  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  /**
   * Lấy toàn bộ khoảng bận (từ meetings status scheduled/in_progress) của
   * danh sách user trong [rangeStart, rangeEnd], group theo user_id.
   * FR-009, FR-010, FR-027.
   */
  async getBusyIntervalsByUser(
    userIds: string[],
    rangeStart: Date,
    rangeEnd: Date,
    excludeMeetingId: string | null,
  ): Promise<Map<string, Interval[]>> {
    const result = new Map<string, Interval[]>();
    for (const userId of userIds) {
      result.set(userId, []);
    }
    if (userIds.length === 0) return result;

    const rows: BusyRow[] = await this.entityManager.query(
      `SELECT mp.user_id, m.start_time, m.end_time
         FROM meeting_participants mp
         JOIN meetings m ON m.id = mp.meeting_id
        WHERE mp.user_id = ANY($1::uuid[])
          AND m.deleted_at IS NULL
          AND m.status IN ('scheduled', 'in_progress')
          AND m.start_time < $2
          AND m.end_time > $3
          AND ($4::uuid IS NULL OR m.id != $4)
        ORDER BY mp.user_id, m.start_time ASC`,
      [userIds, rangeEnd, rangeStart, excludeMeetingId],
    );

    for (const row of rows) {
      const list = result.get(row.user_id) ?? [];
      list.push({
        start: new Date(row.start_time),
        end: new Date(row.end_time),
      });
      result.set(row.user_id, list);
    }

    for (const [userId, intervals] of result) {
      result.set(userId, this.mergeIntervals(intervals));
    }

    return result;
  }

  /**
   * Merge các interval chồng lấn/liền kề, giả định đầu vào đã sort theo start ASC
   * (đúng do query ORDER BY ở trên).
   */
  mergeIntervals(intervals: Interval[]): Interval[] {
    if (intervals.length <= 1) return intervals;

    const merged: Interval[] = [];
    let current = { ...intervals[0] };

    for (let i = 1; i < intervals.length; i++) {
      const next = intervals[i];
      if (current.end.getTime() >= next.start.getTime()) {
        if (next.end.getTime() > current.end.getTime()) {
          current.end = next.end;
        }
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    return merged;
  }

  /**
   * Free-interval của 1 user = phần bù của busy (đã merge) trong [rangeStart, rangeEnd].
   */
  complement(busy: Interval[], rangeStart: Date, rangeEnd: Date): Interval[] {
    const free: Interval[] = [];
    let cursor = rangeStart;

    for (const b of busy) {
      if (b.start.getTime() > cursor.getTime()) {
        free.push({ start: cursor, end: b.start });
      }
      if (b.end.getTime() > cursor.getTime()) {
        cursor = b.end;
      }
    }
    if (cursor.getTime() < rangeEnd.getTime()) {
      free.push({ start: cursor, end: rangeEnd });
    }
    return free;
  }

  /**
   * Giao (intersection) của N tập interval đã sort. Dùng sweep tuần tự:
   * intersect(A, B) rồi intersect kết quả với C, v.v.
   * Nếu truyền mảng rỗng (0 user), coi như không có ràng buộc — trả nguyên
   * [rangeStart, rangeEnd] do caller tự truyền vào như 1 "free set" ban đầu.
   */
  intersectAll(intervalSets: Interval[][]): Interval[] {
    if (intervalSets.length === 0) return [];
    let acc = intervalSets[0];
    for (let i = 1; i < intervalSets.length; i++) {
      acc = this.intersectTwo(acc, intervalSets[i]);
      if (acc.length === 0) break;
    }
    return acc;
  }

  private intersectTwo(a: Interval[], b: Interval[]): Interval[] {
    const result: Interval[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const start =
        a[i].start.getTime() > b[j].start.getTime() ? a[i].start : b[j].start;
      const end = a[i].end.getTime() < b[j].end.getTime() ? a[i].end : b[j].end;
      if (start.getTime() < end.getTime()) {
        result.push({ start, end });
      }
      if (a[i].end.getTime() < b[j].end.getTime()) {
        i++;
      } else {
        j++;
      }
    }
    return result;
  }

  /** Kiểm tra 1 candidate slot có overlap với bất kỳ interval nào trong danh sách không. */
  overlapsAny(intervals: Interval[], slotStart: Date, slotEnd: Date): boolean {
    return intervals.some(
      (iv) =>
        iv.start.getTime() < slotEnd.getTime() &&
        iv.end.getTime() > slotStart.getTime(),
    );
  }
}
