import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { useContainer } from 'class-validator';
import { buildSwaggerConfig, SWAGGER_DOCS_PATH } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
