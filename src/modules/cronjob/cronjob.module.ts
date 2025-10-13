import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronService } from './cronjob.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [CronService],
  exports: [CronService],
})
export class CronModule {}