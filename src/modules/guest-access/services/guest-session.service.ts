import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';
import {
  GUEST_SCOPE_VIEW,
  GUEST_TOKEN_TYPE,
} from '../constants/guest-access.constants.js';
import { GuestJwtPayload } from '../types/guest-jwt-payload.type.js';

/**
 * GuestSessionService — sign/verify token phiên khách.
 *
 * Ký bằng `GUEST_TOKEN_SECRET` — KHÁC HOÀN TOÀN `AUTH_ACCESS_TOKEN_SECRET`.
 * Đây là ranh giới bảo mật cốt lõi của toàn bộ feature (spec FR-GLA-020):
 * token khách đưa vào `JwtAuthGuard` PHẢI bị từ chối ngay ở bước verify chữ ký.
 *
 * `exp` là chặn trên TUYỆT ĐỐI (`iat + sessionMaxHours`), KHÔNG đổi được sau
 * khi cấp — kể cả khi meeting được gia hạn. Việc "nới" theo `meeting.endTime`
 * mới được xử lý RIÊNG ở tầng guard/service mỗi request (đọc tươi từ DB), chứ
 * không nhúng vào JWT (research.md rủi ro #6).
 */
@Injectable()
export class GuestSessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: GuestAccessConfigService,
  ) {}

  async signGuestToken(params: {
    externalParticipantId: string;
    meetingId: string;
  }): Promise<{ token: string; jti: string; expiresInSeconds: number }> {
    const jti = randomUUID();
    const expiresInSeconds = this.config.getSessionMaxHours() * 3600;
    const payload: Omit<GuestJwtPayload, 'iat' | 'exp'> = {
      typ: GUEST_TOKEN_TYPE,
      sub: params.externalParticipantId,
      mid: params.meetingId,
      scope: [GUEST_SCOPE_VIEW],
      jti,
    };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.config.getGuestTokenSecret(),
      expiresIn: expiresInSeconds,
    });
    return { token, jti, expiresInSeconds };
  }

  /** Verify chữ ký + hạn JWT. Throw nếu sai/hết hạn — caller (guard) bắt lỗi. */
  async verifyGuestToken(token: string): Promise<GuestJwtPayload> {
    const payload = await this.jwtService.verifyAsync<GuestJwtPayload>(token, {
      secret: this.config.getGuestTokenSecret(),
    });
    if (payload.typ !== GUEST_TOKEN_TYPE) {
      throw new Error('Invalid guest token type');
    }
    return payload;
  }
}
