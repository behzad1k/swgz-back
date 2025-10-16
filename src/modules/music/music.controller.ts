import { Controller, Get, Post, Query, Param, UseGuards, Body, Res, NotFoundException, Req, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { SearchFilter } from '../../types';
import { PlaySongDto } from './dto/music.dto';
import { MusicService } from './music.service';
import { StreamingService } from './streaming.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User, SubscriptionPlan } from '../users/entities/user.entity';
import { RequireSubscription } from '../../common/decorators/decorators';
import { SubscriptionGuard } from '../../common/guards/guards';

@Controller('music')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class MusicController {
  constructor(
    private musicService: MusicService,
    private streamingService: StreamingService,
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
  @HttpCode(200)
  async streamSong(
    @Param('id') songId: string,
    @Query('flac') preferFlac: string | boolean,
    @Query('api-key') apiKey: string,
    @Query('quality') quality: string,
    @CurrentUser() user: User,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    // Parse quality preference
    const wantsFlac = preferFlac === true || preferFlac === 'true' || quality === 'flac';

    // Only premium users can stream FLAC
    if (wantsFlac && user.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      return res.status(403).json({
        error: 'FLAC streaming requires premium subscription',
        requestedQuality: 'flac',
      });
    }
    // Handle GET request - normal streaming
    await this.streamingService.streamSong(songId, res, wantsFlac);
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
    if (!artistId) throw new NotFoundException("Artist not found");
    return this.musicService.fetchArtistInfo(artistId);
  }

  @Get('check-flac/:id')
  @UseGuards(SubscriptionGuard)
  @RequireSubscription(SubscriptionPlan.PREMIUM)
  async checkFlacAvailability(@Param('id') songId: string) {
    const hasFlac = await this.musicService.checkFlacAvailability(songId);
    return { songId, hasFlac };
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
    await this.musicService.resetUnavailableQuality(songId, quality);
    return {
      message: `Reset unavailable flag for ${quality} quality`,
      songId,
      quality,
    };
  }
}