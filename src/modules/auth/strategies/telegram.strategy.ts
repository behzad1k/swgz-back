import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-custom";
import { Request } from "express";
import * as crypto from "crypto";

export interface TelegramAuthData {
	id: number;
	first_name: string;
	last_name?: string;
	username?: string;
	photo_url?: string;
	auth_date: number;
	hash: string;
}

@Injectable()
export class TelegramStrategy extends PassportStrategy(Strategy, "telegram") {
	constructor() {
		super();
	}

	async validate(req: Request): Promise<TelegramAuthData> {
		const telegramData = req.body as TelegramAuthData;

		if (!telegramData || !telegramData.hash) {
			throw new UnauthorizedException("Invalid Telegram data");
		}

		// Verify Telegram data authenticity
		const isValid = this.verifyTelegramAuth(telegramData);
		if (!isValid) {
			throw new UnauthorizedException("Invalid Telegram authentication");
		}

		// Check if auth is not too old (24 hours)
		const authDate = new Date(telegramData.auth_date * 1000);
		const now = new Date();
		const hoursDiff = (now.getTime() - authDate.getTime()) / (1000 * 60 * 60);

		if (hoursDiff > 24) {
			throw new UnauthorizedException("Telegram authentication expired");
		}

		return telegramData;
	}

	private verifyTelegramAuth(data: TelegramAuthData): boolean {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;

		if (!botToken) {
			throw new Error("TELEGRAM_BOT_TOKEN is not configured");
		}

		const { hash, ...authData } = data;

		// Create data check string
		const dataCheckArr = Object.keys(authData)
			.filter((key) => authData[key] !== undefined)
			.sort()
			.map((key) => `${key}=${authData[key]}`);

		const dataCheckString = dataCheckArr.join("\n");

		// Create secret key from bot token
		const secretKey = crypto.createHash("sha256").update(botToken).digest();

		// Create hash of data check string
		const computedHash = crypto
			.createHmac("sha256", secretKey)
			.update(dataCheckString)
			.digest("hex");

		return computedHash === hash;
	}
}
