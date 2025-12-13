// social.service.ts
import {
	Injectable,
	BadRequestException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import {
	Stalker,
	Repost,
	Activity,
	ActivityType,
} from "./entities/social.entity";
import { Song } from "../music/entities/song.entity";
import { User } from "../users/entities/user.entity";
import { SwagzService, SwagzAction } from "../swagz/swagz.service";

@Injectable()
export class SocialService {
	constructor(
		@InjectRepository(Stalker)
		private stalkerRepository: Repository<Stalker>,
		@InjectRepository(Repost)
		private repostRepository: Repository<Repost>,
		@InjectRepository(Activity)
		private activityRepository: Repository<Activity>,
		@InjectRepository(Song)
		private songRepository: Repository<Song>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private swagzService: SwagzService,
	) {}

	// Stalker/Following system
	async stalk(stalkerId: string, stalkingId: string) {
		if (stalkerId === stalkingId) {
			throw new BadRequestException("You cannot stalk yourself");
		}

		const stalking = await this.userRepository.findOne({
			where: { id: stalkingId },
		});
		if (!stalking) {
			throw new NotFoundException("User not found");
		}

		const existing = await this.stalkerRepository.findOne({
			where: { stalkerId, stalkingId },
		});

		if (existing) {
			throw new BadRequestException("Already stalking this user");
		}

		const stalker = this.stalkerRepository.create({ stalkerId, stalkingId });
		return this.stalkerRepository.save(stalker);
	}

	async unstalk(stalkerId: string, stalkingId: string) {
		const result = await this.stalkerRepository.delete({
			stalkerId,
			stalkingId,
		});
		if (result.affected === 0) {
			throw new BadRequestException("Not stalking this user");
		}
		return { message: "Unstalk successful" };
	}

	async getStalkings(userId: string) {
		const stalkings = await this.stalkerRepository.find({
			where: { stalkerId: userId },
			relations: ["stalking"],
		});
		return stalkings.map((s) => s.stalking);
	}

	async getStalkers(userId: string) {
		const stalkers = await this.stalkerRepository.find({
			where: { stalkingId: userId },
			relations: ["stalker"],
		});
		return stalkers.map((s) => s.stalker);
	}

	async getStalkingCount(userId: string): Promise<number> {
		return this.stalkerRepository.count({ where: { stalkerId: userId } });
	}

	async getStalkerCount(userId: string): Promise<number> {
		return this.stalkerRepository.count({ where: { stalkingId: userId } });
	}

	// Repost system
	async repost(userId: string, songId: string) {
		const song = await this.songRepository.findOne({ where: { id: songId } });
		if (!song) {
			throw new NotFoundException("Song not found");
		}

		const existing = await this.repostRepository.findOne({
			where: { userId, songId },
		});

		if (existing) {
			throw new BadRequestException("Already reposted");
		}

		const repost = this.repostRepository.create({ userId, songId });
		await this.repostRepository.save(repost);

		// Increment repost count
		await this.songRepository.increment({ id: songId }, "repostCount", 1);

		// Create activity
		await this.activityRepository.save({
			userId,
			type: ActivityType.REPOST,
			songId,
		});

		// Award swagz
		await this.swagzService.awardSwagz(userId, SwagzAction.REPOST);

		return { message: "Reposted successfully" };
	}

	async unrepost(userId: string, songId: string) {
		const result = await this.repostRepository.delete({ userId, songId });
		if (result.affected === 0) {
			throw new BadRequestException("Repost not found");
		}

		await this.songRepository.decrement({ id: songId }, "repostCount", 1);
		return { message: "Unrepost successful" };
	}

	async getUserReposts(userId: string, limit: number = 20) {
		const reposts = await this.repostRepository.find({
			where: { userId },
			relations: ["song"],
			order: { createdAt: "DESC" },
			take: limit,
		});
		return reposts.map((r) => r.song);
	}

	// Activity feed
	async getHomeFeed(userId: string, page: number = 1, limit: number = 20) {
		const stalkings = await this.stalkerRepository.find({
			where: { stalkerId: userId },
		});

		const stalkingIds = stalkings.map((s) => s.stalkingId);

		if (stalkingIds.length === 0) {
			return { activities: [], total: 0, page, totalPages: 0 };
		}

		const [activities, total] = await this.activityRepository.findAndCount({
			where: { userId: In(stalkingIds) },
			relations: ["user", "song"],
			order: { createdAt: "DESC" },
			skip: (page - 1) * limit,
			take: limit,
		});

		return {
			activities,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		};
	}

	async getUserActivity(userId: string, limit: number = 20) {
		return this.activityRepository.find({
			where: { userId },
			relations: ["song"],
			order: { createdAt: "DESC" },
			take: limit,
		});
	}
}
