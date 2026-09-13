import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { StaffGuard } from '../checkin/staff.guard';
import { RechargeDto } from './dto';
import { RechargeService } from './recharge.service';

/** Caja/recepción: recargas y consulta de saldo. Todo detrás de X-Staff-Key. */
@Controller('recargas')
@UseGuards(StaffGuard)
export class RechargeController {
  constructor(private readonly service: RechargeService) {}

  @Post()
  recargar(@Body() dto: RechargeDto) {
    return this.service.recargar(dto.cedula, dto.packageId, dto.registradoPor);
  }

  @Get(':cedula')
  saldo(@Param('cedula') cedula: string) {
    return this.service.saldo(cedula);
  }
}
