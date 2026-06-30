/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IvssOccupancyController } from './ivss-occupancy.controller.js';
import { IvssOccupancyIngestService } from '../services/ivss-occupancy-ingest.service.js';
import { IvssInternalTokenGuard } from '../guards/ivss-internal-token.guard.js';
import { OccupancyEventDto } from '../dto/occupancy-event.dto.js';

const body = (): OccupancyEventDto => ({
  type: 'occupancy',
  channelId: 5,
  number: 3,
  utc: '2026-06-30T09:00:00.000Z',
});

describe('IvssOccupancyController (IVSS-OCC-001)', () => {
  let controller: IvssOccupancyController;
  let service: { ingest: jest.Mock };

  beforeEach(async () => {
    service = { ingest: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IvssOccupancyController],
      providers: [{ provide: IvssOccupancyIngestService, useValue: service }],
    })
      .overrideGuard(IvssInternalTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(IvssOccupancyController);
  });

  it('AC-01: token đúng → gọi service.ingest + envelope ack', async () => {
    const dto = body();
    const res = await controller.receiveEvent(dto);
    expect(service.ingest).toHaveBeenCalledWith(dto);
    expect(res).toEqual({
      success: true,
      message: 'IVSS occupancy event accepted',
      data: { accepted: true },
    });
  });

  it('AC-16: service ném → controller nuốt → vẫn ack 200', async () => {
    service.ingest.mockRejectedValue(new Error('boom'));
    const res = await controller.receiveEvent(body());
    expect(res.data).toEqual({ accepted: true });
  });
});

// AC-02/03: guard auth (route dùng IvssInternalTokenGuard) — unit guard.
describe('IvssInternalTokenGuard (auth cho occupancy route)', () => {
  const ctx = (headers: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as any;

  const guardWith = (envToken: string) =>
    new IvssInternalTokenGuard({
      get: jest.fn().mockReturnValue(envToken),
    } as unknown as ConfigService);

  it('AC-02: token sai → 401', () => {
    expect(() =>
      guardWith('right').canActivate(ctx({ 'x-internal-token': 'wrong' })),
    ).toThrow(UnauthorizedException);
  });

  it('AC-03: thiếu token → 401', () => {
    expect(() => guardWith('right').canActivate(ctx({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('token đúng → cho qua', () => {
    expect(
      guardWith('right').canActivate(ctx({ 'x-internal-token': 'right' })),
    ).toBe(true);
  });
});
