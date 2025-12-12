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
	language_code?: string;
	allows_write_to_pm?: boolean;
}

@Injectable()
export class TelegramStrategy extends PassportStrategy(Strategy, "telegram") {
	constructor() {
		super();
	}

	async validate(req: Request): Promise<TelegramAuthData> {
		const { initData } = req.body;

		if (!initData) {
			throw new UnauthorizedException("Missing initData");
		}

		// Parse the URL-encoded initData string
		const params = new URLSearchParams(initData);
		const hash = params.get("hash");

		if (!hash) {
			throw new UnauthorizedException("Missing hash in initData");
		}

		// Verify Telegram data authenticity
		const isValid = this.verifyTelegramAuth(initData, hash);
		if (!isValid) {
			throw new UnauthorizedException("Invalid Telegram authentication");
		}

		// Extract and parse user data
		const userDataStr = params.get("user");
		if (!userDataStr) {
			throw new UnauthorizedException("Missing user data");
		}

		const userData = JSON.parse(
			decodeURIComponent(userDataStr),
		) as TelegramAuthData;

		// Check if auth is not too old (24 hours)
		const authDateStr = params.get("auth_date");
		if (authDateStr) {
			const authDate = new Date(parseInt(authDateStr) * 1000);
			const now = new Date();
			const hoursDiff = (now.getTime() - authDate.getTime()) / (1000 * 60 * 60);

			if (hoursDiff > 24) {
				throw new UnauthorizedException("Telegram authentication expired");
			}
		}

		return userData;
	}

	private verifyTelegramAuth(initData: string, hash: string): boolean {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;

		if (!botToken) {
			throw new Error("TELEGRAM_BOT_TOKEN is not configured");
		}

		// Parse the initData
		const params = new URLSearchParams(initData);

		// Remove hash from params for verification
		params.delete("hash");

		// Sort parameters alphabetically and create data-check-string
		const dataCheckArray: string[] = [];
		const sortedKeys = Array.from(params.keys()).sort();

		for (const key of sortedKeys) {
			const value = params.get(key);
			if (value) {
				dataCheckArray.push(`${key}=${value}`);
			}
		}

		const dataCheckString = dataCheckArray.join("\n");

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
