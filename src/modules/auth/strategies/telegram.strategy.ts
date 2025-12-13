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

		console.log("=== Telegram Auth Debug ===");
		console.log("Received initData:", initData);

		if (!initData) {
			throw new UnauthorizedException("Missing initData");
		}

		// Parse the URL-encoded initData string
		const params = new URLSearchParams(initData);
		const hash = params.get("hash");

		console.log("Extracted hash:", hash);

		if (!hash) {
			throw new UnauthorizedException("Missing hash in initData");
		}

		// Verify Telegram data authenticity
		const isValid = this.verifyTelegramAuth(initData, hash);
		console.log("Verification result:", isValid);

		if (!isValid) {
			throw new UnauthorizedException("Invalid Telegram authentication");
		}

		// Extract and parse user data
		const userDataStr = params.get("user");
		console.log("User data string:", userDataStr);

		if (!userDataStr) {
			throw new UnauthorizedException("Missing user data");
		}

		const userData = JSON.parse(
			decodeURIComponent(userDataStr),
		) as TelegramAuthData;
		console.log("Parsed user data:", userData);

		// Check if auth is not too old (24 hours)
		const authDateStr = params.get("auth_date");
		if (authDateStr) {
			const authDate = new Date(parseInt(authDateStr) * 1000);
			const now = new Date();
			const hoursDiff = (now.getTime() - authDate.getTime()) / (1000 * 60 * 60);

			console.log("Auth date:", authDate);
			console.log("Hours old:", hoursDiff);

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

		// Split initData into key=value pairs
		const pairs = initData.split("&");
		const dataCheck: { [key: string]: string } = {};

		for (const pair of pairs) {
			const [key, value] = pair.split("=");
			if (key === "hash") {
				continue; // Skip hash and signature
			}
			dataCheck[key] = value; // Keep URL-encoded
		}

		// Sort keys and create data-check-string with URL-encoded values
		const sortedKeys = Object.keys(dataCheck).sort();
		const dataCheckArray = sortedKeys.map((key) => `${key}=${dataCheck[key]}`);
		const dataCheckString = dataCheckArray.join("\n");

		console.log(
			"Data check string (first 200 chars):",
			dataCheckString.substring(0, 200),
		);

		// Create secret key from bot token
		const secretKey = crypto.createHash("sha256").update(botToken).digest();

		// Create hash of data check string
		const computedHash = crypto
			.createHmac("sha256", secretKey)
			.update(dataCheckString)
			.digest("hex");

		console.log("Computed hash:", computedHash);
		console.log("Received hash:", hash);
		console.log("Hashes match:", computedHash === hash);

		return computedHash === hash;
	}
}
