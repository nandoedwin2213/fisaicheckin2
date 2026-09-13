import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { CheckinModule } from './checkin/checkin.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RechargeModule } from './recharge/recharge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Un terminal legítimo lee como mucho una tarjeta cada pocos segundos.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 30) }]),
    PrismaModule,
    CheckinModule,
    RechargeModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
