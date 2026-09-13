import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CheckinDto {
  @IsString()
  @Matches(/^[0-9A-Fa-f\s:.-]{8,32}$/, { message: 'uid debe ser hexadecimal' })
  uid!: string;
}

export class CheckinManualDto {
  @IsString()
  @Length(10, 10)
  @Matches(/^\d{10}$/, { message: 'cedula debe tener 10 dígitos' })
  cedula!: string;

  @IsString()
  terminalId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  registradoPor?: string;
}
