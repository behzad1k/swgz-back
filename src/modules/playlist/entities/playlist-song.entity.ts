import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Playlist } from './playlist.entity';

@Entity('playlist_songs')
export class PlaylistSong {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Playlist, playlist => playlist.songs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist: Playlist;

  @Column()
  playlistId: string;

  @ManyToOne(() => require('../../music/entities/song.entity').Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song: any;

  @Column()
  songId: string;

  @Column({ default: 0 })
  position: number;

  @CreateDateColumn()
  addedAt: Date;
}