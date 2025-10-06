// profile.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SocialModule } from '../social/social.module';
import { CommentsModule } from '../comments/comments.module';
import { LibraryModule } from '../library/library.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), SocialModule, CommentsModule, LibraryModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
