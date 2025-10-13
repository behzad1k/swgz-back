import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class AddToLibraryDto {
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
  duration?: string;

  @IsString()
  @IsOptional()
  coverUrl?: string;

  @IsBoolean()
  @IsOptional()
  isLiked?: boolean;
}