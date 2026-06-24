export class ImageFileMetadataDto {
  fileName: string;
  mimeType: string;
  fileSizeBytes: string | null;
  storageProvider: string;
}

export class ReviewMetadataDto {
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export class AvatarSubmissionDetailDto {
  faceProfileId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  status: string;
  primaryImageFileId: string | null;
  imageFile: ImageFileMetadataDto | null;
  hasPreview: boolean;
  submittedAt: Date | null;
  consentAt: Date | null;
  reviewMetadata: ReviewMetadataDto | null;
}
