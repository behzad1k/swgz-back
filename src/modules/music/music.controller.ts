import { Controller, Get, Post, Query, Param, UseGuards, Body, Res, NotFoundException, Req, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
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
   * Stream endpoint - handles both GET and HEAD requests
   */
  @Get('stream/:id')
  async streamSong(
    @Param('id') songId: string,
    @CurrentUser() user: User,
    @Res() res: Response,
    @Query('quality') quality?: QualityPreference,
  ) {
    // Only premium users can stream FLAC
    if (quality === 'flac' && user.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      return res.status(403).json({
        error: 'FLAC streaming requires premium subscription',
        requestedQuality: 'flac',
      });
    }

    // Pass user's subscription plan to streaming service
    //
    // await this.dfiStreamingService.streamSong(songId, res, quality, user.subscriptionPlan);
    if (quality && quality === 'flac') await this.streamingService.streamSong(songId, res, quality, user.subscriptionPlan);
    else await this.ytdlpStreamingService.streamSong(songId, res);
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
}