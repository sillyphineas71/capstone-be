import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface SaveFileOptions {
  /** Buffer hoặc nội dung file */
  buffer: Buffer;
  /** Tên file gốc (chỉ dùng để lấy extension) */
  originalName: string;
  /** Subfolder trong storage root (VD: 'recordings', 'avatars') */
  folder?: string;
  /** Key override — nếu không truyền sẽ auto-generate */
  storageKey?: string;
}

export interface SaveFileResult {
  storageKey: string;
  publicUrl: string;
  sizeBytes: number;
}

/**
 * StorageService — Quản lý file storage.
 *
 * Hiện tại: local adapter.
 * Tương lai: S3/MinIO adapter — chỉ cần implement interface tương tự.
 *
 * Mọi path đều resolve từ STORAGE_LOCAL_PATH (mặc định: ./uploads).
 * URL public được build từ STORAGE_PUBLIC_BASE_URL.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageDriver: string;
  private readonly localPath: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.storageDriver = this.configService.get<string>('STORAGE_DRIVER', 'local');
    this.localPath = this.configService.get<string>('STORAGE_LOCAL_PATH', './uploads');
    this.publicBaseUrl = this.configService.get<string>(
      'STORAGE_PUBLIC_BASE_URL',
      'http://localhost:3000/uploads',
    );
  }

  onModuleInit(): void {
    if (this.storageDriver === 'local') {
      this.ensureLocalDirExists();
    }
    this.logger.log(`StorageService initialized — driver: ${this.storageDriver}`);
  }

  /**
   * Tạo thư mục uploads nếu chưa có.
   */
  private ensureLocalDirExists(): void {
    const resolvedPath = path.resolve(this.localPath);
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      this.logger.log(`Created local storage directory: ${resolvedPath}`);
    }
  }

  /**
   * Sinh storage key từ folder + filename.
   * Format: <folder>/<timestamp>-<random>.<ext>
   */
  getStorageKey(originalName: string, folder?: string): string {
    const ext = path.extname(originalName).toLowerCase();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    const filename = `${timestamp}-${random}${ext}`;
    return folder ? `${folder}/${filename}` : filename;
  }

  /**
   * Lưu file vào storage.
   * Hiện tại: local filesystem.
   */
  async saveFile(options: SaveFileOptions): Promise<SaveFileResult> {
    if (this.storageDriver !== 'local') {
      // TODO: implement S3 adapter
      throw new Error(`Storage driver "${this.storageDriver}" is not yet implemented.`);
    }

    const storageKey = options.storageKey ?? this.getStorageKey(options.originalName, options.folder);
    const resolvedPath = path.resolve(this.localPath, storageKey);
    const dir = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, options.buffer);

    return {
      storageKey,
      publicUrl: this.getPublicUrl(storageKey),
      sizeBytes: options.buffer.length,
    };
  }

  /**
   * Xóa file khỏi storage.
   */
  async deleteFile(storageKey: string): Promise<void> {
    if (this.storageDriver !== 'local') {
      // TODO: implement S3 adapter
      throw new Error(`Storage driver "${this.storageDriver}" is not yet implemented.`);
    }

    const resolvedPath = path.resolve(this.localPath, storageKey);
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
      this.logger.log(`Deleted file: ${storageKey}`);
    } else {
      this.logger.warn(`File not found for deletion: ${storageKey}`);
    }
  }

  /**
   * Build public URL từ storageKey.
   */
  getPublicUrl(storageKey: string): string {
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return `${base}/${storageKey}`;
  }

  /**
   * Kiểm tra thư mục local storage có tồn tại và có thể ghi không.
   * Dùng cho health check.
   */
  checkLocalStorageAccess(): { accessible: boolean; path: string; error?: string } {
    if (this.storageDriver !== 'local') {
      return { accessible: true, path: 'remote', error: undefined };
    }

    const resolvedPath = path.resolve(this.localPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        return { accessible: false, path: resolvedPath, error: 'Directory does not exist' };
      }
      fs.accessSync(resolvedPath, fs.constants.W_OK);
      return { accessible: true, path: resolvedPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { accessible: false, path: resolvedPath, error: message };
    }
  }

  getDriver(): string {
    return this.storageDriver;
  }
}
