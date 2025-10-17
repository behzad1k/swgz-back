// playlist.service.ts
import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlaylistSong } from './entities/playlist-song.entity';
import { Playlist, PlaylistSource } from './entities/playlist.entity';
import { User, SubscriptionPlan } from '../users/entities/user.entity';
import { MusicService } from '../music/music.service';

@Injectable()
export class PlaylistService {
  constructor(
    @InjectRepository(Playlist)
    private playlistRepository: Repository<Playlist>,
    @InjectRepository(PlaylistSong)
    private playlistSongRepository: Repository<PlaylistSong>,
    private musicService: MusicService,
  ) {}

  async create(userId: string, name: string, description: string, user: User) {
    const count = await this.playlistRepository.count({ where: { userId } });

    if (user.subscriptionPlan === SubscriptionPlan.FREE && count >= 3) {
      throw new ForbiddenException('Free plan allows maximum 3 playlists');
    }

    const playlist = this.playlistRepository.create({
      userId,
      title: name,
      description,
      source: PlaylistSource.USER,
    });

    return this.playlistRepository.save(playlist);
  }

  async getUserPlaylists(userId: string) {
    return this.playlistRepository.find({
      where: { userId },
      relations: ['songs', 'songs.song'],
      order: { createdAt: 'DESC' },
    });
  }

  async getPlaylist(playlistId: string, userId: string) {
    const playlist = await this.playlistRepository.findOne({
      where: { id: playlistId, userId },
      relations: ['songs', 'songs.song'],
    });

    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }

    return playlist;
  }

  async addSong(playlistId: string, songData: any, userId: string) {
    const playlist = await this.playlistRepository.findOne({
      where: { id: playlistId, userId },
    });

    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }

    if (!playlist.isEditable) {
      throw new BadRequestException('Playlist is not editable');
    }

    const song = await this.musicService.getOrCreateSong(songData);

    const maxPosition = await this.playlistSongRepository
    .createQueryBuilder('ps')
    .select('MAX(ps.position)', 'max')
    .where('ps.playlistId = :playlistId', { playlistId })
    .getRawOne();

    const playlistSong = this.playlistSongRepository.create({
      playlistId,
      songId: song.id,
      position: (maxPosition?.max || 0) + 1,
    });

    return this.playlistSongRepository.save(playlistSong);
  }

  async removeSong(playlistId: string, songId: string, userId: string) {
    const playlist = await this.playlistRepository.findOne({
      where: { id: playlistId, userId },
    });

    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }

    if (!playlist.isEditable) {
      throw new BadRequestException('Playlist is not editable');
    }

    await this.playlistSongRepository.delete({ playlistId, songId });
    return { message: 'Song removed from playlist' };
  }

  async delete(playlistId: string, userId: string) {
    const result = await this.playlistRepository.delete({ id: playlistId, userId });
    if (result.affected === 0) {
      throw new NotFoundException('Playlist not found');
    }
    return { message: 'Playlist deleted' };
  }

  async update(playlistId: string, name: string, description: string, userId: string) {
    const playlist = await this.playlistRepository.findOne({
      where: { id: playlistId, userId },
    });

    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }

    playlist.title = name || playlist.title;
    playlist.description = description || playlist.description;

    return this.playlistRepository.save(playlist);
  }
}
