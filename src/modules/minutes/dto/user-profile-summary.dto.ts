/**
 * Profile đầy đủ cho issuedBy/preparedBy trong response list/detail của
 * meeting-minutes (yêu cầu FE — BE_REQUIREMENT_meeting_minutes_list_fields.md):
 * cần jobTitle + department + avatarUrl ngoài id/fullName/email cơ bản.
 */
export class DepartmentSummaryDto {
  id: string;
  departmentName: string;

  constructor(id: string, departmentName: string) {
    this.id = id;
    this.departmentName = departmentName;
  }
}

export class UserProfileSummaryDto {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  department: DepartmentSummaryDto | null;
  avatarUrl: string | null;

  constructor(data: UserProfileSummaryDto) {
    Object.assign(this, data);
  }
}
