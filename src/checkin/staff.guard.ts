import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { comparacionSegura } from './terminal-key';

/**
 * Protege los endpoints que usa recepción (FISAI Flow) con la clave compartida STAFF_API_KEY.
 * Sustituible por el guard de usuario de FISAI Flow sin tocar el servicio.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const esperada = this.config.get<string>('STAFF_API_KEY');
    if (!esperada) throw new UnauthorizedException('STAFF_API_KEY no configurada');

    const request = context.switchToHttp().getRequest<Request>();
    const recibida = request.header('x-staff-key');
    if (!recibida || !comparacionSegura(recibida, esperada)) {
      throw new UnauthorizedException('Credencial de recepción inválida');
    }
    return true;
  }
}
