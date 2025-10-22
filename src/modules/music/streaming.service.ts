import { Injectable, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ChildProcess } from 'child_process';
import { createReadStream, existsSync, watch, FSWatcher } from 'fs';
import { unlink, mkdir, readdir, rmdir } from 'fs/promises';
import path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityPreference } from '../../types';
import { formatSldlInputStr } from '../../utils/formatter';
import { Song } from './entities/song.entity';
import { PassThrough } from 'stream';
import { SubscriptionPlan } from '../users/entities/user.entity';

type QualityPreferenceOrUnrestricted = QualityPreference | 'unrestricted';

interface ActiveDownload {
  process: ChildProcess | null;
  activeStreams: Set<PassThrough>;
  filePath: string | null;
  isComplete: boolean;
  requestedQuality: QualityPreferenceOrUnrestricted;
  actualQuality: string | null;
  streamDir: string;
  watcher: FSWatcher | null;
  jobName: string;
  status: 'searching' | 'downloading' | 'ready' | 'failed';
  error?: string;
  progress: number;
  duration?: number;
  fileSize?: number;
}

@Injectable()
export class StreamingService {
  private streamCache = new Map<string, string>();
  private activeDownloads = new Map<string, ActiveDownload>();
  private downloadLocks = new Map<string, Promise<void>>();
  private tempDir: string;
  private downloadsDir: string;

  private readonly QUALITY_HIERARCHY = {
    'flac': ['flac'],
    '320': ['320', 'v0', '256', '192', '128'],
    'v0': ['v0', '320', '256', '192', '128'],
    '256': ['256', '320', 'v0', '192', '128'],
    '192': ['192', '256', '320', 'v0', '128'],
    '128': ['128', '192', '256', '320', 'v0'],
    'standard': ['320', 'v0', '256', '192', '128'],
  };

  private readonly QUALITY_ORDER = ['128', '192', '256', 'v0', '320', 'flac'];

  constructor(
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
  ) {
    this.tempDir = process.env.STREAM_TEMP_DIR || path.join(process.cwd(), 'temp', 'streams');
    this.downloadsDir = process.env.DOWNLOADS_DIR || path.join(process.cwd(), 'downloads');
    this.ensureDirectories();
  }

  private async ensureDirectories() {
    try {
      await mkdir(this.tempDir, { recursive: true });
      await mkdir(this.downloadsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create directories:', error);
    }
  }

  private getCacheKey(songId: string, quality: QualityPreferenceOrUnrestricted): string {
    return `${songId}-${quality}`;
  }

  private compareQuality(quality1: string, quality2: string): number {
    const index1 = this.QUALITY_ORDER.indexOf(quality1);
    const index2 = this.QUALITY_ORDER.indexOf(quality2);
    return index1 - index2;
  }

  /**
   * Get download status for a song
   */
  getDownloadStatus(
    songId: string,
    quality?: QualityPreference
  ): {
    status: string;
    progress: number;
    quality?: string;
    duration?: number;
    fileSize?: number;
    error?: string;
    message?: string;
  } {
    const cacheKey = this.getCacheKey(songId, quality || 'standard');
    const download = this.activeDownloads.get(cacheKey);

    if (!download) {
      return {
        status: 'not_started',
        progress: 0,
        message: 'Download has not been initiated'
      };
    }

    return {
      status: download.status,
      progress: download.progress,
      quality: download.actualQuality || download.requestedQuality as string,
      duration: download.duration,
      fileSize: download.fileSize,
      error: download.error,
      message: this.getStatusMessage(download.status, download.progress),
    };
  }

  private getStatusMessage(status: string, progress: number): string {
    switch (status) {
      case 'searching':
        return 'Searching for track...';
      case 'downloading':
        return `Downloading... ${progress}%`;
      case 'ready':
        return 'File ready for streaming';
      case 'failed':
        return 'Download failed';
      default:
        return 'Unknown status';
    }
  }

  /**
   * Start background download without streaming
   */
  async startBackgroundDownload(songId: string, quality?: QualityPreference): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id: songId } });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    const requestedQuality = quality || 'standard';

    // Check if already downloading
    const cacheKey = this.getCacheKey(songId, requestedQuality);
    if (this.activeDownloads.has(cacheKey)) {
      console.log('⚠️ Download already in progress for song:', songId, 'quality:', requestedQuality);
      return;
    }

    // Check if already cached
    if (requestedQuality === 'flac') {
      if (song.flacPath && existsSync(song.flacPath)) {
        console.log('✅ FLAC already cached:', songId);
        return;
      }
      if (song.hasFlac === false) {
        throw new NotFoundException('FLAC quality is not available for this track');
      }
    } else {
      if (song.standardPath && existsSync(song.standardPath)) {
        console.log('✅ Song already cached:', songId);
        return;
      }
    }

    const timestamp = Date.now();
    const streamDirName = `${song.id}-${requestedQuality}-${timestamp}`;
    const streamDir = path.join(this.tempDir, streamDirName);

    await mkdir(streamDir, { recursive: true });

    const download: ActiveDownload = {
      process: null,
      activeStreams: new Set(),
      filePath: null,
      isComplete: false,
      requestedQuality: requestedQuality as QualityPreferenceOrUnrestricted,
      actualQuality: null,
      streamDir,
      watcher: null,
      jobName: `sldl-${streamDirName}`,
      status: 'searching',
      progress: 0,
    };

    this.activeDownloads.set(cacheKey, download);

    // Setup file watcher
    this.setupFileWatcher(download, streamDir, streamDirName, song);

    // Start download process
    this.performDownload(song, download, streamDir, requestedQuality as QualityPreferenceOrUnrestricted).catch(error => {
      console.error('Background download error:', error);
      download.status = 'failed';
      download.error = error.message;
    });
  }

  async streamSong(
    songId: string,
    res: Response,
    quality?: QualityPreference,
    userSubscriptionPlan?: SubscriptionPlan
  ): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id: songId } });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // Determine quality to use
    let requestedQuality: QualityPreferenceOrUnrestricted = quality || 'standard';

    // Check cache first (this should be done by music.service, but double-check)
    if (requestedQuality === 'flac') {
      if (song.flacPath && existsSync(song.flacPath)) {
        console.log('📂 Streaming cached FLAC');
        return this.streamFromFile(song.flacPath, res);
      }
      if (song.hasFlac === false) {
        throw new NotFoundException('FLAC quality is not available for this track');
      }
    } else {
      if (song.standardPath && existsSync(song.standardPath)) {
        console.log('📂 Streaming cached standard quality');
        return this.streamFromFile(song.standardPath, res);
      }
    }

    const cacheKey = this.getCacheKey(songId, requestedQuality);
    const existingDownload = this.activeDownloads.get(cacheKey);

    // If download is ready, stream it
    if (existingDownload?.status === 'ready' && existingDownload.filePath && existsSync(existingDownload.filePath)) {
      console.log('📂 File ready from active download, streaming...');
      return this.joinExistingStream(existingDownload, res);
    }

    // If download is in progress, join it
    if (existingDownload && existingDownload.status !== 'failed') {
      console.log('🔄 Joining existing download...');
      return this.joinExistingStream(existingDownload, res);
    }

    // Start new download with streaming
    console.log('⬇️ Starting new download with streaming...');
    await this.downloadAndStream(song, res, requestedQuality);
  }

  private async joinExistingStream(download: ActiveDownload, res: Response): Promise<void> {
    const passThrough = new PassThrough();
    download.activeStreams.add(passThrough);

    res.on('close', () => {
      console.log('❌ Client disconnected from stream');
      download.activeStreams.delete(passThrough);
      passThrough.end();
    });

    res.on('error', (error) => {
      console.error('❌ Response error:', error);
    });

    // Wait for file to be ready if still downloading
    if (download.status !== 'ready' || !download.filePath) {
      const maxWaitTime = 120000; // 2 minutes
      const startTime = Date.now();

      await new Promise<void>((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (download.status === 'ready' && download.filePath && existsSync(download.filePath)) {
            clearInterval(checkInterval);
            resolve();
          } else if (download.status === 'failed') {
            clearInterval(checkInterval);
            reject(new Error(download.error || 'Download failed'));
          } else if (Date.now() - startTime > maxWaitTime) {
            clearInterval(checkInterval);
            reject(new Error('Download timeout'));
          }
        }, 500);
      }).catch(error => {
        download.activeStreams.delete(passThrough);
        if (!res.headersSent) {
          res.status(404).json({ error: error.message });
        }
        throw error;
      });
    }

    if (!download.filePath || !existsSync(download.filePath)) {
      if (!res.headersSent) {
        res.status(404).json({ error: 'File not found' });
      }
      return;
    }

    const ext = path.extname(download.filePath).replace('.incomplete', '').toLowerCase();
    const mimeType = this.getMimeType(ext);

    try {
      const stats = await import('fs/promises').then(fs => fs.stat(download.filePath!));

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Quality': download.actualQuality || download.requestedQuality,
      });

      passThrough.pipe(res);

      // Send current file content
      const currentStream = createReadStream(download.filePath, { start: 0 });
      currentStream.pipe(passThrough, { end: false });

      currentStream.on('end', () => {
        console.log('✅ Client caught up with current content');
      });

      currentStream.on('error', (error) => {
        console.error('❌ Stream error:', error);
        passThrough.end();
      });
    } catch (error) {
      console.error('❌ Error joining stream:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Streaming error' });
      }
    }
  }

  private async streamFromFile(filePath: string, res: Response): Promise<void> {
    try {
      console.log('📂 streamFromFile called for:', filePath);
      const stat = await import('fs/promises').then(fs => fs.stat(filePath));
      const fileSize = stat.size;
      const ext = path.extname(filePath).replace('.incomplete', '').toLowerCase();
      const mimeType = this.getMimeType(ext);

      console.log('📊 File stats:', { fileSize, ext, mimeType });

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });

      console.log('✅ Headers sent successfully');

      const stream = createReadStream(filePath);

      stream.on('open', () => console.log('📖 File stream opened'));
      stream.on('end', () => console.log('✅ File stream ended'));
      stream.on('close', () => console.log('🔒 File stream closed'));

      stream.pipe(res);

      stream.on('error', (error) => {
        console.error('❌ Stream error:', error);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });

      res.on('close', () => console.log('🔌 Client connection closed'));
      res.on('finish', () => console.log('✅ Response finished'));
      res.on('error', (error) => console.error('❌ Response error:', error));
    } catch (error) {
      console.error('❌ streamFromFile error:', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  }

  private setupFileWatcher(
    download: ActiveDownload,
    streamDir: string,
    streamDirName: string,
    song: Song
  ): void {
    let fileDetected = false;

    download.watcher = watch(streamDir, { persistent: false }, async (eventType, filename) => {
      if (!filename || fileDetected) return;

      console.log(`👁️ File watcher event: ${eventType} - ${filename}`);

      if (filename === streamDirName) {
        console.log('⏭️ Skipping directory event');
        return;
      }

      const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg'];
      const isAudioFile = audioExtensions.some(ext =>
        filename.endsWith(ext) || filename.endsWith(ext + '.incomplete')
      );

      if (!isAudioFile) {
        console.log('⏭️ Skipping non-audio file:', filename);
        return;
      }

      if (!filename.endsWith('.incomplete')) {
        console.log('⏭️ Skipping final file (already processed incomplete):', filename);
        return;
      }

      fileDetected = true;
      console.log('🔒 File detection locked');

      const filePath = path.join(streamDir, filename);

      // Wait for file to be ready
      let attempts = 0;
      const maxAttempts = 100;
      let fileReady = false;

      while (attempts < maxAttempts && !fileReady) {
        await new Promise(resolve => setTimeout(resolve, 300));

        if (!existsSync(filePath)) {
          attempts++;
          continue;
        }

        try {
          const stats = await import('fs/promises').then(fs => fs.stat(filePath));
          if (stats.size >= 100536) {
            fileReady = true;
            download.fileSize = stats.size;
            console.log(`✅ File ready with ${stats.size} bytes after ${attempts * 300}ms`);
          } else {
            console.log(`⏳ File has ${stats.size} bytes, waiting for more...`);
            attempts++;
          }
        } catch (error) {
          attempts++;
        }
      }

      if (!fileReady) {
        console.log('❌ File never became ready with sufficient data');
        fileDetected = false;
        return;
      }

      fileDetected = true;

      const ext = path.extname(filename).replace('.incomplete', '').toLowerCase();
      download.filePath = filePath;
      download.actualQuality = ext === '.flac' ? 'flac' : download.requestedQuality as string;
      download.status = 'ready';
      download.progress = 50;

      const cacheKey = this.getCacheKey(song.id, download.requestedQuality);
      this.streamCache.set(cacheKey, filePath);

      console.log('📁 FILE DETECTED via watcher:', filePath);
      console.log('📊 Actual quality:', download.actualQuality, '(requested:', download.requestedQuality, ')');

      // Start progressive tailing for active streams
      if (download.activeStreams.size > 0) {
        this.startProgressiveTailing(filePath, download, 0);
      }
    });

    console.log('👁️ File watcher started for:', streamDir);
  }

  private async downloadAndStream(
    song: Song,
    res: Response,
    requestedQuality: QualityPreferenceOrUnrestricted
  ): Promise<void> {
    const timestamp = Date.now();
    const streamDirName = `${song.id}-${requestedQuality}-${timestamp}`;
    const streamDir = path.join(this.tempDir, streamDirName);
    const cacheKey = this.getCacheKey(song.id, requestedQuality);

    await mkdir(streamDir, { recursive: true });
    console.log('📁 Created stream directory:', streamDir);

    const passThrough = new PassThrough();

    const download: ActiveDownload = {
      process: null,
      activeStreams: new Set([passThrough]),
      filePath: null,
      isComplete: false,
      requestedQuality: requestedQuality,
      actualQuality: null,
      streamDir,
      watcher: null,
      jobName: `sldl-${streamDirName}`,
      status: 'searching',
      progress: 0,
    };

    this.activeDownloads.set(cacheKey, download);

    let headersSent = false;

    const cleanup = async () => {
      if (download.watcher) {
        download.watcher.close();
        download.watcher = null;
        console.log('🛑 File watcher closed');
      }

      setTimeout(async () => {
        this.activeDownloads.delete(cacheKey);

        try {
          if (existsSync(streamDir)) {
            const files = await readdir(streamDir);
            for (const file of files) {
              await unlink(path.join(streamDir, file));
            }
            await import('fs/promises').then(fs => fs.rm(streamDir, { recursive: true }));
            console.log('🧹 Cleaned up stream directory');
          }
        } catch (err) {
          console.error('Failed to clean up:', err);
        }
      }, 5000);
    };

    res.on('close', () => {
      console.log('❌ Initial client disconnected');
      download.activeStreams.delete(passThrough);
      passThrough.end();

      // Don't kill download, let it complete for caching
      if (download.activeStreams.size === 0) {
        console.log('ℹ️ No more clients, but continuing download for cache');
      }
    });

    res.on('error', (error) => {
      console.error('❌ Response error in downloadAndStream:', error);
    });

    // Setup file watcher with streaming support
    let fileDetected = false;
    download.watcher = watch(streamDir, { persistent: false }, async (eventType, filename) => {
      if (!filename || fileDetected) return;

      console.log(`👁️ File watcher event: ${eventType} - ${filename}`);

      if (filename === streamDirName) {
        console.log('⏭️ Skipping directory event');
        return;
      }

      const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg'];
      const isAudioFile = audioExtensions.some(ext =>
        filename.endsWith(ext) || filename.endsWith(ext + '.incomplete')
      );

      if (!isAudioFile) {
        console.log('⏭️ Skipping non-audio file:', filename);
        return;
      }

      if (!filename.endsWith('.incomplete')) {
        console.log('⏭️ Skipping final file (already processed incomplete):', filename);
        return;
      }

      fileDetected = true;
      console.log('🔒 File detection locked');

      const filePath = path.join(streamDir, filename);

      // Wait for file to be ready
      let attempts = 0;
      const maxAttempts = 100;
      let fileReady = false;

      while (attempts < maxAttempts && !fileReady) {
        await new Promise(resolve => setTimeout(resolve, 300));

        if (!existsSync(filePath)) {
          attempts++;
          continue;
        }

        try {
          const stats = await import('fs/promises').then(fs => fs.stat(filePath));
          if (stats.size >= 65536) {
            fileReady = true;
            download.fileSize = stats.size;
            console.log(`✅ File ready with ${stats.size} bytes after ${attempts * 300}ms`);
          } else {
            attempts++;
          }
        } catch (error) {
          attempts++;
        }
      }

      if (!fileReady) {
        console.log('❌ File never became ready with sufficient data');
        fileDetected = false;
        return;
      }

      fileDetected = true;

      const ext = path.extname(filename).replace('.incomplete', '').toLowerCase();
      download.filePath = filePath;
      download.actualQuality = ext === '.flac' ? 'flac' : requestedQuality as string;
      download.status = 'ready';
      download.progress = 50;
      this.streamCache.set(cacheKey, filePath);

      console.log('📁 FILE DETECTED via watcher:', filePath);
      console.log('📊 Actual quality:', download.actualQuality, '(requested:', requestedQuality, ')');

      if (headersSent) {
        console.log('⚠️ Headers already sent, skipping');
        return;
      }

      headersSent = true;

      const mimeType = this.getMimeType(ext);

      console.log('✅ Starting progressive stream');

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Quality': download.actualQuality,
      });

      console.log('✅ Headers sent');
      passThrough.pipe(res);

      passThrough.on('error', (error) => {
        console.error('❌ PassThrough error:', error);
      });

      console.log('🎬 Starting progressive tailing from position 0');
      this.startProgressiveTailing(filePath, download, 0);
    });

    console.log('👁️ File watcher started for:', streamDir);

    // Perform download
    await this.performDownload(song, download, streamDir, requestedQuality);

    if (download.status === 'failed' && !headersSent) {
      res.status(404).json({
        error: download.error || 'Download failed',
        requestedQuality,
      });
      await cleanup();
    }
  }

  private async performDownload(
    song: Song,
    download: ActiveDownload,
    streamDir: string,
    requestedQuality: QualityPreferenceOrUnrestricted
  ): Promise<void> {
    const input = formatSldlInputStr(song);
    console.log('Input:', input);

    const configPath = process.env.SLDL_CONFIG_PATH || '~/.config/sldl/sldl.conf';
    const args = [
      input,
      '-p', streamDir,
      '-c', configPath,
      '--no-progress',
    ];

    // Only add quality filters if not unrestricted
    if (requestedQuality !== 'unrestricted') {
      if (requestedQuality === 'flac') {
        args.push('--format', 'flac');
        args.push('--pref-min-bitrate', '500');
      } else {
        const qualityNum = parseInt(requestedQuality as string);
        if (!isNaN(qualityNum)) {
          args.push('--pref-min-bitrate', (qualityNum - 20).toString());
          args.push('--pref-max-bitrate', (qualityNum + 20).toString());
        }
      }
    }

    const sldlPath = process.env.SLDL_PATH || 'sldl';

    console.log('🚀 Spawning SLDL process');
    console.log('📋 SLDL command:', sldlPath, args.join(' '));

    download.status = 'downloading';

    setImmediate(async () => {
      const { spawn } = await import('child_process');
      const sldl = spawn(sldlPath, args);
      download.process = sldl;

      let notFound = false;

      console.log('🎯 SLDL process started with PID:', sldl.pid);

      sldl.stdout.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        console.log('SLDL stdout:', output);

        // Parse progress
        const progressMatch = output.match(/(\d+)%/);
        if (progressMatch) {
          download.progress = Math.min(90, parseInt(progressMatch[1]));
        }

        if (output.toLowerCase().includes('not found')) {
          console.log('⚠️ Track not found on sldl');
          notFound = true;
        }
      });

      sldl.stderr.on('data', (data: Buffer) => {
        const errorOutput = data.toString().trim();
        console.error('SLDL stderr:', errorOutput);
      });

      sldl.on('error', async (error) => {
        console.error('❌ SLDL process error:', error);
        download.status = 'failed';
        download.error = error.message;
        download.isComplete = true;
      });

      sldl.on('close', async (code) => {
        console.log('SLDL process closed with code:', code);
        download.isComplete = true;

        await new Promise(resolve => setTimeout(resolve, 500));

        const isSuccess = code === 0 && download.filePath && !notFound;

        if (isSuccess) {
          if (download.filePath.endsWith('.incomplete')) {
            const withoutIncomplete = download.filePath.replace('.incomplete', '');
            if (existsSync(withoutIncomplete)) {
              console.log('📝 File completed, updating path:', withoutIncomplete);
              download.filePath = withoutIncomplete;
              const cacheKey = this.getCacheKey(song.id, requestedQuality);
              this.streamCache.set(cacheKey, withoutIncomplete);
            }
          }

          download.progress = 100;
          await this.handleSuccessfulDownload(song, download);
        } else {
          console.error('❌ SLDL failed - code:', code, 'notFound:', notFound, 'hasFile:', !!download.filePath);

          download.status = 'failed';

          // Mark quality as unavailable
          if (notFound) {
            if (requestedQuality === 'flac') {
              song.hasFlac = false;
              await this.songRepository.save(song);
              console.log('❌ Marked FLAC as unavailable');
            } else if (requestedQuality !== 'unrestricted') {
              if (!song.standardQuality || this.compareQuality(requestedQuality as QualityPreference, song.standardQuality) < 0) {
                song.standardQuality = requestedQuality as QualityPreference;
                await this.songRepository.save(song);
                console.log(`❌ Marked ${requestedQuality} as unavailable`);
              }
            } else {
              song.standardQuality = '128';
              await this.songRepository.save(song);
              console.log('❌ Marked track as completely unavailable');
            }
          }

          download.error = notFound
            ? `The ${requestedQuality} quality is not available for this track`
            : 'Download service error';

          if (download.filePath && existsSync(download.filePath)) {
            unlink(download.filePath).catch(err =>
              console.error('Failed to clean up failed file:', err)
            );
          }
        }
      });
    });
  }

  private determineQuality(filePath: string, fileSize: number): string {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.flac') {
      return 'flac';
    }

    if (fileSize > 10 * 1024 * 1024) {
      return '320';
    } else if (fileSize > 7 * 1024 * 1024) {
      return 'v0';
    } else if (fileSize > 5 * 1024 * 1024) {
      return '256';
    } else if (fileSize > 3 * 1024 * 1024) {
      return '192';
    } else {
      return '128';
    }
  }

  private startProgressiveTailing(
    initialFilePath: string,
    download: ActiveDownload,
    startPosition: number
  ): void {
    let lastPosition = startPosition;
    let currentFilePath = initialFilePath;
    let isReading = false;
    let totalBytesBroadcast = 0;

    console.log('🎬 Starting progressive tailing from position:', startPosition);

    const tailInterval = setInterval(async () => {
      if (isReading) return;

      if (download.activeStreams.size === 0) {
        console.log('⚠️ No active streams, stopping tailing');
        clearInterval(tailInterval);
        return;
      }

      try {
        isReading = true;

        if (currentFilePath.endsWith('.incomplete')) {
          const withoutIncomplete = currentFilePath.replace('.incomplete', '');
          if (existsSync(withoutIncomplete) && !existsSync(currentFilePath)) {
            console.log('📝 File renamed from .incomplete:', withoutIncomplete);
            currentFilePath = withoutIncomplete;
            download.filePath = currentFilePath;

            const cacheEntry = Array.from(this.activeDownloads.entries())
            .find(([_, d]) => d === download);
            if (cacheEntry) {
              this.streamCache.set(cacheEntry[0], currentFilePath);
            }
          }
        }

        if (!existsSync(currentFilePath)) {
          console.log('⚠️ File no longer exists');
          isReading = false;
          return;
        }

        const stats = await import('fs/promises').then(fs => fs.stat(currentFilePath));
        const currentSize = stats.size;

        if (currentSize > lastPosition) {
          const bytesToRead = currentSize - lastPosition;
          console.log('📖 Reading new data:', bytesToRead, 'bytes from position', lastPosition);

          const chunk = await this.readFileChunk(currentFilePath, lastPosition, currentSize - 1);
          totalBytesBroadcast += chunk.length;

          console.log('📡 Broadcasting', chunk.length, 'bytes to', download.activeStreams.size, 'clients');

          let successfulWrites = 0;
          download.activeStreams.forEach((passThrough) => {
            if (!passThrough.destroyed) {
              const written = passThrough.write(chunk);
              if (written) {
                successfulWrites++;
              }
            }
          });

          console.log('✅ Successfully wrote to', successfulWrites, '/', download.activeStreams.size, 'clients');

          lastPosition = currentSize;
        }

        if (download.isComplete && currentSize === lastPosition) {
          clearInterval(tailInterval);
          console.log('✅ Progressive streaming completed');
          console.log('📊 Total bytes broadcast:', totalBytesBroadcast);
          download.activeStreams.forEach(stream => {
            if (!stream.destroyed) {
              stream.end();
            }
          });
        }

        isReading = false;
      } catch (error) {
        console.error('❌ Error in tailing loop:', error);
        isReading = false;
        if (download.isComplete) {
          clearInterval(tailInterval);
          download.activeStreams.forEach(stream => stream.end());
        }
      }
    }, 150);
  }

  private async readFileChunk(
    filePath: string,
    start: number,
    end: number
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(filePath, { start, end });

      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (error) => reject(error));
    });
  }

  private async handleSuccessfulDownload(
    song: Song,
    download: ActiveDownload
  ): Promise<void> {
    try {
      let finalTempPath = download.filePath;

      if (!finalTempPath) {
        console.error('❌ No file path in download object');
        return;
      }

      if (finalTempPath.endsWith('.incomplete')) {
        const withoutIncomplete = finalTempPath.replace('.incomplete', '');
        if (existsSync(withoutIncomplete)) {
          finalTempPath = withoutIncomplete;
        }
      }

      if (!existsSync(finalTempPath)) {
        console.error('❌ Downloaded file not found:', finalTempPath);
        return;
      }

      console.log('⏳ Waiting briefly for streams to complete...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const stats = await import('fs/promises').then(fs => fs.stat(finalTempPath!));
      const ext = path.extname(finalTempPath).toLowerCase();
      const quality = this.determineQuality(finalTempPath, stats.size);

      console.log(`📊 Download quality determined: ${quality}`);

      const timestamp = Date.now();
      const permanentFileName = `${song.id}-${quality}-${timestamp}${ext}`;
      const permanentPath = path.join(this.downloadsDir, permanentFileName);

      await import('fs/promises').then(fs => fs.copyFile(finalTempPath!, permanentPath));
      console.log('✅ Copied to permanent storage:', permanentPath);

      if (quality === 'flac') {
        song.flacPath = permanentPath;
        song.hasFlac = true;
      } else {
        song.standardPath = permanentPath;
        song.standardQuality = quality;
      }

      song.metadata = {
        ...song.metadata,
        fileSize: stats.size,
        format: ext.substring(1),
        quality,
        downloadedAt: new Date().toISOString(),
      };

      await this.songRepository.save(song);
      console.log('✅ Song entity updated');

      const cacheKey = this.getCacheKey(song.id, download.requestedQuality);
      this.streamCache.set(cacheKey, permanentPath);

      setTimeout(async () => {
        try {
          if (existsSync(finalTempPath!)) {
            await unlink(finalTempPath!);
            console.log('🧹 Cleaned up temp file:', finalTempPath);
          }
          if (existsSync(download.streamDir)) {
            await rmdir(download.streamDir, { recursive: true });
            console.log('🧹 Cleaned up stream directory:', download.streamDir);
          }
        } catch (error) {
          console.error('Failed to clean up:', error);
        }
      }, 5000);

    } catch (error) {
      console.error('❌ Error handling download:', error);
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
    };
    return mimeTypes[ext] || 'audio/mpeg';
  }

  async clearTempCache(): Promise<void> {
    console.log('🧹 Clearing temporary cache');
    this.streamCache.clear();

    try {
      const dirs = await readdir(this.tempDir);
      for (const dir of dirs) {
        const dirPath = path.join(this.tempDir, dir);
        await rmdir(dirPath, { recursive: true });
      }
      console.log('✅ Temp cache cleared');
    } catch (error) {
      console.error('❌ Error clearing temp cache:', error);
    }
  }
}