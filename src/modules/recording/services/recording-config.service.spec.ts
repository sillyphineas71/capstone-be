/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { RecordingConfigService } from './recording-config.service.js';
import { RecordingConfigAuditRepository } from '../repositories/recording-config-audit.repository.js';

describe('RecordingConfigService', () => {
  let service: RecordingConfigService;
  let dataSourceMock: any;
  let auditMock: any;
  let queryRunnerMock: any;

  beforeEach(async () => {
    queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        create: jest.fn((_e, obj) => obj),
        save: jest.fn(async (_e, obj) => ({ id: 'cfg-1', ...obj })),
      },
    };
    dataSourceMock = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunnerMock),
      manager: {
        query: jest.fn(),
        findOne: jest.fn(),
      },
    };
    auditMock = { logConfigChange: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingConfigService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: RecordingConfigAuditRepository, useValue: auditMock },
      ],
    }).compile();

    service = module.get(RecordingConfigService);
  });

  describe('create', () => {
    it('happy: 201, configuredBy set, status draft, audit create', async () => {
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { id: 'm1' },
      ]); // meeting exists
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null); // no existing

      const r = await service.create('m1', { enableVideo: true }, 'user-1');

      expect(r.meetingId).toBe('m1');
      expect(r.enableVideo).toBe(true);
      expect(r.status).toBe('draft');
      expect(r.configuredBy).toBe('user-1');
      expect(auditMock.logConfigChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({ action: 'create', userId: 'user-1' }),
      );
    });

    it('404: meeting không tồn tại', async () => {
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([]);
      await expect(service.create('m1', {}, null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('409: meeting đã có config', async () => {
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { id: 'm1' },
      ]);
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'cfg-exist',
      });
      await expect(service.create('m1', {}, null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('400: videoSourceDeviceId không phải ip_camera', async () => {
      (dataSourceMock.manager.query as jest.Mock)
        .mockResolvedValueOnce([{ id: 'm1' }]) // meeting exists
        .mockResolvedValueOnce([]); // ip_camera check empty
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.create('m1', { videoSourceDeviceId: 'dev-x' }, null),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('happy', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'cfg-1',
        meetingId: 'm1',
        status: 'draft',
      });
      const r = await service.findOne('m1');
      expect(r.id).toBe('cfg-1');
    });

    it('404: chưa có config', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('m1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const baseConfig = () => ({
      id: 'cfg-1',
      meetingId: 'm1',
      enableAudio: false,
      enableVideo: false,
      enableTranscription: false,
      videoSourceDeviceId: null,
      audioSourceMode: null,
      autoStart: false,
      consentRequired: true,
      retentionDays: null,
      status: 'draft',
      configuredBy: null,
      configuredAt: new Date('2026-06-01T00:00:00Z'),
    });

    it('partial: đổi enableVideo, bump configured_*, audit update', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(
        baseConfig(),
      );
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([]); // no active session

      const r = await service.update('m1', { enableVideo: true }, 'user-2');

      expect(r.enableVideo).toBe(true);
      expect(r.configuredBy).toBe('user-2');
      expect(auditMock.logConfigChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({ action: 'update' }),
      );
    });

    it('404: chưa có config', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.update('m1', {}, null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('409: đang ghi (session active)', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(
        baseConfig(),
      );
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { id: 'sess-1' },
      ]);
      await expect(
        service.update('m1', { enableVideo: true }, null),
      ).rejects.toThrow(ConflictException);
    });

    it('idempotent: trùng giá trị → không transaction/audit', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(
        baseConfig(),
      );
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([]);

      const r = await service.update('m1', { enableVideo: false }, null);

      expect(r.enableVideo).toBe(false);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(auditMock.logConfigChange).not.toHaveBeenCalled();
    });
  });
});
