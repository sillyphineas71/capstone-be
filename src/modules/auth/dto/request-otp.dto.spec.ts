import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestOtpDto } from './request-otp.dto';

describe('RequestOtpDto', () => {
  it('should validate a correct email', async () => {
    const dto = plainToInstance(RequestOtpDto, {
      email: 'john.doe@example.com',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should trim and lowercase email when transformed', async () => {
    const dto = plainToInstance(RequestOtpDto, {
      email: '  JOhN.dOe@ExAMPle.COM  ',
    });

    // Verify transformation
    expect(dto.email).toBe('john.doe@example.com');

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid email format', async () => {
    const dto = plainToInstance(RequestOtpDto, {
      email: 'invalid-email',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject empty email', async () => {
    const dto = plainToInstance(RequestOtpDto, {
      email: '',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
