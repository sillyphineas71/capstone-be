/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import { RecordingReconcileService } from './recording-reconcile.service.js';
import { RecordingProcessManager } from './recording-process-manager.js';
import { RecordingSessionService } from './recording-session.service.js';

jest.mock('fs');
const fsMock = fs as jest.Mocked<typeof fs>;

describe('RecordingReconcileService (REC-004 Part B)', () => {
  let service: RecordingReconcileService;
  let dataSourceMock: any;
  let managerMock: any;
  let sessionServiceMock: any;

  const orphan = (over: any = {}) => ({
    id: 's1',
    meeting_id: 'm1',
    status: 'recording',
    storage_path: '/rec/s1.mp4',
    started_at: new Date(Date.now() - 60000).toISOString(),
    paused_duration_seconds: 0,
    metadata_json: null,
    ...over,
  });

  beforeEach(async () => {
    dataSourceMock = { manager: { query: jest.fn() } };
    managerMock = { has: jest.fn().mockReturnValue(false) };
    sessionServiceMock = {
      finalizeFileToStopped: jest.fn().mockResolvedValue({
        stoppedAt: new Date(),
        durationSeconds: 60,
        fileSizeBytes: '1024',
        mediaFileId: 'media-1',
      }),
    };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 1024 } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingReconcileService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: RecordingProcessManager, useValue: managerMock },
        { provide: RecordingSessionService, useValue: sessionServiceMock },
      ],
    }).compile();
    service = module.get(RecordingReconcileService);
  });

  afterEach(() => jest.clearAllMocks());

  it('recover→stopped: file size>0 → finalizeFileToStopped(recovered:true, userId:null)', async () => {
    dataSourceMock.manager.query.mockResolvedValueOnce([orphan()]);
    await service.onApplicationBootstrap();
    expect(sessionServiceMock.finalizeFileToStopped).toHaveBeenCalledTimes(1);
    const arg = sessionServiceMock.finalizeFileToStopped.mock.calls[0][0];
    expect(arg.recovered).toBe(true);
    expect(arg.userId).toBeNull();
    expect(arg.sessionId).toBe('s1');
  });

  it('recover→failed: file thiếu → UPDATE failed, KHÔNG finalize', async () => {
    fsMock.existsSync.mockReturnValue(false);
    dataSourceMock.manager.query
      .mockResolvedValueOnce([orphan()]) // SELECT
      .mockResolvedValueOnce(undefined); // UPDATE failed
    await service.onApplicationBootstrap();
    expect(sessionServiceMock.finalizeFileToStopped).not.toHaveBeenCalled();
    const updateCall = dataSourceMock.manager.query.mock.calls.find(
      (c: any[]) => String(c[0]).includes('UPDATE recording_sessions'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual(
      expect.arrayContaining(['failed', 'interrupted by restart']),
    );
  });

  it('skip: manager.has=true → không finalize, không UPDATE (chỉ SELECT)', async () => {
    managerMock.has.mockReturnValue(true);
    dataSourceMock.manager.query.mockResolvedValueOnce([orphan()]);
    await service.onApplicationBootstrap();
    expect(sessionServiceMock.finalizeFileToStopped).not.toHaveBeenCalled();
    expect(dataSourceMock.manager.query).toHaveBeenCalledTimes(1);
  });

  it('boot-safe: 1 session throw → vẫn xử lý session khác, không reject', async () => {
    sessionServiceMock.finalizeFileToStopped
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        stoppedAt: new Date(),
        durationSeconds: 10,
        fileSizeBytes: '1',
        mediaFileId: 'm2',
      });
    dataSourceMock.manager.query.mockResolvedValueOnce([
      orphan({ id: 's1' }),
      orphan({ id: 's2' }),
    ]);
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(sessionServiceMock.finalizeFileToStopped).toHaveBeenCalledTimes(2);
  });

  it('idempotent: query WHERE loại trừ stopped_at IS NULL + status active', async () => {
    dataSourceMock.manager.query.mockResolvedValueOnce([]);
    await service.onApplicationBootstrap();
    const selectSql = String(dataSourceMock.manager.query.mock.calls[0][0]);
    expect(selectSql).toContain('stopped_at IS NULL');
    expect(selectSql).toContain("status IN ('starting','recording','paused')");
  });

  it('query lỗi → return, KHÔNG throw (boot-safe)', async () => {
    dataSourceMock.manager.query.mockRejectedValueOnce(new Error('db down'));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
