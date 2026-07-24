/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PersonControlListEntity } from '../entities/person-control-list.entity.js';
import { AlertRulesService } from './alert-rules.service.js';
import { AlertsService } from './alerts.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { PersonWatchlistCheckService } from './person-watchlist-check.service.js';

describe('PersonWatchlistCheckService (PWL-001 / UC-125)', () => {
  let service: PersonWatchlistCheckService;
  let repo: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let notifMock: any;
  let dsMock: any;
  let cfg: Record<string, unknown>;

  const adminRows = [{ id: 'admin1' }];
  const match = (over: any = {}) => ({
    id: 'pcl1',
    userId: 'user-1',
    displayName: 'Nguyễn Văn A',
    listType: 'watchlist',
    reason: 'theo dõi',
    priority: 'medium',
    active: true,
    ...over,
  });

  const build = async () => {
    repo = { findOne: jest.fn().mockResolvedValue(null) };
    alertRulesMock = {
      findEffectiveRule: jest
        .fn()
        .mockResolvedValue({ rule: null, suppressed: false }),
    };
    alertsMock = { recordAlert: jest.fn().mockResolvedValue({ isNew: true }) };
    notifMock = { createNotification: jest.fn().mockResolvedValue({}) };
    dsMock = { manager: { query: jest.fn().mockResolvedValue(adminRows) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonWatchlistCheckService,
        {
          provide: getRepositoryToken(PersonControlListEntity),
          useValue: repo,
        },
        { provide: AlertRulesService, useValue: alertRulesMock },
        { provide: AlertsService, useValue: alertsMock },
        { provide: NotificationsService, useValue: notifMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(PersonWatchlistCheckService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  it('R4: không tìm thấy match (active=true) → no-op, KHÔNG gọi recordAlert/notification', async () => {
    repo.findOne.mockResolvedValue(null);
    await service.checkPersonWatchlist('user-1');
    expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('lookup where: userId + active:true + deletedAt IsNull (KHÔNG dùng faceProfileId)', async () => {
    await service.checkPersonWatchlist('user-1');
    const where = repo.findOne.mock.calls[0][0].where;
    expect(where.userId).toBe('user-1');
    expect(where.active).toBe(true);
    expect(where.deletedAt).toBeDefined();
  });

  it('match + trong throttle window (2 lần liên tiếp) → chỉ recordAlert 1 lần', async () => {
    repo.findOne.mockResolvedValue(match());
    await service.checkPersonWatchlist('user-1');
    await service.checkPersonWatchlist('user-1');
    expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
  });

  it('R6: suppressed=true → KHÔNG gọi recordAlert lẫn notification (AF1)', async () => {
    repo.findOne.mockResolvedValue(match());
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: null,
      suppressed: true,
    });
    await service.checkPersonWatchlist('user-1');
    expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('R5: match hợp lệ → recordAlert với severity=match.priority TRỰC TIẾP (KHÔNG qua bảng mapping)', async () => {
    repo.findOne.mockResolvedValue(match({ priority: 'critical' }));
    await service.checkPersonWatchlist('user-1');
    const input = alertsMock.recordAlert.mock.calls[0][0];
    expect(input.alertType).toBe('person_watchlist_match');
    expect(input.zoneId).toBeNull();
    expect(input.severity).toBe('critical');
    expect(input.payloadJson).toMatchObject({
      personControlListEntryId: 'pcl1',
      userId: 'user-1',
    });
  });

  it('ruleId truyền từ findEffectiveRule khi có rule', async () => {
    repo.findOne.mockResolvedValue(match());
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: { id: 'rule-5' },
      suppressed: false,
    });
    await service.checkPersonWatchlist('user-1');
    expect(alertsMock.recordAlert.mock.calls[0][0].ruleId).toBe('rule-5');
  });

  it('sau recordAlert thành công → gửi notification cho recipients', async () => {
    repo.findOne.mockResolvedValue(match());
    await service.checkPersonWatchlist('user-1');
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe('person_watchlist_match');
    expect(dto.recipientUserIds).toEqual(['admin1']);
  });

  it('recipient rỗng → KHÔNG gọi createNotification, KHÔNG throw', async () => {
    repo.findOne.mockResolvedValue(match());
    dsMock.manager.query.mockResolvedValue([]);
    await expect(
      service.checkPersonWatchlist('user-1'),
    ).resolves.toBeUndefined();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  describe('R7 crux — NotThrow toàn bộ', () => {
    it('lookup (repo.findOne) reject → KHÔNG throw', async () => {
      repo.findOne.mockRejectedValue(new Error('db boom'));
      await expect(
        service.checkPersonWatchlist('user-1'),
      ).resolves.toBeUndefined();
    });

    it('recordAlert reject → KHÔNG throw, KHÔNG gửi notification (lỗi trước bước notification)', async () => {
      repo.findOne.mockResolvedValue(match());
      alertsMock.recordAlert.mockRejectedValue(new Error('db down'));
      await expect(
        service.checkPersonWatchlist('user-1'),
      ).resolves.toBeUndefined();
      expect(notifMock.createNotification).not.toHaveBeenCalled();
    });

    it('createNotification reject → KHÔNG throw', async () => {
      repo.findOne.mockResolvedValue(match());
      notifMock.createNotification.mockRejectedValue(new Error('queue down'));
      await expect(
        service.checkPersonWatchlist('user-1'),
      ).resolves.toBeUndefined();
    });
  });
});
