// download.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LibrarySong } from '../library/entities/library-song.entity';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';
import { MusicModule } from '../music/music.module';

@Module({
  imports: [TypeOrmModule.forFeature([LibrarySong]), MusicModule],
  controllers: [DownloadController],
  providers: [DownloadService],
})
export class DownloadModule {}