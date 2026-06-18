import { RoomCameraController } from './room-camera.controller.js';

describe('RoomCameraController (OCC-001)', () => {
  it('occupancy-snapshots → map req → service.ingest, trả accepted', async () => {
    const serviceMock = {
      ingest: jest.fn().mockResolvedValue({ accepted: true }),
    };
    const controller = new RoomCameraController(serviceMock as never);
    const req = {
      headers: { 'x-device-code': 'CAM-1' },
      body: { roomId: 'room-1', occupancyCount: 3 },
      query: {},
      params: {},
      ip: '127.0.0.1',
    };
    const r = await controller.occupancySnapshot(req as never);
    expect(r).toEqual({ accepted: true });
    expect(serviceMock.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: req.headers,
        body: req.body,
        clientIp: '127.0.0.1',
      }),
    );
  });
});
