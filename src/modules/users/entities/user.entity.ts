import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Exclude } from 'class-transformer';
import { Playlist } from '../../playlist/entities/playlist.entity';
import { LibrarySong } from '../../library/entities/library-song.entity';
import { SearchHistory } from '../../music/entities/search-history.entity';
import { PlayHistory } from '../../library/entities/play-history.entity';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export enum SubscriptionPlan {
  FREE = 'free',
  PREMIUM = 'premium',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  @Exclude()
  password: string;

  @Column({ unique: true, nullable: true })
  username: string;

  @Column({ nullable: true })
  bio: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: false })
  isPrivate: boolean;

  @Column({ nullable: true })
  googleId: string;

  @Column({ default: false })
  isEmailConfirmed: boolean;

  @Column({ nullable: true })
  @Exclude()
  emailConfirmToken: string;

  @Column({ nullable: true })
  @Exclude()
  resetPasswordToken: string;

  @Column({ unique: true, nullable: true })
  apiKey: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({
    type: 'enum',
    enum: SubscriptionPlan,
    default: SubscriptionPlan.FREE,
  })
  subscriptionPlan: SubscriptionPlan;

  @Column({ type: 'timestamp', nullable: true })
  subscriptionExpiresAt: Date;

  @Column({ type: 'int', default: 0 })
  swagz: number;

  @OneToMany(() => Playlist, playlist => playlist.user)
  playlists: Playlist[];

  @OneToMany(() => LibrarySong, librarySong => librarySong.user)
  librarySongs: LibrarySong[];

  @OneToMany(() => SearchHistory, searchHistory => searchHistory.user)
  searchHistory: SearchHistory[];

  @OneToMany(() => PlayHistory, playHistory => playHistory.user)
  playHistory: PlayHistory[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}