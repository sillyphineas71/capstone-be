export class RejectResponseDto {
  requestId: string;
  approvalStatus: string;
  decisionAt: Date;

  constructor(data: RejectResponseDto) {
    Object.assign(this, data);
  }
}
