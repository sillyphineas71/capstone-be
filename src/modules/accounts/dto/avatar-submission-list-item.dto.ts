export class AvatarSubmissionListItemDto {
  faceProfileId: string;
  userId: string;
  fullName: string;
  email: string;
  employeeCode: string;
  departmentName: string;
  status: string;
  submittedAt: Date | null;
  primaryImageFileId: string | null;
  qualityScore: number | null;
}
