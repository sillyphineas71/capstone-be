import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  NoShowConfirmJwtPayload,
  NO_SHOW_CONFIRM_TOKEN_TYPE,
} from '../types/no-show-confirm-jwt-payload.type.js';

/**
 * NoShowConfirmTokenService — sign/verify link "Tôi vẫn đến" gửi qua email
 * (Việc B, Hướng 2). Mirror ĐÚNG GuestSessionService (guest-access) — cùng thư
 * viện (@nestjs/jwt), cùng kiểu tách secret riêng theo domain.
 *
 * Trần hạn TTL_SECONDS CỐ ĐỊNH, ĐỘC LẬP với `no_show.auto_release_grace_minutes`
 * (NoShowConfigService, biến nghiệp vụ người dùng chỉnh được) — case tự thành
 * terminal theo ngưỡng nghiệp vụ đó rồi thì dismiss trên case terminal tự nhiên
 * no-op ở NoShowService.update() (KHÔNG cần token tự biết điều đó); trần cứng ở
 * đây CHỈ để phòng email bị forward/lộ về sau, link không sống mãi (yêu cầu Harry).
 */
@Injectable()
export class NoShowConfirmTokenService {
  private static readonly TOKEN_TTL_SECONDS = 60 * 60; // 60 phút

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private getSecret(): string {
    return this.configService.get<string>('NO_SHOW_CONFIRM_LINK_SECRET', '');
  }

  async sign(params: { caseId: string; userId: string }): Promise<string> {
    const payload: Omit<NoShowConfirmJwtPayload, 'iat' | 'exp'> = {
      typ: NO_SHOW_CONFIRM_TOKEN_TYPE,
      caseId: params.caseId,
      userId: params.userId,
    };
    return this.jwtService.signAsync(payload, {
      secret: this.getSecret(),
      expiresIn: NoShowConfirmTokenService.TOKEN_TTL_SECONDS,
    });
  }

  /**
   * Verify chữ ký + hạn + typ. Throw nếu sai/hết hạn/sai type — caller
   * (NoShowConfirmController) bắt lỗi, KHÔNG phân biệt lý do cụ thể ra response
   * (mirror GuestSessionGuard#invalidSession — 1 thông điệp chung "không hợp lệ
   * hoặc đã hết hạn", tránh lộ thêm thông tin cho route công khai không đăng nhập).
   */
  async verify(token: string): Promise<NoShowConfirmJwtPayload> {
    const payload = await this.jwtService.verifyAsync<NoShowConfirmJwtPayload>(
      token,
      { secret: this.getSecret() },
    );
    if (payload.typ !== NO_SHOW_CONFIRM_TOKEN_TYPE) {
      throw new Error('Invalid no-show confirm token type');
    }
    return payload;
  }

  buildLink(baseUrl: string, token: string): string {
    const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmedBase}/no-show-confirm/${token}`;
  }
}
