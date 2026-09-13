import { Module } from '@nestjs/common';
import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { StaffGuard } from './staff.guard';

@Module({
  controllers: [CheckinController],
  providers: [CheckinService, StaffGuard],
  exports: [CheckinService],
})
export class CheckinModule {}
