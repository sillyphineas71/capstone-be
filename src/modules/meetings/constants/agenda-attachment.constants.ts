export const AGENDA_ATTACHMENT_MAX_BYTES_DEFAULT = 20 * 1024 * 1024; // 20MB
export const AGENDA_ATTACHMENT_MAX_COUNT_DEFAULT = 5; // per agenda item

export const AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const AGENDA_ATTACHMENT_MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    '.pptx',
  ],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    '.xlsx',
  ],
};
