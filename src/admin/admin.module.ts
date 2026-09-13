import { Module } from '@nestjs/common';
import { StaffGuard } from '../checkin/staff.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, StaffGuard],
})
export class AdminModule {}
