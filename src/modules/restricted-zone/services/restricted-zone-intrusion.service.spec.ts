/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { RestrictedZoneIntrusionService } from './restricted-zone-intrusion.service.js';

describe('RestrictedZoneIntrusionService (ARZ-001 / UC-124)', () => {
  let service: RestrictedZoneIntrusionService;
  let gateLogRepo: any;
  let presenceRepo: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let configRepo: any;
  let dataSourceMock: any;

  const rule = (over: any = {}) => ({
    id: 'rule-1',
    alertType: 'intrusion',
    zoneId: 'zone-1',
    restrictedHoursJson: null,
    allowedPersonIdsJson: null,
    ...over,
  });

  const build = () => {
    gateLogRepo = { find: jest.fn().mockResolvedValue([]) };
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
        RestrictedZoneIntrusionService,
        {
          provide: getRepositoryToken(GateAccessLogEntity),
          useValue: gateLogRepo,
        },
        {
          provide: getRepositoryToken(ZonePresenceEventEntity),
          useValue: presenceRepo,
        },
        { provide: AlertRulesService, useValue: alertRulesMock },
        { provide: AlertsService, useValue: alertsMock },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    service = module.get(RestrictedZoneIntrusionService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  describe('isViolation (private, test qua evaluateIntrusions)', () => {
    it('trong khung giờ cho phép → KHÔNG vi phạm bất kể userId', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '07:00', allowTo: '18:00' },
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null,
          accessTime: new Date('2026-07-23T10:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(0);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('ngoài khung giờ + userId trong allowlist → KHÔNG vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '07:00', allowTo: '18:00' },
            allowedPersonIdsJson: ['user-ok'],
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: 'user-ok',
          accessTime: new Date('2026-07-23T22:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(0);
    });

    it('ngoài khung giờ + userId NGOÀI allowlist → vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '07:00', allowTo: '18:00' },
            allowedPersonIdsJson: ['user-ok'],
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: 'user-bad',
          accessTime: new Date('2026-07-23T22:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(1);
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          ruleId: 'rule-1',
        }),
      );
    });

    it('ngoài khung giờ + userId NULL (chưa định danh) → LUÔN vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '07:00', allowTo: '18:00' },
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null,
          accessTime: new Date('2026-07-23T22:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(1);
    });

    it('KHÔNG có restrictedHoursJson → hạn chế 24/7, chỉ allowlist mới không vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ allowedPersonIdsJson: ['user-ok'] })],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: 'user-bad',
          accessTime: new Date('2026-07-23T10:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(1);
    });

    it('khung giờ qua đêm (22:00→06:00): 23:59 trong khung → không vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '22:00', allowTo: '06:00' },
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null,
          accessTime: new Date('2026-07-23T23:59:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(0);
    });

    it('khung giờ qua đêm: 00:00 trong khung → không vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '22:00', allowTo: '06:00' },
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null,
          accessTime: new Date('2026-07-23T00:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(0);
    });

    it('khung giờ qua đêm: 12:00 (giữa trưa) NGOÀI khung → vi phạm nếu không trong allowlist', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '22:00', allowTo: '06:00' },
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null,
          accessTime: new Date('2026-07-23T12:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(1);
    });
  });

  // ── DONE: isWithinAllowedHours phải quy đổi giờ VN (Asia/Ho_Chi_Minh), ĐỘC LẬP
  // với TZ runtime của server (KHÔNG dùng Date#getHours() local) ──
  describe('isWithinAllowedHours — quy đổi giờ VN độc lập TZ server', () => {
    it('occurredAt=2026-08-07T05:56:00Z (UTC) → hiểu đúng 12:56 giờ VN, trong khung 08:00-18:00 → KHÔNG vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '08:00', allowTo: '18:00' },
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null, // userId NULL bình thường LUÔN vi phạm — nếu vẫn 0 vi phạm
          // tức nhánh "trong khung giờ" đã thắng, chứng minh quy đổi giờ VN đúng.
          accessTime: new Date('2026-08-07T05:56:00.000Z'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(0);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('case biên: occurredAt=2026-08-06T17:10:00Z (UTC) = 00:10 giờ VN NGÀY KẾ TIẾP (qua đêm 22:00-06:00) → trong khung, KHÔNG vi phạm dù UTC/VN lệch ngày', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '22:00', allowTo: '06:00' },
          }),
        ],
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null,
          // UTC 2026-08-06T17:10:00Z + 7h = 2026-08-07T00:10 giờ VN — ngày VN đã
          // sang 07/08 trong khi ngày UTC vẫn còn 06/08 (lệch ngày).
          accessTime: new Date('2026-08-06T17:10:00.000Z'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(0);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('đối chứng: occurredAt=2026-08-07T05:56:00Z (12:56 VN) nhưng khung 08:00-18:00 KHÔNG áp dụng (rỗng) → userId NULL vẫn vi phạm như thường (nhánh giờ không nuốt hết logic)', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ restrictedHoursJson: null })], // không có khung giờ → hạn chế 24/7
      });
      gateLogRepo.find.mockResolvedValue([
        {
          id: 'log1',
          userId: null,
          accessTime: new Date('2026-08-07T05:56:00.000Z'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.violationsFound).toBe(1);
    });
  });

  describe('loadZoneScopedIntrusionRules (§2.1)', () => {
    it('loại bỏ rule zoneId=NULL (toàn khuôn viên) khỏi tập quét', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({ zoneId: null }),
          rule({ id: 'rule-2', zoneId: 'zone-2' }),
        ],
      });
      const r = await service.evaluateIntrusions();
      expect(r.zonesScanned).toBe(1);
      expect(alertRulesMock.list).toHaveBeenCalledWith(
        expect.objectContaining({ alertType: 'intrusion', enabled: true }),
      );
    });
  });

  describe('watermark (§2.4/R5)', () => {
    it('lần đầu (chưa có dòng system_configs) → khởi tạo watermark = hiện tại, tự lưu lại (KHÔNG quét lùi lịch sử)', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()] });
      await service.evaluateIntrusions();
      // loadWatermark gọi saveWatermark ngay khi thiếu dòng → configRepo.save được gọi
      // (2 lần loadWatermark khởi tạo + 2 lần saveWatermark cuối = tối thiểu 2 lần cho case rỗng)
      expect(configRepo.save).toHaveBeenCalled();
      const savedCalls = configRepo.save.mock.calls.map((c: any[]) => c[0]);
      expect(
        savedCalls.some(
          (s: any) => s.configKey === 'restricted_zone.gate_log_watermark',
        ),
      ).toBe(true);
    });

    it('gateLogRepo.find được gọi với accessTime MoreThan(watermark)', async () => {
      const existing = {
        configGroup: 'restricted_zone_intrusion',
        configKey: 'restricted_zone.gate_log_watermark',
        configValue: '2026-07-01T00:00:00.000Z',
      };
      configRepo.findOne.mockImplementation((opts: any) =>
        Promise.resolve(
          opts.where.configKey === 'restricted_zone.gate_log_watermark'
            ? existing
            : null,
        ),
      );
      alertRulesMock.list.mockResolvedValue({ items: [rule()] });
      await service.evaluateIntrusions();
      const where = gateLogRepo.find.mock.calls[0][0].where;
      expect(where.zoneId).toBe('zone-1');
      expect(where.direction).toBe('enter');
      expect(where.accessTime).toBeDefined();
    });
  });

  describe('presence events (zone_presence_events)', () => {
    it('quét eventType=enter, dùng cùng logic isViolation', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ allowedPersonIdsJson: ['user-ok'] })],
      });
      presenceRepo.find.mockResolvedValue([
        {
          id: 'evt1',
          userId: 'user-bad',
          eventTime: new Date('2026-07-23T10:00:00'),
        },
      ]);
      const r = await service.evaluateIntrusions();
      expect(r.presenceEventsChecked).toBe(1);
      expect(r.violationsFound).toBe(1);
      const where = presenceRepo.find.mock.calls[0][0].where;
      expect(where.eventType).toBe('appear');
    });
  });

  // ── evaluateZoneEventNow — đường TỨC THỜI (bên cạnh cron, KHÔNG thay thế) ──
  describe('evaluateZoneEventNow (đường tức thời)', () => {
    it('vi phạm (ngoài giờ, ngoài allowlist) → recordAlert gọi 1 lần, trả về true', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '07:00', allowTo: '18:00' },
            allowedPersonIdsJson: ['user-ok'],
          }),
        ],
      });
      const eventTime = new Date('2026-07-23T22:00:00');
      const r = await service.evaluateZoneEventNow({
        zoneId: 'zone-1',
        userId: 'user-bad',
        eventTime,
        sourceTable: 'zone_presence_events',
        sourceRowId: 'zpe-1',
      });
      expect(r).toBe(true);
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          ruleId: 'rule-1',
          payloadJson: expect.objectContaining({
            sourceTable: 'zone_presence_events',
            sourceRowId: 'zpe-1',
            userId: 'user-bad',
            occurredAt: eventTime.toISOString(),
          }),
        }),
      );
    });

    it('trong giờ cho phép → KHÔNG vi phạm, recordAlert KHÔNG gọi, trả về false', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({
            restrictedHoursJson: { allowFrom: '07:00', allowTo: '18:00' },
          }),
        ],
      });
      const r = await service.evaluateZoneEventNow({
        zoneId: 'zone-1',
        userId: 'user-any',
        eventTime: new Date('2026-07-23T10:00:00'),
        sourceTable: 'zone_presence_events',
        sourceRowId: 'zpe-2',
      });
      expect(r).toBe(false);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('không có rule intrusion nào active cho zone → KHÔNG vi phạm, trả về false', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [] });
      const r = await service.evaluateZoneEventNow({
        zoneId: 'zone-1',
        userId: 'user-any',
        eventTime: new Date('2026-07-23T22:00:00'),
        sourceTable: 'zone_presence_events',
        sourceRowId: 'zpe-3',
      });
      expect(r).toBe(false);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('gọi alertRulesService.list lọc ĐÚNG zoneId (KHÔNG tải toàn bộ rule rồi lọc JS)', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [] });
      await service.evaluateZoneEventNow({
        zoneId: 'zone-42',
        userId: 'user-any',
        eventTime: new Date('2026-07-23T22:00:00'),
        sourceTable: 'zone_presence_events',
        sourceRowId: 'zpe-4',
      });
      expect(alertRulesMock.list).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'intrusion',
          zoneId: 'zone-42',
          enabled: true,
        }),
      );
    });

    it('dedupe qua recordAlert() có sẵn — GỌI LẠI evaluateZoneEventNow cho CÙNG zone (mô phỏng cron quét lại) → recordAlert vẫn được gọi (bump occurrenceCount), KHÔNG throw, KHÔNG cần cờ chống trùng riêng', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ restrictedHoursJson: null })], // 24/7, không allowlist → luôn vi phạm
      });
      const eventTime = new Date('2026-07-23T22:00:00');
      // Lần 1: đường tức thời
      await service.evaluateZoneEventNow({
        zoneId: 'zone-1',
        userId: 'user-bad',
        eventTime,
        sourceTable: 'zone_presence_events',
        sourceRowId: 'zpe-5',
      });
      // Lần 2: mô phỏng cron quét lại cùng event (watermark chưa kịp vượt qua) —
      // gọi lại recordAlert cho cùng (alertType, zoneId). alertsMock ở đây chỉ
      // verify SỐ LẦN GỌI — hành vi bump-not-duplicate là trách nhiệm CỦA
      // AlertsService.recordAlert() (đã có unique index, test riêng ở
      // alerts.service.spec.ts), KHÔNG phải logic của service này.
      await service.evaluateZoneEventNow({
        zoneId: 'zone-1',
        userId: 'user-bad',
        eventTime,
        sourceTable: 'zone_presence_events',
        sourceRowId: 'zpe-5',
      });
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(2);
      expect(alertsMock.recordAlert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ alertType: 'intrusion', zoneId: 'zone-1' }),
      );
      expect(alertsMock.recordAlert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ alertType: 'intrusion', zoneId: 'zone-1' }),
      );
    });
  });
});
