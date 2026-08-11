/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { AlertsService } from './alerts.service.js';
import { SecurityAlertConfigService } from './security-alert-config.service.js';

describe('AlertsService (ASC-001 / UC-123)', () => {
  let service: AlertsService;
  let repo: any;
  let qb: any;
  let securityAlertConfigService: any;

  beforeEach(async () => {
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
      getMany: jest.fn().mockResolvedValue([]),
    };
    repo = {
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'a1', ...x })),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
      // bumpOccurrence() dùng raw SQL (jsonb_set atomic) thay vì createQueryBuilder —
      // xem alerts.service.ts.
      query: jest.fn().mockResolvedValue(undefined),
    };
    // [FIX 2026-08-11] bumpOccurrence() đọc occurrenceDebounceSeconds mỗi lần gọi —
    // mock default=5s (giống DEBOUNCE_CONFIG_DEFAULT thật), override per-test khi cần.
    securityAlertConfigService = {
      getDebounceSeconds: jest.fn().mockResolvedValue(5),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: getRepositoryToken(SecurityAlertEntity), useValue: repo },
        {
          provide: SecurityAlertConfigService,
          useValue: securityAlertConfigService,
        },
      ],
    }).compile();
    service = module.get(AlertsService);
  });

  describe('recordAlert', () => {
    it('R1 crux: KHÔNG có alert đang mở → INSERT mới, isNew=true, severity theo bảng mặc định', async () => {
      const r = await service.recordAlert({ alertType: 'intrusion' });
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.status).toBe('new');
      expect(saved.occurrenceCount).toBe(1);
      expect(saved.severity).toBe('critical'); // default map intrusion
      expect(saved.zoneId).toBeNull();
      expect(r.isNew).toBe(true);
    });

    it('severity override từ caller được ưu tiên hơn bảng mặc định', async () => {
      await service.recordAlert({ alertType: 'crowd', severity: 'critical' });
      expect(repo.save.mock.calls[0][0].severity).toBe('critical');
    });

    it('alertType lạ không có trong bảng mặc định → fallback medium', async () => {
      await service.recordAlert({ alertType: 'device_error' });
      expect(repo.save.mock.calls[0][0].severity).toBe('low');
    });

    it('R2 crux: 23505 (đã có alert mở) → KHÔNG throw, chuyển UPDATE occurrenceCount, isNew=false, severity/triggeredAt KHÔNG bị ghi đè', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      const openAlert = {
        id: 'open-1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        severity: 'high',
        status: 'new',
      };
      repo.findOne
        .mockResolvedValueOnce(openAlert) // findOpenAlert
        .mockResolvedValueOnce({ ...openAlert, occurrenceCount: 2 }); // getOrThrow sau bumpOccurrence
      const r = await service.recordAlert({
        alertType: 'crowd',
        zoneId: 'zone-1',
        severity: 'critical', // PHẢI bị bỏ qua — alert đang mở giữ nguyên severity gốc
      });
      expect(r.isNew).toBe(false);
      expect(repo.query).toHaveBeenCalledTimes(1); // bumpOccurrence() raw SQL, không còn createQueryBuilder
      expect(r.alert.occurrenceCount).toBe(2);
    });

    it('zoneId NULL: findOpenAlert dùng nhánh IsNull (KHÔNG so sánh = null trực tiếp)', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne
        .mockResolvedValueOnce({ id: 'open-1', status: 'new' })
        .mockResolvedValueOnce({ id: 'open-1', occurrenceCount: 2 });
      await service.recordAlert({ alertType: 'stranger' });
      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.zoneId).toBeDefined(); // IsNull() object, KHÔNG phải literal null
    });

    it('race hiếm: 23505 nhưng SELECT không thấy alert mở → retry INSERT 1 lần, thành công', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockResolvedValueOnce({ id: 'a2', status: 'new' });
      repo.findOne.mockResolvedValueOnce(null); // findOpenAlert lần 1: không thấy
      const r = await service.recordAlert({ alertType: 'stranger' });
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(r.isNew).toBe(true);
    });

    it('race hiếm: retry vẫn 23505, SELECT lần 2 tìm thấy → UPDATE bumpOccurrence', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne
        .mockResolvedValueOnce(null) // findOpenAlert lần 1: không thấy
        .mockResolvedValueOnce({ id: 'a3', status: 'new' }) // findOpenAlert lần 2: thấy
        .mockResolvedValueOnce({ id: 'a3', occurrenceCount: 2 }); // getOrThrow sau bump
      const r = await service.recordAlert({ alertType: 'stranger' });
      expect(r.isNew).toBe(false);
      expect(r.alert.id).toBe('a3');
    });

    it('race cực hiếm: retry vẫn 23505 và vẫn không SELECT thấy → throw lỗi rõ ràng', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.recordAlert({ alertType: 'stranger' }),
      ).rejects.toThrow(/recordAlert/);
    });

    it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
      const boom = new Error('db down');
      repo.save.mockRejectedValue(boom);
      await expect(service.recordAlert({ alertType: 'crowd' })).rejects.toBe(
        boom,
      );
    });
  });

  describe('bumpOccurrence — payload_json.occurrences (fix "mất dấu vết nhiều người vi phạm")', () => {
    // repo.query() ở đây là raw SQL (WITH latest_match + jsonb_set atomic, chạy thật trong
    // Postgres khi production) — không có DB thật trong unit test này, nên repo.query mock
    // TỰ MÔ PHỎNG đúng thuật toán mà câu SQL trong alerts.service.ts thực hiện (đọc params
    // $2/$3/$4 y hệt code thật truyền vào: entry JSON, cap 20, debounceSeconds), để xác nhận
    // HÀNH VI qua nhiều lần gọi recordAlert() liên tiếp — bao gồm cả nhánh debounce [FIX
    // 2026-08-11]: last_seen_at/occurrence_count LUÔN tăng vô điều kiện; occurrences CHỈ
    // skip append khi entry mới CÙNG userId (khác null) với entry gần nhất trong mảng hiện
    // có VÀ cách nhau dưới debounceSeconds giây — mirror đúng điều kiện SQL
    // `latest_match`/`ABS(EXTRACT(EPOCH FROM (...))) < $4`.
    interface OccurrenceEntry {
      userId: string | null;
      sourceEventId: string | null;
      occurredAt: string;
    }
    const makeStatefulQueryMock = (row: {
      occurrenceCount: number;
      lastSeenAt: string | null;
      payloadJson: Record<string, unknown>;
    }) =>
      jest.fn((_sql: string, params: unknown[]) => {
        const [, entryJson, max, debounceSeconds] = params as [
          string,
          string,
          number,
          number,
        ];
        const entry = JSON.parse(entryJson) as OccurrenceEntry;
        const prior = (row.payloadJson.occurrences as OccurrenceEntry[]) ?? [];

        // mirror SQL: last_seen_at/occurrence_count LUÔN cập nhật vô điều kiện,
        // KHÔNG phụ thuộc debounce (R3 — an toàn cho auto-resolve).
        row.occurrenceCount += 1;
        row.lastSeenAt = new Date().toISOString();

        const latestMatch = [...prior]
          .reverse()
          .find((e) => e.userId !== null && e.userId === entry.userId);
        const debounced =
          entry.userId !== null &&
          latestMatch !== undefined &&
          Math.abs(
            (new Date(entry.occurredAt).getTime() -
              new Date(latestMatch.occurredAt).getTime()) /
              1000,
          ) < debounceSeconds;

        if (!debounced) {
          row.payloadJson = {
            ...row.payloadJson,
            occurrences: [...prior, entry].slice(-max),
          };
        }
        return Promise.resolve(undefined);
      });

    it('bump nhiều lần liên tiếp → occurrences tích lũy đúng, giữ thứ tự, không mất entry', async () => {
      const row = {
        id: 'alert-1',
        alertType: 'intrusion',
        zoneId: 'zone-1',
        status: 'new',
        occurrenceCount: 1,
        lastSeenAt: null as string | null,
        payloadJson: {} as Record<string, unknown>,
      };
      repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
      repo.save.mockRejectedValue({ driverError: { code: '23505' } }); // luôn có alert mở → luôn bump
      repo.query = makeStatefulQueryMock(row);

      const violators = [
        {
          sourceEventId: 'evt-1',
          userId: 'u1',
          occurredAt: '2026-08-09T01:00:00.000Z',
        },
        {
          sourceEventId: 'evt-2',
          userId: 'u2',
          occurredAt: '2026-08-09T01:05:00.000Z',
        },
        {
          sourceEventId: 'evt-3',
          userId: null,
          occurredAt: '2026-08-09T01:10:00.000Z',
        },
      ];
      let last;
      for (const v of violators) {
        last = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: v.sourceEventId,
          payloadJson: { userId: v.userId, occurredAt: v.occurredAt },
        });
      }

      expect(repo.query).toHaveBeenCalledTimes(3);
      expect(last!.isNew).toBe(false);
      expect(last!.alert.payloadJson.occurrences).toEqual(violators);
    });

    it('payload_json.occurrences đã có đủ 20 phần tử → bump thêm 1 vẫn giữ đúng 20, drop entry cũ nhất', async () => {
      const seeded = Array.from({ length: 20 }, (_, i) => ({
        userId: `u${i}`,
        sourceEventId: `evt-${i}`,
        occurredAt: `2026-08-09T00:${String(i).padStart(2, '0')}:00.000Z`,
      }));
      const row = {
        id: 'alert-2',
        alertType: 'crowd',
        zoneId: 'zone-9',
        status: 'new',
        occurrenceCount: 20,
        lastSeenAt: null as string | null,
        payloadJson: { occurrences: seeded } as Record<string, unknown>,
      };
      repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.query = makeStatefulQueryMock(row);

      const r = await service.recordAlert({
        alertType: 'crowd',
        zoneId: 'zone-9',
        sourceEventId: 'evt-new',
        payloadJson: { occurredAt: '2026-08-09T02:00:00.000Z' }, // crowd: không có userId
      });

      const occurrences = r.alert.payloadJson!.occurrences as unknown[];
      expect(occurrences).toHaveLength(20);
      expect(occurrences[0]).toEqual(seeded[1]); // entry cũ nhất (u0/evt-0) bị drop
      expect(occurrences[19]).toEqual({
        userId: null,
        sourceEventId: 'evt-new',
        occurredAt: '2026-08-09T02:00:00.000Z',
      });
    });

    describe('debounce theo userId (fix 2026-08-11, chống thổi phồng khi camera bắn appear gần-trùng-giờ)', () => {
      it('case biên — alert vừa mở, occurrences RỖNG → latest_match 0 dòng, EXISTS=false → LUÔN append (không phụ thuộc debounceSeconds)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(9999); // debounce cực lớn — vẫn phải append vì chưa có gì để so
        const row = {
          id: 'alert-empty',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>, // occurrences chưa tồn tại (rỗng)
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        const r = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });

        expect(r.alert.occurrenceCount).toBe(2);
        const occurrences = r.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(1); // append thành công dù occurrences ban đầu rỗng
        expect(occurrences[0]).toEqual({
          userId: 'u1',
          sourceEventId: 'evt-1',
          occurredAt: '2026-08-11T09:00:00.000Z',
        });
      });

      it('cùng userId, 2 lần cách nhau < debounceSeconds → occurrence_count vẫn tăng, occurrences KHÔNG có entry mới', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-3',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-2',
          // 3s sau lần trước — dưới debounceSeconds=5.
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:03.000Z' },
        });

        expect(repo.query).toHaveBeenCalledTimes(2);
        expect(r2.alert.occurrenceCount).toBe(3); // vô điều kiện: 1 (insert) → 2 → 3
        const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(1); // lần 2 bị debounce, KHÔNG append
        expect(occurrences[0]).toEqual({
          userId: 'u1',
          sourceEventId: 'evt-1',
          occurredAt: '2026-08-11T09:00:00.000Z',
        });
      });

      it('cùng userId, 2 lần cách nhau >= debounceSeconds → append bình thường', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-4',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-2',
          // đúng 5s sau — KHÔNG < debounceSeconds=5 (biên, không debounce).
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:05.000Z' },
        });

        expect(r2.alert.occurrenceCount).toBe(3);
        const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(2); // append bình thường
        expect(occurrences[1]).toEqual({
          userId: 'u1',
          sourceEventId: 'evt-2',
          occurredAt: '2026-08-11T09:00:05.000Z',
        });
      });

      it('crowd (userId null) gọi liên tiếp nhanh → KHÔNG bị debounce nhầm, mỗi lần đều append (regression 4 loại alert khác)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-5',
          alertType: 'crowd',
          zoneId: 'zone-9',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        // 2 lần cách nhau 1s (< debounceSeconds=5) nhưng userId=null (crowd) → không debounce.
        await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-1',
          payloadJson: { occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-2',
          payloadJson: { occurredAt: '2026-08-11T09:00:01.000Z' },
        });

        const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(2); // cả 2 đều append, không bị debounce nhầm
      });

      it('last_seen_at LUÔN cập nhật dù bị debounce hay không (chống rủi ro R3 — auto-resolve không được đóng nhầm)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-6',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        expect(row.lastSeenAt).toBeNull();

        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        // repo.save luôn 23505 (mock chung của describe cha) → MỌI lần gọi recordAlert()
        // ở đây đi qua bumpOccurrence(), kể cả lần "đầu tiên" trong test này.
        const afterFirst = row.lastSeenAt;
        expect(afterFirst).not.toBeNull();

        // lần 2: 1s sau — CHẮC CHẮN bị debounce (< 5s) — nhưng last_seen_at vẫn phải đổi.
        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-2',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:01.000Z' },
        });

        expect(row.occurrenceCount).toBe(3); // 1 → 2 → 3, vô điều kiện
        expect(row.payloadJson.occurrences as unknown[]).toHaveLength(1); // debounced, occurrences KHÔNG đổi — chứng minh 2 việc tách rời nhau
        // repo.query() được gọi đúng 2 lần (1 lần/recordAlert) — mock TỰ set lastSeenAt =
        // NOW() vô điều kiện ở CẢ 2 lần (mirror `SET last_seen_at = NOW()` chạy trước CASE
        // debounce trong SQL thật), bất kể lần đó có bị debounce hay không.
        expect(repo.query).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('list', () => {
    it('R3: không truyền status → where KHÔNG có status (trả mọi trạng thái)', async () => {
      await service.list({ page: 1, limit: 20 } as any);
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect('status' in where).toBe(false);
    });

    it('filter status → where.status đúng giá trị', async () => {
      await service.list({ page: 1, limit: 20, status: 'new' } as any);
      expect(repo.findAndCount.mock.calls[0][0].where.status).toBe('new');
    });

    it('sort mặc định triggeredAt DESC', async () => {
      await service.list({ page: 1, limit: 20 } as any);
      expect(repo.findAndCount.mock.calls[0][0].order).toEqual({
        triggeredAt: 'DESC',
      });
    });
  });

  describe('findDetail (R4)', () => {
    it('không tồn tại → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findDetail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('zone bị xóa mềm (deletedAt khác null) → trả zone:null (CLAUDE.md §5.5 quy tắc 1)', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        zone: { id: 'zone-1', deletedAt: new Date() },
      });
      const r = await service.findDetail('a1');
      expect(r.zone).toBeNull();
    });

    it('zone còn sống → trả nguyên zone; history dùng IS NOT DISTINCT FROM', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        zone: { id: 'zone-1', deletedAt: null },
      });
      const r = await service.findDetail('a1');
      expect(r.zone).toEqual({ id: 'zone-1', deletedAt: null });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'a.zone_id IS NOT DISTINCT FROM :zoneId',
        { zoneId: 'zone-1' },
      );
    });
  });

  describe('acknowledge (R5/R6 crux EX1)', () => {
    it('status=new → conditional update thành công', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'acknowledged' });
      const r = await service.acknowledge('a1', 'u1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'a1', status: 'new' },
        expect.objectContaining({
          status: 'acknowledged',
          acknowledgedBy: 'u1',
        }),
      );
      expect(r.status).toBe('acknowledged');
    });

    it('EX1: status KHÔNG PHẢI new (đã bị xử lý) → 409 kèm đúng người/thời điểm', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({
        id: 'a1',
        status: 'acknowledged',
        acknowledgedBy: 'other-guard',
        acknowledgedAt: new Date('2026-07-23T10:00:00Z'),
      });
      try {
        await service.acknowledge('a1', 'u1');
        fail('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response.by).toBe('other-guard');
        expect(e.response.status).toBe('acknowledged');
      }
    });

    it('EX1: đã resolved → conflict dùng resolvedBy/resolvedAt, KHÔNG dùng acknowledgedBy', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({
        id: 'a1',
        status: 'resolved',
        acknowledgedBy: 'guard-a',
        resolvedBy: 'guard-b',
        resolvedAt: new Date('2026-07-23T11:00:00Z'),
      });
      try {
        await service.acknowledge('a1', 'u1');
        fail('should throw');
      } catch (e: any) {
        expect(e.response.by).toBe('guard-b');
      }
    });
  });

  describe('resolve (R7/R8)', () => {
    it('status=acknowledged → conditional update thành công, resolutionNote lưu đúng', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'resolved' });
      await service.resolve('a1', { resolutionNote: 'báo động giả' }, 'u1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'a1', status: 'acknowledged' },
        expect.objectContaining({
          status: 'resolved',
          resolutionNote: 'báo động giả',
          resolvedBy: 'u1',
        }),
      );
    });

    it('status=new (chưa acknowledge) → 409, KHÔNG cho nhảy cóc', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'new' });
      await expect(
        service.resolve('a1', { resolutionNote: 'x' }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('bulkAcknowledge (R9 AF1)', () => {
    it('mix thành công + conflict — 1 lỗi KHÔNG chặn id khác', async () => {
      repo.update
        .mockResolvedValueOnce({ affected: 1 }) // id1 ok
        .mockResolvedValueOnce({ affected: 0 }); // id2 conflict
      repo.findOne
        .mockResolvedValueOnce({ id: 'id1', status: 'acknowledged' }) // getOrThrow sau update id1
        .mockResolvedValueOnce({
          id: 'id2',
          status: 'resolved',
          resolvedBy: 'other',
          resolvedAt: new Date(),
        }); // getOrThrow trong conflict path id2
      const r = await service.bulkAcknowledge(['id1', 'id2'], 'u1');
      expect(r.acknowledged).toEqual(['id1']);
      expect(r.alreadyProcessed).toHaveLength(1);
      expect(r.alreadyProcessed[0].id).toBe('id2');
      expect(r.alreadyProcessed[0].status).toBe('resolved');
    });

    it('lỗi KHÔNG phải conflict (vd DB down) → ném ra ngoài, dừng batch', async () => {
      const boom = new Error('db down');
      repo.update.mockRejectedValue(boom);
      await expect(service.bulkAcknowledge(['id1'], 'u1')).rejects.toBe(boom);
    });
  });
});
