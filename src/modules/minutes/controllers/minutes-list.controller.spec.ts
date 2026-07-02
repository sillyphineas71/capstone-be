import { MeetingMinutesListController } from './minutes-list.controller.js';
import { MinutesService } from '../services/minutes.service.js';
import { MinutesListItemDto } from '../dto/minutes-list-item.dto.js';
import { MinutesMeetingSummaryDto } from '../dto/minutes-meeting-summary.dto.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';
import { MeetingMinutesStatus } from '../entities/meeting-minutes.entity.js';
import { MeetingMode } from '../../meetings/entities/meeting.entity.js';
import { MinutesQueryDto } from '../dto/minutes-query.dto.js';

describe('MeetingMinutesListController', () => {
  let controller: MeetingMinutesListController;
  let minutesService: { findMinutesList: jest.Mock };

  const currentUser = { userId: 'user-1' };

  const sampleItem = new MinutesListItemDto(
    'minutes-1',
    'Bien ban hop A',
    MeetingMinutesStatus.PUBLISHED,
    1,
    new Date('2026-07-01T00:00:00Z'),
    new MinutesMeetingSummaryDto(
      'meeting-1',
      'Sprint Planning',
      new Date('2026-06-30T09:00:00Z'),
      new Date('2026-06-30T10:00:00Z'),
      MeetingMode.OFFLINE,
      null,
    ),
    new UserSummaryDto('host-1', 'Nguyen Van A', 'a@company.com'),
  );

  beforeEach(() => {
    minutesService = {
      findMinutesList: jest.fn().mockResolvedValue({
        items: [sampleItem],
        total: 1,
        page: 1,
        limit: 20,
      }),
    };
    controller = new MeetingMinutesListController(
      minutesService as unknown as MinutesService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('gọi MinutesService.findMinutesList với query + currentUser và bọc response chuẩn', async () => {
    const query: MinutesQueryDto = { status: 'published' };

    const result = await controller.findAll(query, currentUser);

    expect(minutesService.findMinutesList).toHaveBeenCalledWith(query, {
      userId: 'user-1',
    });
    expect(result).toEqual({
      success: true,
      message: 'Danh sách biên bản họp',
      data: [sampleItem],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('trả totalPages=0 khi danh sách rỗng', async () => {
    minutesService.findMinutesList.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    const result = await controller.findAll({}, currentUser);

    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    expect(result.data).toEqual([]);
  });

  it('tính đúng totalPages khi total không chia hết cho limit', async () => {
    minutesService.findMinutesList.mockResolvedValue({
      items: [sampleItem],
      total: 41,
      page: 1,
      limit: 20,
    });

    const result = await controller.findAll({}, currentUser);

    expect(result.meta.totalPages).toBe(3);
  });
});
