import { IsUUID, IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * MapUnmappedDto (UMR-001) — body POST /api/v1/face-access/unmapped-verifies/map.
 *
 * Liên kết (deviceId, personId) → userId cho meeting (per-meeting). personId là
 * device_person_id (uid) thiết bị báo trong verify — chuỗi, KHÔNG bắt buộc UUID.
 */
export class MapUnmappedDto {
  @IsUUID()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  personId: string;

  @IsUUID()
  userId: string;

  @IsUUID()
  meetingId: string;
}
