import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { RoomSearchService } from '../services/room-search.service.js';

describe('RoomSearchService', () => {
  let service: RoomSearchService;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let queryMock: jest.Mock;

  const mockRoomRow = {
    id: 'r1',
    room_code: 'R301',
    room_name: 'Phong hop 301',
    site_name: 'Toa A',
    area_name: 'Tang 3',
    location_description: null,
    capacity: 12,
    room_type: 'meeting_room',
    current_status: 'available',
    has_camera: true,
    has_microphone: false,
    has_display: false,
    allow_recording: false,
    faulty_count: '0',
    warning_count: '0',
  };

  beforeEach(async () => {
    queryMock = jest.fn();
    dataSource = {
      manager: { query: queryMock } as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomSearchService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<RoomSearchService>(RoomSearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return all active rooms when no filter is provided (AF-1)', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow]) // SELECT
      .mockResolvedValueOnce([{ count: '1' }]); // COUNT

    const result = await service.search({ page: 1, limit: 50 });

    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].roomId).toBe('r1');
    expect(result.rooms[0].roomCode).toBe('R301');
    expect(result.meta.total).toBe(1);
    expect(result.meta.appliedFilters).toEqual({});

    // Verify WHERE clause always excludes inactive/soft-deleted rooms
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('r.is_active = true');
    expect(sql).toContain('r.deleted_at IS NULL');
    expect(params).toEqual([null, null, null, null, 50, 0]);
  });

  it('should combine capacityMin + capacityMax + areaName + onlyAvailable with AND', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '1' }]);

    await service.search({
      capacityMin: 8,
      capacityMax: 15,
      areaName: 'Tang 3',
      onlyAvailable: true,
      page: 1,
      limit: 50,
    });

    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([8, 15, 'Tang 3', true, 50, 0]);
  });

  it('should return empty rooms array when nothing matches (E1)', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }]);

    const result = await service.search({
      capacityMin: 1000,
      page: 1,
      limit: 50,
    });

    expect(result.rooms).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('should throw BadRequestException when capacityMin > capacityMax', async () => {
    await expect(
      service.search({ capacityMin: 20, capacityMax: 10 } as any),
    ).rejects.toThrow(BadRequestException);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('should not expose internal operational fields in the mapped item', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });

    expect(result.rooms[0]).not.toHaveProperty('occupancyCount');
    expect(result.rooms[0]).not.toHaveProperty('lastPresenceAt');
    expect(result.rooms[0]).not.toHaveProperty('noShowStatus');
    expect(result.rooms[0]).not.toHaveProperty('currentBooking');
  });

  it('should compute pagination meta correctly', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '105' }]);

    const result = await service.search({ page: 2, limit: 50 });

    expect(result.meta.page).toBe(2);
    expect(result.meta.limit).toBe(50);
    expect(result.meta.total).toBe(105);
    expect(result.meta.totalPages).toBe(3);
    // offset = (page-1)*limit = 50
    const [, params] = queryMock.mock.calls[0];
    expect(params[5]).toBe(50);
  });
});
