import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmResetDto } from './confirm-reset.dto';

describe('ConfirmResetDto', () => {
  const validData = {
    email: 'john.doe@example.com',
    otp: '123456',
    newPassword: 'Password123!',
  };

  it('should validate with correct data', async () => {
    const dto = plainToInstance(ConfirmResetDto, validData);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should trim and lowercase email when transformed', async () => {
    const dto = plainToInstance(ConfirmResetDto, {
      ...validData,
      email: '  JOhN.dOe@ExAMPle.COM  ',
    });
    expect(dto.email).toBe('john.doe@example.com');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid OTP length', async () => {
    const dto1 = plainToInstance(ConfirmResetDto, { ...validData, otp: '12345' });
    const dto2 = plainToInstance(ConfirmResetDto, { ...validData, otp: '1234567' });

    const errors1 = await validate(dto1);
    const errors2 = await validate(dto2);

    expect(errors1.length).toBeGreaterThan(0);
    expect(errors2.length).toBeGreaterThan(0);
  });

  it('should reject non-numeric OTP', async () => {
    const dto = plainToInstance(ConfirmResetDto, { ...validData, otp: '12345a' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject passwords not meeting the complexity rules', async () => {
    const invalidPasswords = [
      'short', // too short
      'NoSpecial123', // missing special character
      'nospecialandlower123!', // missing uppercase letter
      'NOSPECIALANDUPPER123!', // missing lowercase letter
      'NoSpecialAndNoNumber!', // missing number
    ];

    for (const password of invalidPasswords) {
      const dto = plainToInstance(ConfirmResetDto, { ...validData, newPassword: password });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});
