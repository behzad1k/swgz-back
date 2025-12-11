import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	OneToMany,
	JoinColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { PlaylistSong } from "./playlist-song.entity";
import { File } from "../../files/entities/file.entity";

export enum PlaylistSource {
	USER = "user",
	SPOTIFY = "spotify",
	YOUTUBE = "youtube",
}

@Entity("playlists")
export class Playlist {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	title: string;

	@Column({ nullable: true })
	description: string;

	@Column({
		type: "enum",
		enum: PlaylistSource,
		default: PlaylistSource.USER,
	})
	source: PlaylistSource;

	@Column({ nullable: true })
	externalId: string;

	// Store the URL directly, not the file ID
	@Column({ nullable: true })
	coverUrl: string;

	// Relation to File entity for metadata
	@Column({ nullable: true })
	coverFileId: string;

	@ManyToOne(() => File, { nullable: true, onDelete: "SET NULL" })
	@JoinColumn({ name: "coverFileId" })
	coverFile: File;

	@Column({ default: true })
	isEditable: boolean;

	@ManyToOne(() => User, (user) => user.playlists, { onDelete: "CASCADE" })
	@JoinColumn({ name: "userId" })
	user: User;

	@Column()
	userId: string;

	@OneToMany(() => PlaylistSong, (playlistSong) => playlistSong.playlist, {
		cascade: true,
	})
	songs: PlaylistSong[];

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}
