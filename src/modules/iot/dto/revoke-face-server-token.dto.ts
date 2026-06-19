import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * TKR-001 (#11) — body cho POST /iot-devices/:id/face-server/revoke.
 * reason là optional, dùng ghi vào face_server_config.revoked_reason + audit.
 */
export class RevokeFaceServerTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
