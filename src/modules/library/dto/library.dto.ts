import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class AddToLibraryDto {
  @IsString()
  id: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  artistName: string;
}