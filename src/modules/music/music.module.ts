import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LibraryModule } from '../library/library.module';
import { AmazonService } from './amazon.service';
import { DFiStreamingService } from './DFiStreaming.service';
import { DiscogsService } from './discogs.service';
import { Album } from './entities/album.entity';
import { Artist } from './entities/artist.entity';
import { Song } from './entities/song.entity';
import { SearchHistory } from './entities/search-history.entity';
import { PlayHistory } from '../library/entities/play-history.entity';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';
import { LastfmService } from './lastfm.service';
import { SlskService } from './slsk.service';
import { StreamingService } from './streaming.service';
import { SwagzModule } from '../swagz/swagz.module';
import { YtdlpStreamingService } from './YTDLPStreaming.service';

@Module({
  imports: [TypeOrmModule.forFeature([Song, SearchHistory, PlayHistory, Artist, Album]), SwagzModule, forwardRef(() => LibraryModule)],
  controllers: [MusicController],
  providers: [MusicService, LastfmService, SlskService, StreamingService, DiscogsService, DFiStreamingService, YtdlpStreamingService, AmazonService],
  exports: [MusicService, SlskService],
})
export class MusicModule {}