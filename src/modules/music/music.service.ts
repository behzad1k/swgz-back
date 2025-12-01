import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';
import { existsSync } from 'fs';
import { stat, unlink } from 'fs/promises';
import { FindOneOptions, In, Like, Repository } from 'typeorm';
import { applyMapping, EXTERNAL_MAPPINGS } from '../../config/mapping.config';
import { DownloadStatus, QualityPreference, SearchFilter, StreamInfo } from '../../types';
import { SEARCH_FILTERS } from '../../utils/enums';
import { LibraryService } from '../library/library.service';
import { SubscriptionPlan, User } from '../users/entities/user.entity';
import { AmazonService } from './amazon.service';
import { DiscogsService } from './discogs.service';
import { Album } from './entities/album.entity';
import { Artist } from './entities/artist.entity';
import { SearchHistory } from './entities/search-history.entity';
import { Song } from './entities/song.entity';
import { LastfmService } from './lastfm.service';
import { StreamingService } from './streaming.service';
import { YtdlpStreamingService } from './YTDLPStreaming.service';

type MusicInfoProvider = 'lastFM' | 'amazon';
type MusicProvider = 'ytdlp' | 'sldl';

@Injectable()
export class MusicService {
  // Track temporary downloads for cleanup
  private temporaryDownloads = new Map<string, { filePath: string; scheduledDeletion: NodeJS.Timeout }>();

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
    private amazonService: AmazonService,
    private streamingService: StreamingService,
    private ytdlpStreamingService: YtdlpStreamingService,
  ) {}

  private readonly musicInfoProvider: MusicInfoProvider = process.env.MUSIC_INFO_PROVIDER as MusicInfoProvider || 'lastFM';
  private readonly musicProvider: MusicProvider = process.env.MUSIC_PROVIDER as MusicProvider || 'sldl';

  private getMusicInfoService() {
    return this.musicInfoProvider === 'amazon' ? this.amazonService : this.lastFMService;
  }

  private getMusicService() {
    return this.musicProvider === 'ytdlp' ? this.ytdlpStreamingService : this.streamingService;
  }

  /**
   * Get stream info - checks cache and returns file info or download status
   */
  async getStreamInfo(
    songId: string,
    quality?: QualityPreference,
    userSubscriptionPlan?: SubscriptionPlan
  ): Promise<StreamInfo> {
    const song = await this.songRepository.findOne({ where: { id: songId } });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // Helper to get file info
    const getFileInfo = async (filePath: string, quality: string) => {
      const stats = await stat(filePath);
      const ext = filePath.split('.').pop()?.toLowerCase() || 'mp3';
      const mimeTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        flac: 'audio/flac',
        ogg: 'audio/ogg',
        opus: 'audio/opus',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        webm: 'audio/webm',
      };

      return {
        status: 'ready' as const,
        ready: true,
        filePath,
        quality,
        duration: song.duration,
        fileSize: stats.size,
        mimeType: mimeTypes[ext] || 'audio/mpeg',
      };
    };

    // Case 1: Quality specified
    if (quality) {
      if (quality === 'flac') {
        // Check for cached FLAC
        if (song.flacPath && existsSync(song.flacPath)) {
          return getFileInfo(song.flacPath, 'flac');
        }

        // Check if FLAC is marked as unavailable
        if (song.hasFlac === false) {
          throw new NotFoundException('FLAC quality is not available for this track');
        }

        // Check download status
        const downloadStatus = this.getMusicService().getDownloadStatus(songId, quality);
        if (downloadStatus.status !== 'not_started') {
          return {
            status: downloadStatus.status as any,
            ready: downloadStatus.status === 'ready',
            progress: downloadStatus.progress,
            message: downloadStatus.message,
          };
        }

        // Need to start download
        return {
          status: 'not_started',
          ready: false,
          message: 'FLAC download not started. Call /download endpoint or stream with ?quality=flac',
        };
      } else {
        // Standard quality requested
        if (song.standardPath && existsSync(song.standardPath)) {
          return getFileInfo(song.standardPath, song.standardQuality || quality);
        }

        // Check download status
        const downloadStatus = this.getMusicService().getDownloadStatus(songId);
        if (downloadStatus.status !== 'not_started') {
          return {
            status: downloadStatus.status as any,
            ready: downloadStatus.status === 'ready',
            progress: downloadStatus.progress,
            message: downloadStatus.message,
          };
        }

        return {
          status: 'not_started',
          ready: false,
          message: 'Download not started. Call /download endpoint or stream endpoint',
        };
      }
    }

    // Case 2: No quality specified - auto-select best
    // Check standard path first
    if (song.standardPath && existsSync(song.standardPath)) {
      return getFileInfo(song.standardPath, song.standardQuality || 'standard');
    }

    // Check FLAC for premium users
    if (song.flacPath && existsSync(song.flacPath) && userSubscriptionPlan === SubscriptionPlan.PREMIUM) {
      return getFileInfo(song.flacPath, 'flac');
    }

    // Check if any download is in progress
    const ytdlpStatus = this.getMusicService().getDownloadStatus(songId);
    if (ytdlpStatus.status !== 'not_started') {
      return {
        status: ytdlpStatus.status as any,
        ready: ytdlpStatus.status === 'ready',
        progress: ytdlpStatus.progress,
        message: ytdlpStatus.message,
      };
    }

    return {
      status: 'not_started',
      ready: false,
      message: 'No cached file available. Download will start on stream request.',
    };
  }

  /**
   * Stream a song - handles routing to appropriate streaming service
   */
  async streamSong(
    songId: string,
    res: Response,
    user: User,
    quality?: QualityPreference,
  ): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id: songId } });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    await this.libraryService.recordPlay(song.id, user)

    if (song.standardPath && existsSync(song.standardPath)) {
      console.log(`📂 Streaming cached file: ${song.standardPath}`);
      return this.streamFromFile(song.standardPath, res, song.standardQuality || 'standard');
    }
    // Route to appropriate streaming service
    // if (quality === 'flac') {
    await this.getMusicService().streamSong(songId, res, quality, user.subscriptionPlan);
    // } else {
    //
    //   // No cache, use YTDLP streaming service
    //   await this.ytdlpStreamingService.streamSong(songId, res);
    // }
  }

  /**
   * Download and cache a song without streaming
   */
  async downloadSong(
    songId: string,
    quality?: QualityPreference,
    userSubscriptionPlan?: SubscriptionPlan
  ): Promise<{ status: string; message: string; songId: string; quality?: string }> {
    const song = await this.songRepository.findOne({ where: { id: songId } });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // Check if already cached
    if (quality === 'flac') {
      if (song.flacPath && existsSync(song.flacPath)) {
        return {
          status: 'already_cached',
          message: 'FLAC quality already cached',
          songId,
          quality: 'flac',
        };
      }

      if (song.hasFlac === false) {
        throw new NotFoundException('FLAC quality is not available for this track');
      }

      // Start download
      await this.getMusicService().startBackgroundDownload(songId, quality);
      return {
        status: 'downloading',
        message: 'FLAC download started. Check /download-status for progress.',
        songId,
        quality: 'flac',
      };
    } else {
      if (song.standardPath && existsSync(song.standardPath)) {
        return {
          status: 'already_cached',
          message: `Quality ${song.standardQuality} already cached`,
          songId,
          quality: song.standardQuality,
        };
      }

      // Start download
      await this.getMusicService().startBackgroundDownload(songId);
      return {
        status: 'downloading',
        message: 'Download started. Check /download-status for progress.',
        songId,
      };
    }
  }

  /**
   * Get download status
   */
  async getDownloadStatus(
    songId: string,
    quality?: QualityPreference
  ): Promise<DownloadStatus> {
    if (quality === 'flac') {
      const status = this.getMusicService().getDownloadStatus(songId, quality);
      return {
        ...status,
      };
    }
    return this.getMusicService().getDownloadStatus(songId);
  }
  /**
   * Schedule temporary file deletion
   */
  scheduleTemporaryFileDeletion(songId: string, filePath: string, delayMs: number = 3600000): void {
    // Cancel existing scheduled deletion if any
    const existing = this.temporaryDownloads.get(songId);
    if (existing) {
      clearTimeout(existing.scheduledDeletion);
    }

    // Schedule new deletion
    const timeout = setTimeout(async () => {
      try {
        if (existsSync(filePath)) {
          await unlink(filePath);
          console.log(`🗑️  Deleted temporary file: ${filePath}`);
        }
        this.temporaryDownloads.delete(songId);
      } catch (error) {
        console.error(`Failed to delete temporary file ${filePath}:`, error);
      }
    }, delayMs);

    this.temporaryDownloads.set(songId, { filePath, scheduledDeletion: timeout });
    console.log(`⏰ Scheduled deletion of ${filePath} in ${delayMs / 1000 / 60} minutes`);
  }

  /**
   * Cancel scheduled deletion (e.g., when file becomes permanent)
   */
  cancelScheduledDeletion(songId: string): void {
    const existing = this.temporaryDownloads.get(songId);
    if (existing) {
      clearTimeout(existing.scheduledDeletion);
      this.temporaryDownloads.delete(songId);
      console.log(`✅ Cancelled scheduled deletion for song ${songId}`);
    }
  }

  /**
   * Stream from a file
   */
  private async streamFromFile(filePath: string, res: Response, quality: string): Promise<void> {
    try {
      const { createReadStream } = await import('fs');
      const stats = await stat(filePath);
      const ext = filePath.split('.').pop()?.toLowerCase() || 'mp3';
      const mimeTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        flac: 'audio/flac',
        ogg: 'audio/ogg',
        opus: 'audio/opus',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        webm: 'audio/webm',
      };

      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'audio/mpeg',
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'X-Quality': quality,
      });

      const stream = createReadStream(filePath);
      stream.pipe(res);

      stream.on('error', (error) => {
        console.error('❌ Stream error:', error);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
    } catch (error) {
      console.error('❌ streamFromFile error:', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  }

  async search(query: string, user: User, filter?: SearchFilter) {
    await this.searchHistoryRepository.save({
      userId: user.id,
      query,
      filter: filter || 'all'
    });

    const musicService = this.getMusicInfoService();

    // If no filter specified, search everything
    if (!filter || filter === 'all') {
      const [tracks, artists, albums] = await Promise.all([
        musicService.trackSearch(query, 7),
        musicService.artistSearch(query, 7),
        musicService.albumSearch(query, 7)
      ]);

      // Get cached results from all types
      const [cachedSongs, cachedArtists, cachedAlbums] = await Promise.all([
        this.songRepository.find({
          where: { title: Like(`%${query}%`) },
          order: { externalListens: 'DESC' },
          take: 10
        }),
        this.artistRepository.find({
          where: { name: Like(`%${query}%`) },
          order: { externalListeners: 'DESC' },
          take: 10
        }),
        this.albumRepository.find({
          where: { title: Like(`%${query}%`) },
          order: { externalListeners: 'DESC' },
          take: 10
        })
      ]);

      // Format results
      const formattedTracks = await musicService.formatResult(
        musicService.removeCachedDuplicateSongs(cachedSongs, tracks),
        SEARCH_FILTERS.track
      );

      const formattedArtists = await musicService.formatResult(
        musicService.removeCachedDuplicateArtists(cachedArtists, artists),
        SEARCH_FILTERS.artist,
        'pfp'
      );
      const formattedAlbums = await musicService.formatResult(
        musicService.removeCachedDuplicateAlbums(cachedAlbums, albums),
        SEARCH_FILTERS.album,
      );

      // Save new results
      try {
        await Promise.all([
          this.songRepository.save(formattedTracks as Song[]),
          this.artistRepository.save(formattedArtists as Artist[]),
          this.albumRepository.save(formattedAlbums as Album[])
        ]);
      } catch (err) {
        console.error('Error saving general search results:', err);
      }

      return {
        track: [...cachedSongs, ...formattedTracks]
        .sort((a, b) => b.externalListens - a.externalListens)
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, 20),
        artist: [...cachedArtists, ...formattedArtists]
        .sort((a, b) => b.externalListeners - a.externalListeners)
        .slice(0, 20),
        album: [...cachedAlbums, ...formattedAlbums]
      };
    }

    switch (filter) {
      case 'track':
        const cachedSongs = await this.songRepository.find({
          where: { title: Like(`%${query}%`) },
          order: { externalListens: 'DESC' }
        });

        const songResults = await musicService.trackSearch(query);

        const formattedSongs = await musicService.formatResult(
          musicService.removeCachedDuplicateSongs(cachedSongs, songResults),
          SEARCH_FILTERS.track
        );

        try {
          await this.songRepository.save(formattedSongs as Song[]);
        } catch (err) {
          console.error(err);
        }

        return [...cachedSongs, ...formattedSongs]
        .sort((a, b) => b.externalListens - a.externalListens)
        .sort((a, b) => b.playCount - a.playCount);

      case 'artist':
        let cachedResult = await this.artistRepository.find({
          where: { name: Like(`%${query}%`) },
          order: { externalListeners: 'DESC' }
        });

        let newResult = await musicService.artistSearch(query, 20);

        // Filter by mbid only if using LastFM (Amazon doesn't have mbid)
        if (this.musicInfoProvider === 'lastFM') {
          newResult = newResult.filter(e => e.mbid);
        } else {
          newResult = newResult.filter(e => e.acin);
        }

        const formattedArtists = await musicService.formatResult(
          musicService.removeCachedDuplicateArtists(cachedResult, newResult),
          SEARCH_FILTERS.artist,
          'pfp'
        );

        try {
          await this.artistRepository.save(formattedArtists as Artist[]);
        } catch (err) {
          console.error(err);
        }

        return [...cachedResult, ...formattedArtists]
        .sort((a, b) => b.externalListeners - a.externalListeners);

      case 'album':
        return await musicService.albumSearch(query);

      default:
        return await this.discogsService.search(query);
    }
  }

  async prepareTrackToPlay(songData: Partial<Song>, user: User) {
    const findOptions: FindOneOptions<Song> = {
      where: {
        title: songData.title,
        artistName: songData.artistName,
      },
    };
    const song = await this.getOrCreateSong(songData, findOptions);

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
    const song = await this.songRepository.findOne({
      where: { id: songId },
      relations: { relatedSongs: true }
    });

    let relatedSongs = song.relatedSongs;

    if (!song.relatedSongs.length) {
      try {
        const similarTracks: any[] = await this.lastFMService.getSimilarTracks(song);

        const cachedResult = await this.songRepository.find({
          where: { lastFMLink: In(similarTracks.map(e => e.link)) },
          order: { externalListens: 'DESC' },
          take: 10
        });

        relatedSongs = await this.lastFMService.formatResult(
          this.lastFMService.removeCachedDuplicateSongs(cachedResult, similarTracks),
          SEARCH_FILTERS.track
        );

        const savedTracks = await this.songRepository.insert(relatedSongs);

        song.relatedSongs = await this.songRepository.findBy({
          id: In(savedTracks.generatedMaps.map(e => e.id))
        });

        await this.songRepository.save(song);
      } catch (e) {
        console.log(e);
      }
    }

    return relatedSongs;
  }

  async fetchAlbumInfo(albumId: string): Promise<Album> {
    const album = await this.albumRepository.findOne({ where: { id: albumId } });
    return album;
  }

  async fetchArtistInfo(artistId: string): Promise<Artist> {
    let artist;
    try {
      artist = await this.artistRepository.findOne({
        where: { id: artistId },
        relations: { songs: true, albums: true }
      });
    } catch (e) {
      throw new NotFoundException('Artist Not Found');
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
      };

      artist = formattedArtist;
    }

    if (shouldSearchSongs) {
      const songs = await this.lastFMService.getArtistTopSongs(artist);

      const cachedSongs = await this.songRepository.find({
        where: [
          { mbid: In(songs.map(e => e.mbid)) },
          { lastFMLink: In(songs.map((e: any) => e.url)) }
        ]
      });

      const formattedResultSongs = await this.lastFMService.formatResult(
        songs.filter(e => !cachedSongs.find(j => (j.mbid == e.mbid || j.lastFMLink == e.url))),
        SEARCH_FILTERS.track
      );

      await this.songRepository.save(formattedResultSongs);

      artist.songs = [...cachedSongs, ...formattedResultSongs];
    }

    if (shouldSearchAlbums) {
      const albums = await this.lastFMService.getArtistAlbums(artist);

      const cachedAlbums = await this.albumRepository.find({
        where: [
          { artistId: artist.id },
          { mbid: In(albums.map(e => e.mbid)) },
          { lastFMLink: In(albums.map(e => e.url)) }
        ]
      });

      const formattedAlbums = albums
      .filter(e => !cachedAlbums.find(j => (e.url == j.lastFMLink || e.mbid == j.mbid)))
      .map(e => applyMapping<Album>(e, EXTERNAL_MAPPINGS.lastFM.album));

      await this.albumRepository.save(formattedAlbums);

      artist.albums = [...cachedAlbums, ...formattedAlbums];
    }

    if (shouldSearchArtist || shouldSearchSongs || shouldSearchAlbums) {
      await this.artistRepository.save(artist);
    }

    return artist;
  }

  async getAvailableQualities(songId: string) {
    const song = await this.songRepository.findOne({
      where: { id: songId },
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
        unavailable: song.hasFlac === false,
        path: exists ? song.flacPath : undefined,
        size: fileSize,
      });
    } else if (song.hasFlac === false) {
      availableQualities.push({
        quality: 'flac',
        format: 'flac',
        available: false,
        unavailable: true,
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
    } else if (song.standardQuality) {
      availableQualities.push({
        quality: song.standardQuality,
        format: 'mp3',
        available: false,
        unavailable: true,
      });
    }

    // Check if track is completely unavailable
    if (song.standardQuality === '128' && !song.standardPath) {
      availableQualities.push({
        quality: 'unavailable',
        format: 'none',
        available: false,
        unavailable: true,
      });
    }

    const available = availableQualities.filter(q => q.available);
    const unavailable = availableQualities.filter(q => q.unavailable);

    return {
      songId: song.id,
      title: song.title,
      artist: song.artistName,
      hasFlac: song.hasFlac,
      standardQuality: song.standardQuality,
      availableQualities: available,
      unavailableQualities: unavailable.map(q => q.quality),
      totalAvailable: available.length,
      totalUnavailable: unavailable.length,
      completelyUnavailable: song.standardQuality === '128' && !song.standardPath,
    };
  }

  async getSongWithQualities(songId: string) {
    const song = await this.songRepository.findOne({
      where: { id: songId },
      relations: ['artist'],
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    const qualitiesInfo = await this.getAvailableQualities(songId);

    return {
      ...song,
      availableQualities: qualitiesInfo.availableQualities,
      unavailableQualities: qualitiesInfo.unavailableQualities,
      completelyUnavailable: qualitiesInfo.completelyUnavailable,
    };
  }

  getQualityFallbackChain(requestedQuality: string): string[] {
    const fallbackMap: Record<string, string[]> = {
      'flac': ['flac'],
      '320': ['320', 'v0', '256', '192', '128'],
      'v0': ['v0', '320', '256', '192', '128'],
      '256': ['256', '320', 'v0', '192', '128'],
      '192': ['192', '256', '320', 'v0', '128'],
      '128': ['128', '192', '256', '320', 'v0'],
      'standard': ['320', 'v0', '256', '192', '128'],
    };

    return fallbackMap[requestedQuality] || ['320', 'v0', '256'];
  }

  async resetUnavailableQuality(songId: string, quality: string): Promise<void> {
    const song = await this.songRepository.findOne({
      where: { id: songId },
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    if (quality === 'flac') {
      if (song.hasFlac === false) {
        song.hasFlac = null;
        await this.songRepository.save(song);
        console.log(`✅ Reset unavailable flag for FLAC quality of song ${songId}`);
      }
    } else if (quality === 'all') {
      song.hasFlac = null;
      song.standardQuality = null;
      await this.songRepository.save(song);
      console.log(`✅ Reset all unavailable flags for song ${songId}`);
    } else {
      if (song.standardQuality === quality && !song.standardPath) {
        song.standardQuality = null;
        await this.songRepository.save(song);
        console.log(`✅ Reset unavailable flag for ${quality} quality of song ${songId}`);
      }
    }
  }
}