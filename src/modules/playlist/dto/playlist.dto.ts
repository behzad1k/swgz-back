import {
	IsString,
	IsNotEmpty,
	IsOptional,
	IsUrl,
	IsArray,
	ArrayNotEmpty,
} from "class-validator";

export class CreatePlaylistDto {
	@IsString()
	@IsNotEmpty()
	name: string;

	@IsString()
	@IsOptional()
	description?: string;
}

export class UpdatePlaylistDto {
	@IsString()
	@IsOptional()
	name?: string;

	@IsString()
	@IsOptional()
	description?: string;
}

export class AddSongToPlaylistDto {
	@IsString()
	@IsNotEmpty()
	id: string;

	@IsString()
	@IsNotEmpty()
	title: string;

	@IsString()
	@IsNotEmpty()
	artist: string;

	@IsString()
	@IsOptional()
	album?: string;

	@IsString()
	@IsOptional()
	lastFMLink?: string;

	@IsString()
	@IsOptional()
	mbid?: string;
}

export class ImportPlaylistDto {
	@IsUrl()
	@IsNotEmpty()
	playlistUrl: string;
}

export class ReorderSongsDto {
	@IsArray()
	@ArrayNotEmpty()
	@IsString({ each: true })
	songIds: string[];
}
