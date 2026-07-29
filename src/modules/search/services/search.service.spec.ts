/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { IoTDeviceEntity } from '../../iot/entities/iot-device.entity.js';
import { VehicleRegistrationEntity } from '../../anpr/entities/vehicle-registration.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { SearchService } from './search.service.js';

describe('SearchService (SRCH-01)', () => {
  let service: SearchService;
  let authzRepo: any;
  let zoneRepo: any;
  let deviceRepo: any;
  let vehicleRepo: any;
  let userRepo: any;
  let meetingRepo: any;

  const ALL_PERMISSIONS = [
    'zones.zone.read',
    'iot.device.read',
    'anpr.vehicle.admin_read',
    'accounts.user.list',
    'meeting.read.all',
  ];

  const build = () => {
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: ALL_PERMISSIONS }),
    };
    zoneRepo = { find: jest.fn().mockResolvedValue([]) };
    deviceRepo = { find: jest.fn().mockResolvedValue([]) };
    vehicleRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    meetingRepo = { find: jest.fn().mockResolvedValue([]) };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: AuthzReadRepository, useValue: authzRepo },
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
        { provide: getRepositoryToken(IoTDeviceEntity), useValue: deviceRepo },
        {
          provide: getRepositoryToken(VehicleRegistrationEntity),
          useValue: vehicleRepo,
        },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(MeetingEntity), useValue: meetingRepo },
      ],
    }).compile();
    service = module.get(SearchService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  it('R4: type không có permission → loại hẳn khỏi response, KHÔNG query DB cho type đó', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: [],
      permissions: ['zones.zone.read'], // chỉ có quyền zone
    });
    const result = await service.search('user-1', 'test', [
      'zone',
      'device',
      'vehicle',
    ]);
    expect(result.types.map((t) => t.type)).toEqual(['zone']);
    expect(deviceRepo.find).not.toHaveBeenCalled();
    expect(vehicleRepo.find).not.toHaveBeenCalled();
  });

  it('R5: type có permission nhưng không tìm thấy gì → {type, items: []}', async () => {
    zoneRepo.find.mockResolvedValue([]);
    const result = await service.search('user-1', 'test', ['zone']);
    expect(result.types).toEqual([{ type: 'zone', items: [] }]);
  });

  it('R6: searchDevices KHÔNG filter deletedAt (IoTDeviceEntity không soft-delete)', async () => {
    deviceRepo.find.mockResolvedValue([
      { id: 'd1', deviceName: 'Cam 1', deviceCode: 'CAM01' },
    ]);
    const result = await service.search('user-1', 'cam', ['device']);
    const callArg = deviceRepo.find.mock.calls[0][0];
    const whereClauses = callArg.where as Record<string, unknown>[];
    for (const clause of whereClauses) {
      expect(clause.deletedAt).toBeUndefined();
    }
    expect(result.types[0].items).toEqual([
      { type: 'device', id: 'd1', label: 'Cam 1', subtitle: 'CAM01' },
    ]);
  });

  it('R7: searchZones/searchUsers/searchMeetings/searchVehicles PHẢI filter deletedAt IsNull', async () => {
    await service.search('user-1', 'test', ['zone']);
    let where = zoneRepo.find.mock.calls[0][0].where as Record<
      string,
      unknown
    >[];
    for (const clause of where) expect(clause.deletedAt).toBeDefined();

    await service.search('user-1', 'test', ['user']);
    where = userRepo.find.mock.calls[0][0].where as Record<string, unknown>[];
    for (const clause of where) expect(clause.deletedAt).toBeDefined();

    await service.search('user-1', 'test', ['meeting']);
    where = meetingRepo.find.mock.calls[0][0].where as Record<
      string,
      unknown
    >[];
    for (const clause of where) expect(clause.deletedAt).toBeDefined();

    await service.search('user-1', '30a12345', ['vehicle']);
    where = vehicleRepo.find.mock.calls[0][0].where as Record<
      string,
      unknown
    >[];
    for (const clause of where) expect(clause.deletedAt).toBeDefined();
  });

  it('searchVehicles: gọi normalizePlate chuẩn hóa q trước khi ILIKE plateNumber', async () => {
    vehicleRepo.find.mockResolvedValue([
      { id: 'v1', plateRaw: '30A-123.45', vehicleType: 'car' },
    ]);
    const result = await service.search('user-1', '30a-123.45', ['vehicle']);
    expect(result.types[0].items).toEqual([
      { type: 'vehicle', id: 'v1', label: '30A-123.45', subtitle: 'car' },
    ]);
  });

  it('mặc định (không truyền types) → tìm cả 5 loại nếu có đủ permission', async () => {
    const result = await service.search('user-1', 'test', [
      'zone',
      'device',
      'vehicle',
      'user',
      'meeting',
    ]);
    expect(result.types).toHaveLength(5);
  });
});
