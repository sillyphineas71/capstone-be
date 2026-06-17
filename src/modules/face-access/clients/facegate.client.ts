import * as http from 'http';
import {
  FaceDeviceProviderPort,
  FaceDeviceError,
  FaceFileRef,
  AddPersonInput,
  FaceGateResponse,
} from '../ports/face-device-provider.port.js';
import { fmtTz } from '../utils/facegate-time.util.js';

export interface FaceGateClientDeps {
  baseUrl: string; // vd http://192.168.1.222
  username: string;
  password: string; // ĐÃ decrypt (factory lo)
  timeoutMs: number;
  tz: string;
  uploadField: string; // field name multipart upload (default 'vfileselector')
  uploadPollIntervalMs?: number; // default 300
  uploadMaxAttempts?: number; // default 30
  debug?: boolean; // log method/path/status/rawBody (KHÔNG log creds) — dùng khi smoke
}

interface MultipartPart {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}
interface RequestInit2 {
  method?: 'GET' | 'POST';
  multipart?: MultipartPart;
}

const DEFAULT_JURISDICTION = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const LIST_PAGE_SIZE = 20;
// getWhitelist begintime/endtime: khoảng RỘNG để lấy mọi người bất kể ngày enroll.
// Format YYYY-MM-DD/HH:MM:SS (dấu '/', KHÁC format add dùng dấu cách). Thiếu cặp này
// → cam trả totalcount=0 dù có person (đã xác nhận trên cam thật).
const LIST_WIDE_BEGIN = '2000-01-01/00:00:00';
const LIST_WIDE_END = '2099-12-31/23:59:59';
const MAX_PAGES = 100; // backstop chống loop vô hạn.
const DEFAULT_UPLOAD_POLL_MS = 300;
const DEFAULT_UPLOAD_MAX_ATTEMPTS = 30;
// Field rỗng theo request add proven-working (giữ đúng để cam chấp nhận).
const EMPTY_ADD_FIELDS = [
  'ucernumber',
  'uphone',
  'uplace',
  'uaddr',
  'uBankNum',
  'utext',
  'uIdCardID',
  'uWardenId',
  'uAccessID',
  'uRoomNum',
  'uRFIdCardNum',
  'WgFacility',
  'WgCardID',
  'group',
  'ueffectNumber',
  'uvalidTimeBeg1',
  'uvalidTimeEnd1',
  'uvalidTimeBeg2',
  'uvalidTimeEnd2',
  'uvalidTimeBeg3',
  'uvalidTimeEnd3',
  'uvalidTimeBeg4',
  'uvalidTimeEnd4',
];

/**
 * FaceGateClient (FGC-001) — impl FaceDeviceProviderPort cho FaceGate `webs/` CGI (HTTP Basic).
 *
 * Transport = Node `http` module (KHÔNG fetch — cam giữ phiên theo IP, fetch dễ treo).
 * Phiên: login-first (GET /webs/login), keyed theo IP, KHÔNG cookie. Mọi op qua requestAuthed:
 * login nếu chưa, gặp `ERR.des==='loginTimeout'` (kể cả ERR.no=0) → re-login + retry ĐÚNG 1 lần.
 * Success = ERR.no===0 VÀ ERR.des!=='loginTimeout'. Per-device (factory tạo).
 * SEC-01: KHÔNG log creds/Authorization/url. ARCH-02: timeout no-hang, KHÔNG retry op (caller B lo).
 */
export class FaceGateClient implements FaceDeviceProviderPort {
  private loggedIn = false;

  constructor(private readonly deps: FaceGateClientDeps) {}

  // ── parseResponse (pure) ──────────────────────────────────────────────
  parseResponse(text: string): FaceGateResponse {
    const root: Record<string, Record<string, string>> = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^root\.([^.]+)\.([^=]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const ns = m[1];
      const field = m[2];
      const value = m[3];
      (root[ns] ??= {})[field] = value;
    }
    const rawErr = root['ERR']?.['no'];
    const errNo = rawErr !== undefined ? Number(rawErr) : -1;
    return { errNo: Number.isFinite(errNo) ? errNo : -1, root };
  }

  // ── addPerson ─────────────────────────────────────────────────────────
  async addPerson(input: AddPersonInput): Promise<{ ok: true }> {
    const vf = fmtTz(input.validFrom, this.deps.tz);
    const vt = fmtTz(input.validTo, this.deps.tz);
    const jurisdiction = input.jurisdiction ?? DEFAULT_JURISDICTION;

    const query: Record<string, string | number> = {
      action: 'add',
      group: 'LIST',
      'LIST.uid': -1,
      'LIST.dwfiletype': input.faceRef.dwfiletype,
      'LIST.dwfileindex': input.faceRef.dwfileindex,
      'LIST.dwfilepos': input.faceRef.dwfilepos,
      'LIST.protocol': 1,
      'LIST.publicMjCardNo': 1,
      'LIST.MjCardNo': 1,
      'LIST.uname': input.uname,
      'LIST.uregno': 0,
      'LIST.uvalidbegintime': vf.dateTime,
      'LIST.uvalidendtime': vt.dateTime,
      'LIST.uvalidDateBeg': vf.date,
      'LIST.uvalidDateEnd': vt.date,
      'LIST.uvalidTimeBeg': vf.time,
      'LIST.uvalidTimeEnd': vt.time,
      'LIST.uIsCheckSim': 0,
      'LIST.ucardtype': 0,
      'LIST.ulisttype': 0,
      'LIST.ulistChScope': 0,
      'LIST.utype': 0,
      'LIST.usex': 0,
      'LIST.unation': 1,
      'LIST.ucertype': 0,
      'LIST.uStatus': 4,
    };
    for (const f of EMPTY_ADD_FIELDS) query[`LIST.${f}`] = '';
    for (const ch of jurisdiction) {
      query[`CFGIpcJurisdiction.bIPC_Enable${ch}`] = 1;
    }

    const resp = await this.requestAuthed('/webs/setWhitelist', query);
    if (resp.errNo !== 0) {
      throw new FaceDeviceError(
        'device_error',
        `addPerson failed (ERR.no=${resp.errNo})`,
        resp.errNo,
      );
    }
    return { ok: true };
  }

  // ── deletePerson ──────────────────────────────────────────────────────
  async deletePerson(uid: string): Promise<{ ok: true }> {
    const resp = await this.requestAuthed('/webs/setWhitelist', {
      action: 'del',
      group: 'LIST',
      'LIST.uid': uid,
    });
    if (resp.errNo !== 0) {
      throw new FaceDeviceError(
        'device_error',
        `deletePerson failed (ERR.no=${resp.errNo})`,
        resp.errNo,
      );
    }
    return { ok: true };
  }

  // ── findUidByName (vì add không trả uid; trùng uname → uid lớn nhất) ──
  async findUidByName(uname: string): Promise<string | null> {
    let beginno = 0;
    const matches: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const resp = await this.requestAuthed('/webs/getWhitelist', {
        action: 'list',
        group: 'LIST',
        uflag: 0,
        usex: 2,
        uage: '0-100',
        MjCardNo: 0,
        begintime: LIST_WIDE_BEGIN,
        endtime: LIST_WIDE_END,
        utype: 3,
        sequence: 1,
        sessionid: 0,
        beginno,
        reqcount: LIST_PAGE_SIZE,
      });
      const entries = this.parseWhitelistEntries(resp);
      for (const e of entries) if (e.uname === uname) matches.push(e.uid);
      if (entries.length < LIST_PAGE_SIZE) break; // trang cuối (rspcount < reqcount).
      beginno += entries.length;
    }
    if (matches.length === 0) return null;
    // Chọn uid LỚN NHẤT (mới nhất) — cam cho phép trùng uname.
    return matches.reduce((a, b) => (Number(b) > Number(a) ? b : a));
  }

  /**
   * E2 (format thật): response list dạng `root.LIST.ITEM<N>.<field>`.
   * Gom theo ITEM index → [{uid, uname, utime?}]. Robust: thiếu uid/uname → bỏ entry.
   */
  private parseWhitelistEntries(
    resp: FaceGateResponse,
  ): Array<{ uid: string; uname: string; utime?: string }> {
    const list = resp.root['LIST'] ?? {};
    const items: Record<
      string,
      { uid?: string; uname?: string; utime?: string }
    > = {};
    for (const [k, v] of Object.entries(list)) {
      const m = /^ITEM(\d+)\.(uid|uname|utime)$/.exec(k);
      if (m) (items[m[1]] ??= {})[m[2] as 'uid' | 'uname' | 'utime'] = v;
    }
    return Object.values(items)
      .filter((x) => x.uid && x.uname)
      .map((x) => ({
        uid: x.uid as string,
        uname: x.uname as string,
        utime: x.utime,
      }));
  }

  // ── uploadFace (E3 — POST multipart → poll getUploadPercent) ──────────
  async uploadFace(image: Buffer): Promise<FaceFileRef> {
    const sessionid = this.randomSession();

    // 1. POST ảnh JPEG (multipart). Field name = uploadField (chốt khi smoke).
    //    Fire-and-forget: cam ack qua iframe → body thường RỖNG/`<html></html>`
    //    (không có root.ERR.no). KHÔNG gate POST theo errNo; chỉ poll mới là nguồn sự thật.
    await this.requestAuthed(
      '/webs/uploadfile',
      { action: 'LISTADD', group: 'UPLOAD', sessionid, IsCheckSim: 0 },
      {
        method: 'POST',
        multipart: {
          field: this.deps.uploadField,
          filename: 'face.jpg',
          contentType: 'image/jpeg',
          data: image,
        },
      },
    );

    // 2. Poll getUploadPercent tới state===100 (bounded → no-hang).
    const intervalMs = this.deps.uploadPollIntervalMs ?? DEFAULT_UPLOAD_POLL_MS;
    const maxAttempts =
      this.deps.uploadMaxAttempts ?? DEFAULT_UPLOAD_MAX_ATTEMPTS;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const poll = await this.requestAuthed('/webs/getUploadPercent', {
        action: 'list',
        group: 'UPLOAD',
        sessionid,
      });
      if (poll.errNo !== 0) {
        throw new FaceDeviceError(
          'device_error',
          `uploadFace poll failed (ERR.no=${poll.errNo})`,
          poll.errNo,
        );
      }
      const up = poll.root['UPLOAD'] ?? {};
      if (Number(up['state']) === 100) {
        return {
          dwfiletype: Number(up['dwfiletype'] ?? 0),
          dwfileindex: Number(up['dwfileindex'] ?? 0),
          dwfilepos: Number(up['dwfilepos'] ?? 0),
        };
      }
      await this.sleep(intervalMs);
    }
    throw new FaceDeviceError(
      'timeout',
      'uploadFace: upload không đạt 100% sau maxAttempts.',
    );
  }

  // ── Session (login-first, keyed theo IP, KHÔNG cookie) ────────────────
  private isLoginTimeout(resp: FaceGateResponse): boolean {
    return resp.root['ERR']?.['des'] === 'loginTimeout';
  }

  /** GET /webs/login; thành công khi ERR.des==='ok' → loggedIn=true. */
  private async login(): Promise<void> {
    const resp = await this.httpRequest('/webs/login', {
      action: 'list',
      group: 'LOGIN',
      UserID: this.rand(),
    });
    if (resp.root['ERR']?.['des'] !== 'ok') {
      throw new FaceDeviceError(
        'device_error',
        'login failed (ERR.des != ok)',
        resp.errNo,
      );
    }
    this.loggedIn = true;
  }

  /**
   * Bọc op: login nếu chưa; nếu resp là loginTimeout (kể cả ERR.no=0) →
   * re-login + retry ĐÚNG 1 lần; vẫn loginTimeout → device_error.
   */
  private async requestAuthed(
    path: string,
    query: Record<string, string | number>,
    init?: RequestInit2,
  ): Promise<FaceGateResponse> {
    if (!this.loggedIn) await this.login();

    let resp = await this.httpRequest(path, query, init);
    if (this.isLoginTimeout(resp)) {
      this.loggedIn = false;
      await this.login();
      resp = await this.httpRequest(path, query, init);
      if (this.isLoginTimeout(resp)) {
        throw new FaceDeviceError(
          'device_error',
          'loginTimeout (re-login không phục hồi phiên)',
          resp.errNo,
        );
      }
    }
    return resp;
  }

  // ── HTTP transport (Node http; timeout no-hang; KHÔNG log creds) ───────
  private httpRequest(
    path: string,
    query: Record<string, string | number>,
    init?: RequestInit2,
  ): Promise<FaceGateResponse> {
    return new Promise<FaceGateResponse>((resolve, reject) => {
      const qs = `${this.encodeQuery(query)}&nRanId=${this.rand()}`;
      const base = new URL(this.deps.baseUrl);

      const headers: Record<string, string | number> = {
        Authorization: this.basicAuth(),
      };
      let body: Buffer | undefined;
      if (init?.method === 'POST' && init.multipart) {
        const { boundary, buffer } = this.buildMultipart(init.multipart);
        body = buffer;
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        headers['Content-Length'] = buffer.length;
      }

      const options: http.RequestOptions = {
        hostname: base.hostname,
        port: base.port || 80,
        path: `${path}?${qs}`,
        method: init?.method ?? 'GET',
        headers,
        // KHÔNG set Expect: 100-continue.
      };

      const method = options.method ?? 'GET';
      let timedOut = false;
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const rawBody = Buffer.concat(chunks).toString('utf8');
          if (this.deps.debug) {
            // SEC: path KHÔNG chứa creds; KHÔNG log Authorization header.
            console.error('[FaceGate]', method, path, '→', status, rawBody);
          }
          if (status !== 200) {
            reject(
              new FaceDeviceError(
                'http_error',
                `FaceGate HTTP ${status}`,
                undefined,
                status,
              ),
            );
            return;
          }
          resolve(this.parseResponse(rawBody));
        });
      });

      req.setTimeout(this.deps.timeoutMs, () => {
        timedOut = true;
        req.destroy();
        reject(new FaceDeviceError('timeout', 'FaceGate request timeout'));
      });
      req.on('error', (e: Error) => {
        if (timedOut) return; // đã reject timeout.
        reject(
          new FaceDeviceError(
            'http_error',
            `FaceGate request failed: ${e instanceof Error ? e.message : 'unknown'}`,
          ),
        );
      });

      if (body) req.write(body);
      req.end();
    });
  }

  private buildMultipart(mp: MultipartPart): {
    boundary: string;
    buffer: Buffer;
  } {
    const boundary = `----FaceGateBoundary${this.rand()}${this.rand()}`;
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${mp.field}"; filename="${mp.filename}"\r\n` +
        `Content-Type: ${mp.contentType}\r\n\r\n`,
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    return { boundary, buffer: Buffer.concat([head, mp.data, tail]) };
  }

  private encodeQuery(query: Record<string, string | number>): string {
    return Object.entries(query)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  private basicAuth(): string {
    const token = Buffer.from(
      `${this.deps.username}:${this.deps.password}`,
    ).toString('base64');
    return `Basic ${token}`;
  }

  private rand(): number {
    return Math.floor(Math.random() * 1e8);
  }

  private randomSession(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 8; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
