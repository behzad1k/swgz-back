// social.module.ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Stalker, Repost, Activity } from "./entities/social.entity";
import { Song } from "../music/entities/song.entity";
import { User } from "../users/entities/user.entity";
import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";
import { SwagzModule } from "../swagz/swagz.module";

@Module({
	imports: [
		TypeOrmModule.forFeature([Stalker, Repost, Activity, Song, User]),
		SwagzModule,
	],
	controllers: [SocialController],
	providers: [SocialService],
	exports: [SocialService],
})
export class SocialModule {}
