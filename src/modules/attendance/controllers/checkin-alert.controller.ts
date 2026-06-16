import { Controller, Post, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { CheckInAlertService } from '../services/checkin-alert.service.js';
import { InternalApiGuard } from '../../../common/guards/internal-api.guard.js';
import { LateCheckinAlertResponseDto } from '../dto/late-checkin-alert-response.dto.js';

@Controller('internal/meetings')
@UseGuards(InternalApiGuard)
export class CheckInAlertController {
  constructor(private readonly checkInAlertService: CheckInAlertService) {}

  @Post(':meetingId/late-checkin-alerts')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerLateCheckinAlerts(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
  ): Promise<LateCheckinAlertResponseDto> {
    return this.checkInAlertService.triggerForMeeting(meetingId);
  }
}
