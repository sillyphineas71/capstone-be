import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AddExternalParticipantDto } from './add-external-participant.dto.js';

describe('AddExternalParticipantDto Validation', () => {
  describe('fullName', () => {
    it('should accept valid fullName', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'fullName');
      expect(nameErrors.length).toBe(0);
    });

    it('should reject empty fullName', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: '',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'fullName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject whitespace-only fullName', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: '   ',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'fullName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject missing fullName', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'fullName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });
  });

  describe('email', () => {
    it('should accept valid email', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      const emailErrors = errors.filter((e) => e.property === 'email');
      expect(emailErrors.length).toBe(0);
    });

    it('should reject invalid email format', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'not-an-email',
      });
      const errors = await validate(dto);
      const emailErrors = errors.filter((e) => e.property === 'email');
      expect(emailErrors.length).toBeGreaterThan(0);
    });

    it('should reject missing email', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
      });
      const errors = await validate(dto);
      const emailErrors = errors.filter((e) => e.property === 'email');
      expect(emailErrors.length).toBeGreaterThan(0);
    });
  });

  describe('organizationName (optional)', () => {
    it('should accept valid organizationName', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
        organizationName: 'Cong ty Doi tac ABC',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should be optional - missing is ok', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      const orgErrors = errors.filter((e) => e.property === 'organizationName');
      expect(orgErrors.length).toBe(0);
    });
  });

  describe('phoneNumber (optional)', () => {
    it('should accept valid phoneNumber', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
        phoneNumber: '0901234567',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should be optional - missing is ok', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      const phoneErrors = errors.filter((e) => e.property === 'phoneNumber');
      expect(phoneErrors.length).toBe(0);
    });
  });

  describe('overrideWarnings (optional)', () => {
    it('should accept boolean true', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
        overrideWarnings: true,
      });
      const errors = await validate(dto);
      const ovrErrors = errors.filter((e) => e.property === 'overrideWarnings');
      expect(ovrErrors.length).toBe(0);
    });

    it('should be optional', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('warningToken (optional)', () => {
    it('should accept valid string', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
        warningToken: 'some-token-value',
      });
      const errors = await validate(dto);
      const tokenErrors = errors.filter((e) => e.property === 'warningToken');
      expect(tokenErrors.length).toBe(0);
    });

    it('should be optional', async () => {
      const dto = plainToInstance(AddExternalParticipantDto, {
        fullName: 'Nguyen Van Khach',
        email: 'khach@partner.com',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
