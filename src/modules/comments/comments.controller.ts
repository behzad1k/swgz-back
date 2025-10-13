// comments.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateCommentDto, UpdateCommentDto } from './dto/comments.dto';
import { CommentsService } from './comments.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User } from '../users/entities/user.entity';

@Controller('comments')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Post()
  async createComment(
    @Body() body: CreateCommentDto,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.create(body.songId, body.content, user.id, body.parentCommentId);
  }

  @Get('song/:songId')
  async getSongComments(
    @Param('songId') songId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.commentsService.getSongComments(songId, page, limit);
  }

  @Get(':commentId/replies')
  async getReplies(@Param('commentId') commentId: string) {
    return this.commentsService.getReplies(commentId);
  }

  @Put(':id')
  async updateComment(
    @Param('id') id: string,
    @Body() body: UpdateCommentDto,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.update(id, body.content, user.id);
  }

  @Delete(':id')
  async deleteComment(@Param('id') id: string, @CurrentUser() user: User) {
    return this.commentsService.delete(id, user.id);
  }
}