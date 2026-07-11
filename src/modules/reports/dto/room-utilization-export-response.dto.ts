/**
 * CreateRoomUtilizationExportResponseDto — response cho UC-RUM-16.
 * FR-005: endpoint tạo job trả 202 Accepted với jobId, status, delivery, outputFileId.
 */
export class CreateRoomUtilizationExportResponseDto {
  jobId: string;
  status: 'queued';
  delivery: 'download';
  outputFileId: null;
}
