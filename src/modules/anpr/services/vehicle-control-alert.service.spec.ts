/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { VehicleControlAlertService } from './vehicle-control-alert.service.js';

describe('VehicleControlAlertService (VCC-001 / UC9)', () => {
  let service: VehicleControlAlertService;
  let controlListMock: any;
  let notifMock: any;
  let dsMock: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let cfg: Record<string, unknown>;

  const adminRows = [{ id: 'admin1' }, { id: 'admin2' }];
  const blocklistMatch = {
    id: 'cl1',
    plateNumber: '30A12345',
    listType: 'blocklist',
    reason: 'stolen',
  };
  const watchlistMatch = {
    id: 'cl2',
    plateNumber: '30A12345',
    listType: 'watchlist',
    reason: null,
  };

  const build = () => {
    controlListMock = { checkControlList: jest.fn().mockResolvedValue(null) };
    notifMock = { createNotification: jest.fn().mockResolvedValue({}) };
    dsMock = {
      manager: { query: jest.fn().mockResolvedValue(adminRows) },
    };
    alertRulesMock = {
      findEffectiveRule: jest
        .fn()
        .mockResolvedValue({ rule: null, suppressed: false }),
    };
    alertsMock = { recordAlert: jest.fn().mockResolvedValue({ isNew: true }) };
    const cfgMock = { get: (k: string, d?: unknown) => cfg[k] ?? d };
    service = new VehicleControlAlertService(
      controlListMock,
      notifMock,
      cfgMock as any,
      dsMock,
      alertRulesMock,
      alertsMock,
    );
  };

  beforeEach(() => {
    cfg = {};
    build();
  });

  const ctx = { channelId: 5, direction: 'enter' };

  it('không match → KHÔNG gọi createNotification', async () => {
    await service.evaluate('30A12345', ctx);
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('blocklist match → createNotification 1 lần, priority HIGH, đúng notificationType + recipient', async () => {
    controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
    await service.evaluate('30A12345', ctx);
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe('vehicle_control_list_match');
    expect(dto.priority).toBe('high');
    expect(dto.channel).toBe('in_app');
    expect(dto.recipientUserIds).toEqual(['admin1', 'admin2']);
    expect(dto.payloadJson).toMatchObject({
      plateNumber: '30A12345',
      listType: 'blocklist',
      reason: 'stolen',
      channelId: 5,
      direction: 'enter',
      controlListEntryId: 'cl1',
    });
  });

  it('watchlist match → priority NORMAL, subject/content khác blocklist', async () => {
    controlListMock.checkControlList.mockResolvedValue(watchlistMatch);
    await service.evaluate('30A12345', ctx);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.priority).toBe('normal');
    expect(dto.subject).not.toBe('Cảnh báo: xe trong danh sách chặn');
    expect(dto.payloadJson.listType).toBe('watchlist');
  });

  describe('throttle theo plate', () => {
    it('2 lần liên tiếp cùng plate trong window → chỉ 1 createNotification', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      await service.evaluate('30A12345', ctx);
      await service.evaluate('30A12345', ctx);
      expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    });

    it('plate khác → KHÔNG bị throttle chéo', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      await service.evaluate('30A12345', ctx);
      controlListMock.checkControlList.mockResolvedValue({
        ...blocklistMatch,
        id: 'cl3',
        plateNumber: '51F99999',
      });
      await service.evaluate('51F99999', ctx);
      expect(notifMock.createNotification).toHaveBeenCalledTimes(2);
    });

    it('qua khỏi throttle window → gọi lại createNotification', async () => {
      cfg = { VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS: 1 }; // 1s cho test nhanh
      build();
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      await service.evaluate('30A12345', ctx);
      nowSpy.mockReturnValue(1_000_000 + 1500); // >1s sau
      await service.evaluate('30A12345', ctx);
      expect(notifMock.createNotification).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });
  });

  it('recipient rỗng → KHÔNG gọi createNotification, KHÔNG throw', async () => {
    controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
    dsMock.manager.query.mockResolvedValue([]);
    await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  describe('NotThrow', () => {
    it('checkControlList reject → evaluate KHÔNG throw', async () => {
      controlListMock.checkControlList.mockRejectedValue(new Error('db boom'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    });

    it('createNotification reject → evaluate KHÔNG throw', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      notifMock.createNotification.mockRejectedValue(new Error('queue down'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    });

    it('resolveRecipients (dataSource.query) reject → evaluate KHÔNG throw', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      dsMock.manager.query.mockRejectedValue(new Error('conn refused'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    });
  });

  describe('ASM-001 (Bước 3 / 3d) — recordAlert wiring', () => {
    it('suppressed=true → KHÔNG gọi recordAlert lẫn createNotification (AF1)', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      alertRulesMock.findEffectiveRule.mockResolvedValue({
        rule: null,
        suppressed: true,
      });
      await service.evaluate('30A12345', ctx);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
      expect(notifMock.createNotification).not.toHaveBeenCalled();
    });

    it('không suppressed → recordAlert gọi TRƯỚC createNotification, severity đúng theo listType', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      const callOrder: string[] = [];
      alertsMock.recordAlert.mockImplementation(() => {
        callOrder.push('recordAlert');
        return Promise.resolve({ isNew: true });
      });
      notifMock.createNotification.mockImplementation(() => {
        callOrder.push('createNotification');
        return Promise.resolve({});
      });
      await service.evaluate('30A12345', ctx);
      expect(callOrder).toEqual(['recordAlert', 'createNotification']);
      const input = alertsMock.recordAlert.mock.calls[0][0];
      expect(input.alertType).toBe('vehicle_control_match');
      expect(input.zoneId).toBeNull();
      expect(input.severity).toBe('high'); // blocklist
      expect(input.payloadJson).toMatchObject({ plateNumber: '30A12345' });
    });

    it('watchlist match → severity medium', async () => {
      controlListMock.checkControlList.mockResolvedValue(watchlistMatch);
      await service.evaluate('30A12345', ctx);
      expect(alertsMock.recordAlert.mock.calls[0][0].severity).toBe('medium');
    });

    it('recordAlert lỗi → NotThrow riêng, createNotification VẪN được gọi', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      alertsMock.recordAlert.mockRejectedValue(new Error('db down'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
      expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    });

    it('ruleId truyền từ findEffectiveRule khi có rule', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      alertRulesMock.findEffectiveRule.mockResolvedValue({
        rule: { id: 'rule-1' },
        suppressed: false,
      });
      await service.evaluate('30A12345', ctx);
      expect(alertsMock.recordAlert.mock.calls[0][0].ruleId).toBe('rule-1');
    });
  });
});
