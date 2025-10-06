// library.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LibrarySong } from './entities/library-song.entity';
import { Song } from '../music/entities/song.entity';
import { Activity } from '../social/entities/social.entities';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { MusicModule } from '../music/music.module';
import { SwagzModule } from '../swagz/swagz.module';

@Module({
  imports: [TypeOrmModule.forFeature([LibrarySong, Song, Activity]), MusicModule, SwagzModule],
  controllers: [LibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}
