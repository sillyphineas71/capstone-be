/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { RecordingConfigService } from './recording-config.service.js';
import { RecordingConfigAuditRepository } from '../repositories/recording-config-audit.repository.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';

describe('RecordingConfigService', () => {
  let service: RecordingConfigService;
  let dataSourceMock: any;
  let auditMock: any;
  let authzMock: any;
  let queryRunnerMock: any;

  /** Meeting row mặc định: userId nào cũng KHÔNG phải organizer/host. */
  const meetingRow = (overrides: Partial<Record<string, unknown>> = {}) => [
    { id: 'm1', organizer_id: 'someone-else', host_id: null, ...overrides },
  ];

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
    // Mặc định: role full-scope (SYSTEM_ADMIN) → bỏ qua check Host/Organizer,
    // giữ hành vi các test hiện có (không liên quan bug 7.2) không đổi.
    authzMock = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['SYSTEM_ADMIN'], permissions: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingConfigService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: RecordingConfigAuditRepository, useValue: auditMock },
        { provide: AuthzReadRepository, useValue: authzMock },
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
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue(
        meetingRow(),
      );
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'cfg-exist',
      });
      await expect(service.create('m1', {}, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('400: videoSourceDeviceId không phải ip_camera', async () => {
      (dataSourceMock.manager.query as jest.Mock)
        .mockResolvedValueOnce(meetingRow()) // meeting exists
        .mockResolvedValueOnce([]); // ip_camera check empty
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.create('m1', { videoSourceDeviceId: 'dev-x' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('403: EMPLOYEE không phải Host/Organizer bị chặn', async () => {
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue(
        meetingRow({ organizer_id: 'someone-else', host_id: 'other-host' }),
      );
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      authzMock.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      await expect(service.create('m1', {}, 'random-employee')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('happy: EMPLOYEE là Host của chính meeting đó được phép tạo config', async () => {
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue(
        meetingRow({ organizer_id: 'someone-else', host_id: 'host-employee' }),
      );
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      authzMock.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      const r = await service.create('m1', {}, 'host-employee');
      expect(r.meetingId).toBe('m1');
    });
  });

  describe('findOne', () => {
    it('happy', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'cfg-1',
        meetingId: 'm1',
        status: 'draft',
      });
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue(
        meetingRow(),
      );
      const r = await service.findOne('m1', 'user-1');
      expect(r.id).toBe('cfg-1');
    });

    it('404: chưa có config', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('m1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403: EMPLOYEE không phải Host/Organizer bị chặn khi xem config', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'cfg-1',
        meetingId: 'm1',
        status: 'draft',
      });
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue(
        meetingRow(),
      );
      authzMock.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      await expect(service.findOne('m1', 'random-employee')).rejects.toThrow(
        ForbiddenException,
      );
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
        service.update('m1', { enableVideo: true }, 'user-2'),
      ).rejects.toThrow(ConflictException);
    });

    it('403: EMPLOYEE không phải Host/Organizer bị chặn khi update', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(
        baseConfig(),
      );
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue(
        meetingRow(),
      );
      authzMock.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      await expect(
        service.update('m1', { enableVideo: true }, 'random-employee'),
      ).rejects.toThrow(ForbiddenException);
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
