import { IsBoolean, IsOptional } from 'class-validator';

export class StartDownloadDto {
  @IsBoolean()
  @IsOptional()
  preferFlac?: boolean;
}