/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { EventEmitter } from 'events';
import { createReadStream } from 'fs';
import { MediaFilesController } from './media-files.controller.js';

jest.mock('fs', () => ({ createReadStream: jest.fn() }));
const createReadStreamMock = createReadStream as unknown as jest.Mock;

class FakeStream extends EventEmitter {
  pipe = jest.fn();
}

function fakeRes() {
  return {
    headersSent: false,
    setHeader: jest.fn(),
    writeHead: jest.fn(),
    status: jest.fn().mockReturnThis(),
    end: jest.fn(),
  } as any;
}

describe('MediaFilesController.playback (REC-006)', () => {
  let controller: MediaFilesController;
  let serviceMock: any;
  let storageServiceMock: any;
  let stream: FakeStream;

  beforeEach(() => {
    serviceMock = {
      resolvePlayback: jest.fn().mockResolvedValue({
        path: '/rec/f1.mp4',
        size: 1000,
        mimeType: 'video/mp4',
      }),
    };
    controller = new MediaFilesController(storageServiceMock, serviceMock);
    stream = new FakeStream();
    createReadStreamMock.mockReturnValue(stream);
  });

  afterEach(() => jest.clearAllMocks());

  it('không Range → 200 full + Accept-Ranges + Content-Type + pipe', async () => {
    const res = fakeRes();
    await controller.playback('f1', { headers: {} }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Length': 1000 });
    expect(createReadStreamMock).toHaveBeenCalledWith('/rec/f1.mp4');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('Range hợp lệ → 206 + Content-Range + Content-Length đoạn', async () => {
    const res = fakeRes();
    await controller.playback('f1', { headers: { range: 'bytes=0-99' } }, res);
    expect(res.writeHead).toHaveBeenCalledWith(206, {
      'Content-Range': 'bytes 0-99/1000',
      'Content-Length': 100,
    });
    expect(createReadStreamMock).toHaveBeenCalledWith('/rec/f1.mp4', {
      start: 0,
      end: 99,
    });
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('Range mở (bytes=500-) → end=size-1', async () => {
    const res = fakeRes();
    await controller.playback('f1', { headers: { range: 'bytes=500-' } }, res);
    expect(res.writeHead).toHaveBeenCalledWith(206, {
      'Content-Range': 'bytes 500-999/1000',
      'Content-Length': 500,
    });
  });

  it('suffix Range (bytes=-100) → 206 N byte cuối', async () => {
    const res = fakeRes();
    await controller.playback('f1', { headers: { range: 'bytes=-100' } }, res);
    expect(res.writeHead).toHaveBeenCalledWith(206, {
      'Content-Range': 'bytes 900-999/1000',
      'Content-Length': 100,
    });
    expect(createReadStreamMock).toHaveBeenCalledWith('/rec/f1.mp4', {
      start: 900,
      end: 999,
    });
  });

  it('Range end vượt size (bytes=0-99999999) → 206 clamp end, KHÔNG 416', async () => {
    const res = fakeRes();
    await controller.playback(
      'f1',
      { headers: { range: 'bytes=0-99999999' } },
      res,
    );
    expect(res.writeHead).toHaveBeenCalledWith(206, {
      'Content-Range': 'bytes 0-999/1000',
      'Content-Length': 1000,
    });
  });

  it('Range vượt size → 416 + Content-Range */size', async () => {
    const res = fakeRes();
    await controller.playback(
      'f1',
      { headers: { range: 'bytes=5000-6000' } },
      res,
    );
    expect(res.writeHead).toHaveBeenCalledWith(416, {
      'Content-Range': 'bytes */1000',
    });
    expect(res.end).toHaveBeenCalled();
    expect(createReadStreamMock).not.toHaveBeenCalled();
  });

  it('Range malformed → 416', async () => {
    const res = fakeRes();
    await controller.playback('f1', { headers: { range: 'bytes=abc' } }, res);
    expect(res.writeHead).toHaveBeenCalledWith(416, {
      'Content-Range': 'bytes */1000',
    });
    expect(createReadStreamMock).not.toHaveBeenCalled();
  });

  it('stream error trước khi gửi xong → 500, KHÔNG lộ path', async () => {
    const res = fakeRes();
    await controller.playback('f1', { headers: {} }, res);
    stream.emit('error', new Error('/secret/path ENOENT'));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('MediaFilesController list/detail/visibility (REC-006)', () => {
  let controller: MediaFilesController;
  let serviceMock: any;
  let storageServiceMock: any;

  beforeEach(() => {
    serviceMock = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'f1' }], meta: { total: 1 } }),
      detail: jest.fn().mockResolvedValue({ id: 'f1', checksum: 'x' }),
      setVisibility: jest
        .fn()
        .mockResolvedValue({ fileId: 'f1', isActive: false }),
    };
    controller = new MediaFilesController(storageServiceMock, serviceMock);
  });

  it('list → data + meta', async () => {
    const r = await controller.list('m1', { page: 1 });
    expect(serviceMock.list).toHaveBeenCalledWith('m1', { page: 1 });
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.meta).toEqual({ total: 1 });
  });

  it('detail → data', async () => {
    const r = await controller.detail('f1');
    expect(serviceMock.detail).toHaveBeenCalledWith('f1');
    expect(r.data).toMatchObject({ id: 'f1' });
  });

  it('visibility → data', async () => {
    const r = await controller.setVisibility('f1', { action: 'hide' });
    expect(serviceMock.setVisibility).toHaveBeenCalledWith('f1', {
      action: 'hide',
    });
    expect(r.data).toMatchObject({ isActive: false });
  });
});
