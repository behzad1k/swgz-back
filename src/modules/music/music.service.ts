import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
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
import { Song } from './entities/song.entity';
import { LastfmService } from './lastfm.service';
import { SlskService } from './slsk.service';

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

        formattedResult = await this.lastFMService.formatResult(this.lastFMService.removeCachedDuplicateArtists(cachedResult, newResult), SEARCH_FILTERS.artist, 'image')

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
        image: artist.image,
        ...(applyMapping({ ...artist, ...artistDetail }, EXTERNAL_MAPPINGS.lastFM.artist) as any)
      }

      artist = formattedArtist;
    }

    if (shouldSearchSongs){
      const songs = await this.lastFMService.getArtistTopSongs(artist);

      const cachedSongs = await this.songRepository.find({ where: [{ mbid: In(songs.map(e => e.mbid)) }, { lastFMLink: In(songs.map((e: any) => e.url))}]})

      const formattedResultSongs = await this.lastFMService.formatResult(songs.filter(e => !cachedSongs.find(j => (j.mbid == e.mbid || j.lastFMLink == e.url))), SEARCH_FILTERS.track);

      await this.songRepository.save(formattedResultSongs);

      artist.songs = [...cachedSongs, formattedResultSongs]
    }

    if (shouldSearchAlbums){
      const albums = await this.lastFMService.getArtistAlbums(artist);

      const cachedAlbums = await this.albumRepository.find({ where: [{ artistId: artist.id }, { mbid: In(albums.map(e => e.mbid))}, { lastFMLink: In(albums.map(e => e.url))}] })
      const formattedAlbums = albums.filter(e => !cachedAlbums.find(j => (e.url == j.lastFMLink || e.mbid == j.mbid))).map(e => applyMapping<Album>(e, EXTERNAL_MAPPINGS.lastFM.album))
      console.log(formattedAlbums);
      await this.albumRepository.save(formattedAlbums)

      artist.albums = [...cachedAlbums, ...formattedAlbums]
    }

    if (shouldSearchArtist || shouldSearchSongs){
      await this.artistRepository.save(artist)
    }


    // TODO: similar artists

    return artist;
  }
}
