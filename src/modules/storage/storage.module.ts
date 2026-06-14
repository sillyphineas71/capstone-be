import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service.js';

/**
 * StorageModule — Global module cung cấp StorageService dùng chung.
 *
 * Hiện tại chỉ implement local storage adapter.
 * Structure sẵn cho S3/MinIO adapter sau này.
 *
 * STORAGE_DRIVER=local (default): lưu vào STORAGE_LOCAL_PATH
 * STORAGE_DRIVER=s3: TODO — implement S3Adapter khi cần
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
