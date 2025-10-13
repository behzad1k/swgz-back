// playlist.controller.ts
import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AddSongToPlaylistDto, CreatePlaylistDto, ImportPlaylistDto, UpdatePlaylistDto } from './dto/playlist.dto';
import { PlaylistService } from './playlist.service';
import { ImportService } from './import.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User, SubscriptionPlan } from '../users/entities/user.entity';
import { RequireSubscription } from '../../common/decorators/decorators';
import { SubscriptionGuard } from '../../common/guards/guards';

@Controller('playlists')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class PlaylistController {
  constructor(
    private playlistService: PlaylistService,
    private importService: ImportService,
  ) {}

  @Get()
  async getUserPlaylists(@CurrentUser() user: User) {
    return this.playlistService.getUserPlaylists(user.id);
  }

  @Get(':id')
  async getPlaylist(@Param('id') id: string, @CurrentUser() user: User) {
    return this.playlistService.getPlaylist(id, user.id);
  }

  @Post()
  async createPlaylist(@Body() body: CreatePlaylistDto, @CurrentUser() user: User) {
    return this.playlistService.create(user.id, body.name, body.description, user);
  }

  @Put(':id')
  async updatePlaylist(
    @Param('id') id: string,
    @Body() body: UpdatePlaylistDto,
    @CurrentUser() user: User,
  ) {
    return this.playlistService.update(id, body.name, body.description, user.id);
  }

  @Delete(':id')
  async deletePlaylist(@Param('id') id: string, @CurrentUser() user: User) {
    return this.playlistService.delete(id, user.id);
  }

  @Post(':id/songs')
  async addSongToPlaylist(@Param('id') id: string, @Body() songData: AddSongToPlaylistDto, @CurrentUser() user: User) {
    return this.playlistService.addSong(id, songData, user.id);
  }

  @Delete(':id/songs/:songId')
  async removeSongFromPlaylist(
    @Param('id') id: string,
    @Param('songId') songId: string,
    @CurrentUser() user: User,
  ) {
    return this.playlistService.removeSong(id, songId, user.id);
  }

  @Post('import/spotify')
  @UseGuards(SubscriptionGuard)
  @RequireSubscription(SubscriptionPlan.PREMIUM)
  async importFromSpotify(@Body() body: ImportPlaylistDto, @CurrentUser() user: User) {
    return this.importService.importFromSpotify(body.playlistUrl, user);
  }

  @Post('import/youtube')
  @UseGuards(SubscriptionGuard)
  @RequireSubscription(SubscriptionPlan.PREMIUM)
  async importFromYoutube(@Body() body: { playlistUrl: string }, @CurrentUser() user: User) {
    return this.importService.importFromYoutube(body.playlistUrl, user);
  }
}