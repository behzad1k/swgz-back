import {
	Injectable,
	UnauthorizedException,
	BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import {
	User,
	UserRole,
	SubscriptionPlan,
	AuthProvider,
} from "../users/entities/user.entity";
import { EmailService } from "./email.service";
import { TelegramService } from "./telegram.service";
import { TelegramUserDto } from "./dto/telegram-auth.dto";

@Injectable()
export class AuthService {
	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private jwtService: JwtService,
		private emailService: EmailService,
		private telegramService: TelegramService,
	) {}

	/**
	 * Traditional email/password signup
	 */
	async signUp(email: string, password: string, username: string) {
		const existingUser = await this.userRepository.findOne({
			where: { email },
		});
		if (existingUser) {
			throw new BadRequestException("Email already registered");
		}

		const hashedPassword = await bcrypt.hash(password, 10);
		const emailConfirmToken = uuidv4();
		const apiKey = uuidv4();

		const user = this.userRepository.create({
			email,
			password: hashedPassword,
			username,
			emailConfirmToken,
			apiKey,
			subscriptionPlan: SubscriptionPlan.FREE,
			authProvider: AuthProvider.LOCAL,
		});

		await this.userRepository.save(user);
		await this.emailService.sendConfirmationEmail(email, emailConfirmToken);

		return { message: "All good. Check your email" };
	}

	/**
	 * Email confirmation
	 */
	async confirmEmail(token: string) {
		const user = await this.userRepository.findOne({
			where: { emailConfirmToken: token },
		});

		if (!user) {
			throw new BadRequestException("Invalid confirmation token");
		}

		user.isEmailConfirmed = true;
		user.emailConfirmToken = null;
		await this.userRepository.save(user);

		return { message: "Email confirmed successfully" };
	}

	/**
	 * Traditional email/password login
	 */
	async login(email: string, password: string) {
		const user = await this.userRepository.findOne({ where: { email } });

		if (!user || !user.password) {
			throw new UnauthorizedException("Invalid credentials");
		}

		if (!user.isEmailConfirmed && user.authProvider === AuthProvider.LOCAL) {
			throw new UnauthorizedException("Please confirm your email first");
		}

		const isPasswordValid = await bcrypt.compare(password, user.password);
		if (!isPasswordValid) {
			throw new UnauthorizedException("Invalid credentials");
		}

		// Update last seen
		user.lastSeenAt = new Date();
		await this.userRepository.save(user);

		const payload = { sub: user.id, email: user.email, role: user.role };
		const accessToken = this.jwtService.sign(payload);

		return {
			accessToken,
			apiKey: user.apiKey,
			user: {
				id: user.id,
				email: user.email,
				username: user.username,
				role: user.role,
				subscriptionPlan: user.subscriptionPlan,
				apiKey: user.apiKey,
				authProvider: user.authProvider,
			},
		};
	}

	/**
	 * Get user information
	 */
	async getUser(user: User) {
		return this.userRepository.findOneOrFail({ where: { id: user.id } });
	}

	/**
	 * Google OAuth login
	 */
	async googleLogin(profile: any) {
		let user = await this.userRepository.findOne({
			where: { googleId: profile.id },
		});

		if (!user) {
			user = await this.userRepository.findOne({
				where: { email: profile.emails[0].value },
			});

			if (!user) {
				const apiKey = uuidv4();
				user = this.userRepository.create({
					email: profile.emails[0].value,
					googleId: profile.id,
					isEmailConfirmed: true,
					apiKey,
					subscriptionPlan: SubscriptionPlan.FREE,
					authProvider: AuthProvider.GOOGLE,
				});
			} else {
				user.googleId = profile.id;
				user.isEmailConfirmed = true;
				user.authProvider = AuthProvider.GOOGLE;
			}

			await this.userRepository.save(user);
		}

		// Update last seen
		user.lastSeenAt = new Date();
		await this.userRepository.save(user);

		const payload = { sub: user.id, email: user.email, role: user.role };
		const accessToken = this.jwtService.sign(payload);

		return {
			accessToken,
			apiKey: user.apiKey,
			user: {
				id: user.id,
				email: user.email,
				role: user.role,
				subscriptionPlan: user.subscriptionPlan,
			},
		};
	}

	/**
	 * Telegram Mini App authentication
	 * Find or create user based on Telegram data
	 */
	async findOrCreateTelegramUser(telegramUser: TelegramUserDto): Promise<User> {
		const telegramId = telegramUser.id.toString();

		// Try to find existing user by Telegram ID
		let user = await this.userRepository.findOne({
			where: { telegramId },
		});

		if (!user) {
			// Generate username and email
			const username = this.telegramService.generateUsername(telegramUser);
			const email = this.telegramService.generateEmail(telegramUser);
			const apiKey = uuidv4();

			// Check if username exists and make it unique if needed
			let finalUsername = username;
			let counter = 1;
			while (
				await this.userRepository.findOne({
					where: { username: finalUsername },
				})
			) {
				finalUsername = `${username}${counter}`;
				counter++;
			}

			// Create new user
			user = this.userRepository.create({
				email,
				username: finalUsername,
				telegramId,
				telegramUsername: telegramUser.username || null,
				telegramFirstName: telegramUser.first_name,
				telegramLastName: telegramUser.last_name || null,
				telegramPhotoUrl: telegramUser.photo_url || null,
				isTelegramPremium: telegramUser.is_premium || false,
				telegramLanguageCode: telegramUser.language_code || null,
				isEmailConfirmed: true, // Auto-confirm for Telegram users
				apiKey,
				subscriptionPlan: SubscriptionPlan.FREE,
				authProvider: AuthProvider.TELEGRAM,
				avatarUrl: telegramUser.photo_url || null,
			});

			await this.userRepository.save(user);
			console.log(`Created new Telegram user: ${user.id} (${telegramId})`);
		} else {
			// Update existing user's Telegram data
			user.telegramUsername = telegramUser.username || user.telegramUsername;
			user.telegramFirstName = telegramUser.first_name;
			user.telegramLastName = telegramUser.last_name || null;
			user.telegramPhotoUrl = telegramUser.photo_url || user.telegramPhotoUrl;
			user.isTelegramPremium = telegramUser.is_premium || false;
			user.telegramLanguageCode =
				telegramUser.language_code || user.telegramLanguageCode;
			user.lastSeenAt = new Date();

			// Update avatar if Telegram photo exists and user doesn't have one
			if (telegramUser.photo_url && !user.avatarUrl) {
				user.avatarUrl = telegramUser.photo_url;
			}

			await this.userRepository.save(user);
			console.log(`Updated existing Telegram user: ${user.id} (${telegramId})`);
		}

		return user;
	}

	/**
	 * Telegram Mini App authentication
	 * Validates initData, finds or creates user, returns JWT token (same format as regular login)
	 */
	async telegramAuth(initData: string) {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			throw new Error("TELEGRAM_BOT_TOKEN is not configured");
		}

		// Validate and parse Telegram data
		const parsedData = this.telegramService.validateTelegramRequest(
			initData,
			botToken,
		);

		// Extract user
		const telegramUser = this.telegramService.extractUser(parsedData);
		if (!telegramUser) {
			throw new UnauthorizedException("User data not found");
		}

		// Find or create user
		const user = await this.findOrCreateTelegramUser(telegramUser);

		// Update last seen
		user.lastSeenAt = new Date();
		await this.userRepository.save(user);

		// Generate JWT token (same as regular login)
		const payload = { sub: user.id, email: user.email, role: user.role };
		const accessToken = this.jwtService.sign(payload);

		// Return same format as regular login
		return {
			accessToken,
			apiKey: user.apiKey,
			user: {
				id: user.id,
				email: user.email,
				username: user.username,
				role: user.role,
				subscriptionPlan: user.subscriptionPlan,
				apiKey: user.apiKey,
				authProvider: user.authProvider,
			},
		};
	}

	/**
	 * Validate API key (supports both traditional and Telegram users)
	 */
	async validateApiKey(apiKey: string): Promise<User | null> {
		return this.userRepository.findOne({
			where: { apiKey, isEmailConfirmed: true },
		});
	}

	/**
	 * Validate user by ID
	 */
	async validateUser(userId: string): Promise<User | null> {
		return this.userRepository.findOne({ where: { id: userId } });
	}

	/**
	 * Validate user by Telegram ID
	 */
	async validateTelegramUser(telegramId: string): Promise<User | null> {
		return this.userRepository.findOne({ where: { telegramId } });
	}
}
