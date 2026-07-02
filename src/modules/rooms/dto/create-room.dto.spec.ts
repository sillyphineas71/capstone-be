import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRoomDto } from './create-room.dto.js';

describe('CreateRoomDto Validation', () => {
  const validDto = {
    roomCode: 'R301',
    roomName: 'Phong hop 301',
    capacity: 12,
    roomType: 'meeting_room',
    hasCamera: true,
    hasMicrophone: false,
    allowRecording: true,
  };

  describe('roomCode', () => {
    it('should accept valid roomCode', async () => {
      const dto = plainToInstance(CreateRoomDto, validDto);
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomCode');
      expect(fieldErrors.length).toBe(0);
    });

    it('should reject empty roomCode', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...validDto, roomCode: '' });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject roomCode with lowercase letters', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        roomCode: 'r301',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject roomCode with special characters', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        roomCode: 'ROOM_101',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should accept hyphenated roomCode', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        roomCode: 'A-B-C',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomCode');
      expect(fieldErrors.length).toBe(0);
    });

    it('should reject roomCode shorter than 3 chars', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        roomCode: 'AB',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });
  });

  describe('roomName', () => {
    it('should accept valid roomName', async () => {
      const dto = plainToInstance(CreateRoomDto, validDto);
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomName');
      expect(fieldErrors.length).toBe(0);
    });

    it('should reject empty roomName', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...validDto, roomName: '' });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomName');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject missing roomName', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        roomCode: 'R301',
        capacity: 12,
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomName');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });
  });

  describe('capacity', () => {
    it('should accept valid capacity', async () => {
      const dto = plainToInstance(CreateRoomDto, validDto);
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'capacity');
      expect(fieldErrors.length).toBe(0);
    });

    it('should reject capacity = 0', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...validDto, capacity: 0 });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'capacity');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject negative capacity', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...validDto, capacity: -1 });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'capacity');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject capacity > 1000', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        capacity: 1001,
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'capacity');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject non-integer capacity', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        capacity: 12.5,
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'capacity');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject missing capacity', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        roomCode: 'R301',
        roomName: 'Phong',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'capacity');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should accept capacity = 1 (edge)', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...validDto, capacity: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept capacity = 1000 (edge)', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        capacity: 1000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('roomType', () => {
    it('should accept valid roomType', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        roomType: 'board_room',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomType');
      expect(fieldErrors.length).toBe(0);
    });

    it('should reject invalid roomType', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        roomType: 'invalid_type',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomType');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should accept missing roomType (optional, default meeting_room)', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        roomCode: 'R301',
        roomName: 'Phong',
        capacity: 10,
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'roomType');
      expect(fieldErrors.length).toBe(0);
    });
  });

  describe('boolean fields', () => {
    it('should accept missing boolean fields as optional', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        roomCode: 'R301',
        roomName: 'Phong',
        capacity: 10,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject non-boolean hasCamera', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...validDto,
        hasCamera: 'yes',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'hasCamera');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });
  });
});
