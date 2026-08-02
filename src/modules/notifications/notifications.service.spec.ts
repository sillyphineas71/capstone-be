/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationReadStateService } from './services/notification-read-state.service.js';

describe('NotificationsService — inbox + BE-07 mark-read', () => {
  let service: NotificationsService;
  let repo: any;
  let readStateService: jest.Mocked<NotificationReadStateService>;
  let queryBuilder: any;

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      findOne: jest.fn(),
    };

    readStateService = {
      getReadState: jest.fn(),
      computeIsRead: jest.fn(),
      isRead: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    } as unknown as jest.Mocked<NotificationReadStateService>;

    service = new NotificationsService(
      repo,
      {} as any, // queueService (không dùng trong các test này)
      {} as any, // backgroundJobsService
      { get: jest.fn() } as any, // configService
      readStateService,
    );
  });

  describe('listMyNotifications', () => {
    it('gọi getReadState 1 LẦN cho cả trang, map isRead cho từng item qua computeIsRead', async () => {
      const items = [
        {
          id: 'n1',
          notificationType: 't',
          subject: null,
          content: 'c1',
          relatedEntityType: null,
          relatedEntityId: null,
          priority: 'normal',
          createdAt: new Date('2026-07-01'),
        },
        {
          id: 'n2',
          notificationType: 't',
          subject: null,
          content: 'c2',
          relatedEntityType: null,
          relatedEntityId: null,
          priority: 'normal',
          createdAt: new Date('2026-07-02'),
        },
      ];
      queryBuilder.getManyAndCount.mockResolvedValue([items, 2]);
      const state = { readIds: new Set(['n1']), readAllAt: null };
      readStateService.getReadState.mockResolvedValue(state);
      readStateService.computeIsRead.mockImplementation(
        (_s, id) => id === 'n1',
      );

      const result = await service.listMyNotifications('u1', 1, 20);

      expect(readStateService.getReadState).toHaveBeenCalledTimes(1);
      expect(readStateService.getReadState).toHaveBeenCalledWith('u1');
      expect(result.data[0].isRead).toBe(true);
      expect(result.data[1].isRead).toBe(false);
    });
  });

  describe('getMyNotificationDetail', () => {
    it('404 nếu không tồn tại', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getMyNotificationDetail('n1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403 nếu user không phải recipient', async () => {
      repo.findOne.mockResolvedValue({
        id: 'n1',
        recipientUserIdsJson: ['other-user'],
        createdAt: new Date(),
      });
      await expect(service.getMyNotificationDetail('n1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('trả isRead từ readStateService.isRead khi là recipient', async () => {
      const createdAt = new Date('2026-07-10');
      repo.findOne.mockResolvedValue({
        id: 'n1',
        notificationType: 't',
        subject: null,
        content: 'c',
        relatedEntityType: null,
        relatedEntityId: null,
        priority: 'normal',
        recipientUserIdsJson: ['u1'],
        createdAt,
      });
      readStateService.isRead.mockResolvedValue(true);

      const result = await service.getMyNotificationDetail('n1', 'u1');

      expect(readStateService.isRead).toHaveBeenCalledWith(
        'u1',
        'n1',
        createdAt,
      );
      expect(result.isRead).toBe(true);
    });
  });

  describe('markNotificationRead', () => {
    it('kiểm tra recipient (qua getMyNotificationDetail) trước khi ghi Redis', async () => {
      repo.findOne.mockResolvedValue({
        id: 'n1',
        recipientUserIdsJson: ['u1'],
        createdAt: new Date(),
      });
      readStateService.isRead.mockResolvedValue(false);

      await service.markNotificationRead('n1', 'u1');

      expect(readStateService.markRead).toHaveBeenCalledWith('u1', 'n1');
    });

    it('không phải recipient → 403, KHÔNG gọi markRead', async () => {
      repo.findOne.mockResolvedValue({
        id: 'n1',
        recipientUserIdsJson: ['other-user'],
        createdAt: new Date(),
      });

      await expect(service.markNotificationRead('n1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(readStateService.markRead).not.toHaveBeenCalled();
    });
  });

  describe('markAllNotificationsRead', () => {
    it('gọi readStateService.markAllRead với userId', async () => {
      await service.markAllNotificationsRead('u1');
      expect(readStateService.markAllRead).toHaveBeenCalledWith('u1');
    });
  });
});
