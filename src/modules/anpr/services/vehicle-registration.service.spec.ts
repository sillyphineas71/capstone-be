/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { VehicleRegistrationService } from './vehicle-registration.service.js';

describe('VehicleRegistrationService (VPR-001 / UC1)', () => {
  let service: VehicleRegistrationService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'veh1', ...x })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleRegistrationService,
        {
          provide: getRepositoryToken(VehicleRegistrationEntity),
          useValue: repo,
        },
      ],
    }).compile();
    service = module.get(VehicleRegistrationService);
  });

  it('ok → save với plate_number chuẩn + status active + userId', async () => {
    const r = await service.register('u1', {
      plateRaw: '30A-123.45',
      vehicleType: 'car',
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.plateNumber).toBe('30A12345');
    expect(saved.plateRaw).toBe('30A-123.45');
    expect(saved.status).toBe('active');
    expect(saved.userId).toBe('u1');
    expect(r.id).toBe('veh1');
  });

  it('pre-check trùng (findOne trả row) → ConflictException PLATE_ALREADY_REGISTERED, KHÔNG save', async () => {
    repo.findOne.mockResolvedValue({ id: 'old' });
    await expect(
      service.register('u1', { plateRaw: '30A12345' }),
    ).rejects.toMatchObject({
      response: { code: 'PLATE_ALREADY_REGISTERED' },
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('SEC: message conflict KHÔNG chứa thông tin user khác', async () => {
    repo.findOne.mockResolvedValue({ id: 'old', userId: 'other-user-999' });
    try {
      await service.register('u1', { plateRaw: '30A12345' });
      fail('should throw');
    } catch (e: any) {
      expect(JSON.stringify(e.response)).not.toContain('other-user-999');
      expect(e).toBeInstanceOf(ConflictException);
    }
  });

  it('save ném 23505 (race) → safety-net ConflictException, KHÔNG ném lỗi thô', async () => {
    repo.save.mockRejectedValue({ driverError: { code: '23505' } });
    await expect(
      service.register('u1', { plateRaw: '30A12345' }),
    ).rejects.toMatchObject({ response: { code: 'PLATE_ALREADY_REGISTERED' } });
  });

  it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
    const boom = new Error('db down');
    repo.save.mockRejectedValue(boom);
    await expect(service.register('u1', { plateRaw: '30A12345' })).rejects.toBe(
      boom,
    );
  });

  describe('format validate (OQ-4) → BadRequestException INVALID_PLATE, KHÔNG save', () => {
    const bad: Array<[string, string]> = [
      ['quá ngắn (5)', '30A12'],
      ['quá dài (11)', '30A12345678'],
      ['toàn chữ', 'ABCDEF'],
      ['toàn số', '123456'],
    ];
    it.each(bad)('%s', async (_label, plateRaw) => {
      await expect(service.register('u1', { plateRaw })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('biên hợp lệ: dài 6 và 10 (có cả chữ+số) → save', async () => {
    await service.register('u1', { plateRaw: '12345A' }); // 6
    await service.register('u1', {
      plateRaw: '99MD123456'.slice(0, 10),
    }); // 10
    expect(repo.save).toHaveBeenCalledTimes(2);
  });
});
