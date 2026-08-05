/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { NotFoundException } from '@nestjs/common';
import { DeviceEventSnapshotService } from './device-event-snapshot.service.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const MEDIA_ID = '22222222-2222-4222-8222-222222222222';

describe('DeviceEventSnapshotService (F-F)', () => {
  let service: DeviceEventSnapshotService;
  let dsMock: any;
  let storageMock: any;

  const wire = (
    over: {
      event?: Array<{ snapshot_file_id: string | null }>;
      media?: Array<{
        storage_key: string;
        mime_type: string;
        file_name: string;
      }>;
    } = {},
  ) => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM iot_device_events'))
        return Promise.resolve(over.event ?? [{ snapshot_file_id: MEDIA_ID }]);
      if (sql.includes('FROM media_files'))
        return Promise.resolve(
          over.media ?? [
            {
              storage_key: 'stranger-snapshots/x.jpg',
              mime_type: 'image/jpeg',
              file_name: 'x.jpg',
            },
          ],
        );
      return Promise.resolve([]);
    });
  };

  beforeEach(() => {
    dsMock = { manager: { query: jest.fn() } };
    storageMock = {
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('IMG')),
    };
    service = new DeviceEventSnapshotService(dsMock, storageMock);
  });

  it('event có snapshot_file_id + media tồn tại → trả buffer/mimeType/fileName', async () => {
    wire();
    const result = await service.getSnapshot(EVENT_ID);
    expect(storageMock.downloadFile).toHaveBeenCalledWith(
      'stranger-snapshots/x.jpg',
    );
    expect(result).toEqual({
      buffer: Buffer.from('IMG'),
      mimeType: 'image/jpeg',
      fileName: 'x.jpg',
    });
  });

  it('event không tồn tại → NotFoundException, KHÔNG gọi storage', async () => {
    wire({ event: [] });
    await expect(service.getSnapshot(EVENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storageMock.downloadFile).not.toHaveBeenCalled();
  });

  it('event tồn tại nhưng snapshot_file_id null → NotFoundException', async () => {
    wire({ event: [{ snapshot_file_id: null }] });
    await expect(service.getSnapshot(EVENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storageMock.downloadFile).not.toHaveBeenCalled();
  });

  it('snapshot_file_id có nhưng media_files row bị xoá/mất → NotFoundException', async () => {
    wire({ media: [] });
    await expect(service.getSnapshot(EVENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storageMock.downloadFile).not.toHaveBeenCalled();
  });

  it('bind eventId đúng tham số cho query đầu tiên (SEC-03)', async () => {
    wire();
    await service.getSnapshot(EVENT_ID);
    expect(dsMock.manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM iot_device_events'),
      [EVENT_ID],
    );
    expect(dsMock.manager.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM media_files'),
      [MEDIA_ID],
    );
  });
});
