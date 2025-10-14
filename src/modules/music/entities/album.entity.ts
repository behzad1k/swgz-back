import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { LibrarySong } from '../../library/entities/library-song.entity';
import { PlaylistSong } from '../../playlist/entities/playlist-song.entity';
import { PlayHistory } from '../../library/entities/play-history.entity';
import { Artist } from './artist.entity';
import { Song } from './song.entity';

@Entity('albums')
export class Album {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  albumCover?: string;

  @Column({ nullable: true, unique: true })
  lastFMLink?: string;

  @Column({ nullable: true })
  artistId?: string;

  @Column({ nullable: true })
  externalListeners?: number;

  @Column({ nullable: true })
  externalPlays?: number;

  @Column({ nullable: true })
  mbid?: string;

  @Column({ nullable: true })
  releaseDate?: string;

  @Column({ nullable: true })
  rankForArtist?: number;

  @Column({ nullable: true })
  artistName?: string;

  @OneToMany(() => Song, song => song.artist)
  songs: Song[];

  @ManyToOne(() => Artist, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'artistId' })
  artist: Artist;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}