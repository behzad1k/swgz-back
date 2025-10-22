import { Controller, Get, Post, Query, Param, UseGuards, Body, Res, NotFoundException, Req, HttpCode, Sse } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { from, interval, map, Observable, switchMap, takeWhile } from 'rxjs';
import { QualityPreference, SearchFilter } from '../../types';
import { DFiStreamingService } from './DFiStreaming.service';
import { PlaySongDto } from './dto/music.dto';
import { MusicService } from './music.service';
import { StreamingService } from './streaming.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User, SubscriptionPlan } from '../users/entities/user.entity';
import { RequireSubscription } from '../../common/decorators/decorators';
import { SubscriptionGuard } from '../../common/guards/guards';
import { YtdlpStreamingService } from './YTDLPStreaming.service';

@Controller('music')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class MusicController {
  constructor(
    private musicService: MusicService,
    private dfiStreamingService: DFiStreamingService,
    private streamingService: StreamingService,
    private ytdlpStreamingService: YtdlpStreamingService,
  ) {}

  @Get('search')
  async search(@Query('q') query: string, @Query('filter') filter: SearchFilter, @CurrentUser() user: User) {
    return this.musicService.search(query.replaceAll('%20', ' '), user, filter);
  }

  @Post('prepare')
  async prepare(@Body() playSongDto: PlaySongDto, @CurrentUser() user: User) {
    return this.musicService.prepareTrackToPlay(playSongDto, user);
  }

  /**
   * Get stream info - returns immediately with file info or download status
   */
  @Get('stream-info/:id')
  async getStreamInfo(
    @Param('id') songId: string,
    @CurrentUser() user: User,
    @Query('quality') quality?: QualityPreference,
  ) {
    // Only premium users can request FLAC
    if (quality === 'flac' && user.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      throw new NotFoundException('FLAC streaming requires premium subscription');
    }

    return this.musicService.getStreamInfo(songId, quality, user.subscriptionPlan);
  }

  /**
   * Download and cache a song without streaming
   */
  @Post('download/:id')
  async downloadSong(
    @Param('id') songId: string,
    @CurrentUser() user: User,
    @Query('quality') quality?: QualityPreference,
  ) {
    // Only premium users can download FLAC
    if (quality === 'flac' && user.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      throw new NotFoundException('FLAC download requires premium subscription');
    }

    return this.musicService.downloadSong(songId, 'flac', user.subscriptionPlan);
  }

  /**
   * Check download status for a song
   */
  @Get('download-status/:id')
  async getDownloadStatus(
    @Param('id') songId: string,
    @Query('quality') quality?: QualityPreference,
  ) {
    return this.musicService.getDownloadStatus(songId, quality);
  }

  @Get('recent-searches')
  async getRecentSearches(@CurrentUser() user: User) {
    return this.musicService.getRecentSearches(user.id);
  }

  @Get('similar-tracks/:id')
  async getSimilarTracks(@Param('id') songId: string) {
    return this.musicService.getSimilarTracks(songId);
  }

  @Get('artist/:id')
  async getArtist(@Param('id') artistId: string) {
    if (!artistId || artistId == 'undefined') throw new NotFoundException('Artist not found');
    return this.musicService.fetchArtistInfo(artistId);
  }

  @Get('qualities/:id')
  async getAvailableQualities(@Param('id') songId: string) {
    return this.musicService.getAvailableQualities(songId);
  }

  @Get('info/:id')
  async getSongInfo(@Param('id') songId: string) {
    return this.musicService.getSongWithQualities(songId);
  }

  @Get('quality-fallback/:quality')
  async getQualityFallback(@Param('quality') quality: string) {
    const fallbackChain = this.musicService.getQualityFallbackChain(quality);
    return {
      requestedQuality: quality,
      fallbackChain,
    };
  }

  @Post('reset-quality/:id/:quality')
  async resetUnavailableQuality(
    @Param('id') songId: string,
    @Param('quality') quality: string,
  ) {
    return this.musicService.resetUnavailableQuality(songId, quality);
  }


  /**
   * Trigger download - returns immediately
   */
  @Post('download/:id')
  async triggerDownload(
    @Param('id') songId: string,
    @CurrentUser() user: User,
    @Query('quality') quality?: QualityPreference,
  ) {
    if (quality === 'flac' && user.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      throw new NotFoundException('FLAC download requires premium subscription');
    }

    // Check if already cached
    const streamInfo = await this.musicService.getStreamInfo(songId, 'flac', user.subscriptionPlan);

    if (streamInfo.ready) {
      return {
        status: 'ready',
        message: 'File already available',
        streamUrl: `/music/stream/${songId}${quality ? `?quality=flac}` : ''}`,
        quality: 'flac',
        duration: streamInfo.duration,
        fileSize: streamInfo.fileSize,
      };
    }

    // Start download
    await this.musicService.downloadSong(songId, 'flac', user.subscriptionPlan);

    return {
      status: 'accepted',
      message: 'Download started',
      progressUrl: `/music/progress/${songId}${quality ? `?quality=flac}` : ''}`,
      songId,
    };
  }

  /**
   * SSE endpoint for download progress
   */
  @Sse('progress/:id')
  downloadProgress(
    @Param('id') songId: string,
    @Query('quality') quality?: QualityPreference,
  ): Observable<MessageEvent> {
    return interval(500).pipe(
      switchMap(() => from(this.musicService.getDownloadStatus(songId, 'flac'))),
      map(status => {
        // Determine event type based on status
        let eventType = 'progress';
        let data: any = {
          status: status.status,
          progress: status.progress,
        };

        // Add metadata when available
        if (status.quality || status.duration || status.fileSize) {
          data = {
            ...data,
            quality: 'flac',
            duration: status.duration,
            fileSize: status.fileSize,
          };
        }

        // Send ready event when complete
        if (status.status === 'ready') {
          eventType = 'ready';
          data = {
            ...data,
            streamUrl: `/music/stream/${songId}${quality ? `?quality=flac}` : ''}`,
          };
        }

        // Send error event on failure
        if (status.status === 'failed') {
          eventType = 'error';
          data = {
            ...data,
            error: status.error,
          };
        }

        return {
          type: eventType,
          data: data,
        } as MessageEvent;
      }),
      // Stop sending events after ready or failed
      takeWhile((event) => {
        return event.type !== 'ready' && event.type !== 'error';
      }, true), // true = include the final event
    );
  }

  /**
   * Stream endpoint - only called when file is ready
   */
  @Get('stream/:id')
  async streamSong(
    @Param('id') songId: string,
    @CurrentUser() user: User,
    @Res() res: Response,
    @Query('quality') quality?: QualityPreference,
  ) {
    if (quality === 'flac' && user.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      return res.status(403).json({
        error: 'FLAC streaming requires premium subscription',
      });
    }

    // Check if file is ready
    const streamInfo = await this.musicService.getStreamInfo(songId, 'flac', user.subscriptionPlan);

    if (!streamInfo.ready) {
      return res.status(404).json({
        error: 'File not ready',
        status: streamInfo.status,
        progress: streamInfo.progress,
        message: 'File is still downloading. Please wait for ready event.',
      });
    }

    // File is ready, start streaming
    await this.musicService.streamSong(songId, res, 'flac', user.subscriptionPlan);
  }
}