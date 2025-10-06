// playlist.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaylistSong } from './entities/playlist-song.entity';
import { Playlist } from './entities/playlist.entity';
import { PlaylistController } from './playlist.controller';
import { PlaylistService } from './playlist.service';
import { ImportService } from './import.service';
import { MusicModule } from '../music/music.module';

@Module({
  imports: [TypeOrmModule.forFeature([Playlist, PlaylistSong]), MusicModule],
  controllers: [PlaylistController],
  providers: [PlaylistService, ImportService],
})
export class PlaylistModule {}

