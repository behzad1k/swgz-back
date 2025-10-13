// library.controller.ts
import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionGuard } from '../../common/guards/guards';
import { AddToLibraryDto } from './dto/library.dto';
import { LibraryService } from './library.service';
import { CurrentUser, RequireSubscription } from '../../common/decorators/decorators';
import { SubscriptionPlan, User } from '../users/entities/user.entity';

@Controller('library')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class LibraryController {
  constructor(private libraryService: LibraryService) {}

  @Get()
  async getLibrary(@CurrentUser() user: User) {
    return this.libraryService.getLibrary(user.id);
  }

  @Get('liked')
  async getLikedSongs(@CurrentUser() user: User) {
    return this.libraryService.getLikedSongs(user.id);
  }

  @Get('recently-played')
  async getRecentlyPlayed(@CurrentUser() user: User) {
    return this.libraryService.getRecentlyPlayed(user.id);
  }

  @Get('most-listened')
  async getMostListened(@CurrentUser() user: User) {
    return this.libraryService.getMostListened(user.id);
  }

  @Post('add')
  async addToLibrary(@Body() songData: AddToLibraryDto, @CurrentUser() user: User) {
    return this.libraryService.addToLibrary(user.id, songData, user);
  }

  @Delete(':songId')
  async removeFromLibrary(@Param('songId') songId: string, @CurrentUser() user: User) {
    return this.libraryService.removeFromLibrary(user.id, songId);
  }

  @Post('like/:songId')
  async toggleLike(@Param('songId') songId: string, @CurrentUser() user: User) {
    return this.libraryService.toggleLike(user.id, songId);
  }

  @Post('play/:id')
  async recordPlay(@Param('id') songId: string, @CurrentUser() user: User) {
    await this.libraryService.recordPlay(songId, user);
    return { message: 'Play recorded' };
  }
}