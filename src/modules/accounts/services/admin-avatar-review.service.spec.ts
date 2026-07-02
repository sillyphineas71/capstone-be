import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AdminAvatarReviewService } from './admin-avatar-review.service.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { StorageService } from '../../storage/storage.service.js';

describe('AdminAvatarReviewService', () => {
  let service: AdminAvatarReviewService;
  let faceProfileRepo: Repository<FaceProfileEntity>;
  let dataSource: DataSource;

  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  const mockRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockDataSource = {
    manager: {
      query: jest.fn(),
      insert: jest.fn(),
    },
    transaction: jest.fn(),
  };

  const mockStorageService = {
    generateSignedDownloadToken: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAvatarReviewService,
        {
          provide: getRepositoryToken(FaceProfileEntity),
          useValue: mockRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AdminAvatarReviewService>(AdminAvatarReviewService);
    faceProfileRepo = module.get<Repository<FaceProfileEntity>>(
      getRepositoryToken(FaceProfileEntity),
    );
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listAvatarSubmissions', () => {
    it('should query avatar submissions and return correctly formatted data', async () => {
      const mockItems = [
        {
          id: 'fp-1',
          userId: 'user-1',
          status: FaceProfileStatus.PENDING_REVIEW,
          enrolledAt: new Date('2026-06-24T12:00:00Z'),
          primaryImageFileId: 'media-1',
          qualityScore: 95.5,
          user: {
            id: 'user-1',
            fullName: 'Nguyen Van A',
            email: 'a.nguyen@example.com',
            employeeCode: 'EMP001',
            department: {
              id: 'dept-1',
              departmentName: 'Software Engineering',
            },
          },
        },
      ];

      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockItems, 1]);

      const query = {
        page: 1,
        limit: 10,
        status: 'pending_review',
        sortBy: 'submittedAt',
        sortOrder: 'desc' as const,
      };

      const result = await service.listAvatarSubmissions(query);

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('fp');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        faceProfileId: 'fp-1',
        userId: 'user-1',
        fullName: 'Nguyen Van A',
        email: 'a.nguyen@example.com',
        employeeCode: 'EMP001',
        departmentName: 'Software Engineering',
        status: FaceProfileStatus.PENDING_REVIEW,
        submittedAt: mockItems[0].enrolledAt,
        primaryImageFileId: 'media-1',
        qualityScore: 95.5,
      });
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });
  });
});
