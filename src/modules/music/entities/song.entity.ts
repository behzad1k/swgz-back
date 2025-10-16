import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, JoinColumn, ManyToOne, ManyToMany, JoinTable } from 'typeorm';
import { LibrarySong } from '../../library/entities/library-song.entity';
import { PlaylistSong } from '../../playlist/entities/playlist-song.entity';
import { Artist } from './artist.entity';
import { PlayHistory } from '../../library/entities/play-history.entity';

@Entity('songs')
export class Song {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  artistName: string;

  @Column({ nullable: true })
  albumName: string;

  @Column({ type: 'int', nullable: true })
  duration: number;

  @Column({ nullable: true })
  albumCover: string;

  @Column({ nullable: true })
  spotifyId: string;

  @Column({ nullable: true })
  youtubeId: string;

  @Column({ nullable: true })
  externalUrl: string;

  @Column({ default: false })
  hasFlac: boolean;

  @Column({ nullable: true })
  slskPath: string;

  @Column({ nullable: true })
  artistId: number;

  @Column({ nullable: true, unique: true })
  lastFMLink: string;

  @Column({ nullable: true })
  externalListens: number;

  @Column({ nullable: true })
  mbid: string;

  @Column({ nullable: true })
  downloadedPath: string;

  @Column({ type: 'json', nullable: true })
  metadata: any;

  @Column({ default: 0 })
  playCount: number;

  @Column({ default: 0 })
  likeCount: number;

  @Column({ default: 0 })
  commentCount: number;

  @Column({ default: null })
  rankForArtist: number;

  @Column({ default: 0 })
  repostCount: number;

  @OneToMany(() => LibrarySong, librarySong => librarySong.song)
  librarySongs: LibrarySong[];

  @OneToMany(() => PlaylistSong, playlistSong => playlistSong.song)
  playlistSongs: PlaylistSong[];

  @OneToMany(() => PlayHistory, playHistory => playHistory.song)
  playHistory: PlayHistory[];

  @ManyToOne(() => Artist, artist => artist.songs, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'artistId' })
  artist: Artist;

  @ManyToMany(() => Song)
  @JoinTable({ name: 'related_songs',joinColumn: { name: 'songId_1' }, inverseJoinColumn: { name: 'songId_2'} })
  relatedSongs: Song[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}