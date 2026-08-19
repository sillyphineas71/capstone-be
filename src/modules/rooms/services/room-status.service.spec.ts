/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { RoomStatusService } from './room-status.service.js';

describe('RoomStatusService (RMS-001 / UC-36+38)', () => {
  let service: RoomStatusService;
  let dsMock: any;

  const row = (over: any = {}) => ({
    room_id: 'r1',
    room_code: 'R101',
    room_name: 'Phòng 101',
    current_status: 'occupied',
    occupancy_count: 5,
    last_presence_at: '2026-06-16T09:00:00Z',
    booking_id: 'bk1',
    meeting_id: 'mt1',
    title: 'Sprint',
    host_name: 'Nguyễn Văn A',
    reserved_start_time: '2026-06-16T08:00:00Z',
    reserved_end_time: '2026-06-16T10:00:00Z',
    no_show_status: null,
    ...over,
  });

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [RoomStatusService, { provide: DataSource, useValue: dsMock }],
    }).compile();
    service = module.get(RoomStatusService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── LIST (UC-36) ───
  it('list: map đúng field UC-36 + soft-delete filter trong SQL', async () => {
    dsMock.manager.query.mockResolvedValue([row(), row({ room_id: 'r2' })]);
    const r = await service.getRealtimeStatus({});
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      roomId: 'r1',
      roomCode: 'R101',
      roomName: 'Phòng 101',
      currentStatus: 'occupied',
      currentBooking: {
        meetingId: 'mt1',
        meetingTitle: 'Sprint',
        hostName: 'Nguyễn Văn A',
        reservedEndTime: '2026-06-16T10:00:00Z',
      },
      occupancyCount: 5,
      noShowStatus: null,
      lastPresenceAt: '2026-06-16T09:00:00Z',
    });
    const sql = String(dsMock.manager.query.mock.calls[0][0]);
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('LATERAL');
  });

  // ─── [FIX 2026-08-19] computeCurrentStatus: real-time thay vi doc thang r.current_status ───
  it('list: administrative_status=maintenance thang occupancy → currentStatus=maintenance', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ administrative_status: 'maintenance', occupancy_count: 5 }),
    ]);
    const r = await service.getRealtimeStatus({});
    expect(r[0].currentStatus).toBe('maintenance');
  });

  it('list: co booking hien tai nhung chua co occupancy → currentStatus=reserved', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ occupancy_count: 0, booking_id: 'bk1' }),
    ]);
    const r = await service.getRealtimeStatus({});
    expect(r[0].currentStatus).toBe('reserved');
  });

  it('list: khong booking, khong occupancy → currentStatus=available (khong con "dinh" occupied)', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ occupancy_count: 0, booking_id: null }),
    ]);
    const r = await service.getRealtimeStatus({});
    expect(r[0].currentStatus).toBe('available');
  });

  it('list: filter siteName/areaName → bind params', async () => {
    dsMock.manager.query.mockResolvedValue([]);
    await service.getRealtimeStatus({ siteName: 'Tòa A', areaName: 'Tầng 3' });
    expect(dsMock.manager.query.mock.calls[0][1]).toEqual(['Tòa A', 'Tầng 3']);
  });

  it('list: không filter → params null', async () => {
    dsMock.manager.query.mockResolvedValue([]);
    await service.getRealtimeStatus({});
    expect(dsMock.manager.query.mock.calls[0][1]).toEqual([null, null]);
  });

  it('list: occupancyCount null khi không có event; currentBooking null', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ occupancy_count: null, last_presence_at: null, booking_id: null }),
    ]);
    const r = await service.getRealtimeStatus({});
    expect(r[0].occupancyCount).toBeNull();
    expect(r[0].lastPresenceAt).toBeNull();
    expect(r[0].currentBooking).toBeNull();
  });

  // ─── DETAIL (UC-38) ───
  it('detail: map đúng field UC-38 (KHÔNG roomName) + no-show defer', async () => {
    dsMock.manager.query.mockResolvedValue([row()]);
    const r = await service.getRoomStatus('r1');
    expect(r).toEqual({
      roomId: 'r1',
      roomCode: 'R101',
      currentStatus: 'occupied',
      currentBooking: {
        bookingId: 'bk1',
        meetingId: 'mt1',
        title: 'Sprint',
        hostName: 'Nguyễn Văn A',
        reservedStartTime: '2026-06-16T08:00:00Z',
        reservedEndTime: '2026-06-16T10:00:00Z',
      },
      noShowCase: null,
      noShowStatus: null,
      releaseHistory: [],
      lastPresenceAt: '2026-06-16T09:00:00Z',
      occupancyCount: 5,
    });
    expect(r).not.toHaveProperty('roomName');
  });

  // ─── NO-SHOW STATUS (Q3): nối dữ liệu thật thay hardcode null ───
  it('list: noShowStatus lấy detection_status của case mới nhất theo booking', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ no_show_status: 'risk' }),
      row({ room_id: 'r2', no_show_status: 'confirmed' }),
    ]);
    const r = await service.getRealtimeStatus({});
    expect(r[0].noShowStatus).toBe('risk');
    expect(r[1].noShowStatus).toBe('confirmed');
  });

  it('list: SQL join no_show_cases theo cb.booking_id, lấy bản mới nhất', async () => {
    dsMock.manager.query.mockResolvedValue([]);
    await service.getRealtimeStatus({});
    const sql = String(dsMock.manager.query.mock.calls[0][0]);
    expect(sql).toContain('no_show_cases');
    expect(sql).toContain('ns.booking_id = cb.booking_id');
    expect(sql).toContain('ORDER BY ns.detected_at DESC');
    // nsc PHẢI đứng sau cb (LATERAL chỉ tham chiếu được bảng khai trước nó).
    expect(sql.indexOf(') cb ON true')).toBeLessThan(
      sql.indexOf(') nsc ON true'),
    );
  });

  it('list: phòng không có booking đang chạy → noShowStatus null', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ booking_id: null, no_show_status: null }),
    ]);
    const r = await service.getRealtimeStatus({});
    expect(r[0].noShowStatus).toBeNull();
  });

  it('detail: noShowStatus có giá trị thật, noShowCase vẫn null (defer #31)', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ no_show_status: 'released' }),
    ]);
    const r = await service.getRoomStatus('r1');
    expect(r.noShowStatus).toBe('released');
    expect(r.noShowCase).toBeNull();
  });

  it('detail: 404 ROOM_NOT_FOUND khi không tồn tại/soft-deleted', async () => {
    dsMock.manager.query.mockResolvedValue([]);
    await expect(service.getRoomStatus('r1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('detail: occupancyCount/lastPresence null + currentBooking null', async () => {
    dsMock.manager.query.mockResolvedValue([
      row({ occupancy_count: null, last_presence_at: null, booking_id: null }),
    ]);
    const r = await service.getRoomStatus('r1');
    expect(r.occupancyCount).toBeNull();
    expect(r.lastPresenceAt).toBeNull();
    expect(r.currentBooking).toBeNull();
  });
});
