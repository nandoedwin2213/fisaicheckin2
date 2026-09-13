import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { StaffGuard } from '../checkin/staff.guard';
import { AdminService } from './admin.service';
import { AsignarTarjetaDto, CrearPacienteDto } from './dto';

/** Datos que necesita el panel de caja; todo detrás de X-Staff-Key. */
@Controller('admin')
@UseGuards(StaffGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('paquetes')
  paquetes() {
    return this.service.paquetes();
  }

  @Get('terminales')
  terminales() {
    return this.service.terminales();
  }

  @Post('pacientes')
  crearPaciente(@Body() dto: CrearPacienteDto) {
    return this.service.crearPaciente(dto.cedula, dto.nombre, dto.uid);
  }

  @Post('pacientes/:cedula/tarjeta')
  asignarTarjeta(@Param('cedula') cedula: string, @Body() dto: AsignarTarjetaDto) {
    return this.service.asignarTarjeta(cedula, dto.uid);
  }
}
