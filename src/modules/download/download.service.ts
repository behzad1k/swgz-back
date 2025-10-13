// download.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { LibrarySong } from '../library/entities/library-song.entity';
import { User, SubscriptionPlan } from '../users/entities/user.entity';
import { SlskService } from '../music/slsk.service';

export interface DownloadJob {
  id: string;
  userId: string;
  songId: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  outputPath?: string;
  process?: ChildProcessWithoutNullStreams;
}

@Injectable()
export class DownloadService {
  private jobs: Map<string, DownloadJob> = new Map();
  private downloadQueue: DownloadJob[] = [];
  private activeDownloads = 0;
  private maxConcurrent = 2;

  constructor(
    @InjectRepository(LibrarySong)
    private librarySongRepository: Repository<LibrarySong>,
    private slskService: SlskService,
  ) {}

  async startDownload(songId: string, user: User, preferFlac = false): Promise<string> {
    const librarySong = await this.librarySongRepository.findOne({
      where: { userId: user.id, songId },
      relations: ['song'],
    });

    if (!librarySong) {
      throw new BadRequestException('Song must be in library to download');
    }

    if (preferFlac && user.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      throw new BadRequestException('FLAC quality requires premium subscription');
    }

    const jobId = uuidv4();
    const job: DownloadJob = {
      id: jobId,
      userId: user.id,
      songId,
      status: 'queued',
      progress: 0,
    };

    this.jobs.set(jobId, job);
    this.downloadQueue.push(job);
    this.processQueue();

    return jobId;
  }

  private async processQueue() {
    if (this.activeDownloads >= this.maxConcurrent || this.downloadQueue.length === 0) {
      return;
    }

    const job = this.downloadQueue.shift();
    if (!job) return;

    this.activeDownloads++;
    job.status = 'downloading';

    try {
      await this.executeDownload(job);
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
    } finally {
      this.activeDownloads--;
      this.processQueue();
    }
  }

  private async executeDownload(job: DownloadJob): Promise<void> {
    const librarySong = await this.librarySongRepository.findOne({
      where: { songId: job.songId },
      relations: ['song', 'user'],
    });

    const song = librarySong.song;
    const user = librarySong.user;
    const outputDir = path.join(process.env.DOWNLOAD_DIR || 'downloads', user.id);

    const format = user.subscriptionPlan === SubscriptionPlan.PREMIUM ? 'flac,mp3' : 'mp3';
    const input = `artist=${song.artistName}, title=${song.title}`;

    const args = this.slskService.buildDownloadCommand({
      input,
      path: outputDir,
      format,
    });

    return new Promise((resolve, reject) => {
      const sldl = spawn(process.env.SLDL_PATH, args);
      job.process = sldl;

      let output = '';

      sldl.stdout.on('data', (data) => {
        output += data.toString();
        this.parseProgress(job, output);
      });

      sldl.on('close', async (code) => {
        if (code === 0) {
          job.status = 'completed';
          job.progress = 100;

          librarySong.isDownloaded = true;
          await this.librarySongRepository.save(librarySong);

          resolve();
        } else {
          job.status = 'failed';
          job.error = `Download failed with code ${code}`;
          reject(new Error(job.error));
        }
      });

      sldl.on('error', (error) => {
        job.status = 'failed';
        job.error = error.message;
        reject(error);
      });
    });
  }

  private parseProgress(job: DownloadJob, output: string) {
    const percentMatch = output.match(/(\d+)%/);
    if (percentMatch) {
      job.progress = parseInt(percentMatch[1]);
    }
  }

  async getJobStatus(jobId: string): Promise<DownloadJob | null> {
    return this.jobs.get(jobId) || null;
  }

  async cancelDownload(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new BadRequestException('Job not found');
    }

    if (job.process) {
      job.process.kill();
    }

    job.status = 'failed';
    job.error = 'Cancelled by user';

    const index = this.downloadQueue.indexOf(job);
    if (index > -1) {
      this.downloadQueue.splice(index, 1);
    }
  }
}

