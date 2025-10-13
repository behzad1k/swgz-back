import { IsString, IsOptional, IsDateString } from 'class-validator';

export class UpgradeToPremiumDto {
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}