// playlist.service.ts
import {
	Injectable,
	BadRequestException,
	ForbiddenException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOneOptions, Repository } from "typeorm";
import { PlaylistSong } from "./entities/playlist-song.entity";
import { Playlist, PlaylistSource } from "./entities/playlist.entity";
import { User, SubscriptionPlan } from "../users/entities/user.entity";
import { MusicService } from "../music/music.service";
import { FileService } from "../files/file.service";
import { FileType } from "../files/entities/file.entity";

@Injectable()
export class PlaylistService {
	constructor(
		@InjectRepository(Playlist)
		private playlistRepository: Repository<Playlist>,
		@InjectRepository(PlaylistSong)
		private playlistSongRepository: Repository<PlaylistSong>,
		private musicService: MusicService,
		private fileService: FileService,
	) {}

	async create(userId: string, name: string, description: string, user: User) {
		const count = await this.playlistRepository.count({ where: { userId } });

		if (user.subscriptionPlan === SubscriptionPlan.FREE && count >= 3) {
			throw new ForbiddenException("Free plan allows maximum 3 playlists");
		}

		const playlist = this.playlistRepository.create({
			userId,
			title: name,
			description,
			source: PlaylistSource.USER,
		});

		return this.playlistRepository.save(playlist);
	}

	async getUserPlaylists(userId: string) {
		return this.playlistRepository.find({
			where: { userId },
			relations: ["songs", "songs.song", "coverFile"],
			order: { createdAt: "DESC" },
		});
	}

	async getPlaylist(playlistId: string, userId: string) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
			relations: ["songs", "songs.song", "coverFile"],
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		// Sort songs by position
		playlist.songs.sort((a, b) => a.position - b.position);

		return playlist;
	}

	async addSong(playlistId: string, songData: any, userId: string) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		if (!playlist.isEditable) {
			throw new BadRequestException("Playlist is not editable");
		}

		const whereFindOption: FindOneOptions = songData.id
			? {
					where: {
						id: songData.id,
					},
				}
			: {
					where: {
						title: songData.title,
						artistName: songData.artistName,
					},
				};
		const song = await this.musicService.getOrCreateSong(
			songData,
			whereFindOption,
		);

		// Check if song already exists in playlist
		const existingSong = await this.playlistSongRepository.findOne({
			where: { playlistId, songId: song.id },
		});

		if (existingSong) {
			throw new BadRequestException("Song already exists in playlist");
		}

		const maxPosition = await this.playlistSongRepository
			.createQueryBuilder("ps")
			.select("MAX(ps.position)", "max")
			.where("ps.playlistId = :playlistId", { playlistId })
			.getRawOne();

		const playlistSong = this.playlistSongRepository.create({
			playlistId,
			songId: song.id,
			position: (maxPosition?.max || -1) + 1,
		});

		return this.playlistSongRepository.save(playlistSong);
	}

	async removeSong(playlistId: string, songId: string, userId: string) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		if (!playlist.isEditable) {
			throw new BadRequestException("Playlist is not editable");
		}

		const result = await this.playlistSongRepository.delete({
			playlistId,
			songId,
		});

		if (result.affected === 0) {
			throw new NotFoundException("Song not found in playlist");
		}

		// Reorder remaining songs to fill gaps
		await this.reindexPlaylistSongs(playlistId);

		return { message: "Song removed from playlist" };
	}

	async delete(playlistId: string, userId: string) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		// Delete cover file if exists
		if (playlist.coverFileId) {
			await this.fileService.deleteFile(playlist.coverFileId);
		}

		await this.playlistRepository.delete({ id: playlistId, userId });
		return { message: "Playlist deleted" };
	}

	async update(
		playlistId: string,
		name: string,
		description: string,
		userId: string,
	) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		playlist.title = name || playlist.title;
		playlist.description = description || playlist.description;

		return this.playlistRepository.save(playlist);
	}

	/**
	 * Update playlist cover image
	 */
	async updateCover(
		playlistId: string,
		file: Express.Multer.File,
		userId: string,
	) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		// Delete old cover file if exists
		if (playlist.coverFileId) {
			await this.fileService.deleteFile(playlist.coverFileId);
		}

		// Save new file
		const savedFile = await this.fileService.saveFile(
			file,
			FileType.PLAYLIST_COVER,
			userId,
		);

		// Update playlist
		playlist.coverFileId = savedFile.id;
		playlist.coverUrl = savedFile.url;
		await this.playlistRepository.save(playlist);

		return {
			message: "Cover updated successfully",
			coverUrl: savedFile.url,
			file: savedFile,
			playlist,
		};
	}

	/**
	 * Delete playlist cover image
	 */
	async deleteCover(playlistId: string, userId: string) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		if (!playlist.coverFileId) {
			throw new BadRequestException("Playlist has no cover image");
		}

		// Delete the file
		await this.fileService.deleteFile(playlist.coverFileId);

		// Update database
		playlist.coverFileId = null;
		playlist.coverUrl = null;
		await this.playlistRepository.save(playlist);

		return {
			message: "Cover deleted successfully",
			playlist,
		};
	}

	/**
	 * Reorder songs in a playlist
	 */
	async reorderSongs(playlistId: string, songIds: string[], userId: string) {
		const playlist = await this.playlistRepository.findOne({
			where: { id: playlistId, userId },
			relations: ["songs"],
		});

		if (!playlist) {
			throw new NotFoundException("Playlist not found");
		}

		if (!playlist.isEditable) {
			throw new BadRequestException("Playlist is not editable");
		}

		// Validate that all songIds exist in the playlist
		const existingSongIds = playlist.songs.map((ps) => ps.songId);
		const invalidSongIds = songIds.filter(
			(id) => !existingSongIds.includes(id),
		);

		if (invalidSongIds.length > 0) {
			throw new BadRequestException(
				`Invalid song IDs: ${invalidSongIds.join(", ")}`,
			);
		}

		// Ensure all songs are included in the new order
		if (songIds.length !== existingSongIds.length) {
			throw new BadRequestException(
				"Song IDs array must contain all songs in the playlist",
			);
		}

		// Update positions
		const updates = songIds.map((songId, index) => {
			return this.playlistSongRepository.update(
				{ playlistId, songId },
				{ position: index },
			);
		});

		await Promise.all(updates);

		// Return updated playlist
		return this.getPlaylist(playlistId, userId);
	}

	/**
	 * Reindex playlist songs to remove gaps in position numbers
	 */
	private async reindexPlaylistSongs(playlistId: string): Promise<void> {
		const songs = await this.playlistSongRepository.find({
			where: { playlistId },
			order: { position: "ASC" },
		});

		const updates = songs.map((song, index) => {
			song.position = index;
			return this.playlistSongRepository.save(song);
		});

		await Promise.all(updates);
	}
}
