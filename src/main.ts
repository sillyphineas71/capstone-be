import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('APP_PORT', 3000);

  await app.listen(port);
}
bootstrap();
