import { IsString, IsOptional, IsBoolean, IsUrl } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;
}