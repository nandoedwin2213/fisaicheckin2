import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CrearPacienteDto {
  @IsString()
  @Length(10, 10)
  @Matches(/^\d{10}$/, { message: 'cedula debe tener 10 dígitos' })
  cedula!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Fa-f\s:.-]{8,32}$/, { message: 'uid debe ser hexadecimal' })
  uid?: string;
}

export class AsignarTarjetaDto {
  @IsString()
  @Matches(/^[0-9A-Fa-f\s:.-]{8,32}$/, { message: 'uid debe ser hexadecimal' })
  uid!: string;
}
