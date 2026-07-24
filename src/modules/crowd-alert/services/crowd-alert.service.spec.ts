/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { CrowdAlertService } from './crowd-alert.service.js';

describe('CrowdAlertService (ACR-001 / UC-121)', () => {
  let service: CrowdAlertService;
  let presenceRepo: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let configRepo: any;
  let dataSourceMock: any;

  const rule = (over: any = {}): any => ({
    id: 'rule-1',
    alertType: 'crowd',
    zoneId: 'zone-1',
    threshold: 25,
    ...over,
  });

  const event = (over: any = {}): any => ({
    id: 'evt-1',
    occupancyCount: 30,
    eventTime: new Date('2026-07-23T08:00:00Z'),
    ...over,
  });

  const build = () => {
    presenceRepo = { find: jest.fn().mockResolvedValue([]) };
    alertRulesMock = {
      list: jest.fn().mockResolvedValue({ items: [], meta: {} }),
    };
    alertsMock = { recordAlert: jest.fn().mockResolvedValue({ isNew: true }) };
    configRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve(x)),
    };
    dataSourceMock = { getRepository: jest.fn(() => configRepo) };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrowdAlertService,
        {
          provide: getRepositoryToken(ZonePresenceEventEntity),
          useValue: presenceRepo,
        },
        { provide: AlertRulesService, useValue: alertRulesMock },
        { provide: AlertsService, useValue: alertsMock },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    service = module.get(CrowdAlertService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  describe('evaluateCrowdAlerts', () => {
    it('occupancyCount > threshold → gọi recordAlert đúng payload', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 30 })]);

      const result = await service.evaluateCrowdAlerts();

      expect(alertsMock.recordAlert).toHaveBeenCalledWith({
        alertType: 'crowd',
        zoneId: 'zone-1',
        ruleId: 'rule-1',
        payloadJson: {
          occupancyCount: 30,
          threshold: 25,
          sourceEventId: 'evt-1',
          occurredAt: '2026-07-23T08:00:00.000Z',
        },
      });
      expect(result.violationsFound).toBe(1);
      expect(result.eventsChecked).toBe(1);
      expect(result.zonesScanned).toBe(1);
    });

    it('occupancyCount <= threshold → KHÔNG gọi recordAlert', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 25 })]);

      const result = await service.evaluateCrowdAlerts();

      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
      expect(result.violationsFound).toBe(0);
    });

    it('occupancyCount == threshold (biên, dùng >) → KHÔNG coi là vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: 30 })],
        meta: {},
      });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 30 })]);

      await service.evaluateCrowdAlerts();
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('bỏ qua rule threshold=NULL (chưa cấu hình ngưỡng)', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: null })],
        meta: {},
      });

      const result = await service.evaluateCrowdAlerts();
      expect(result.zonesScanned).toBe(0);
      expect(presenceRepo.find).not.toHaveBeenCalled();
    });

    it('bỏ qua rule zoneId=NULL (toàn khuôn viên)', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ zoneId: null })],
        meta: {},
      });

      const result = await service.evaluateCrowdAlerts();
      expect(result.zonesScanned).toBe(0);
    });

    it('watermark cập nhật đúng giá trị lớn nhất đã xử lý', async () => {
      configRepo.findOne.mockResolvedValue({
        configGroup: 'crowd_alert',
        configKey: 'crowd_alert.count_event_watermark',
        configValue: '2026-07-23T07:00:00.000Z',
      });
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      const olderEvent = event({
        id: 'evt-1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      });
      const newerEvent = event({
        id: 'evt-2',
        eventTime: new Date('2026-07-23T09:00:00Z'),
      });
      presenceRepo.find.mockResolvedValue([olderEvent, newerEvent]);

      await service.evaluateCrowdAlerts();

      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          configValue: new Date('2026-07-23T09:00:00Z').toISOString(),
        }),
      );
    });

    it('watermark lần đầu (chưa có dòng) → tự lưu lại (KHÔNG quét lùi lịch sử)', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      configRepo.findOne.mockResolvedValue(null);

      await service.evaluateCrowdAlerts();

      const savedCalls = configRepo.save.mock.calls.map((c: any[]) => c[0]);
      expect(
        savedCalls.some(
          (s: any) => s.configKey === 'crowd_alert.count_event_watermark',
        ),
      ).toBe(true);
      const where = presenceRepo.find.mock.calls[0][0].where;
      expect(where.eventTime).toBeDefined();
    });

    it('watermark đã có dòng hợp lệ → dùng lại giá trị đó, UPDATE dòng cũ khi lưu (KHÔNG tạo dòng mới)', async () => {
      const existingRow = {
        configGroup: 'crowd_alert',
        configKey: 'crowd_alert.count_event_watermark',
        configValue: '2026-07-01T00:00:00.000Z',
      };
      configRepo.findOne.mockResolvedValue(existingRow);
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 30 })]);

      await service.evaluateCrowdAlerts();

      expect(configRepo.create).not.toHaveBeenCalled();
      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ configKey: existingRow.configKey }),
      );
    });
  });

  describe('loadZoneScopedCrowdRules (private, test qua evaluateCrowdAlerts)', () => {
    it('loại đúng rule zoneId=NULL VÀ threshold=NULL, giữ lại rule hợp lệ', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({ id: 'r1', zoneId: null }),
          rule({ id: 'r2', threshold: null }),
          rule({ id: 'r3', zoneId: 'zone-3', threshold: 10 }),
        ],
        meta: {},
      });
      presenceRepo.find.mockResolvedValue([]);

      const result = await service.evaluateCrowdAlerts();
      expect(result.zonesScanned).toBe(1);
    });
  });
});
