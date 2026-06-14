import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Unit test cho StorageService.
 * Mock fs module — không đọc/ghi file thật.
 */

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('StorageService', () => {
  let service: StorageService;

  const mockConfigService = (overrides: Record<string, unknown> = {}) => ({
    get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_PATH: './uploads',
        STORAGE_PUBLIC_BASE_URL: 'http://localhost:3000/uploads',
        ...overrides,
      };
      return config[key] ?? defaultValue;
    }),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Mock fs.existsSync để tránh tạo thư mục thật
    mockFs.existsSync.mockReturnValue(true);
    mockFs.accessSync.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfigService() },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    service.onModuleInit();
  });

  describe('getStorageKey()', () => {
    it('should generate key with extension and folder', () => {
      const key = service.getStorageKey('image.jpg', 'avatars');
      expect(key).toMatch(/^avatars\/\d+-[a-z0-9]+\.jpg$/);
    });

    it('should generate key without folder', () => {
      const key = service.getStorageKey('document.pdf');
      expect(key).toMatch(/^\d+-[a-z0-9]+\.pdf$/);
    });
  });

  describe('getPublicUrl()', () => {
    it('should return correct public URL', () => {
      const url = service.getPublicUrl('recordings/test-file.mp4');
      expect(url).toBe('http://localhost:3000/uploads/recordings/test-file.mp4');
    });

    it('should handle base URL with trailing slash', async () => {
      const module = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfigService({
              STORAGE_PUBLIC_BASE_URL: 'http://localhost:3000/uploads/',
            }),
          },
        ],
      }).compile();
      const svc = module.get<StorageService>(StorageService);
      const url = svc.getPublicUrl('test.jpg');
      expect(url).toBe('http://localhost:3000/uploads/test.jpg');
    });
  });

  describe('saveFile()', () => {
    it('should save file and return storageKey and publicUrl', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const buffer = Buffer.from('test content');
      const result = await service.saveFile({
        buffer,
        originalName: 'test.txt',
        folder: 'documents',
      });

      expect(result.storageKey).toMatch(/^documents\/\d+-[a-z0-9]+\.txt$/);
      expect(result.publicUrl).toContain('http://localhost:3000/uploads/');
      expect(result.sizeBytes).toBe(buffer.length);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should use provided storageKey when given', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const result = await service.saveFile({
        buffer: Buffer.from('content'),
        originalName: 'test.txt',
        storageKey: 'custom/key.txt',
      });

      expect(result.storageKey).toBe('custom/key.txt');
    });

    it('should throw for unsupported driver', async () => {
      const module = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfigService({ STORAGE_DRIVER: 's3' }),
          },
        ],
      }).compile();
      const svc = module.get<StorageService>(StorageService);

      await expect(
        svc.saveFile({ buffer: Buffer.from('x'), originalName: 'x.txt' }),
      ).rejects.toThrow('not yet implemented');
    });
  });

  describe('deleteFile()', () => {
    it('should delete file if it exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockReturnValue(undefined);

      await service.deleteFile('test/file.txt');
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should not throw if file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await expect(service.deleteFile('missing/file.txt')).resolves.not.toThrow();
    });
  });

  describe('checkLocalStorageAccess()', () => {
    it('should return accessible=true when directory exists and is writable', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.accessSync.mockReturnValue(undefined);

      const result = service.checkLocalStorageAccess();
      expect(result.accessible).toBe(true);
      expect(result.path).toContain(path.resolve('./uploads'));
    });

    it('should return accessible=false when directory does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = service.checkLocalStorageAccess();
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  describe('getDriver()', () => {
    it('should return the current storage driver', () => {
      expect(service.getDriver()).toBe('local');
    });
  });
});
