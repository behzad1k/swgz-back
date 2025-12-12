import {
	Controller,
	Post,
	Get,
	Body,
	UseGuards,
	Req,
	Res,
	HttpCode,
	HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
	ApiTags,
	ApiOperation,
	ApiResponse,
	ApiBearerAuth,
	ApiBody,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/decorators";
import { User } from "../users/entities/user.entity";
import { AuthService } from "./auth.service";
import { SignUpDto, LoginDto, ConfirmEmailDto } from "./dto/auth.dto";
import {
	TelegramAuthDto,
	TelegramAuthResponseDto,
} from "./dto/telegram-auth.dto";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
	constructor(private authService: AuthService) {}

	@Post("signup")
	@ApiOperation({ summary: "Register a new user with email and password" })
	@ApiResponse({ status: 201, description: "User registered successfully" })
	@ApiResponse({ status: 400, description: "Email already registered" })
	async signUp(@Body() signUpDto: SignUpDto) {
		return this.authService.signUp(
			signUpDto.email,
			signUpDto.password,
			signUpDto.username,
		);
	}

	@Post("confirm-email")
	@ApiOperation({ summary: "Confirm user email with token" })
	@ApiResponse({ status: 200, description: "Email confirmed successfully" })
	@ApiResponse({ status: 400, description: "Invalid confirmation token" })
	async confirmEmail(@Body() confirmEmailDto: ConfirmEmailDto) {
		return this.authService.confirmEmail(confirmEmailDto.token);
	}

	@Post("login")
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Login with email and password" })
	@ApiResponse({ status: 200, description: "Login successful" })
	@ApiResponse({ status: 401, description: "Invalid credentials" })
	async login(
		@Body() loginDto: LoginDto,
		@Res({ passthrough: true }) res: any,
	) {
		const user = await this.authService.login(
			loginDto.email,
			loginDto.password,
		);

		res.cookie("api-key", user.apiKey, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
		});

		return user;
	}

	@Post("telegram")
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: "Authenticate via Telegram Mini App",
		description:
			"Validates Telegram Web App init data and returns JWT token (same as regular login)",
	})
	@ApiBody({ type: TelegramAuthDto })
	@ApiResponse({
		status: 200,
		description: "Authentication successful",
		type: TelegramAuthResponseDto,
	})
	@ApiResponse({
		status: 401,
		description: "Invalid Telegram data or authentication failed",
	})
	@ApiResponse({
		status: 500,
		description: "TELEGRAM_BOT_TOKEN not configured",
	})
	async telegramAuth(
		@Body() telegramAuthDto: TelegramAuthDto,
		@Res({ passthrough: true }) res: any,
	) {
		// Validate Telegram data and find/create user
		const user = await this.authService.telegramAuth(telegramAuthDto.initData);

		// Set API key in cookie for web clients
		res.cookie("api-key", user.apiKey, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
		});

		// Return same format as regular login
		return user;
	}

	@Get("user")
	@UseGuards(AuthGuard("jwt"))
	@ApiBearerAuth()
	@ApiOperation({ summary: "Get current authenticated user" })
	@ApiResponse({ status: 200, description: "User data retrieved successfully" })
	@ApiResponse({ status: 401, description: "Unauthorized" })
	async getUser(@CurrentUser() user: User) {
		return this.authService.getUser(user);
	}

	@Get("google")
	@UseGuards(AuthGuard("google"))
	@ApiOperation({ summary: "Initiate Google OAuth login" })
	async googleAuth() {
		// Guard redirects to Google
	}

	@Get("google/callback")
	@UseGuards(AuthGuard("google"))
	@ApiOperation({ summary: "Google OAuth callback" })
	async googleAuthCallback(@Req() req) {
		return this.authService.googleLogin(req.user);
	}
}
