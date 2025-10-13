import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PlaySongDto{
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  artistName: string;

  @IsString()
  @IsOptional()
  albumName?: string;

  @IsString()
  @IsOptional()
  albumCover?: string;

  @IsString()
  @IsOptional()
  lastFMLink?: string;

  @IsInt()
  @IsOptional()
  duration?: number;

  @IsString()
  @IsOptional()
  mbid?: string;
}