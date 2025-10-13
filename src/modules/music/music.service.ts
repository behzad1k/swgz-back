import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { SearchFilter } from '../../types';
import { SEARCH_FILTERS } from '../../utils/enums';
import { LibraryService } from '../library/library.service';
import { SwagzAction, SwagzService } from '../swagz/swagz.service';
import { User } from '../users/entities/user.entity';
import { DiscogsService } from './discogs.service';
import { PlaySongDto } from './dto/music.dto';
import { PlayHistory } from '../library/entities/play-history.entity';
import { SearchHistory } from './entities/search-history.entity';
import { Song } from './entities/song.entity';
import { LastfmService } from './lastfm.service';
import { SlskService } from './slsk.service';

@Injectable()
export class MusicService {
  constructor(
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
    @InjectRepository(SearchHistory)
    private searchHistoryRepository: Repository<SearchHistory>,
    @Inject(forwardRef(() => LibraryService))
    private libraryService: LibraryService,
    private lastFMService: LastfmService,
    private discogsService: DiscogsService,
    private slskService: SlskService,
    private swagzService: SwagzService,
  ) {}

  async search(query: string, user: User, filter: SearchFilter) {
    await this.searchHistoryRepository.save({
      userId: user.id,
      query,
      filter
    });

    let cachedResult, newResult, formattedResult;

    switch (filter) {
      case 'track':
        cachedResult = await this.songRepository.find({ where: { title: Like(`%${query}%`)}, order: { externalListens: 'DESC' } })
        newResult = await this.lastFMService.trackSearch(query);

        formattedResult = await this.lastFMService.formatResult(this.lastFMService.removeCachedDuplicateSongs(cachedResult, newResult), SEARCH_FILTERS.track)

        // Save the new songs to the database for future references
        // insert method mixes up the id's we can use the save method but it takes much more time to excute
        try{
          await this.songRepository.insert(formattedResult)
        }
        catch(err){
          console.error(err);
        }
        // await this.songRepository.save(newResult)

        return [...cachedResult, ...formattedResult].map(e => { const { id: _, ...newObj } = e; return newObj}).sort((a, b) => b.externalListens - a.externalListens);
      case 'artist':
        // cachedResult = await this.songRepository.find({ where: { title: Like(`%${query}%`)}, order: { externalListens: 'DESC' }, take: 10 })
        return await this.lastFMService.artistSearch(query);
      case 'album':
        return await this.lastFMService.albumSearch(query);
      default:
        return await this.discogsService.search(query)
    }
  }

  async prepareTrackToPlay(songData: Partial<Song>, user: User) {
    const song = await this.getOrCreateSong(songData);

    await this.libraryService.recordPlay(song.id, user);

    return song;
  }

  async getOrCreateSong(songData: Partial<Song>): Promise<Song> {

    let song = await this.songRepository.findOne({
      where: {
        title: songData.title,
        artistName: songData.artistName,
      },
    });

    if (!song) {
      song = this.songRepository.create(songData);
      await this.songRepository.save(song);
    }

    return song;
  }

  async getRecentSearches(userId: string, limit: number = 10) {
    return this.searchHistoryRepository.find({
      where: { userId },
      order: { searchedAt: 'DESC' },
      take: limit,
    });
  }

  async checkFlacAvailability(songId: string): Promise<boolean> {
    const song = await this.songRepository.findOne({ where: { id: songId } });
    if (!song) return false;

    const hasFlac = await this.slskService.checkFlacAvailability(
      song.artistName,
      song.title,
    );

    song.hasFlac = hasFlac;
    await this.songRepository.save(song);

    return hasFlac;
  }

  async getSimilarTracks(songId: string): Promise<Song[]> {
    const song = await this.songRepository.findOne({ where: { id: songId }, relations: { relatedSongs: true }});
    let relatedSongs = song.relatedSongs
    if (!song.relatedSongs.length){
      try {
        const similarTracks: any[] = await this.lastFMService.getSimilarTracks(song);

        const cachedResult = await this.songRepository.find({
          where: { lastFMLink: In(similarTracks.map(e => e.link)) },
          order: { externalListens: 'DESC' },
          take: 10
        });

        relatedSongs = await this.lastFMService.formatResult(this.lastFMService.removeCachedDuplicateSongs(cachedResult, similarTracks), SEARCH_FILTERS.track);

        const savedTracks = await this.songRepository.insert(relatedSongs);

        song.relatedSongs = await this.songRepository.findBy({ id: In(savedTracks.generatedMaps.map(e => e.id)) });

        await this.songRepository.save(song);
      }catch (e){
        console.log(e);
      }
    }

    return relatedSongs;
  }
}
