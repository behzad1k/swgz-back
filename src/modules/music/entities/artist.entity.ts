import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { LibrarySong } from '../../library/entities/library-song.entity';
import { PlaylistSong } from '../../playlist/entities/playlist-song.entity';
import { PlayHistory } from '../../library/entities/play-history.entity';
import { Album } from './album.entity';
import { Song } from './song.entity';

@Entity('artists')
export class Artist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  pfp?: string;

  @Column({ nullable: true, unique: true })
  lastFMLink?: string;

  @Column({ nullable: true })
  externalListeners?: number;

  @Column({ nullable: true })
  externalPlays?: number;

  @Column({ nullable: true })
  mbid?: string;

  @Column({ nullable: true, type: 'longtext' })
  bio?: string;

  @Column({ nullable: true, type: 'longtext'})
  fullBio?: string;

  @OneToMany(() => Song, song => song.artist)
  songs: Song[];

  @OneToMany(() => Album, album => album.artist)
  albums: Album[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}