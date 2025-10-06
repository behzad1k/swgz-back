// library.controller.ts
import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LibraryService } from './library.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User } from '../users/entities/user.entity';

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

  @Post('add')
  async addToLibrary(@Body() songData: any, @CurrentUser() user: User) {
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
}