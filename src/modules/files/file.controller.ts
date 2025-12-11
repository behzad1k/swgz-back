import { 
  Controller, 
  Get, 
  Delete, 
  Param, 
  UseGuards,
  Query,
  Post
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileService } from './file.service';
import { FileType } from './entities/file.entity';
import { CurrentUser } from '../../common/decorators/decorators';
import { User, UserRole } from '../users/entities/user.entity';
import { Roles } from '../../common/decorators/decorators';
import { RolesGuard } from '../../common/guards/guards';

@Controller('files')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class FileController {
  constructor(private fileService: FileService) {}

  @Get(':id')
  async getFile(@Param('id') id: string) {
    return this.fileService.getFile(id);
  }

  @Get()
  async getFiles(
    @Query('type') type?: FileType,
    @CurrentUser() user?: User,
  ) {
    return this.fileService.getFilesByType(type, user?.id);
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: string, @CurrentUser() user: User) {
    // You can add ownership check here
    await this.fileService.deleteFile(id);
    return { message: 'File deleted successfully' };
  }

  @Post('cleanup')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async cleanupOrphanedFiles() {
    const count = await this.fileService.cleanupOrphanedFiles();
    return { 
      message: `Cleaned up ${count} orphaned files`,
      count 
    };
  }
}
