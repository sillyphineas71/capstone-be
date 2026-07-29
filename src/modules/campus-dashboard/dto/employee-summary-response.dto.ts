export interface GateAccessTodayItemDto {
  direction: string;
  accessTime: string;
}

export interface EmployeeVehicleStatusDto {
  plateNumber: string;
  status: string;
}

export interface EmployeeSummaryResponseDto {
  gateAccessToday: GateAccessTodayItemDto[];
  /** null nếu user chưa từng tự đăng ký xe (CDB-RS-001 spec §2.7). */
  vehicleStatus: EmployeeVehicleStatusDto | null;
  meetingsToday: number;
}
