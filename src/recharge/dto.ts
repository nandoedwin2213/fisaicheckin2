import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

export class RechargeDto {
  @IsString()
  @Length(10, 10)
  @Matches(/^\d{10}$/, { message: 'cedula debe tener 10 dígitos' })
  cedula!: string;

  @IsUUID()
  packageId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  registradoPor?: string;
}
