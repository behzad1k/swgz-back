// profile.controller.ts
import { Controller, Get, Put, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UpdateProfileDto } from './dto/profile.dto';
import { ProfileService } from './profile.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User } from '../users/entities/user.entity';

@Controller('profile')
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  @Get('search')
  async searchUsers(@Query('q') query: string) {
    return this.profileService.searchUsers(query);
  }

  @Get(':username')
  @UseGuards(AuthGuard(['jwt', 'api-key']))
  async getProfile(@Param('username') username: string, @CurrentUser() user?: User) {
    return this.profileService.getProfile(username, user?.id);
  }

  @Get(':username/activity')
  @UseGuards(AuthGuard(['jwt', 'api-key']))
  async getProfileActivity(@Param('username') username: string, @CurrentUser() user?: User) {
    return this.profileService.getProfileActivity(username, user?.id);
  }

  @Put('me')
  @UseGuards(AuthGuard(['jwt', 'api-key']))
  async updateMyProfile(
    @Body() updates: UpdateProfileDto,
    @CurrentUser() user: User,
  ) {
    return this.profileService.updateProfile(user.id, updates);
  }
}