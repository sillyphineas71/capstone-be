import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AttendanceController } from '../controllers/attendance.controller.js';
import { AttendanceService } from '../services/attendance.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('AttendanceController.getAttendanceRecordDetail (UC-82)', () => {
  let controller: AttendanceController;
  const mockService = {
    getAttendanceRecordDetail: jest.fn(),
    getAttendanceList: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [{ provide: AttendanceService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<AttendanceController>(AttendanceController);
  });

  afterEach(() => jest.clearAllMocks());

  const meetingId = '550e8400-e29b-41d4-a716-446655440000';
  const recordId = '550e8400-e29b-41d4-a716-446655440001';

  it('[C1] goi service dung (meetingId,recordId,userId) & tra {success,message,data}', async () => {
    const data = { id: recordId, userFullName: 'A', editHistory: [] };
    mockService.getAttendanceRecordDetail.mockResolvedValue(data);

    const result = await controller.getAttendanceRecordDetail(
      meetingId,
      recordId,
    );

    expect(mockService.getAttendanceRecordDetail).toHaveBeenCalledWith(
      meetingId,
      recordId,
    );
    expect(result).toEqual({
      success: true,
      message: 'Attendance record detail retrieved successfully',
      data,
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { getAttendanceRecordDetail, getAttendanceList } =
    AttendanceController.prototype;

  it('[C2] @RequirePermissions attendance.read + PermissionsGuard tren handler', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      getAttendanceRecordDetail,
    ) as string[];
    expect(permissions).toEqual(['attendance.read']);

    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      getAttendanceRecordDetail,
    ) as unknown[];
    expect(guards).toEqual([PermissionsGuard]);
  });

  it('[C3] route order — detail path = :recordId (dong), list path = / (khong nuot)', () => {
    const detailPath = Reflect.getMetadata(
      PATH_METADATA,
      getAttendanceRecordDetail,
    ) as string;
    const listPath = Reflect.getMetadata(
      PATH_METADATA,
      getAttendanceList,
    ) as string;
    expect(detailPath).toBe(':recordId');
    // list la collection root — path khac hoan toan, khong dung nhau
    expect(listPath === '/' || listPath === '').toBe(true);
  });
});
