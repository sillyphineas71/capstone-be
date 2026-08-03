import { DocumentBuilder } from '@nestjs/swagger';

/**
 * DocumentBuilder config cho trang docs Swagger/OpenAPI, wire ở `src/main.ts`.
 */
export const SWAGGER_DOCS_PATH = 'api/docs';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Capstone SmarTracking API')
    .setDescription(
      'OpenAPI spec cho FE generate TypeScript types từ BE — SmarTracking backend. ' +
        'Dùng nút Authorize (Bearer JWT) để test trực tiếp trên trang docs.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}
