import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { useContainer } from 'class-validator';
import { buildSwaggerConfig, SWAGGER_DOCS_PATH } from './config/swagger.config';

// Nest mac dinh dung body-parser cua express voi limit 100kb — qua nho cho
// payload device callback kem anh base64 (vd /internal/ivss/events: JPEG
// snapshot ~100-500KB -> base64 ~150-700KB). Tat bodyParser tu dong cua Nest
// (bodyParser: false) va tu dang ky json/urlencoded voi limit 5mb — du an
// toan cho snapshot, van co tran de tranh DoS qua payload khong lo.
const BODY_LIMIT = '5mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
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
