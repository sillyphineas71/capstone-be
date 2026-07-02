import { validate } from 'class-validator';
import {
  QueryAttendanceDto,
  AttendanceQueryStatusList,
} from '../dto/query-attendance.dto.js';

describe('QueryAttendanceDto', () => {
  it('should pass validation with valid params', async () => {
    const dto = new QueryAttendanceDto();
    dto.status = 'present';
    dto.search = 'Nguyen';
    dto.page = 1;
    dto.pageSize = 20;
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation with invalid status', async () => {
    const dto = new QueryAttendanceDto();
    (dto as any).status = 'invalid_status';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail validation when search exceeds 100 chars', async () => {
    const dto = new QueryAttendanceDto();
    dto.search = 'a'.repeat(101);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail validation when page < 1', async () => {
    const dto = new QueryAttendanceDto();
    (dto as any).page = 0;
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail validation when pageSize > 100', async () => {
    const dto = new QueryAttendanceDto();
    (dto as any).pageSize = 101;
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept all valid status values', async () => {
    for (const status of AttendanceQueryStatusList) {
      const dto = new QueryAttendanceDto();
      dto.status = status;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    }
  });

  it('should use default values when not provided', () => {
    const dto = new QueryAttendanceDto();
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
  });
});
