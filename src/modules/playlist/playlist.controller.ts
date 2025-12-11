// playlist.controller.ts
import {
	Controller,
	Get,
	Post,
	Put,
	Delete,
	Param,
	Body,
	UseGuards,
	UseInterceptors,
	UploadedFile,
	BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname } from "path";
import {
	AddSongToPlaylistDto,
	CreatePlaylistDto,
	ImportPlaylistDto,
	UpdatePlaylistDto,
	ReorderSongsDto,
} from "./dto/playlist.dto";
import { PlaylistService } from "./playlist.service";
import { ImportService } from "./import.service";
import { CurrentUser } from "../../common/decorators/decorators";
import { User, SubscriptionPlan } from "../users/entities/user.entity";
import { RequireSubscription } from "../../common/decorators/decorators";
import { SubscriptionGuard } from "../../common/guards/guards";
import { FileService } from "../files/file.service";
import { FileType } from "../files/entities/file.entity";

@Controller("playlists")
@UseGuards(AuthGuard(["jwt", "api-key"]))
export class PlaylistController {
	constructor(
		private playlistService: PlaylistService,
		private importService: ImportService,
		private fileService: FileService,
	) {}

	@Get()
	async getUserPlaylists(@CurrentUser() user: User) {
		return this.playlistService.getUserPlaylists(user.id);
	}

	@Get(":id")
	async getPlaylist(@Param("id") id: string, @CurrentUser() user: User) {
		return this.playlistService.getPlaylist(id, user.id);
	}

	@Post()
	async createPlaylist(
		@Body() body: CreatePlaylistDto,
		@CurrentUser() user: User,
	) {
		return this.playlistService.create(
			user.id,
			body.name,
			body.description,
			user,
		);
	}

	@Put(":id")
	async updatePlaylist(
		@Param("id") id: string,
		@Body() body: UpdatePlaylistDto,
		@CurrentUser() user: User,
	) {
		return this.playlistService.update(
			id,
			body.name,
			body.description,
			user.id,
		);
	}

	@Delete(":id")
	async deletePlaylist(@Param("id") id: string, @CurrentUser() user: User) {
		return this.playlistService.delete(id, user.id);
	}

	@Post("songs/:id")
	async addSongToPlaylist(
		@Param("id") id: string,
		@Body() songData: AddSongToPlaylistDto,
		@CurrentUser() user: User,
	) {
		return this.playlistService.addSong(id, songData, user.id);
	}

	@Delete("songs/:id/:songId")
	async removeSongFromPlaylist(
		@Param("id") id: string,
		@Param("songId") songId: string,
		@CurrentUser() user: User,
	) {
		return this.playlistService.removeSong(id, songId, user.id);
	}

	/**
	 * Upload cover photo for a playlist
	 * Accepts multipart/form-data with 'cover' field
	 */
	@Post("cover/:id")
	@UseInterceptors(
		FileInterceptor("cover", {
			storage: diskStorage({
				destination: (req, file, cb) => {
					// Use FileService to get the storage path
					const storagePath = "./uploads/playlist-covers";
					cb(null, storagePath);
				},
				filename: (req, file, cb) => {
					const uniqueSuffix =
						Date.now() + "-" + Math.round(Math.random() * 1e9);
					const ext = extname(file.originalname);
					cb(null, `playlist-${req.params.id}-${uniqueSuffix}${ext}`);
				},
			}),
			fileFilter: (req, file, cb) => {
				// Accept images only
				if (!file.mimetype.match(/^image\/(jpg|jpeg|png|gif|webp)$/)) {
					return cb(
						new BadRequestException("Only image files are allowed"),
						false,
					);
				}
				cb(null, true);
			},
			limits: {
				fileSize: 5 * 1024 * 1024, // 5MB max
			},
		}),
	)
	async uploadCover(
		@Param("id") id: string,
		@UploadedFile() file: Express.Multer.File,
		@CurrentUser() user: User,
	) {
		if (!file) {
			throw new BadRequestException("No file uploaded");
		}

		return this.playlistService.updateCover(id, file, user.id);
	}

	/**
	 * Delete cover photo from a playlist
	 */
	@Delete("cover/:id")
	async deleteCover(@Param("id") id: string, @CurrentUser() user: User) {
		return this.playlistService.deleteCover(id, user.id);
	}

	/**
	 * Reorder songs in a playlist
	 * Body: { songIds: string[] } - array of song IDs in desired order
	 */
	@Put("order/:id")
	async reorderSongs(
		@Param("id") id: string,
		@Body() body: ReorderSongsDto,
		@CurrentUser() user: User,
	) {
		return this.playlistService.reorderSongs(id, body.songIds, user.id);
	}

	@Post("import/spotify")
	@UseGuards(SubscriptionGuard)
	@RequireSubscription(SubscriptionPlan.PREMIUM)
	async importFromSpotify(
		@Body() body: ImportPlaylistDto,
		@CurrentUser() user: User,
	) {
		return this.importService.importFromSpotify(body.playlistUrl, user);
	}

	@Post("import/youtube")
	@UseGuards(SubscriptionGuard)
	@RequireSubscription(SubscriptionPlan.PREMIUM)
	async importFromYoutube(
		@Body() body: { playlistUrl: string },
		@CurrentUser() user: User,
	) {
		return this.importService.importFromYoutube(body.playlistUrl, user);
	}
}
