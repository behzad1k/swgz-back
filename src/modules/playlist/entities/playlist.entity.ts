import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PlaylistSong } from './playlist-song.entity';

export enum PlaylistSource {
  USER = 'user',
  SPOTIFY = 'spotify',
  YOUTUBE = 'youtube',
}

@Entity('playlists')
export class Playlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: PlaylistSource,
    default: PlaylistSource.USER,
  })
  source: PlaylistSource;

  @Column({ nullable: true })
  externalId: string;

  @Column({ nullable: true })
  coverImage: string;

  @Column({ default: true })
  isEditable: boolean;

  @ManyToOne(() => User, user => user.playlists, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @OneToMany(() => PlaylistSong, playlistSong => playlistSong.playlist, { cascade: true })
  songs: PlaylistSong[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
