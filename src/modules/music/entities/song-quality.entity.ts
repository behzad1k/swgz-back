import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Song } from './song.entity';

@Entity('song_quality')
export class SongQuality {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  songId: string;

  @Column()
  quality: string; // '320', 'v0', '256', '192', '128', 'flac', etc.

  @Column()
  path: string;

  @Column()
  extension: string; // '.mp3', '.flac', '.ogg', etc.

  @Column({ default: false })
  unavailable: boolean; // True when this quality was searched but not found on Soulseek

  @ManyToOne(() => Song, song => song.qualities, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song: Song;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}