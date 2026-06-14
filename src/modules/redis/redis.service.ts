import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

/**
 * RedisService — Service dùng chung cho cache/session/rate-limit.
 *
 * Lưu ý: REDIS_KEY_PREFIX đã được set ở cấp Redis client (ioredis keyPrefix),
 * nên tất cả key truyền vào đây sẽ được tự động thêm prefix.
 *
 * Không lưu password, token raw, OTP, secret vào đây trực tiếp.
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: Redis,
  ) {}

  /**
   * Lấy giá trị theo key. Trả về null nếu không tồn tại.
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Lấy giá trị và parse JSON. Trả về null nếu không tồn tại hoặc parse lỗi.
   */
  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      this.logger.warn(`Failed to parse Redis JSON for key: ${key}`);
      return null;
    }
  }

  /**
   * Set giá trị (không TTL).
   */
  async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  /**
   * Set giá trị với TTL (giây).
   */
  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  /**
   * Set JSON object với TTL (giây).
   */
  async setJsonWithTtl<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /**
   * Xóa key.
   */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Kiểm tra key có tồn tại không.
   */
  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  /**
   * Tăng giá trị integer của key lên 1. Trả về giá trị sau khi tăng.
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Set TTL cho key (giây).
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  /**
   * Lấy TTL còn lại của key (giây). Trả về -1 nếu không có TTL, -2 nếu key không tồn tại.
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Ping Redis — dùng cho health check.
   */
  async ping(): Promise<string> {
    return this.client.ping();
  }

  /**
   * Expose raw ioredis client nếu cần thao tác nâng cao.
   * Dùng cẩn thận — không dùng cho business logic thông thường.
   */
  getClient(): Redis {
    return this.client;
  }
}
