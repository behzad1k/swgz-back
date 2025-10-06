// social.controller.ts
import { Controller, Get, Post, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SocialService } from './social.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User } from '../users/entities/user.entity';

@Controller('social')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class SocialController {
  constructor(private socialService: SocialService) {}

  // Stalker/Following endpoints
  @Post('stalk/:userId')
  async stalk(@Param('userId') userId: string, @CurrentUser() user: User) {
    return this.socialService.stalk(user.id, userId);
  }

  @Delete('stalk/:userId')
  async unstalk(@Param('userId') userId: string, @CurrentUser() user: User) {
    return this.socialService.unstalk(user.id, userId);
  }

  @Get('stalkings')
  async getMyStalkings(@CurrentUser() user: User) {
    return this.socialService.getStalkings(user.id);
  }

  @Get('stalkers')
  async getMyStalkers(@CurrentUser() user: User) {
    return this.socialService.getStalkers(user.id);
  }

  @Get('user/:userId/stalkings')
  async getUserStalkings(@Param('userId') userId: string) {
    return this.socialService.getStalkings(userId);
  }

  @Get('user/:userId/stalkers')
  async getUserStalkers(@Param('userId') userId: string) {
    return this.socialService.getStalkers(userId);
  }

  // Repost endpoints
  @Post('repost/:songId')
  async repost(@Param('songId') songId: string, @CurrentUser() user: User) {
    return this.socialService.repost(user.id, songId);
  }

  @Delete('repost/:songId')
  async unrepost(@Param('songId') songId: string, @CurrentUser() user: User) {
    return this.socialService.unrepost(user.id, songId);
  }

  @Get('user/:userId/reposts')
  async getUserReposts(@Param('userId') userId: string) {
    return this.socialService.getUserReposts(userId);
  }

  // Activity feed
  @Get('feed')
  async getHomeFeed(
    @CurrentUser() user: User,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.socialService.getHomeFeed(user.id, page, limit);
  }

  @Get('activity/:userId')
  async getUserActivity(@Param('userId') userId: string) {
    return this.socialService.getUserActivity(userId);
  }
}