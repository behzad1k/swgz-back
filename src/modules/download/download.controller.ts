// download.controller.ts
import { Controller, Post, Get, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DownloadService } from './download.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User } from '../users/entities/user.entity';

@Controller('downloads')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class DownloadController {
  constructor(private downloadService: DownloadService) {}

  @Post(':songId')
  async startDownload(
    @Param('songId') songId: string,
    @Body() body: { preferFlac?: boolean },
    @CurrentUser() user: User,
  ) {
    const jobId = await this.downloadService.startDownload(songId, user, body.preferFlac);
    return { jobId, message: 'Download started' };
  }

  @Get('status/:jobId')
  async getStatus(@Param('jobId') jobId: string) {
    const status = await this.downloadService.getJobStatus(jobId);
    if (!status) {
      return { error: 'Job not found' };
    }
    return status;
  }

  @Delete(':jobId')
  async cancelDownload(@Param('jobId') jobId: string) {
    await this.downloadService.cancelDownload(jobId);
    return { message: 'Download cancelled' };
  }
}