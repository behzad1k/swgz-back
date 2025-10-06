// comments.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './entities/comment.entity';
import { Song } from '../music/entities/song.entity';
import { Activity } from '../social/entities/social.entities';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { SwagzModule } from '../swagz/swagz.module';

@Module({
  imports: [TypeOrmModule.forFeature([Comment, Song, Activity]), SwagzModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}

