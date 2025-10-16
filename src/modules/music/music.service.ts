import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { FindOneOptions, In, Like, Repository } from 'typeorm';
import { applyMapping, EXTERNAL_MAPPINGS } from '../../config/mapping.config';
import { SearchFilter } from '../../types';
import { SEARCH_FILTERS } from '../../utils/enums';
import { LibraryService } from '../library/library.service';
import { SwagzAction, SwagzService } from '../swagz/swagz.service';
import { User } from '../users/entities/user.entity';
import { DiscogsService } from './discogs.service';
import { PlaySongDto } from './dto/music.dto';
import { PlayHistory } from '../library/entities/play-history.entity';
import { Album } from './entities/album.entity';
import { Artist } from './entities/artist.entity';
import { SearchHistory } from './entities/search-history.entity';
import { SongQuality } from './entities/song-quality.entity';
import { Song } from './entities/song.entity';
import { LastfmService } from './lastfm.service';
import { SlskService } from './slsk.service';
import { stat } from 'fs/promises';

@Injectable()
export class MusicService {
  constructor(
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
    @InjectRepository(Artist)
    private artistRepository: Repository<Artist>,
    @InjectRepository(Album)
    private albumRepository: Repository<Album>,
    @InjectRepository(SearchHistory)
    private searchHistoryRepository: Repository<SearchHistory>,
    @InjectRepository(SongQuality)
    private songQualityRepository: Repository<SongQuality>,
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

        try{
          await this.songRepository.save(formattedResult)
        }
        catch(err){
          console.error(err);
        }

        return [...cachedResult, ...formattedResult].sort((a, b) => b.externalListens - a.externalListens);
      case 'artist':
        cachedResult = await this.artistRepository.find({ where: { name: Like(`%${query}%`)}, order: { externalListeners: 'DESC' } })

        newResult = await this.lastFMService.artistSearch(query, 20);

        formattedResult = await this.lastFMService.formatResult(this.lastFMService.removeCachedDuplicateArtists(cachedResult, newResult.filter(e => e.mbid)), SEARCH_FILTERS.artist, 'pfp')

        try{
          await this.artistRepository.save(formattedResult)
        }
        catch(err){
          console.error(err);
        }

        return [...cachedResult, ...formattedResult].sort((a, b) => b.externalListeners - a.externalListeners);
      case 'album':
        return await this.lastFMService.albumSearch(query);
      default:
        return await this.discogsService.search(query)
    }
  }

  async prepareTrackToPlay(songData: Partial<Song>, user: User) {
    const findOptions: FindOneOptions<Song> = {
      where: {
        title: songData.title,
        artistName: songData.artistName,
      },
      relations: { qualities: true }
    }
    const song = await this.getOrCreateSong(songData, findOptions);

    await this.libraryService.recordPlay(song.id, user);

    return song;
  }

  async getOrCreateSong(songData: Partial<Song>, options: FindOneOptions = {
    where: {
      title: songData.title,
      artistName: songData.artistName,
    },
  }): Promise<Song> {
    let song = await this.songRepository.findOne(options);

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

  async fetchAlbumInfo(albumId: string): Promise<Album>{
    const album = await this.albumRepository.findOne({ where: { id: albumId } });
  //   TODO:
    return album
  }

  async fetchArtistInfo(artistId: string): Promise<Artist>{
    let artist
    try {
      artist = await this.artistRepository.findOne({ where: { id: artistId }, relations: { songs: true, albums: true } });
    } catch (e){
      throw new NotFoundException('Artist Not Found')
    }

    const shouldSearchArtist = !artist.bio;
    const shouldSearchSongs = artist.songs.length <= 5;
    const shouldSearchAlbums = artist.albums.length == 0;

    let formattedArtist = null;

    if (shouldSearchArtist) {
      const artistDetail = await this.lastFMService.getArtistData(artist);
      formattedArtist = {
        id: artist.id,
        pfp: artist.pfp,
        ...(applyMapping({ ...artist, ...artistDetail }, EXTERNAL_MAPPINGS.lastFM.artist) as any)
      }

      artist = formattedArtist;
    }

    if (shouldSearchSongs){
      const songs = await this.lastFMService.getArtistTopSongs(artist);

      const cachedSongs = await this.songRepository.find({ where: [{ mbid: In(songs.map(e => e.mbid)) }, { lastFMLink: In(songs.map((e: any) => e.url))}]})

      const formattedResultSongs = await this.lastFMService.formatResult(songs.filter(e => !cachedSongs.find(j => (j.mbid == e.mbid || j.lastFMLink == e.url))), SEARCH_FILTERS.track);

      await this.songRepository.save(formattedResultSongs);

      artist.songs = [...cachedSongs, ...formattedResultSongs]
    }

    if (shouldSearchAlbums){
      const albums = await this.lastFMService.getArtistAlbums(artist);

      const cachedAlbums = await this.albumRepository.find({ where: [{ artistId: artist.id }, { mbid: In(albums.map(e => e.mbid))}, { lastFMLink: In(albums.map(e => e.url))}] })
      const formattedAlbums = albums.filter(e => !cachedAlbums.find(j => (e.url == j.lastFMLink || e.mbid == j.mbid))).map(e => applyMapping<Album>(e, EXTERNAL_MAPPINGS.lastFM.album))

      await this.albumRepository.save(formattedAlbums)

      artist.albums = [...cachedAlbums, ...formattedAlbums]
    }

    if (shouldSearchArtist || shouldSearchSongs || shouldSearchAlbums){
      await this.artistRepository.save(artist)
    }


    // TODO: similar artists

    return artist;
  }

  async getAvailableQualities(songId: string) {
    const song = await this.songRepository.findOne({
      where: { id: songId },
      relations: ['qualities'],
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    const availableQualities: {
      quality: string;
      format: string;
      available: boolean;
      unavailable: boolean;
      path?: string;
      size?: number;
    }[] = [];

    // Check FLAC
    if (song.flacPath) {
      const exists = existsSync(song.flacPath);
      const fileSize = exists ? (await stat(song.flacPath)).size : undefined;
      availableQualities.push({
        quality: 'flac',
        format: 'flac',
        available: exists,
        unavailable: false,
        path: exists ? song.flacPath : undefined,
        size: fileSize,
      });
    }

    // Check standard quality
    if (song.standardPath) {
      const exists = existsSync(song.standardPath);
      const fileSize = exists ? (await stat(song.standardPath)).size : undefined;
      availableQualities.push({
        quality: song.standardQuality || 'standard',
        format: song.standardPath.split('.').pop() || 'mp3',
        available: exists,
        unavailable: false,
        path: exists ? song.standardPath : undefined,
        size: fileSize,
      });
    }

    // Check all qualities from SongQuality table
    if (song.qualities && song.qualities.length > 0) {
      for (const quality of song.qualities) {
        // Skip if already added
        const alreadyAdded = availableQualities.some(
          q => q.path === quality.path || (q.quality === quality.quality && !quality.unavailable)
        );

        if (!alreadyAdded) {
          if (quality.unavailable) {
            // Include unavailable qualities in the response
            availableQualities.push({
              quality: quality.quality,
              format: quality.extension.replace('.', ''),
              available: false,
              unavailable: true,
            });
          } else {
            const exists = existsSync(quality.path);
            const fileSize = exists ? (await stat(quality.path)).size : undefined;
            availableQualities.push({
              quality: quality.quality,
              format: quality.extension.replace('.', ''),
              available: exists,
              unavailable: false,
              path: exists ? quality.path : undefined,
              size: fileSize,
            });
          }
        }
      }
    }

    // Separate available and unavailable
    const available = availableQualities.filter(q => q.available);
    const unavailable = availableQualities.filter(q => q.unavailable);

    return {
      songId: song.id,
      title: song.title,
      artist: song.artistName,
      hasFlac: song.hasFlac,
      availableQualities: available,
      unavailableQualities: unavailable.map(q => q.quality),
      totalAvailable: available.length,
      totalUnavailable: unavailable.length,
    };
  }

  /**
   * Get song with all quality information
   */
  async getSongWithQualities(songId: string) {
    const song = await this.songRepository.findOne({
      where: { id: songId },
      relations: ['qualities', 'artist'],
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    const qualitiesInfo = await this.getAvailableQualities(songId);

    return {
      ...song,
      availableQualities: qualitiesInfo.availableQualities,
      unavailableQualities: qualitiesInfo.unavailableQualities,
    };
  }

  /**
   * Check if FLAC is available for a song
   */
  async checkFlacAvailability(songId: string): Promise<boolean> {
    const song = await this.songRepository.findOne({
      where: { id: songId },
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // Check if FLAC path exists and file is accessible
    if (song.flacPath && existsSync(song.flacPath)) {
      return true;
    }

    // Check in SongQuality table for FLAC entries (not marked unavailable)
    const flacQuality = await this.songQualityRepository.findOne({
      where: { songId, quality: 'flac', unavailable: false },
    });

    if (flacQuality && existsSync(flacQuality.path)) {
      // Update song entity if not already set
      if (!song.flacPath) {
        song.flacPath = flacQuality.path;
        song.hasFlac = true;
        await this.songRepository.save(song);
      }
      return true;
    }

    // Check if FLAC is marked as unavailable
    const unavailableFlac = await this.songQualityRepository.findOne({
      where: { songId, quality: 'flac', unavailable: true },
    });

    // Return false if explicitly unavailable or not found
    return false;
  }

  /**
   * Get quality fallback chain for a requested quality
   */
  getQualityFallbackChain(requestedQuality: string): string[] {
    const fallbackMap: Record<string, string[]> = {
      'flac': ['flac'], // No fallback for FLAC
      '320': ['320', 'v0', '256', '192', '128'],
      'v0': ['v0', '320', '256', '192', '128'],
      '256': ['256', '320', 'v0', '192', '128'],
      '192': ['192', '256', '320', 'v0', '128'],
      '128': ['128', '192', '256', '320', 'v0'],
      'standard': ['320', 'v0', '256', '192', '128'],
    };

    return fallbackMap[requestedQuality] || ['320', 'v0', '256'];
  }

  /**
   * Reset unavailable quality flag (e.g., for retrying)
   */
  async resetUnavailableQuality(songId: string, quality: string): Promise<void> {
    const songQuality = await this.songQualityRepository.findOne({
      where: { songId, quality, unavailable: true },
    });

    if (songQuality) {
      await this.songQualityRepository.remove(songQuality);
      console.log(`✅ Reset unavailable flag for ${quality} quality of song ${songId}`);
    }
  }


  async getSongById(songId: string): Promise<Song | null> {
    return this.songRepository.findOne({
      where: { id: songId },
      relations: ['qualities'],
    });
  }
}
