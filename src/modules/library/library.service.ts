
// library.service.ts
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LibrarySong } from './entities/library-song.entity';
import { User, SubscriptionPlan } from '../users/entities/user.entity';
import { MusicService } from '../music/music.service';
import { Song } from '../music/entities/song.entity';
import { Activity, ActivityType } from '../social/entities/social.entities';
import { SwagzService, SwagzAction } from '../swagz/swagz.service';

@Injectable()
export class LibraryService {
  constructor(
    @InjectRepository(LibrarySong)
    private librarySongRepository: Repository<LibrarySong>,
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
    @InjectRepository(Activity)
    private activityRepository: Repository<Activity>,
    private musicService: MusicService,
    private swagzService: SwagzService,
  ) {}

  async addToLibrary(userId: string, songData: any, user: User) {
    const count = await this.librarySongRepository.count({ where: { userId } });

    if (user.subscriptionPlan === SubscriptionPlan.FREE && count >= 100) {
      throw new ForbiddenException('Free plan allows maximum 100 songs in library');
    }

    const song = await this.musicService.getOrCreateSong(songData);

    const existing = await this.librarySongRepository.findOne({
      where: { userId, songId: song.id },
    });

    if (existing) {
      throw new BadRequestException('Song already in library');
    }

    const librarySong = this.librarySongRepository.create({
      userId,
      songId: song.id,
      isLiked: songData.isLiked || false,
    });

    await this.librarySongRepository.save(librarySong);

    if (librarySong.isLiked) {
      await this.songRepository.increment({ id: song.id }, 'likeCount', 1);
      await this.activityRepository.save({
        userId,
        type: ActivityType.LIKE,
        songId: song.id,
      });
      await this.swagzService.awardSwagz(userId, SwagzAction.LIKE);
    }

    return librarySong;
  }

  async removeFromLibrary(userId: string, songId: string) {
    const librarySong = await this.librarySongRepository.findOne({
      where: { userId, songId },
    });

    if (!librarySong) {
      throw new BadRequestException('Song not found in library');
    }

    if (librarySong.isLiked) {
      await this.songRepository.decrement({ id: songId }, 'likeCount', 1);
    }

    await this.librarySongRepository.delete({ userId, songId });
    return { message: 'Song removed from library' };
  }

  async getLibrary(userId: string) {
    return this.librarySongRepository.find({
      where: { userId },
      relations: ['song'],
      order: { addedAt: 'DESC' },
    });
  }

  async getLikedSongs(userId: string) {
    return this.librarySongRepository.find({
      where: { userId, isLiked: true },
      relations: ['song'],
      order: { addedAt: 'DESC' },
    });
  }

  async toggleLike(userId: string, songId: string) {
    const librarySong = await this.librarySongRepository.findOne({
      where: { userId, songId },
    });

    if (!librarySong) {
      throw new BadRequestException('Song not in library');
    }

    const wasLiked = librarySong.isLiked;
    librarySong.isLiked = !librarySong.isLiked;
    await this.librarySongRepository.save(librarySong);

    if (librarySong.isLiked) {
      await this.songRepository.increment({ id: songId }, 'likeCount', 1);
      await this.activityRepository.save({
        userId,
        type: ActivityType.LIKE,
        songId,
      });
      await this.swagzService.awardSwagz(userId, SwagzAction.LIKE);
    } else {
      await this.songRepository.decrement({ id: songId }, 'likeCount', 1);
    }

    return { isLiked: librarySong.isLiked };
  }
}
