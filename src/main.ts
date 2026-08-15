import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { useContainer } from 'class-validator';
import { buildSwaggerConfig, SWAGGER_DOCS_PATH } from './config/swagger.config';
import { deviceCallbackTimeout } from './config/device-callback-timeout.middleware';

// Nest mac dinh dung body-parser cua express voi limit 100kb — qua nho cho
// payload device callback kem anh base64 (vd /internal/ivss/events: JPEG
// snapshot ~100-500KB -> base64 ~150-700KB). Tat bodyParser tu dong cua Nest
// (bodyParser: false) va tu dang ky json/urlencoded voi limit 5mb — du an
// toan cho snapshot, van co tran de tranh DoS qua payload khong lo.
const BODY_LIMIT = '5mb';

// [FIX 2026-08-15] Timeout rieng cho 3 route callback thiet bi (/vf, /hb, /sf) — LAN noi
// bo nen 15s la du du, khong qua dai gay cho vo ich khi that su treo.
const DEVICE_CALLBACK_TIMEOUT_MS = 15000;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Dang ky TRUOC json()/urlencoded() — phai boc ca giai doan doc body, vi day chinh
  // la noi request treo im lang neu thiet bi gui thieu byte so voi Content-Length.
  app.use(
    ['/api/v1/vf', '/api/v1/hb', '/api/v1/sf'],
    deviceCallbackTimeout(DEVICE_CALLBACK_TIMEOUT_MS),
  );
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ limit: BODY_LIMIT, extended: true }));

  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.setGlobalPrefix('api/v1');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('APP_PORT', 3000);

  app.enableCors({
    origin: configService
      .get<string>('CORS_ORIGIN', 'http://localhost:5173,http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  });

  // Swagger/OpenAPI docs — phơi toàn bộ bề mặt API ra public, gate bằng env
  // để tắt được khi cần (mặc định bật cho demo/bảo vệ).
  const swaggerEnabled = configService.get<boolean>('SWAGGER_ENABLED', true);
  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
    SwaggerModule.setup(SWAGGER_DOCS_PATH, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port);
}
bootstrap();
