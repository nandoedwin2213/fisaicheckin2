import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Configuración compartida por el arranque real y las pruebas de integración. */
export function configurarApp(app: NestExpressApplication): void {
  // Panel de caja: estático, consume la misma API con X-Staff-Key.
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/panel' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
