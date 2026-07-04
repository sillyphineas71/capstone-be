/**
 * meeting-activity-export-response.dto.ts
 * Response DTO cho UC-AA-12 — tạo job xuất báo cáo hoạt động cuộc họp.
 *
 * FR-005: Endpoint tạo job trả 202 Accepted với jobId, status, delivery, outputFileId.
 */
export class CreateExportResponseDto {
  /** ID của background job vừa tạo — dùng để poll status qua GET /api/v1/background-jobs/:id */
  jobId: string;

  /** Luôn là 'queued' khi mới tạo */
  status: 'queued';

  /** Luôn là 'download' (OOS-001) */
  delivery: 'download';

  /** null khi mới tạo — sẽ có giá trị khi job completed (poll qua background-jobs endpoint) */
  outputFileId: null;
}
