import { GUEST_TOKEN_TYPE } from '../constants/guest-access.constants.js';

/** Payload JWT của phiên khách — ký bằng GUEST_TOKEN_SECRET (khác secret nhân viên). */
export interface GuestJwtPayload {
  typ: typeof GUEST_TOKEN_TYPE;
  /** external_participant_id — KHÔNG phải users.id. */
  sub: string;
  /** meeting_id — khóa cứng phiên vào đúng 1 cuộc họp. */
  mid: string;
  scope: string[];
  jti: string;
  iat: number;
  exp: number;
}

/** Dữ liệu gán vào request.guest bởi GuestSessionGuard — KHÔNG BAO GIỜ gán request.user. */
export interface GuestRequestContext {
  externalParticipantId: string;
  meetingId: string;
  jti: string;
}
