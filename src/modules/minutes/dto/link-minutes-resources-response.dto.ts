export class LinkMinutesResourcesResponseDto {
  id: string;
  linkedRecordingFileId: string | null;
  linkedTranscriptId: string | null;
  updatedAt: Date;

  constructor(data: LinkMinutesResourcesResponseDto) {
    Object.assign(this, data);
  }
}
