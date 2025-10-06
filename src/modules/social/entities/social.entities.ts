import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Song } from '../../music/entities/song.entity';

// Stalker/Following relationship
@Entity('stalkers')
@Unique(['stalkerId', 'stalkingId'])
export class Stalker {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stalkerId' })
  stalker: User;

  @Column()
  stalkerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stalkingId' })
  stalking: User;

  @Column()
  stalkingId: string;

  @CreateDateColumn()
  createdAt: Date;
}

// Repost
@Entity('reposts')
@Unique(['userId', 'songId'])
export class Repost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song: Song;

  @Column()
  songId: string;

  @CreateDateColumn()
  createdAt: Date;
}

// Activity feed item
export enum ActivityType {
  LIKE = 'like',
  COMMENT = 'comment',
  REPOST = 'repost',
}

@Entity('activities')
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: ActivityType,
  })
  type: ActivityType;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song: Song;

  @Column()
  songId: string;

  @Column({ nullable: true })
  commentId: string;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn()
  createdAt: Date;
}