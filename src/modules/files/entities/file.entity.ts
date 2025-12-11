import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

export enum FileType {
	PROFILE_PICTURE = "profile_picture",
	PLAYLIST_COVER = "playlist_cover",
	ALBUM_COVER = "album_cover",
	ARTIST_IMAGE = "artist_image",
	OTHER = "other",
}

@Entity("files")
export class File {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	originalName: string;

	@Column()
	filename: string;

	@Column()
	path: string;

	@Column()
	url: string;

	@Column()
	mimeType: string;

	@Column({ type: "bigint" })
	size: number;

	@Column({
		type: "enum",
		enum: FileType,
		default: FileType.OTHER,
	})
	type: FileType;

	@Column({ nullable: true })
	uploadedBy: string;

	@ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
	@JoinColumn({ name: "uploadedBy" })
	uploader: User;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}
