import { NotFoundException } from '@nestjs/common';
import { RoomsController } from './rooms.controller.js';

describe('RoomsController (RMS-001)', () => {
  let controller: RoomsController;
  let serviceMock: {
    getRealtimeStatus: jest.Mock;
    getRoomStatus: jest.Mock;
  };

  beforeEach(() => {
    serviceMock = {
      getRealtimeStatus: jest.fn().mockResolvedValue([{ roomId: 'r1' }]),
      getRoomStatus: jest.fn().mockResolvedValue({ roomId: 'r1' }),
    };
    controller = new RoomsController(undefined as never, serviceMock as never);
  });

  it('list → envelope {success,message,data}', async () => {
    const r = await controller.realtimeStatus({ siteName: 'A' });
    expect(serviceMock.getRealtimeStatus).toHaveBeenCalledWith({
      siteName: 'A',
    });
    expect(r.success).toBe(true);
    expect(r.message).toBe('Room realtime status retrieved');
    expect(r.data).toEqual([{ roomId: 'r1' }]);
  });

  it('detail → envelope {success,message,data}', async () => {
    const r = await controller.roomStatus('r1');
    expect(serviceMock.getRoomStatus).toHaveBeenCalledWith('r1');
    expect(r.data).toMatchObject({ roomId: 'r1' });
  });

  it('detail 404 propagate', async () => {
    serviceMock.getRoomStatus.mockRejectedValue(new NotFoundException());
    await expect(controller.roomStatus('r1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
