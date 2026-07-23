/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/prefer-promise-reject-errors */
import { GateLogPairingService } from './gate-log-pairing.service.js';

interface Opts {
  batch?: Array<{ id: string }>;
  leaveLock?: Array<{ id: string; user_id: string; access_time: Date }>;
  enterLock?: Array<{ id: string; access_time: Date }>;
  updateThrows?: unknown;
  windowH?: number;
  bufferH?: number;
}

const ENTER_T = new Date('2026-07-23T08:00:00Z');
const LEAVE_T = new Date('2026-07-23T12:00:00Z'); // +4h = 14400s

const setup = (opts: Opts = {}) => {
  const updateCalls: Array<{ sql: string; params: unknown[] }> = [];
  const lockCalls: string[] = [];
  const commit = jest.fn();
  const rollback = jest.fn();
  const release = jest.fn();

  const qrQuery = jest.fn((sql: string, _params: unknown[]) => {
    if (
      sql.includes('FOR UPDATE SKIP LOCKED') &&
      sql.includes('direction = $2')
    ) {
      lockCalls.push(sql);
      return Promise.resolve(opts.leaveLock ?? []); // khoá bản leave
    }
    if (sql.includes('ORDER BY access_time DESC')) {
      lockCalls.push(sql);
      return Promise.resolve(opts.enterLock ?? []); // khoá bản enter (LIFO)
    }
    if (sql.trimStart().startsWith('UPDATE')) {
      updateCalls.push({ sql, params: _params });
      if (opts.updateThrows) return Promise.reject(opts.updateThrows);
      return Promise.resolve(undefined);
    }
    return Promise.resolve([]);
  });

  const batchQuery = jest.fn(() => Promise.resolve(opts.batch ?? []));

  const qr = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: commit,
    rollbackTransaction: rollback,
    release,
    manager: { query: qrQuery },
  };
  const dataSource = {
    manager: { query: batchQuery },
    createQueryRunner: jest.fn(() => qr),
  } as any;
  const config = {
    get: (k: string, d?: unknown) =>
      ({
        GATE_PAIRING_WINDOW_HOURS: opts.windowH ?? 24,
        GATE_PAIRING_BUFFER_HOURS: opts.bufferH ?? 1,
      })[k] ?? d,
  } as any;

  const service = new GateLogPairingService(dataSource, config);
  return {
    service,
    updateCalls,
    lockCalls,
    batchQuery,
    qrQuery,
    commit,
    rollback,
    release,
  };
};

const oneLeaveOneEnter = (over: Partial<Opts> = {}): Opts => ({
  batch: [{ id: 'L1' }],
  leaveLock: [{ id: 'L1', user_id: 'u1', access_time: LEAVE_T }],
  enterLock: [{ id: 'E1', access_time: ENTER_T }],
  ...over,
});

describe('GateLogPairingService (GAP-001 / UC-106)', () => {
  it('ghép thành công: 2 UPDATE hai chiều, duration cả hai đúng, commit', async () => {
    const t = setup(oneLeaveOneEnter());
    const r = await t.service.pairBatch();

    expect(t.updateCalls).toHaveLength(2);
    // L trỏ E, E trỏ L (hai chiều); duration bằng nhau + đúng 14400s.
    expect(t.updateCalls[0].params).toEqual(['E1', 14400, 'L1']);
    expect(t.updateCalls[1].params).toEqual(['L1', 14400, 'E1']);
    expect(t.commit).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ scanned: 1, paired: 1, skipped: 0 });
  });

  it('SKIP LOCKED ở CẢ HAI bước khoá', async () => {
    const t = setup(oneLeaveOneEnter());
    await t.service.pairBatch();
    // 2 câu khoá (L + E) đều có SKIP LOCKED.
    expect(t.lockCalls).toHaveLength(2);
    expect(t.lockCalls.every((s) => s.includes('FOR UPDATE SKIP LOCKED'))).toBe(
      true,
    );
  });

  it('ứng viên enter dùng LIFO (ORDER BY access_time DESC LIMIT 1) + cửa sổ', async () => {
    const t = setup(oneLeaveOneEnter());
    await t.service.pairBatch();
    const eSql = t.lockCalls.find((s) =>
      s.includes('ORDER BY access_time DESC'),
    )!;
    expect(eSql).toContain('LIMIT 1');
    expect(eSql).toContain('access_time < $3');
    expect(eSql).toContain('access_time >= $4'); // cận cửa sổ
    expect(eSql).not.toContain('zone_id'); // KHÔNG bắt cùng zone (OQ-1)
  });

  it('query lô: user_id IS NOT NULL + accessTime ASC + LIMIT 300 + cửa sổ quét', async () => {
    const t = setup(oneLeaveOneEnter());
    await t.service.pairBatch();
    const [sql, params] = t.batchQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('user_id IS NOT NULL');
    expect(sql).toContain('ORDER BY access_time ASC'); // xử leave cũ nhất trước
    expect(sql).toContain('LIMIT 300');
    expect(sql).toContain('access_time >= $2');
    expect(params[1]).toBeInstanceOf(Date); // scanFrom = now - (window+buffer)h
  });

  it('không ứng viên enter → 0 UPDATE, skipped, KHÔNG throw, vẫn commit', async () => {
    const t = setup(oneLeaveOneEnter({ enterLock: [] }));
    const r = await t.service.pairBatch();
    expect(t.updateCalls).toHaveLength(0);
    expect(r).toEqual({ scanned: 1, paired: 0, skipped: 1 });
    expect(t.commit).toHaveBeenCalledTimes(1);
  });

  it('bản leave bị khoá/đã ghép (lock trả []) → skipped, 0 UPDATE', async () => {
    const t = setup(oneLeaveOneEnter({ leaveLock: [] }));
    const r = await t.service.pairBatch();
    expect(t.updateCalls).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('23505 (race) → rollback + skipped + KHÔNG ném ra ngoài; commit KHÔNG gọi', async () => {
    const t = setup(
      oneLeaveOneEnter({ updateThrows: { driverError: { code: '23505' } } }),
    );
    const r = await t.service.pairBatch();
    expect(t.rollback).toHaveBeenCalledTimes(1);
    expect(t.commit).not.toHaveBeenCalled();
    expect(r).toEqual({ scanned: 1, paired: 0, skipped: 1 });
  });

  it('lỗi khác 23505 → ném ra (cron sẽ bọc), rollback gọi', async () => {
    const t = setup(oneLeaveOneEnter({ updateThrows: new Error('db down') }));
    await expect(t.service.pairBatch()).rejects.toThrow('db down');
    expect(t.rollback).toHaveBeenCalledTimes(1);
  });

  it('finally release() gọi ở mọi nhánh (paired / no-candidate / 23505 / lỗi khác)', async () => {
    let t = setup(oneLeaveOneEnter());
    await t.service.pairBatch();
    expect(t.release).toHaveBeenCalledTimes(1); // paired

    t = setup(oneLeaveOneEnter({ enterLock: [] }));
    await t.service.pairBatch();
    expect(t.release).toHaveBeenCalledTimes(1); // no candidate

    t = setup(
      oneLeaveOneEnter({ updateThrows: { driverError: { code: '23505' } } }),
    );
    await t.service.pairBatch();
    expect(t.release).toHaveBeenCalledTimes(1); // 23505

    t = setup(oneLeaveOneEnter({ updateThrows: new Error('x') }));
    await expect(t.service.pairBatch()).rejects.toThrow();
    expect(t.release).toHaveBeenCalledTimes(1); // lỗi khác
  });

  it('KHÔNG có "deleted" ở bất kỳ câu query nào (append-only)', async () => {
    const t = setup(oneLeaveOneEnter());
    await t.service.pairBatch();
    const allSql = [
      ...t.batchQuery.mock.calls.map((c: any[]) => String(c[0])),
      ...t.qrQuery.mock.calls.map((c: any[]) => String(c[0])),
    ].join(' | ');
    expect(allSql.toLowerCase()).not.toContain('deleted');
  });

  it('pairForLeaveLog(id, manager) — dùng manager caller, KHÔNG tự tạo transaction', async () => {
    const t = setup(oneLeaveOneEnter());
    const managerQuery = jest.fn((sql: string) => {
      if (sql.includes('direction = $2'))
        return Promise.resolve([
          { id: 'L1', user_id: 'u1', access_time: LEAVE_T },
        ]);
      if (sql.includes('ORDER BY access_time DESC'))
        return Promise.resolve([{ id: 'E1', access_time: ENTER_T }]);
      return Promise.resolve(undefined);
    });
    const outcome = await t.service.pairForLeaveLog('L1', {
      query: managerQuery,
    } as never);
    expect(outcome).toBe('paired');
    // Không tự tạo queryRunner khi có manager của caller.
    expect(t.commit).not.toHaveBeenCalled();
    expect(t.release).not.toHaveBeenCalled();
    expect(managerQuery).toHaveBeenCalled();
  });

  it('list rỗng (batch []) → scanned=0, không tạo transaction', async () => {
    const t = setup({ batch: [] });
    const r = await t.service.pairBatch();
    expect(r).toEqual({ scanned: 0, paired: 0, skipped: 0 });
    expect(t.commit).not.toHaveBeenCalled();
  });
});
