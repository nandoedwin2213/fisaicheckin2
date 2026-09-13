import { Body, Controller, Headers, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CheckinService } from './checkin.service';
import { CheckinDto, CheckinManualDto, FinUsoDto } from './dto';
import { StaffGuard } from './staff.guard';

@Controller('checkin')
export class CheckinController {
  constructor(private readonly service: CheckinService) {}

  /** Llamado por el ESP32. Autenticación por header X-Terminal-Key. */
  @Post()
  checkin(@Body() dto: CheckinDto, @Headers('x-terminal-key') apiKey?: string) {
    if (!apiKey) throw new UnauthorizedException('Falta X-Terminal-Key');
    return this.service.checkinPorTarjeta(dto.uid, apiKey);
  }

  /** Llamado por el ESP32 al apagar el equipo: cierra el uso por minutos y lo cobra. */
  @Post('fin')
  fin(@Body() dto: FinUsoDto, @Headers('x-terminal-key') apiKey?: string) {
    if (!apiKey) throw new UnauthorizedException('Falta X-Terminal-Key');
    return this.service.finalizarUso(dto.usoId, dto.segundos, apiKey);
  }

  /** Llamado desde FISAI Flow (recepción) cuando el paciente olvidó la tarjeta. */
  @Post('manual')
  @UseGuards(StaffGuard)
  manual(@Body() dto: CheckinManualDto) {
    return this.service.checkinManual(dto.cedula, dto.terminalId, dto.registradoPor);
  }
}
