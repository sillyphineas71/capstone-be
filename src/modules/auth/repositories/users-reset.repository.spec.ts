import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { UsersResetRepository } from './users-reset.repository';

describe('UsersResetRepository', () => {
  let repository: UsersResetRepository;
  let dataSource: {
    query: jest.Mock;
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersResetRepository,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    repository = module.get<UsersResetRepository>(UsersResetRepository);
  });

  describe('findByEmailForReset', () => {
    const email = 'test@example.com';

    it('should return user record when user exists', async () => {
      const mockDbRow = [
        {
          id: 'user-uuid',
          email: 'test@example.com',
          password_hash: 'hashedpassword',
          account_status: 'active',
          employment_status: 'active',
          deleted_at: null,
        },
      ];
      dataSource.query.mockResolvedValue(mockDbRow);

      const result = await repository.findByEmailForReset(email);

      expect(result).toEqual({
        id: 'user-uuid',
        email: 'test@example.com',
        passwordHash: 'hashedpassword',
        accountStatus: 'active',
        employmentStatus: 'active',
        deletedAt: null,
      });
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
        email,
      ]);
    });

    it('should return null when user does not exist', async () => {
      dataSource.query.mockResolvedValue([]);

      const result = await repository.findByEmailForReset(email);

      expect(result).toBeNull();
    });
  });

  describe('updatePasswordInTransaction', () => {
    it('should execute update query inside a transaction', async () => {
      const userId = 'user-uuid';
      const newHash = 'newhashedpassword';
      const transactionalEntityManager = {
        query: jest.fn().mockResolvedValue({}),
      };

      dataSource.transaction.mockImplementation(async (cb) => {
        return cb(transactionalEntityManager);
      });

      await repository.updatePasswordInTransaction(userId, newHash);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(transactionalEntityManager.query).toHaveBeenCalledWith(
        expect.any(String),
        [userId, newHash],
      );
    });
  });
});
