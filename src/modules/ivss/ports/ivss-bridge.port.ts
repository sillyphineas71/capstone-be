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
    | 'BRIDGE_BAD_RESPONSE'
    // Bổ sung 2026-08-09 (crowd-alert snapshot chủ động): bridge trả HTTP 200 hợp lệ
    // NHƯNG body { success:false, message } — khác BRIDGE_HTTP_ERROR (status xấu) và
    // BRIDGE_BAD_RESPONSE (JSON không parse được) — đây là JSON hợp lệ, chỉ là thất bại
    // ở tầng nghiệp vụ bridge (vd channel không tồn tại/camera không có ảnh).
    | 'BRIDGE_SNAPSHOT_FAILED';
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

/** Bổ sung 2026-08-09 — input cho POST /api/ivss/snapshot?channelId={channelId}. */
export interface SnapshotInput {
  channelId: number;
}
/** imageBase64 = raw base64 JPEG (KHÔNG prefix data URL — bridge trả thẳng chuỗi base64). */
export interface IvssSnapshot {
  imageBase64: string;
}

export interface IvssBridgePort {
  createGroup(input: CreateGroupInput): Promise<IvssResult<IvssGroup>>;
  enrollFace(input: EnrollFaceInput): Promise<IvssResult<IvssFaceRef>>;
  deleteFace(input: DeleteFaceInput): Promise<IvssResult<{ deleted: boolean }>>;
  status(): Promise<IvssResult<IvssStatus>>;
  /**
   * Chụp ảnh chủ động qua bridge (crowd-alert). Endpoint CONFIRMED: trả
   * { success:true, data: base64Jpeg } hoặc { success:false, message } — khác envelope
   * các method trên (bridge tự bọc success/data/message trong BODY, không chỉ dựa HTTP
   * status). `timeoutMs` optional — override `IVSS_BRIDGE_TIMEOUT_MS` mặc định của client
   * cho riêng lần gọi này (crowd-alert cần timeout ngắn hơn, KHÔNG chặn luồng ghi alert).
   */
  getSnapshot(
    input: SnapshotInput,
    timeoutMs?: number,
  ): Promise<IvssResult<IvssSnapshot>>;
}
