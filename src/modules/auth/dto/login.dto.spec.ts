import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('accepts valid email and password', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'user@example.com',
      password: 'secret',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid email format', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'invalid-email',
      password: 'secret',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
