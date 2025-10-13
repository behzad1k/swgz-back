import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { typeOrmConfig } from './config/typeorm.config';
import { AuthModule } from './modules/auth/auth.module';
import { CronModule } from './modules/cronjob/cronjob.module';
import { UsersModule } from './modules/users/users.module';
import { MusicModule } from './modules/music/music.module';
import { PlaylistModule } from './modules/playlist/playlist.module';
import { LibraryModule } from './modules/library/library.module';
import { DownloadModule } from './modules/download/download.module';
import { AdminModule } from './modules/admin/admin.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { CommentsModule } from './modules/comments/comments.module';
import { SocialModule } from './modules/social/social.module';
import { ProfileModule } from './modules/profile/profile.module';
import { SwagzModule } from './modules/swagz/swagz.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot(typeOrmConfig),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    MusicModule,
    PlaylistModule,
    LibraryModule,
    DownloadModule,
    AdminModule,
    SubscriptionModule,
    CommentsModule,
    SocialModule,
    ProfileModule,
    SwagzModule,
    CronModule,
  ],
})
export class AppModule {}