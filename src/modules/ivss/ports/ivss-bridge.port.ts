/**
 * IvssBridgePort (IVS-001 #36) — hợp đồng gọi IVSS bridge sidecar (Java NetSDK, Option A).
 *
 * Transport thật ở IvssBridgeClient (Node http). Mọi method trả IvssResult typed —
 * bridge-down/timeout → { ok:false, error } (KHÔNG throw vỡ flow). C3: inject qua token IVSS_BRIDGE.
 */

/** C3 — injection token cho IvssBridgePort (provide qua factory). */
export const IVSS_BRIDGE = Symbol('IVSS_BRIDGE');

export interface IvssBridgeError {
  code:
    | 'BRIDGE_UNREACHABLE'
    | 'BRIDGE_TIMEOUT'
    | 'BRIDGE_HTTP_ERROR'
    | 'BRIDGE_BAD_RESPONSE';
  status?: number;
  message: string;
}

export type IvssResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IvssBridgeError };

export interface CreateGroupInput {
  name: string;
  groupId?: string;
}
export interface IvssGroup {
  groupId?: string;
  name?: string;
  [k: string]: unknown;
}

export interface EnrollFaceInput {
  groupId: string;
  personUid: string;
  name?: string;
  imageBase64: string;
}
export interface IvssFaceRef {
  personUid?: string;
  [k: string]: unknown;
}

export interface DeleteFaceInput {
  groupId: string;
  personUid: string;
}

export interface IvssStatus {
  connected: boolean;
  [k: string]: unknown;
}

export interface IvssBridgePort {
  createGroup(input: CreateGroupInput): Promise<IvssResult<IvssGroup>>;
  enrollFace(input: EnrollFaceInput): Promise<IvssResult<IvssFaceRef>>;
  deleteFace(input: DeleteFaceInput): Promise<IvssResult<{ deleted: boolean }>>;
  status(): Promise<IvssResult<IvssStatus>>;
}
