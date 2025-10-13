import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { LibrarySong } from '../../library/entities/library-song.entity';
import { PlaylistSong } from '../../playlist/entities/playlist-song.entity';
import { PlayHistory } from '../../library/entities/play-history.entity';
import { Song } from './song.entity';

@Entity('artists')
export class Artist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  image?: string;

  @Column({ nullable: true, unique: true })
  lastFMLink?: string;

  @Column({ nullable: true })
  externalListens?: number;

  @Column({ nullable: true })
  mbid?: number;

  @OneToMany(() => Song, song => song.artist)
  songs: Song[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}