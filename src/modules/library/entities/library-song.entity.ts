import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Song } from '../../music/entities/song.entity';

@Entity('library_songs')
export class LibrarySong {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.librarySongs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => Song, song => song.librarySongs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song: Song;

  @Column()
  songId: string;

  @Column({ default: false })
  isLiked: boolean;

  @Column({ default: false })
  isDownloaded: boolean;

  @CreateDateColumn()
  addedAt: Date;
}