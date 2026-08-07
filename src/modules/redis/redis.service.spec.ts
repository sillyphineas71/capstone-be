import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service.js';
import { REDIS_CLIENT } from './redis.constants.js';

/**
 * Unit test cho RedisService.
 * Mock ioredis client — không kết nối Redis thật.
 */
describe('RedisService', () => {
  let service: RedisService;

  const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    ping: jest.fn(),
    sadd: jest.fn(),
    sismember: jest.fn(),
    smembers: jest.fn(),
    srem: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: REDIS_CLIENT, useValue: mockRedisClient },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  describe('get()', () => {
    it('should return value if key exists', async () => {
      mockRedisClient.get.mockResolvedValue('test-value');
      const result = await service.get('my-key');
      expect(result).toBe('test-value');
      expect(mockRedisClient.get).toHaveBeenCalledWith('my-key');
    });

    it('should return null if key does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const result = await service.get('missing-key');
      expect(result).toBeNull();
    });
  });

  describe('getJson()', () => {
    it('should parse JSON and return typed object', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({ id: '123', name: 'test' }),
      );
      const result = await service.getJson<{ id: string; name: string }>(
        'my-json-key',
      );
      expect(result).toEqual({ id: '123', name: 'test' });
    });

    it('should return null if value is null', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const result = await service.getJson('missing');
      expect(result).toBeNull();
    });

    it('should return null on JSON parse error', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json{');
      const result = await service.getJson('bad-key');
      expect(result).toBeNull();
    });
  });

  describe('set()', () => {
    it('should call redis set', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      await service.set('my-key', 'my-value');
      expect(mockRedisClient.set).toHaveBeenCalledWith('my-key', 'my-value');
    });
  });

  describe('setWithTtl()', () => {
    it('should call redis set with EX', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      await service.setWithTtl('my-key', 'my-value', 300);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'my-key',
        'my-value',
        'EX',
        300,
      );
    });
  });

  describe('del()', () => {
    it('should call redis del', async () => {
      mockRedisClient.del.mockResolvedValue(1);
      await service.del('my-key');
      expect(mockRedisClient.del).toHaveBeenCalledWith('my-key');
    });
  });

  describe('exists()', () => {
    it('should return true if key exists', async () => {
      mockRedisClient.exists.mockResolvedValue(1);
      const result = await service.exists('my-key');
      expect(result).toBe(true);
    });

    it('should return false if key does not exist', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      const result = await service.exists('missing-key');
      expect(result).toBe(false);
    });
  });

  describe('incr()', () => {
    it('should call redis incr and return new value', async () => {
      mockRedisClient.incr.mockResolvedValue(5);
      const result = await service.incr('counter-key');
      expect(result).toBe(5);
    });
  });

  describe('expire()', () => {
    it('should call redis expire', async () => {
      mockRedisClient.expire.mockResolvedValue(1);
      await service.expire('my-key', 600);
      expect(mockRedisClient.expire).toHaveBeenCalledWith('my-key', 600);
    });
  });

  describe('ping()', () => {
    it('should return PONG', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      const result = await service.ping();
      expect(result).toBe('PONG');
    });
  });

  describe('sadd()', () => {
    it('should call redis sadd and return count added', async () => {
      mockRedisClient.sadd.mockResolvedValue(1);
      const result = await service.sadd('my-set', 'member-1');
      expect(result).toBe(1);
      expect(mockRedisClient.sadd).toHaveBeenCalledWith('my-set', 'member-1');
    });

    it('should propagate error and log it', async () => {
      mockRedisClient.sadd.mockRejectedValue(new Error('conn refused'));
      await expect(service.sadd('my-set', 'member-1')).rejects.toThrow(
        'conn refused',
      );
    });
  });

  describe('sismember()', () => {
    it('should return true if member exists in set', async () => {
      mockRedisClient.sismember.mockResolvedValue(1);
      const result = await service.sismember('my-set', 'member-1');
      expect(result).toBe(true);
    });

    it('should return false if member does not exist in set', async () => {
      mockRedisClient.sismember.mockResolvedValue(0);
      const result = await service.sismember('my-set', 'member-x');
      expect(result).toBe(false);
    });

    it('should propagate error and log it', async () => {
      mockRedisClient.sismember.mockRejectedValue(new Error('conn refused'));
      await expect(service.sismember('my-set', 'member-1')).rejects.toThrow(
        'conn refused',
      );
    });
  });

  describe('smembers()', () => {
    it('should return all members of the set', async () => {
      mockRedisClient.smembers.mockResolvedValue(['m1', 'm2']);
      const result = await service.smembers('my-set');
      expect(result).toEqual(['m1', 'm2']);
    });

    it('should propagate error and log it', async () => {
      mockRedisClient.smembers.mockRejectedValue(new Error('conn refused'));
      await expect(service.smembers('my-set')).rejects.toThrow('conn refused');
    });
  });

  describe('srem()', () => {
    it('should call redis srem and return count removed', async () => {
      mockRedisClient.srem.mockResolvedValue(1);
      const result = await service.srem('my-set', 'member-1');
      expect(result).toBe(1);
      expect(mockRedisClient.srem).toHaveBeenCalledWith('my-set', 'member-1');
    });

    it('should return 0 when member does not exist', async () => {
      mockRedisClient.srem.mockResolvedValue(0);
      const result = await service.srem('my-set', 'member-x');
      expect(result).toBe(0);
    });

    it('should propagate error and log it', async () => {
      mockRedisClient.srem.mockRejectedValue(new Error('conn refused'));
      await expect(service.srem('my-set', 'member-1')).rejects.toThrow(
        'conn refused',
      );
    });
  });

  describe('getClient()', () => {
    it('should expose the raw Redis client', () => {
      const client = service.getClient();
      expect(client).toBe(mockRedisClient);
    });
  });
});
