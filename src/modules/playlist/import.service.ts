import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn } from 'child_process';
import { PlaylistSong } from './entities/playlist-song.entity';
import { Playlist, PlaylistSource } from './entities/playlist.entity';
import { User, SubscriptionPlan } from '../users/entities/user.entity';
import { MusicService } from '../music/music.service';

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(Playlist)
    private playlistRepository: Repository<Playlist>,
    @InjectRepository(PlaylistSong)
    private playlistSongRepository: Repository<PlaylistSong>,
    private musicService: MusicService,
  ) {}

  async importFromSpotify(playlistUrl: string, user: User) {
    if (user.subscriptionPlan === SubscriptionPlan.FREE) {
      throw new ForbiddenException('Premium subscription required for playlist import');
    }

    const tracks = await this.fetchSpotifyPlaylist(playlistUrl);
    return this.createPlaylistFromTracks(user.id, tracks, PlaylistSource.SPOTIFY, playlistUrl);
  }

  async importFromYoutube(playlistUrl: string, user: User) {
    if (user.subscriptionPlan === SubscriptionPlan.FREE) {
      throw new ForbiddenException('Premium subscription required for playlist import');
    }

    const tracks = await this.fetchYoutubePlaylist(playlistUrl);
    return this.createPlaylistFromTracks(user.id, tracks, PlaylistSource.YOUTUBE, playlistUrl);
  }

  private async fetchSpotifyPlaylist(playlistUrl: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const configPath = process.env.SLDL_CONFIG_PATH || 'config/sldl.conf';
      const args = [playlistUrl, '--print', 'tracks', '-c', configPath, '--no-progress'];
      const sldl = spawn(process.env.SLDL_PATH, args);

      let output = '';

      sldl.stdout.on('data', (data) => {
        output += data.toString();
      });

      sldl.on('close', (code) => {
        if (code === 0) {
          const tracks = this.parseTracksOutput(output);
          resolve(tracks);
        } else {
          reject(new Error('Failed to fetch Spotify playlist'));
        }
      });

      sldl.on('error', reject);
    });
  }

  private async fetchYoutubePlaylist(playlistUrl: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const configPath = process.env.SLDL_CONFIG_PATH || 'config/sldl.conf';
      const args = [playlistUrl, '--print', 'tracks', '-c', configPath, '--no-progress'];
      const sldl = spawn(process.env.SLDL_PATH, args);

      let output = '';

      sldl.stdout.on('data', (data) => {
        output += data.toString();
      });

      sldl.on('close', (code) => {
        if (code === 0) {
          const tracks = this.parseTracksOutput(output);
          resolve(tracks);
        } else {
          reject(new Error('Failed to fetch YouTube playlist'));
        }
      });

      sldl.on('error', reject);
    });
  }

  private parseTracksOutput(output: string): any[] {
    const lines = output.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const match = line.match(/(.+?)\s-\s(.+)/);
      if (match) {
        return { artist: match[1].trim(), title: match[2].trim() };
      }
      return null;
    }).filter(Boolean);
  }

  private async createPlaylistFromTracks(
    userId: string,
    tracks: any[],
    source: PlaylistSource,
    externalId: string,
  ) {
    const playlistName = `Imported from ${source} - ${new Date().toLocaleDateString()}`;

    const playlist = this.playlistRepository.create({
      userId,
      name: playlistName,
      source,
      externalId,
      isEditable: true,
    });

    await this.playlistRepository.save(playlist);

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const song = await this.musicService.getOrCreateSong({
        title: track.title,
        artistName: track.artist,
      });

      const playlistSong = this.playlistSongRepository.create({
        playlistId: playlist.id,
        songId: song.id,
        position: i,
      });

      await this.playlistSongRepository.save(playlistSong);
    }

    return this.playlistRepository.findOne({
      where: { id: playlist.id },
      relations: ['songs', 'songs.song'],
    });
  }
}