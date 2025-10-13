// library.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LibrarySong } from './entities/library-song.entity';
import { Song } from '../music/entities/song.entity';
import { Activity } from '../social/entities/social.entities';
import { PlayHistory } from './entities/play-history.entity';
import { SearchHistory } from '../music/entities/search-history.entity';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { MusicModule } from '../music/music.module';
import { SwagzModule } from '../swagz/swagz.module';

@Module({
  imports: [TypeOrmModule.forFeature([LibrarySong, Song, Activity, PlayHistory, SearchHistory]), forwardRef(() => MusicModule), SwagzModule],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService],
})
export class LibraryModule {}
