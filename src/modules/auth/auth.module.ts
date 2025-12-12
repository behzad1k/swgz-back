import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../users/entities/user.entity";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TelegramService } from "./telegram.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";
import { ApiKeyStrategy } from "./strategies/api-key.strategy";
import { TelegramStrategy } from "./strategies/telegram.strategy";
import { EmailService } from "./email.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([User]),
		PassportModule,
		JwtModule.register({
			secret: process.env.JWT_SECRET || "your-secret-key-change-in-production",
			signOptions: { expiresIn: "7d" },
		}),
	],
	controllers: [AuthController],
	providers: [
		AuthService,
		TelegramService,
		JwtStrategy,
		GoogleStrategy,
		ApiKeyStrategy,
		TelegramStrategy,
		EmailService,
	],
	exports: [AuthService, TelegramService],
})
export class AuthModule {}
