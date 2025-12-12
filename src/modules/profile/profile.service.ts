// profile.service.ts
import {
	Injectable,
	NotFoundException,
	ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../users/entities/user.entity";
import { SocialService } from "../social/social.service";
import { CommentsService } from "../comments/comments.service";

@Injectable()
export class ProfileService {
	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private socialService: SocialService,
		private commentsService: CommentsService,
	) {}

	async getProfile(username: string, viewerId?: string) {
		const user = await this.userRepository.findOne({
			where: { username },
		});

		if (!user) {
			throw new NotFoundException("User not found");
		}

		const isOwnProfile = viewerId === user.id;
		const isStalkingViewer = viewerId
			? await this.isStalkingUser(viewerId, user.id)
			: false;

		if (user.isPrivate && !isOwnProfile && !isStalkingViewer) {
			throw new ForbiddenException("This profile is private");
		}

		const stalkerCount = await this.socialService.getStalkerCount(user.id);
		const stalkingCount = await this.socialService.getStalkingCount(user.id);

		return {
			id: user.id,
			username: user.username,
			bio: user.bio,
			avatarUrl: user.avatarUrl,
			isPrivate: user.isPrivate,
			swagz: user.swagz,
			subscriptionPlan: user.subscriptionPlan,
			stalkerCount,
			stalkingCount,
			createdAt: user.createdAt,
			isOwnProfile,
			isStalkingViewer,
		};
	}

	async getOwnProfile(userId: string) {
		const user = await this.userRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new NotFoundException("User not found");
		}

		const userObj: any = await this.getProfileActivity(user.username, user.id);
		return {
			...userObj,
			profile: await this.getProfile(user.username, user.id),
		};
	}
	async getProfileActivity(username: string, viewerId?: string) {
		const user = await this.userRepository.findOne({ where: { username } });
		if (!user) {
			throw new NotFoundException("User not found");
		}

		const isOwnProfile = viewerId === user.id;
		const isStalkingViewer = viewerId
			? await this.isStalkingUser(viewerId, user.id)
			: false;

		if (user.isPrivate && !isOwnProfile && !isStalkingViewer) {
			throw new ForbiddenException("This profile is private");
		}

		const [activity, reposts, comments] = await Promise.all([
			this.socialService.getUserActivity(user.id, 20),
			this.socialService.getUserReposts(user.id, 20),
			this.commentsService.getUserComments(user.id, 20),
		]);

		return {
			activity,
			reposts,
			comments,
		};
	}

	async updateProfile(userId: string, updates: Partial<User>) {
		const user = await this.userRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new NotFoundException("User not found");
		}

		if (updates.username) {
			const existing = await this.userRepository.findOne({
				where: { username: updates.username },
			});
			if (existing && existing.id !== userId) {
				throw new ForbiddenException("Username already taken");
			}
			user.username = updates.username;
		}

		if (updates.bio !== undefined) user.bio = updates.bio;
		if (updates.avatarUrl !== undefined) user.avatarUrl = updates.avatarUrl;
		if (updates.isPrivate !== undefined) user.isPrivate = updates.isPrivate;

		return this.userRepository.save(user);
	}

	async searchUsers(query: string, limit: number = 20) {
		return this.userRepository
			.createQueryBuilder("user")
			.where("user.username LIKE :query", { query: `%${query}%` })
			.andWhere("user.isEmailConfirmed = :confirmed", { confirmed: true })
			.take(limit)
			.getMany();
	}

	private async isStalkingUser(
		stalkerId: string,
		stalkingId: string,
	): Promise<boolean> {
		const stalkings = await this.socialService.getStalkings(stalkerId);
		return stalkings.some((u) => u.id === stalkingId);
	}
}
