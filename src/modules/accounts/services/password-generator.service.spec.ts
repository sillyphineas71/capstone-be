import { Test, TestingModule } from '@nestjs/testing';
import { PasswordGeneratorService } from './password-generator.service.js';

describe('PasswordGeneratorService', () => {
  let service: PasswordGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordGeneratorService],
    }).compile();

    service = module.get<PasswordGeneratorService>(PasswordGeneratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate password of specified length', () => {
    const pwd12 = service.generateTemporaryPassword(12);
    expect(pwd12.length).toBe(12);

    const pwd15 = service.generateTemporaryPassword(15);
    expect(pwd15.length).toBe(15);
  });

  it('should satisfy password complexity requirements', () => {
    for (let i = 0; i < 100; i++) {
      const pwd = service.generateTemporaryPassword(12);

      expect(pwd).toMatch(/[A-Z]/); // at least one uppercase
      expect(pwd).toMatch(/[a-z]/); // at least one lowercase
      expect(pwd).toMatch(/[0-9]/); // at least one digit
      expect(pwd).toMatch(/[@#$%^&*!_\-+=]/); // at least one special char
    }
  });

  it('should throw an error for invalid lengths', () => {
    expect(() => service.generateTemporaryPassword(3)).toThrow();
  });
});
