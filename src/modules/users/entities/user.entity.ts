import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	OneToMany,
	Index,
} from "typeorm";
import { Exclude } from "class-transformer";
import { Playlist } from "../../playlist/entities/playlist.entity";
import { LibrarySong } from "../../library/entities/library-song.entity";
import { SearchHistory } from "../../music/entities/search-history.entity";
import { PlayHistory } from "../../library/entities/play-history.entity";
import { File } from "../../files/entities/file.entity";

export enum UserRole {
	USER = "user",
	ADMIN = "admin",
}

export enum SubscriptionPlan {
	FREE = "free",
	PREMIUM = "maxx",
}

export enum AuthProvider {
	LOCAL = "local",
	GOOGLE = "google",
	TELEGRAM = "telegram",
}

@Entity("users")
export class User {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ unique: true })
	@Index()
	email: string;

	@Column({ nullable: true })
	@Exclude()
	password: string;

	@Column({ unique: true, nullable: true })
	@Index()
	username: string;

	@Column({ nullable: true })
	bio: string;

	@Column({ nullable: true })
	avatarUrl: string;

	@Column({ default: false })
	isPrivate: boolean;

	// Google OAuth fields
	@Column({ nullable: true, unique: true })
	@Index()
	googleId: string;

	// Telegram Mini App fields
	@Column({ nullable: true, unique: true })
	@Index()
	telegramId: string;

	@Column({ nullable: true })
	telegramUsername: string;

	@Column({ nullable: true })
	telegramFirstName: string;

	@Column({ nullable: true })
	telegramLastName: string;

	@Column({ nullable: true })
	telegramPhotoUrl: string;

	@Column({ default: false })
	isTelegramPremium: boolean;

	@Column({ nullable: true })
	telegramLanguageCode: string;

	// Auth provider tracking
	@Column({
		type: "enum",
		enum: AuthProvider,
		default: AuthProvider.LOCAL,
	})
	authProvider: AuthProvider;

	@Column({ default: false })
	isEmailConfirmed: boolean;

	@Column({ nullable: true })
	@Exclude()
	emailConfirmToken: string;

	@Column({ nullable: true })
	@Exclude()
	resetPasswordToken: string;

	@Column({ unique: true, nullable: true })
	@Index()
	apiKey: string;

	@Column({
		type: "enum",
		enum: UserRole,
		default: UserRole.USER,
	})
	role: UserRole;

	@Column({
		type: "enum",
		enum: SubscriptionPlan,
		default: SubscriptionPlan.FREE,
	})
	subscriptionPlan: SubscriptionPlan;

	@Column({ type: "timestamp", nullable: true })
	subscriptionExpiresAt: Date;

	@Column({ type: "int", default: 0 })
	swagz: number;

	// Last seen tracking
	@Column({ type: "timestamp", nullable: true })
	lastSeenAt: Date;

	@OneToMany(() => Playlist, (playlist) => playlist.user)
	playlists: Playlist[];

	@OneToMany(() => LibrarySong, (librarySong) => librarySong.user)
	librarySongs: LibrarySong[];

	@OneToMany(() => SearchHistory, (searchHistory) => searchHistory.user)
	searchHistory: SearchHistory[];

	@OneToMany(() => PlayHistory, (playHistory) => playHistory.user)
	playHistory: PlayHistory[];

	@OneToMany(() => File, (file) => file.uploader)
	uploadedFiles: File[];

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}
