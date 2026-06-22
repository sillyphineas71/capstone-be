import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  IvssBridgePort,
  IvssResult,
  CreateGroupInput,
  IvssGroup,
  EnrollFaceInput,
  IvssFaceRef,
  DeleteFaceInput,
  IvssStatus,
} from '../ports/ivss-bridge.port.js';

export interface IvssBridgeClientDeps {
  baseUrl: string; // vd http://localhost:8088
  token: string; // shared secret 2 chiều (X-Internal-Token) — R1
  timeoutMs: number;
}

/**
 * IvssBridgeClient (IVS-001 #36) — impl IvssBridgePort qua Node http/https.
 *
 * Mirror FaceGate client: `transport.request` + `req.setTimeout` + `req.on('error')`.
 * Mọi nhánh lỗi (unreachable/timeout/http/bad-json) → IvssResult{ok:false} — KHÔNG throw.
 * SEC-01: gắn header X-Internal-Token nhưng KHÔNG log token.
 */
export class IvssBridgeClient implements IvssBridgePort {
  constructor(private readonly deps: IvssBridgeClientDeps) {}

  createGroup(input: CreateGroupInput): Promise<IvssResult<IvssGroup>> {
    return this.request<IvssGroup>('POST', '/api/ivss/groups', input);
  }

  enrollFace(input: EnrollFaceInput): Promise<IvssResult<IvssFaceRef>> {
    return this.request<IvssFaceRef>('POST', '/api/ivss/faces', input);
  }

  deleteFace(
    input: DeleteFaceInput,
  ): Promise<IvssResult<{ deleted: boolean }>> {
    return this.request<{ deleted: boolean }>(
      'DELETE',
      '/api/ivss/faces',
      input,
    );
  }

  status(): Promise<IvssResult<IvssStatus>> {
    return this.request<IvssStatus>('GET', '/api/ivss/status');
  }

  private request<T>(
    method: string,
    path: string,
    bodyObj?: unknown,
  ): Promise<IvssResult<T>> {
    return new Promise<IvssResult<T>>((resolve) => {
      let url: URL;
      try {
        url = new URL(path, this.deps.baseUrl);
      } catch {
        resolve({
          ok: false,
          error: {
            code: 'BRIDGE_UNREACHABLE',
            message: 'Invalid or empty IVSS bridge base URL.',
          },
        });
        return;
      }

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;
      const payload =
        bodyObj !== undefined
          ? Buffer.from(JSON.stringify(bodyObj), 'utf8')
          : undefined;

      const headers: Record<string, string | number> = {
        'X-Internal-Token': this.deps.token,
        Accept: 'application/json',
      };
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
      }

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      };

      let timedOut = false;
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const raw = Buffer.concat(chunks).toString('utf8');
          if (status < 200 || status >= 300) {
            resolve({
              ok: false,
              error: {
                code: 'BRIDGE_HTTP_ERROR',
                status,
                message: `IVSS bridge HTTP ${status}`,
              },
            });
            return;
          }
          try {
            const data: unknown = raw ? JSON.parse(raw) : {};
            resolve({ ok: true, data: data as T });
          } catch {
            resolve({
              ok: false,
              error: {
                code: 'BRIDGE_BAD_RESPONSE',
                status,
                message: 'IVSS bridge returned non-JSON response.',
              },
            });
          }
        });
      });

      req.setTimeout(this.deps.timeoutMs, () => {
        timedOut = true;
        req.destroy();
        resolve({
          ok: false,
          error: {
            code: 'BRIDGE_TIMEOUT',
            message: 'IVSS bridge request timeout.',
          },
        });
      });

      req.on('error', (e: Error) => {
        if (timedOut) return; // đã resolve timeout.
        resolve({
          ok: false,
          error: {
            code: 'BRIDGE_UNREACHABLE',
            message: `IVSS bridge unreachable: ${e.message}`,
          },
        });
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}
