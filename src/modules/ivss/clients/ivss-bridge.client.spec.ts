/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { IvssBridgeClient } from './ivss-bridge.client.js';

jest.mock('http');
jest.mock('https');
const reqMock = http.request as unknown as jest.Mock;
const httpsReqMock = https.request as unknown as jest.Mock;

const DEPS = {
  baseUrl: 'http://localhost:8088',
  token: 'sekret',
  timeoutMs: 8000,
};

type Scn =
  | { text: string; status?: number }
  | { err: string }
  | { timeout: true };

const calls: Array<{ options: any; body?: Buffer }> = [];
let scenarios: Scn[] = [];

const fakeImpl = (options: any, cb: (res: any) => void) => {
  const idx = calls.length;
  const rec: { options: any; body?: Buffer } = { options };
  calls.push(rec);
  const req: any = new EventEmitter();
  req.setTimeout = (_ms: number, fn: () => void) => {
    req.__to = fn;
  };
  req.write = (b: Buffer) => {
    rec.body = b;
  };
  req.destroy = jest.fn();
  req.end = () => {
    const scn = scenarios[idx] ?? scenarios[scenarios.length - 1];
    process.nextTick(() => {
      if ((scn as any).timeout) {
        req.__to?.();
        return;
      }
      if ((scn as any).err) {
        req.emit('error', new Error((scn as any).err));
        return;
      }
      const res: any = new EventEmitter();
      res.statusCode = (scn as any).status ?? 200;
      cb(res);
      res.emit('data', Buffer.from((scn as any).text));
      res.emit('end');
    });
  };
  return req;
};

const installHttp = () => {
  reqMock.mockImplementation(fakeImpl);
  httpsReqMock.mockImplementation(fakeImpl);
};

describe('IvssBridgeClient (IVS-001 #36)', () => {
  let client: IvssBridgeClient;

  beforeEach(() => {
    calls.length = 0;
    scenarios = [];
    reqMock.mockReset();
    httpsReqMock.mockReset();
    installHttp();
    client = new IvssBridgeClient(DEPS);
  });

  it('status 200 JSON → ok:true + data.connected; gắn header X-Internal-Token', async () => {
    scenarios = [{ text: JSON.stringify({ connected: true }) }];
    const r = await client.status();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.connected).toBe(true);
    expect(calls[0].options.headers['X-Internal-Token']).toBe('sekret');
    expect(calls[0].options.path).toBe('/api/ivss/status');
  });

  it('timeout → BRIDGE_TIMEOUT (KHÔNG throw)', async () => {
    scenarios = [{ timeout: true }];
    const r = await client.status();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BRIDGE_TIMEOUT');
  });

  it('ECONNREFUSED → BRIDGE_UNREACHABLE', async () => {
    scenarios = [{ err: 'connect ECONNREFUSED' }];
    const r = await client.status();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BRIDGE_UNREACHABLE');
  });

  it('HTTP 500 → BRIDGE_HTTP_ERROR + status', async () => {
    scenarios = [{ text: 'err', status: 500 }];
    const r = await client.status();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('BRIDGE_HTTP_ERROR');
      expect(r.error.status).toBe(500);
    }
  });

  it('body non-JSON (200) → BRIDGE_BAD_RESPONSE', async () => {
    scenarios = [{ text: '<html>not json</html>' }];
    const r = await client.status();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BRIDGE_BAD_RESPONSE');
  });

  it('baseUrl rỗng → BRIDGE_UNREACHABLE (URL parse fail, KHÔNG gọi http)', async () => {
    const bad = new IvssBridgeClient({ ...DEPS, baseUrl: '' });
    const r = await bad.status();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BRIDGE_UNREACHABLE');
    expect(calls.length).toBe(0);
  });

  it('createGroup POST → body JSON ghi + path đúng', async () => {
    scenarios = [{ text: JSON.stringify({ groupId: 'g1' }) }];
    const r = await client.createGroup({ name: 'Lobby' });
    expect(r.ok).toBe(true);
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.path).toBe('/api/ivss/groups');
    expect(JSON.parse(calls[0].body!.toString())).toEqual({ name: 'Lobby' });
  });

  it('deleteFace DELETE → method + path đúng', async () => {
    scenarios = [{ text: JSON.stringify({ deleted: true }) }];
    const r = await client.deleteFace({ groupId: 'g1', personUid: 'p1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.deleted).toBe(true);
    expect(calls[0].options.method).toBe('DELETE');
    expect(calls[0].options.path).toBe('/api/ivss/faces');
  });

  it('enrollFace POST → ok', async () => {
    scenarios = [{ text: JSON.stringify({ personUid: 'p1' }) }];
    const r = await client.enrollFace({
      groupId: 'g1',
      personUid: 'p1',
      imageBase64: 'data:image/jpeg;base64,AAAA',
    });
    expect(r.ok).toBe(true);
    expect(calls[0].options.path).toBe('/api/ivss/faces');
  });

  it('https baseUrl → dùng transport https + port mặc định 443', async () => {
    scenarios = [{ text: JSON.stringify({ connected: true }) }];
    const httpsClient = new IvssBridgeClient({
      ...DEPS,
      baseUrl: 'https://ivss.local',
    });
    const r = await httpsClient.status();
    expect(r.ok).toBe(true);
    expect(httpsReqMock).toHaveBeenCalledTimes(1);
    expect(calls[0].options.port).toBe(443);
  });

  it('http baseUrl không port → port mặc định 80', async () => {
    scenarios = [{ text: JSON.stringify({ connected: true }) }];
    const noPort = new IvssBridgeClient({
      ...DEPS,
      baseUrl: 'http://ivss.local',
    });
    const r = await noPort.status();
    expect(r.ok).toBe(true);
    expect(calls[0].options.port).toBe(80);
  });

  it('body rỗng (200) → ok:true data {}', async () => {
    scenarios = [{ text: '' }];
    const r = await client.status();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({});
  });
});
