import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Tăng giới hạn payload body (để nhận base64 image/json lớn từ IoT device)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Middleware debug: Chỉ in log cho tín hiệu Heartbeat, Verify và Stranger từ Camera
  app.use((req: any, res: any, next: any) => {
    if (req.originalUrl.includes('/hb/') || req.originalUrl.includes('/vf/') || req.originalUrl.includes('/sf/')) {
      console.log(`[IoT Event] ${req.method} ${req.originalUrl}`);
    }
    next();
  });

  // Kích hoạt tiền tố toàn cục /api/v1 theo tài liệu đặc tả thiết kế
  app.setGlobalPrefix('api/v1');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('APP_PORT', 3000);

  await app.listen(port, '0.0.0.0');
}
bootstrap();
