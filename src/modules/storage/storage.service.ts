import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
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
    this.storageDriver = this.configService.get<string>(
      'STORAGE_DRIVER',
      'local',
    );
    this.localPath = this.configService.get<string>(
      'STORAGE_LOCAL_PATH',
      './uploads',
    );
    this.publicBaseUrl = this.configService.get<string>(
      'STORAGE_PUBLIC_BASE_URL',
      'http://localhost:3000/uploads',
    );
  }

  onModuleInit(): void {
    if (this.storageDriver === 'local') {
      this.ensureLocalDirExists();
    }
    this.logger.log(
      `StorageService initialized — driver: ${this.storageDriver}`,
    );
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
      throw new Error(
        `Storage driver "${this.storageDriver}" is not yet implemented.`,
      );
    }

    const storageKey =
      options.storageKey ??
      this.getStorageKey(options.originalName, options.folder);
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
      throw new Error(
        `Storage driver "${this.storageDriver}" is not yet implemented.`,
      );
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
   * Đọc bytes file local (FPE-001). SEC-03: chống path-traversal — resolved phải nằm
   * trong localPath; file thiếu → ném lỗi rõ.
   */
  getFile(storageKey: string): Buffer {
    if (this.storageDriver !== 'local') {
      throw new Error(
        `Storage driver "${this.storageDriver}" is not yet implemented.`,
      );
    }
    const base = path.resolve(this.localPath);
    const resolved = path.resolve(this.localPath, storageKey);
    if (!(resolved === base || resolved.startsWith(base + path.sep))) {
      throw new Error('Invalid storage key (path traversal).');
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('File not found.');
    }
    return fs.readFileSync(resolved);
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
  checkLocalStorageAccess(): {
    accessible: boolean;
    path: string;
    error?: string;
  } {
    if (this.storageDriver !== 'local') {
      return { accessible: true, path: 'remote', error: undefined };
    }

    const resolvedPath = path.resolve(this.localPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        return {
          accessible: false,
          path: resolvedPath,
          error: 'Directory does not exist',
        };
      }
      fs.accessSync(resolvedPath, fs.constants.W_OK);
      return { accessible: true, path: resolvedPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { accessible: false, path: resolvedPath, error: message };
    }
  }


  /**
   * Generate a signed download token (HMAC-SHA256) for a media file.
   * Token contains mediaFileId + expiry, signed with MEDIA_DOWNLOAD_TOKEN_SECRET.
   */
  generateSignedDownloadToken(
    mediaFileId: string,
    ttlSeconds?: number,
  ): { token: string; expiresAt: string } {
    const secret = this.configService.get<string>(
      'MEDIA_DOWNLOAD_TOKEN_SECRET', '',
    );
    if (!secret) {
      throw new Error('MEDIA_DOWNLOAD_TOKEN_SECRET is not configured');
    }
    const defaultTtl = this.configService.get<number>(
      'MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS', 600,
    );
    const ttl = ttlSeconds ?? defaultTtl;
    const expiresAtEpochMs = Date.now() + ttl * 1000;
    const expiresAt = new Date(expiresAtEpochMs).toISOString();
    const payload = mediaFileId + '|' + expiresAtEpochMs;
    const hmac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    const token = Buffer.from(payload + '.' + hmac).toString('base64url');
    return { token, expiresAt };
  }

  /**
   * Verify a signed download token. Returns the mediaFileId if valid, null otherwise.
   */
  verifySignedDownloadToken(token: string): { mediaFileId: string } | null {
    const secret = this.configService.get<string>(
      'MEDIA_DOWNLOAD_TOKEN_SECRET', '',
    );
    if (!secret) return null;
    let decoded;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch { return null; }
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot === -1) return null;
    const payload = decoded.slice(0, lastDot);
    const receivedHmac = decoded.slice(lastDot + 1);
    const expectedHmac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    if (receivedHmac.length !== expectedHmac.length) return null;
    try {
      if (!crypto.timingSafeEqual(
        Buffer.from(receivedHmac, 'utf8'),
        Buffer.from(expectedHmac, 'utf8'),
      )) return null;
    } catch { return null; }
    const lastPipe = payload.lastIndexOf('|');
    if (lastPipe === -1) return null;
    const mediaFileId = payload.slice(0, lastPipe);
    const expiresAtEpochMs = parseInt(payload.slice(lastPipe + 1), 10);
    if (Date.now() > expiresAtEpochMs) return null;
    return { mediaFileId };
  }
  getDriver(): string {
    return this.storageDriver;
  }
}

