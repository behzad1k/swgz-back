import { IsString } from "class-validator";

export class TelegramAuthDto {
	@IsString()
	initData: string;
}
