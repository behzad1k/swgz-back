// swagz.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { SwagzController } from './swagz.controller';
import { SwagzService } from './swagz.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [SwagzController],
  providers: [SwagzService],
  exports: [SwagzService],
})
export class SwagzModule {}