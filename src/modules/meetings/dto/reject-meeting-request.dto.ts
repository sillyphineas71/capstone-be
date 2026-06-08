import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectMeetingRequestDto {
  @IsString({ message: 'rejectionReason phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'rejectionReason không được để trống' })
  @MaxLength(1000, {
    message: 'rejectionReason không được vượt quá 1000 ký tự',
  })
  rejectionReason: string;
}
