export class AgendaAttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string | null;
  fileUrl: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;

  constructor(data: Partial<AgendaAttachmentDto>) {
    Object.assign(this, data);
  }
}

export class AgendaAttachmentUploadResponseDto extends AgendaAttachmentDto {
  agendaId: string;
  meetingId: string;

  constructor(data: Partial<AgendaAttachmentUploadResponseDto>) {
    super(data);
    Object.assign(this, data);
  }
}

export class DeleteAgendaAttachmentResponseDto {
  fileId: string;
  agendaId: string;
  deletedAt: Date;

  constructor(data: Partial<DeleteAgendaAttachmentResponseDto>) {
    Object.assign(this, data);
  }
}
