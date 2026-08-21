/** Discriminator — chặn token loại khác (guest session, auth access...) bị dùng nhầm ở đây. */
export const NO_SHOW_CONFIRM_TOKEN_TYPE = 'no_show_confirm';

/**
 * Payload JWT của link "Tôi vẫn đến" trong email no-show — ký bằng
 * `NO_SHOW_CONFIRM_LINK_SECRET` (mirror GuestJwtPayload, khác hoàn toàn
 * GUEST_TOKEN_SECRET/AUTH_ACCESS_TOKEN_SECRET).
 *
 * Gắn ĐÚNG 1 `no_show_cases.id` (không phải booking/meeting chung chung — dùng lại
 * cho case khác vô hiệu vì `NoShowService.update()` sẽ query đúng case đó, không
 * còn nghĩa khi case đã terminal) và ĐÚNG 1 `userId` (organizer/host tại thời điểm
 * phát hành). `NoShowConfirmController` KHÔNG tin payload.userId là tuyệt đối — vẫn
 * để `NoShowService.update()` tự re-check userId có còn là organizer/host thật của
 * meeting hay không (defense-in-depth, xem no-show.service.ts#assertAuthorized).
 */
export interface NoShowConfirmJwtPayload {
  typ: typeof NO_SHOW_CONFIRM_TOKEN_TYPE;
  caseId: string;
  userId: string;
  iat: number;
  exp: number;
}
