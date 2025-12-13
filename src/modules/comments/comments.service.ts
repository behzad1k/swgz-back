// comments.service.ts
import {
	Injectable,
	NotFoundException,
	ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Comment } from "./entities/comment.entity";
import { Song } from "../music/entities/song.entity";
import { Activity, ActivityType } from "../social/entities/social.entity";
import { User } from "../users/entities/user.entity";
import { SwagzService, SwagzAction } from "../swagz/swagz.service";

@Injectable()
export class CommentsService {
	constructor(
		@InjectRepository(Comment)
		private commentRepository: Repository<Comment>,
		@InjectRepository(Song)
		private songRepository: Repository<Song>,
		@InjectRepository(Activity)
		private activityRepository: Repository<Activity>,
		private swagzService: SwagzService,
	) {}

	async create(
		songId: string,
		content: string,
		userId: string,
		parentCommentId?: string,
	) {
		const song = await this.songRepository.findOne({ where: { id: songId } });
		if (!song) {
			throw new NotFoundException("Song not found");
		}

		const comment = this.commentRepository.create({
			songId,
			userId,
			content,
			parentCommentId,
		});

		await this.commentRepository.save(comment);

		// Increment comment count
		await this.songRepository.increment({ id: songId }, "commentCount", 1);

		// Create activity
		await this.activityRepository.save({
			userId,
			type: ActivityType.COMMENT,
			songId,
			commentId: comment.id,
			metadata: content.substring(0, 100),
		});

		// Award swagz
		await this.swagzService.awardSwagz(userId, SwagzAction.COMMENT);

		return this.commentRepository.findOne({
			where: { id: comment.id },
			relations: ["user"],
		});
	}

	async getSongComments(songId: string, page: number = 1, limit: number = 20) {
		const [comments, total] = await this.commentRepository.findAndCount({
			where: { songId, parentCommentId: null },
			relations: ["user"],
			order: { createdAt: "DESC" },
			skip: (page - 1) * limit,
			take: limit,
		});

		return {
			comments,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		};
	}

	async getReplies(commentId: string) {
		return this.commentRepository.find({
			where: { parentCommentId: commentId },
			relations: ["user"],
			order: { createdAt: "ASC" },
		});
	}

	async update(commentId: string, content: string, userId: string) {
		const comment = await this.commentRepository.findOne({
			where: { id: commentId },
		});

		if (!comment) {
			throw new NotFoundException("Comment not found");
		}

		if (comment.userId !== userId) {
			throw new ForbiddenException("You can only edit your own comments");
		}

		comment.content = content;
		comment.isEdited = true;

		return this.commentRepository.save(comment);
	}

	async delete(commentId: string, userId: string) {
		const comment = await this.commentRepository.findOne({
			where: { id: commentId },
		});

		if (!comment) {
			throw new NotFoundException("Comment not found");
		}

		if (comment.userId !== userId) {
			throw new ForbiddenException("You can only delete your own comments");
		}

		await this.commentRepository.delete(commentId);
		await this.songRepository.decrement(
			{ id: comment.songId },
			"commentCount",
			1,
		);

		return { message: "Comment deleted" };
	}

	async getUserComments(userId: string, limit: number = 20) {
		return this.commentRepository.find({
			where: { userId },
			relations: ["song"],
			order: { createdAt: "DESC" },
			take: limit,
		});
	}
}
