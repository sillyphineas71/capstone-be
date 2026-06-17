/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * face-verify-payload.util (FAT-001 / ingestion) — trích danh tính từ payload verify
 * THẬT của cam FaceGate (operator='VerifyPush'); danh tính nằm ở body.info.*,
 * KHÔNG phải body.person_id.
 *
 * Payload (POST application/json):
 *   { operator:'VerifyPush', info:{ PersonID, Name, CreateTime, Similarity1,
 *     VerifyStatus, ... }, dwFileIndex, dwFilePos, SanpPic:'data:image/jpeg;base64,…' }
 *
 * - personId = info.PersonID (số) → ép chuỗi (khớp device_person_id trong mapping).
 * - personName = info.Name (= uname = userId:meetingId).
 * - Gate: hợp lệ khi operator==='VerifyPush' VÀ info.VerifyStatus===1.
 * - SanpPic (base64 ảnh) PHẢI bị strip trước khi lưu/log — TUYỆT ĐỐI không giữ base64.
 */

export interface VerifyInfo {
  PersonID?: number | string;
  Name?: string;
  CreateTime?: string;
  VerifyStatus?: number;
  Similarity1?: number;
}

export interface ParsedVerify {
  /** operator==='VerifyPush' && info.VerifyStatus===1 */
  isValid: boolean;
  personId: string | null;
  personName: string | null;
  info: VerifyInfo;
}

export function parseVerifyPayload(body: any): ParsedVerify {
  const info: VerifyInfo = (body?.info ?? {}) as VerifyInfo;
  const personId =
    info.PersonID != null && info.PersonID !== ''
      ? String(info.PersonID)
      : null;
  const personName = info.Name ?? null;
  const isValid = body?.operator === 'VerifyPush' && info.VerifyStatus === 1;
  return { isValid, personId, personName, info };
}

/**
 * Trả về BẢN SAO payload với SanpPic thay bằng '[stripped]' (KHÔNG mutate input).
 * Payload không có SanpPic → trả copy nguyên trạng.
 */
export function stripSanpPic<T extends Record<string, any>>(payload: T): T {
  if (payload && typeof payload === 'object' && 'SanpPic' in payload) {
    return { ...payload, SanpPic: '[stripped]' };
  }
  return { ...payload };
}
