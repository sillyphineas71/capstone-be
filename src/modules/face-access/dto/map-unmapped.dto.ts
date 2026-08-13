import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * MapUnmappedDto (UMR-001) — body POST /api/v1/face-access/unmapped-verifies/map.
 *
 * Liên kết (deviceId, personId) → userId cho meeting (per-meeting). personId là
 * device_person_id (uid) thiết bị báo trong verify — chuỗi, KHÔNG bắt buộc UUID.
 */
export class MapUnmappedDto {
  @ApiProperty({ description: 'ID thiết bị camera đã báo verify chưa khớp' })
  @IsUUID()
  deviceId: string;

  @ApiProperty({
    description:
      'device_person_id (uid) thiết bị báo trong verify — chuỗi thô, KHÔNG bắt buộc UUID',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  personId: string;

  @ApiProperty({ description: 'ID user hệ thống được gán cho person này' })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'ID cuộc họp — mapping chỉ áp dụng trong phạm vi cuộc họp này',
  })
  @IsUUID()
  meetingId: string;
}
