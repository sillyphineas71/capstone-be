import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { RoomEntity, RoomStatus } from '../entities/room.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { RoomsService } from '../services/rooms.service.js';
import { CreateRoomDto } from '../dto/create-room.dto.js';
import { CreateRoomResponseDto } from '../dto/create-room-response.dto.js';

describe('RoomsService', () => {
  let service: RoomsService;
  let roomRepo: jest.Mocked<Partial<Repository<RoomEntity>>>;
  let dataSource: jest.Mocked<Partial<DataSource>>;

  const mockUserId = '550e8400-e29b-41d4-a716-446655440000';
  const mockRoomId = '660e8400-e29b-41d4-a716-446655440001';

  const validDto: CreateRoomDto = {
    roomCode: 'R301',
    roomName: 'Phong hop 301',
    capacity: 12,
  };

  const mockRoom = {
    id: mockRoomId,
    roomCode: 'R301',
    roomName: 'Phong hop 301',
    capacity: 12,
    roomType: 'meeting_room',
    currentStatus: RoomStatus.AVAILABLE,
    isActive: true,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as RoomEntity;

  beforeEach(async () => {
    roomRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    // Mock DataSource transaction supports multiple calls
    dataSource = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: getRepositoryToken(RoomEntity), useValue: roomRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a room successfully and return response', async () => {
      // No duplicate roomCode
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);
      // No duplicate roomName
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      // First transaction (create room) succeeds
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn().mockReturnValue(mockRoom),
            save: jest.fn().mockResolvedValue(mockRoom),
          };
          return cb(mockEm);
        },
      );

      // Second transaction (audit log — fail-safe) succeeds
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn(),
            save: jest.fn().mockResolvedValue({}),
          };
          return cb(mockEm);
        },
      );

      const result = await service.create(validDto, mockUserId);

      expect(result).toBeInstanceOf(CreateRoomResponseDto);
      expect(result.roomCode).toBe('R301');
      expect(result.roomName).toBe('Phong hop 301');
      expect(result.capacity).toBe(12);
      expect(result.currentStatus).toBe('available');
      expect(result.isActive).toBe(true);
    });

    it('should throw ConflictException when roomCode already exists', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(mockRoom);

      await expect(service.create(validDto, mockUserId)).rejects.toThrow(
        ConflictException,
      );
      // Transaction should NOT be called
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when roomName already exists among non-deleted rooms', async () => {
      // roomCode check passes
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);

      // roomName check fails
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockRoom),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      await expect(service.create(validDto, mockUserId)).rejects.toThrow(
        ConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should still return room when audit log fails (FR-019)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      // First transaction (create room) succeeds
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn().mockReturnValue(mockRoom),
            save: jest.fn().mockResolvedValue(mockRoom),
          };
          return cb(mockEm);
        },
      );

      // Second transaction (audit log) FAILS — but room creation still returns
      (dataSource.transaction as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('DB connection lost');
      });

      const result = await service.create(validDto, mockUserId);
      expect(result).toBeInstanceOf(CreateRoomResponseDto);
      expect(result.roomCode).toBe('R301');
    });

    it('should upperCase roomCode automatically', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      let savedRoomCode = '';
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn((entity, data) => ({ ...data, id: mockRoomId })),
            save: jest.fn().mockImplementation((entity, data) => {
              savedRoomCode = data.roomCode;
              return Promise.resolve({ ...mockRoom, roomCode: data.roomCode });
            }),
          };
          return cb(mockEm);
        },
      );

      // Audit ok
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = { create: jest.fn(), save: jest.fn() };
          return cb(mockEm);
        },
      );

      await service.create({ ...validDto, roomCode: 'r301' }, mockUserId);
      expect(savedRoomCode).toBe('R301');
    });
  });
});
