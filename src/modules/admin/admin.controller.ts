// admin.controller.ts
import { Controller, Get, Put, Delete, Query, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/decorators';
import { RolesGuard } from '../../common/guards/guards';
import { UserRole } from '../users/entities/user.entity';

@Controller('admin')
@UseGuards(AuthGuard(['jwt', 'api-key']), RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('users')
  async getAllUsers(@Query('page') page: number = 1, @Query('limit') limit: number = 20) {
    return this.adminService.getAllUsers(page, limit);
  }

  @Get('users/search')
  async searchUsers(@Query('q') query: string) {
    return this.adminService.searchUsers(query);
  }

  @Get('users/:id')
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Put('users/:id/upgrade')
  async upgradeToPremium(
    @Param('id') id: string,
    @Body() body: { expiresAt?: string },
  ) {
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    return this.adminService.upgradeToPremium(id, expiresAt);
  }

  @Put('users/:id/downgrade')
  async downgradeToFree(@Param('id') id: string) {
    return this.adminService.downgradeToFree(id);
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }
}