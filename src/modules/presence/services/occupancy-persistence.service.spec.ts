/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { OccupancyPersistenceService } from './occupancy-persistence.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';

describe('OccupancyPersistenceService (OCC-001 refactor)', () => {
  let service: OccupancyPersistenceService;
  let dataSourceMock: any;
  let qr: any;
  let wsMock: any;
  let bookingRows: any[];
  let roomUpdateRows: any[];

  const input = (over: any = {}) => ({
    roomId: 'room-1',
    meetingId: null,
    occupancyCount: 5,
    confidence: null,
    eventTime: new Date('2026-06-30T09:00:00.000Z'),
    ...over,
  });

  const qrCalled = (needle: string) =>
    qr.query.mock.calls.some((c: any[]) => String(c[0]).includes(needle));

  beforeEach(async () => {
    bookingRows = [{ booking_id: 'bk-1', meeting_id: 'mt-1' }];
    roomUpdateRows = [[{ id: 'room-1' }], 1]; // status đổi.

    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve(bookingRows);
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve(roomUpdateRows);
        return Promise.resolve(undefined);
      }),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSourceMock = { createQueryRunner: jest.fn().mockReturnValue(qr) };
    wsMock = { emitToRoom: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OccupancyPersistenceService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: WebsocketService, useValue: wsMock },
      ],
    }).compile();
    service = module.get(OccupancyPersistenceService);
  });

  afterEach(() => jest.clearAllMocks());

  it('AC-06: count>0 + status đổi → room_events + UPDATE rooms + WS occupancy + status; statusChanged=true', async () => {
    bookingRows = [];
    const r = await service.persist(input({ occupancyCount: 5 }));
    expect(r).toEqual({ statusChanged: true });
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('UPDATE rooms')).toBe(true);
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room-1',
      'room.occupancy.updated',
      expect.objectContaining({ roomId: 'room-1', occupancyCount: 5 }),
    );
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room-1',
      'room.status.updated',
      expect.objectContaining({ status: 'occupied' }),
    );
  });

  it('AC-06b: status KHÔNG đổi (UPDATE trả []) → KHÔNG emit status.updated, vẫn emit occupancy', async () => {
    bookingRows = [];
    roomUpdateRows = [[], 0];
    const r = await service.persist(input());
    expect(r).toEqual({ statusChanged: false });
    const statusEmits = wsMock.emitToRoom.mock.calls.filter(
      (c: any[]) => c[1] === 'room.status.updated',
    );
    expect(statusEmits).toHaveLength(0);
    expect(qrCalled('UPDATE rooms')).toBe(true);
  });

  it('AC-07: count==0 → room_events ghi, KHÔNG UPDATE rooms', async () => {
    bookingRows = [];
    await service.persist(input({ occupancyCount: 0 }));
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('UPDATE rooms')).toBe(false);
  });

  it('AC-08: có booking → presence_snapshots + room_booking_usages', async () => {
    await service.persist(input());
    expect(qrCalled('INSERT INTO presence_snapshots')).toBe(true);
    expect(qrCalled('UPDATE room_booking_usages')).toBe(true);
  });

  it('AC-09: không booking → chỉ room_events (KHÔNG presence/usage)', async () => {
    bookingRows = [];
    await service.persist(input());
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('INSERT INTO presence_snapshots')).toBe(false);
    expect(qrCalled('UPDATE room_booking_usages')).toBe(false);
  });

  it('AC-15: WS lỗi → persist KHÔNG vỡ, transaction đã commit', async () => {
    wsMock.emitToRoom.mockImplementation(() => {
      throw new Error('ws down');
    });
    const r = await service.persist(input());
    expect(r.statusChanged).toBeDefined();
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('LOCKED-A: count âm → BadRequest TRƯỚC transaction (startTransaction KHÔNG gọi)', async () => {
    await expect(
      service.persist(input({ occupancyCount: -1 })),
    ).rejects.toThrow(BadRequestException);
    expect(qr.startTransaction).not.toHaveBeenCalled();
  });

  it('LOCKED-A: count > MAX (1001) → BadRequest', async () => {
    await expect(
      service.persist(input({ occupancyCount: 1001 })),
    ).rejects.toThrow(BadRequestException);
    expect(qr.startTransaction).not.toHaveBeenCalled();
  });

  it('transaction lỗi → rollback + ném', async () => {
    qr.query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO room_events'))
        return Promise.reject(new Error('db boom'));
      return Promise.resolve(undefined);
    });
    await expect(service.persist(input())).rejects.toThrow('db boom');
    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
});
