import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateAgendaItemDto } from './update-agenda-item.dto.js';

describe('UpdateAgendaItemDto Validation', () => {
  it('[T007-1] should accept an empty body at the DTO level', async () => {
    const dto = plainToInstance(UpdateAgendaItemDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('[T007-2] should accept a partial payload with only title', async () => {
    const dto = plainToInstance(UpdateAgendaItemDto, {
      title: 'New title',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  describe('title', () => {
    it('[T007-3] should reject a title longer than 255 characters', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, {
        title: 'a'.repeat(256),
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'title')).toBe(true);
    });

    it('[T007-4] should reject a non-string title', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, { title: 123 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'title')).toBe(true);
    });
  });

  describe('description', () => {
    it('[T007-5] should reject a description longer than 2000 characters', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, {
        description: 'a'.repeat(2001),
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'description')).toBe(true);
    });

    it('[T007-6] should accept an explicit null description', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, { description: null });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'description')).toBe(false);
    });
  });

  describe('ownerId', () => {
    it('[T007-7] should reject an invalid UUID', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, {
        ownerId: 'not-a-uuid',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'ownerId')).toBe(true);
    });

    it('[T007-8] should accept an explicit null ownerId (un-assign)', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, { ownerId: null });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'ownerId')).toBe(false);
    });

    it('[T007-9] should accept a valid UUID', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, {
        ownerId: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'ownerId')).toBe(false);
    });
  });

  describe('plannedDurationMinutes', () => {
    it('[T007-10] should reject zero or negative values', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, {
        plannedDurationMinutes: 0,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'plannedDurationMinutes')).toBe(
        true,
      );
    });

    it('[T007-11] should reject a non-integer value', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, {
        plannedDurationMinutes: 12.5,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'plannedDurationMinutes')).toBe(
        true,
      );
    });

    it('[T007-12] should accept a positive integer', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, {
        plannedDurationMinutes: 30,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'plannedDurationMinutes')).toBe(
        false,
      );
    });
  });

  describe('agendaOrder', () => {
    it('[T007-13] should reject a non-integer value', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, { agendaOrder: 1.5 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'agendaOrder')).toBe(true);
    });

    it('[T007-14] should reject a value below 1', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, { agendaOrder: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'agendaOrder')).toBe(true);
    });

    it('[T007-15] should accept a positive integer', async () => {
      const dto = plainToInstance(UpdateAgendaItemDto, { agendaOrder: 2 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'agendaOrder')).toBe(false);
    });
  });
});
