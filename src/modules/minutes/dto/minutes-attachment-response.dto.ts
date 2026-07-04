export class MinutesAttachmentResponseDto {
  id: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: string | null;
  fileUrl: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;

  constructor(data: MinutesAttachmentResponseDto) {
    this.id = data.id;
    this.fileName = data.fileName;
    this.fileType = data.fileType;
    this.mimeType = data.mimeType;
    this.fileSizeBytes = data.fileSizeBytes;
    this.fileUrl = data.fileUrl;
    this.uploadedBy = data.uploadedBy;
    this.uploadedAt = data.uploadedAt;
  }
}
