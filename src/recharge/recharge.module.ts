import { Module } from '@nestjs/common';
import { StaffGuard } from '../checkin/staff.guard';
import { RechargeController } from './recharge.controller';
import { RechargeService } from './recharge.service';

@Module({
  controllers: [RechargeController],
  providers: [RechargeService, StaffGuard],
})
export class RechargeModule {}
