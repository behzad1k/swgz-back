import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { File, FileType } from "./entities/file.entity";

@Injectable()
export class FileService {
	constructor(
		@InjectRepository(File)
		private fileRepository: Repository<File>,
	) {}

	/**
	 * Save file metadata to database
	 */
	async saveFile(
		file: Express.Multer.File,
		type: FileType,
		userId?: string,
	): Promise<File> {
		const baseUrl = process.env.BACKEND_URL || "http://localhost:9001";
		const relativePath = this.getRelativePathForType(type);
		const url = `${baseUrl}${relativePath}/${file.filename}`;

		const fileEntity = this.fileRepository.create({
			originalName: file.originalname,
			filename: file.filename,
			path: file.path,
			url,
			mimeType: file.mimetype,
			size: file.size,
			type,
			uploadedBy: userId,
		});

		return this.fileRepository.save(fileEntity);
	}

	/**
	 * Get file by ID
	 */
	async getFile(fileId: string): Promise<File> {
		const file = await this.fileRepository.findOne({
			where: { id: fileId },
		});

		if (!file) {
			throw new NotFoundException("File not found");
		}

		return file;
	}

	/**
	 * Delete file from database and filesystem
	 */
	async deleteFile(fileId: string): Promise<void> {
		const file = await this.getFile(fileId);

		// Delete from filesystem
		if (existsSync(file.path)) {
			try {
				await unlink(file.path);
				console.log(`🗑️  Deleted file: ${file.path}`);
			} catch (error) {
				console.error(`Failed to delete file ${file.path}:`, error);
			}
		}

		// Delete from database
		await this.fileRepository.delete(fileId);
	}

	/**
	 * Get all files by type
	 */
	async getFilesByType(type: FileType, userId?: string): Promise<File[]> {
		const where: any = { type };
		if (userId) {
			where.uploadedBy = userId;
		}

		return this.fileRepository.find({
			where,
			order: { createdAt: "DESC" },
		});
	}

	/**
	 * Delete orphaned files (files not referenced by any entity)
	 */
	async cleanupOrphanedFiles(): Promise<number> {
		// This will be implemented based on your specific needs
		// For now, just a placeholder
		const orphanedFiles = await this.fileRepository
			.createQueryBuilder("file")
			.leftJoin("playlists", "p", "p.coverFileId = file.id")
			.leftJoin("users", "u", "u.profilePictureId = file.id")
			.where("p.id IS NULL")
			.andWhere("u.id IS NULL")
			.andWhere("file.createdAt < :date", {
				date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days old
			})
			.getMany();

		for (const file of orphanedFiles) {
			await this.deleteFile(file.id);
		}

		return orphanedFiles.length;
	}

	/**
	 * Get relative path for file type
	 */
	private getRelativePathForType(type: FileType): string {
		const pathMap: Record<FileType, string> = {
			[FileType.PROFILE_PICTURE]: "/uploads/profile-pictures",
			[FileType.PLAYLIST_COVER]: "/uploads/playlist-covers",
			[FileType.ALBUM_COVER]: "/uploads/album-covers",
			[FileType.ARTIST_IMAGE]: "/uploads/artist-images",
			[FileType.OTHER]: "/uploads/other",
		};

		return pathMap[type] || "/uploads/other";
	}

	/**
	 * Get storage path for file type
	 */
	getStoragePathForType(type: FileType): string {
		const pathMap: Record<FileType, string> = {
			[FileType.PROFILE_PICTURE]: "./uploads/profile-pictures",
			[FileType.PLAYLIST_COVER]: "./uploads/playlist-covers",
			[FileType.ALBUM_COVER]: "./uploads/album-covers",
			[FileType.ARTIST_IMAGE]: "./uploads/artist-images",
			[FileType.OTHER]: "./uploads/other",
		};

		return pathMap[type] || "./uploads/other";
	}
}
