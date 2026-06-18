/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { EventEmitter } from 'events';
import * as http from 'http';
import { FaceGateClient } from './facegate.client.js';
import { FaceDeviceError } from '../ports/face-device-provider.port.js';
import { fmtTz } from '../utils/facegate-time.util.js';
import { FaceDeviceProviderFactory } from '../face-device-provider.factory.js';
import {
  encryptSecret,
  decryptSecret,
} from '../../../common/utils/secret-crypto.util.js';

jest.mock('http');
const reqMock = http.request as unknown as jest.Mock;

const DEPS = {
  baseUrl: 'http://192.168.1.222',
  username: 'admin',
  password: 's3cret',
  timeoutMs: 8000,
  tz: 'Asia/Ho_Chi_Minh',
  uploadField: 'vfileselector',
  uploadPollIntervalMs: 0,
  uploadMaxAttempts: 5,
};

// ── Fake transport: mỗi http.request lấy scenario kế tiếp theo thứ tự gọi. ──
type Scn =
  | { text: string; status?: number }
  | { err: string }
  | { timeout: true };

const OK_LOGIN: Scn = { text: 'root.ERR.no=0\nroot.ERR.des=ok' };
const calls: Array<{ options: any; body?: Buffer }> = [];
let scenarios: Scn[] = [];

const installHttp = () => {
  reqMock.mockImplementation((options: any, cb: (res: any) => void) => {
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
          req.__to?.(); // kích hoạt timeout callback → reject('timeout')
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
  });
};

// scenarios cho 1 op (đã login): [OK_LOGIN, ...op]
const withLogin = (...op: Scn[]) => {
  scenarios = [OK_LOGIN, ...op];
};
const opCall = () => calls[calls.length - 1]; // op là call cuối (login đứng trước)
const pathOf = (c: { options: any }) => decodeURIComponent(c.options.path);

beforeEach(() => {
  calls.length = 0;
  scenarios = [];
  reqMock.mockReset();
  installHttp();
});

const FIXTURE_7 = [
  'root.ERR.no=0',
  'root.LIST.rspcount=7',
  'root.LIST.ITEM0.uid=64\nroot.LIST.ITEM0.uname=alice\nroot.LIST.ITEM0.utime=2026-06-17',
  'root.LIST.ITEM1.uid=68\nroot.LIST.ITEM1.uname=carol',
  'root.LIST.ITEM2.uid=70\nroot.LIST.ITEM2.uname=b7f5bba3-2cbc-440a-a2f9-35124d2e13e0',
  'root.LIST.ITEM3.uid=65\nroot.LIST.ITEM3.uname=bob',
  'root.LIST.ITEM4.uid=66\nroot.LIST.ITEM4.uname=dave',
  'root.LIST.ITEM5.uid=67\nroot.LIST.ITEM5.uname=erin',
  'root.LIST.ITEM6.uid=69\nroot.LIST.ITEM6.uname=frank',
].join('\n');

const FACE_REF = { dwfiletype: 0, dwfileindex: 1, dwfilepos: 4259840 };
const addInput = (over: any = {}) => ({
  uname: 'user-1:bk-1',
  faceRef: FACE_REF,
  validFrom: new Date('2026-06-17T01:00:00Z'),
  validTo: new Date('2026-06-17T03:00:00Z'),
  ...over,
});

describe('fmtTz (FGC-001 / E1)', () => {
  it('UTC instant → giờ theo tz thiết bị (UTC+7)', () => {
    const r = fmtTz(new Date('2026-06-17T01:00:00Z'), 'Asia/Ho_Chi_Minh');
    expect(r.dateTime).toBe('2026-06-17 08:00:00');
    expect(r.date).toBe('2026-06-17');
    expect(r.time).toBe('08:00:00');
  });
  it('tz UTC → giữ nguyên', () => {
    expect(fmtTz(new Date('2026-06-17T01:00:00Z'), 'UTC').dateTime).toBe(
      '2026-06-17 01:00:00',
    );
  });
  it('nửa đêm tz → chuẩn hoá về 00:00:00 (không 24:00:00)', () => {
    const r = fmtTz(new Date('2026-06-16T17:00:00Z'), 'Asia/Ho_Chi_Minh');
    expect(r.dateTime).toBe('2026-06-17 00:00:00');
    expect(r.time).toBe('00:00:00');
  });
});

describe('FaceGateClient (FGC-001)', () => {
  let client: FaceGateClient;
  beforeEach(() => {
    client = new FaceGateClient(DEPS);
  });

  // ── parseResponse (pure) ──
  it('parseResponse: ok + map field', () => {
    const r = client.parseResponse('root.ERR.no=0\nroot.LIST.uid=64');
    expect(r.errNo).toBe(0);
    expect(r.root['LIST']['uid']).toBe('64');
  });
  it('parseResponse: errNo từ ERR.no; thiếu → -1; rác bỏ qua', () => {
    expect(client.parseResponse('root.ERR.no=5').errNo).toBe(5);
    expect(client.parseResponse('garbage line\nrandom').errNo).toBe(-1);
  });

  // ── Session: login-first ──
  it('login TRƯỚC op: call[0]=/webs/login group=LOGIN, rồi mới setWhitelist', async () => {
    withLogin({ text: 'root.ERR.no=0' });
    await client.deletePerson('64');
    expect(calls.length).toBe(2);
    expect(pathOf(calls[0])).toContain('/webs/login');
    expect(pathOf(calls[0])).toContain('group=LOGIN');
    expect(pathOf(calls[1])).toContain('/webs/setWhitelist');
  });

  it('login 1 lần cho nhiều op trên cùng client (phiên theo IP)', async () => {
    scenarios = [
      OK_LOGIN,
      { text: 'root.ERR.no=0' },
      { text: 'root.ERR.no=0' },
    ];
    await client.deletePerson('1');
    await client.deletePerson('2');
    const loginCalls = calls.filter((c) =>
      pathOf(c).includes('/webs/login'),
    ).length;
    expect(loginCalls).toBe(1);
    expect(calls.length).toBe(3);
  });

  it('loginTimeout (ERR.no=0) → re-login → retry 1 lần → success', async () => {
    scenarios = [
      OK_LOGIN,
      { text: 'root.ERR.no=0\nroot.ERR.des=loginTimeout' }, // op lần 1
      OK_LOGIN, // re-login
      { text: 'root.ERR.no=0' }, // op retry
    ];
    const r = await client.deletePerson('64');
    expect(r).toEqual({ ok: true });
    expect(calls.length).toBe(4);
    expect(pathOf(calls[2])).toContain('/webs/login'); // re-login
  });

  it('ERR.no=0 + des=loginTimeout KHÔNG tính success (retry vẫn loginTimeout → device_error)', async () => {
    const lt = { text: 'root.ERR.no=0\nroot.ERR.des=loginTimeout' };
    scenarios = [OK_LOGIN, lt, OK_LOGIN, lt];
    await expect(client.deletePerson('64')).rejects.toMatchObject({
      kind: 'device_error',
    });
  });

  it('login thất bại (des != ok) → device_error', async () => {
    scenarios = [{ text: 'root.ERR.no=0\nroot.ERR.des=fail' }];
    await expect(client.deletePerson('1')).rejects.toMatchObject({
      kind: 'device_error',
    });
  });

  // ── addPerson ──
  it('addPerson ok → {ok} + URL action=add, uname encode, validity', async () => {
    withLogin({ text: 'root.ERR.no=0' });
    const r = await client.addPerson(addInput());
    expect(r).toEqual({ ok: true });
    const url = pathOf(opCall());
    expect(url).toContain('action=add');
    expect(url).toContain('LIST.uid=-1');
    expect(url).toContain('LIST.uname=user-1:bk-1');
    expect(url).toContain('CFGIpcJurisdiction.bIPC_Enable0=1');
  });

  it('addPerson E1: validity format theo tz thiết bị (UTC+7)', async () => {
    withLogin({ text: 'root.ERR.no=0' });
    await client.addPerson(addInput());
    const url = pathOf(opCall());
    expect(url).toContain('LIST.uvalidbegintime=2026-06-17 08:00:00');
    expect(url).toContain('LIST.uvalidendtime=2026-06-17 10:00:00');
    expect(url).toContain('LIST.uvalidDateBeg=2026-06-17');
    expect(url).toContain('LIST.uvalidTimeBeg=08:00:00');
  });

  it('addPerson: đủ param hằng số (proven-working)', async () => {
    withLogin({ text: 'root.ERR.no=0' });
    await client.addPerson(addInput());
    const url = pathOf(opCall());
    expect(url).toContain('LIST.protocol=1');
    expect(url).toContain('LIST.publicMjCardNo=1');
    expect(url).toContain('LIST.MjCardNo=1');
    expect(url).toContain('LIST.uregno=0');
    expect(url).toContain('LIST.uIsCheckSim=0');
    expect(url).toContain('LIST.unation=1');
    expect(url).toContain('LIST.ucertype=0');
    expect(url).toContain('LIST.ulistChScope=0');
    expect(url).toContain('LIST.ueffectNumber=');
    expect(url).toContain('LIST.uvalidTimeBeg1=');
  });

  it('addPerson device_error khi ERR.no≠0', async () => {
    withLogin({ text: 'root.ERR.no=5' });
    await expect(client.addPerson(addInput())).rejects.toMatchObject({
      kind: 'device_error',
      errNo: 5,
    });
  });

  it('addPerson jurisdiction tuỳ chỉnh', async () => {
    withLogin({ text: 'root.ERR.no=0' });
    await client.addPerson(addInput({ jurisdiction: [2] }));
    const url = pathOf(opCall());
    expect(url).toContain('CFGIpcJurisdiction.bIPC_Enable2=1');
    expect(url).not.toContain('bIPC_Enable0=1');
  });

  // ── deletePerson ──
  it('deletePerson ok → URL action=del&LIST.uid', async () => {
    withLogin({ text: 'root.ERR.no=0' });
    const r = await client.deletePerson('64');
    expect(r).toEqual({ ok: true });
    const url = pathOf(opCall());
    expect(url).toContain('action=del');
    expect(url).toContain('LIST.uid=64');
  });
  it('deletePerson device_error', async () => {
    withLogin({ text: 'root.ERR.no=3' });
    await expect(client.deletePerson('64')).rejects.toMatchObject({
      kind: 'device_error',
    });
  });

  // ── findUidByName (ITEM format thật) ──
  it('findUidByName: fixture 7-item → b7f5... ra uid 70', async () => {
    withLogin({ text: FIXTURE_7 });
    expect(
      await client.findUidByName('b7f5bba3-2cbc-440a-a2f9-35124d2e13e0'),
    ).toBe('70');
  });

  it('findUidByName: query getWhitelist đủ bộ param UI (begintime/endtime khoảng rộng)', async () => {
    withLogin({ text: FIXTURE_7 });
    await client.findUidByName('alice');
    const url = pathOf(opCall());
    expect(url).toContain('begintime=2000-01-01/00:00:00');
    expect(url).toContain('endtime=2099-12-31/23:59:59');
    expect(url).toContain('uflag=0');
    expect(url).toContain('usex=2');
    expect(url).toContain('uage=0-100');
    expect(url).toContain('utype=3');
    expect(url).toContain('sequence=1');
    expect(url).toContain('reqcount=20');
  });

  it('findUidByName: trùng uname → uid LỚN NHẤT (mới nhất)', async () => {
    withLogin({
      text: 'root.ERR.no=0\nroot.LIST.ITEM0.uid=50\nroot.LIST.ITEM0.uname=dup\nroot.LIST.ITEM1.uid=72\nroot.LIST.ITEM1.uname=dup',
    });
    expect(await client.findUidByName('dup')).toBe('72');
  });

  it('findUidByName: không có entry → null', async () => {
    withLogin({ text: 'root.ERR.no=0\nroot.LIST.rspcount=0' });
    expect(await client.findUidByName('bob')).toBeNull();
  });

  it('findUidByName: phân trang (trang đầy không match → trang sau)', async () => {
    const page1 = [
      'root.ERR.no=0',
      ...Array.from(
        { length: 20 },
        (_, i) => `root.LIST.ITEM${i}.uid=${i}\nroot.LIST.ITEM${i}.uname=u${i}`,
      ),
    ].join('\n');
    const page2 =
      'root.ERR.no=0\nroot.LIST.ITEM0.uid=999\nroot.LIST.ITEM0.uname=target';
    scenarios = [OK_LOGIN, { text: page1 }, { text: page2 }];
    expect(await client.findUidByName('target')).toBe('999');
  });

  it('E2 robust: format lạ (không có ITEM) → null, KHÔNG crash', async () => {
    withLogin({ text: 'root.ERR.no=0\nroot.WL.0.uid=64\nroot.OTHER.x=y' });
    expect(await client.findUidByName('alice')).toBeNull();
  });

  // ── uploadFace (E3) ──
  it('uploadFace: POST body rỗng <html></html> (ack iframe) → poll state=100 → FaceFileRef', async () => {
    scenarios = [
      OK_LOGIN,
      { text: '<html></html>' }, // POST ack rỗng — KHÔNG có root.ERR.no
      {
        text: 'root.ERR.no=0\nroot.UPLOAD.state=100\nroot.UPLOAD.dwfiletype=0\nroot.UPLOAD.dwfileindex=1\nroot.UPLOAD.dwfilepos=4259840',
      },
    ];
    const ref = await client.uploadFace(Buffer.from('jpegbytes'));
    expect(ref).toEqual({ dwfiletype: 0, dwfileindex: 1, dwfilepos: 4259840 });
    const post = calls[1]; // sau login
    expect(pathOf(post)).toContain('/webs/uploadfile');
    expect(pathOf(post)).toContain('action=LISTADD');
    expect(pathOf(post)).toContain('group=UPLOAD');
    expect(post.options.method).toBe('POST');
    expect(post.options.headers['Content-Type']).toContain(
      'multipart/form-data; boundary=',
    );
    expect(Buffer.isBuffer(post.body)).toBe(true);
    // body multipart chứa field name + bytes ảnh
    expect(post.body!.toString()).toContain('name="vfileselector"');
    expect(post.body!.toString()).toContain('jpegbytes');
  });

  it('uploadFace: POST có ERR.no≠0 vẫn KHÔNG gate (poll quyết định) → vẫn ra ref', async () => {
    scenarios = [
      OK_LOGIN,
      { text: 'root.ERR.no=7' }, // POST "lỗi" — bị BỎ QUA, không throw
      {
        text: 'root.ERR.no=0\nroot.UPLOAD.state=100\nroot.UPLOAD.dwfiletype=0\nroot.UPLOAD.dwfileindex=2\nroot.UPLOAD.dwfilepos=10',
      },
    ];
    const ref = await client.uploadFace(Buffer.from('x'));
    expect(ref).toEqual({ dwfiletype: 0, dwfileindex: 2, dwfilepos: 10 });
  });

  it('uploadFace: poll ERR.no≠0 → device_error', async () => {
    scenarios = [
      OK_LOGIN,
      { text: 'root.ERR.no=0' },
      { text: 'root.ERR.no=9' },
    ];
    await expect(client.uploadFace(Buffer.from('x'))).rejects.toMatchObject({
      kind: 'device_error',
      errNo: 9,
    });
  });

  it('uploadFace: poll không đạt 100% sau maxAttempts → timeout', async () => {
    // login + POST ok, mọi poll state=50 → cạn maxAttempts.
    scenarios = [
      OK_LOGIN,
      { text: 'root.ERR.no=0' },
      { text: 'root.ERR.no=0\nroot.UPLOAD.state=50' },
    ];
    await expect(client.uploadFace(Buffer.from('x'))).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  // ── debug ──
  it('debug=true: log method/path/status/rawBody, KHÔNG log Authorization', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const dbgClient = new FaceGateClient({ ...DEPS, debug: true });
    withLogin({ text: 'root.ERR.no=0' });
    await dbgClient.deletePerson('64');
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('[FaceGate]');
    expect(logged).toContain('/webs/setWhitelist');
    expect(logged).not.toContain('s3cret');
    expect(logged).not.toContain('Authorization');
    spy.mockRestore();
  });

  // ── auth / SEC ──
  it('auth: Authorization Basic đúng; creds KHÔNG lộ trong url', async () => {
    withLogin({ text: 'root.ERR.no=0' });
    await client.deletePerson('1');
    const auth = opCall().options.headers.Authorization;
    expect(auth).toBe(
      `Basic ${Buffer.from('admin:s3cret').toString('base64')}`,
    );
    expect(pathOf(opCall())).not.toContain('s3cret');
  });

  // ── http_error / timeout ──
  it('HTTP != 200 → http_error', async () => {
    withLogin({ text: 'err', status: 500 });
    await expect(client.deletePerson('1')).rejects.toMatchObject({
      kind: 'http_error',
      httpStatus: 500,
    });
  });

  it('lỗi mạng (non-timeout) → http_error', async () => {
    withLogin({ err: 'ECONNREFUSED' });
    await expect(client.deletePerson('1')).rejects.toMatchObject({
      kind: 'http_error',
    });
  });

  it('timeout: request treo > timeoutMs → FaceDeviceError(timeout), không hang', async () => {
    withLogin({ timeout: true });
    await expect(client.deletePerson('1')).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('timeout ngay ở login → propagate timeout', async () => {
    scenarios = [{ timeout: true }];
    await expect(client.deletePerson('1')).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});

describe('FaceDeviceProviderFactory (FGC-001 / F1)', () => {
  const config = { get: (_k: string, d?: unknown) => d } as any;
  const factory = new FaceDeviceProviderFactory(config);

  it('create từ ipAddress (không creds) → FaceGateClient', () => {
    const provider = factory.create({
      ipAddress: '192.168.1.222',
      metadataJson: null,
    });
    expect(provider).toBeInstanceOf(FaceGateClient);
  });

  it('create decrypt password_encrypted (IOT-015)', () => {
    process.env.RTSP_CRED_KEY = 'test_rtsp_cred_key_0123456789_abcdefghij';
    const enc = encryptSecret('devicepass');
    expect(decryptSecret(enc)).toBe('devicepass'); // sanity
    const provider = factory.create({
      ipAddress: '10.0.0.9',
      metadataJson: {
        face_server_config: { username: 'admin', password_encrypted: enc },
      },
    });
    expect(provider).toBeInstanceOf(FaceGateClient);
  });

  it('create KHÔNG có baseUrl → FaceDeviceError', () => {
    expect(() =>
      factory.create({ ipAddress: null, metadataJson: null }),
    ).toThrow(FaceDeviceError);
  });
});
