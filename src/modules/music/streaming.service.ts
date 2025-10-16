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
import { CronService } from '../cronjob/cronjob.service';
import { Song } from './entities/song.entity';
import { SongQuality } from './entities/song-quality.entity';
import { PassThrough } from 'stream';

interface ActiveDownload {
  process: ChildProcess | null;
  activeStreams: Set<PassThrough>;
  filePath: string | null;
  isComplete: boolean;
  requestedQuality: QualityPreference;
  actualQuality: string | null;
  streamDir: string;
  watcher: FSWatcher | null;
  jobName: string;
}

interface QualityFallbackResult {
  quality: string;
  path: string;
  wasRequested: boolean;
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

  constructor(
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
    @InjectRepository(SongQuality)
    private songQualityRepository: Repository<SongQuality>,
    private cronService: CronService,
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

  private getCacheKey(songId: string, quality: QualityPreference): string {
    return `${songId}-${quality}`;
  }

  private async findBestAvailableQualityWithFallback(
    song: Song,
    requestedQuality: QualityPreference
  ): Promise<QualityFallbackResult | null> {
    const priorityList = this.QUALITY_HIERARCHY[requestedQuality] || ['320', 'v0', '256', '192'];

    if (requestedQuality === 'flac') {
      if (song.flacPath && existsSync(song.flacPath)) {
        return { quality: 'flac', path: song.flacPath, wasRequested: true };
      }

      const flacQuality = await this.songQualityRepository.findOne({
        where: { songId: song.id, quality: 'flac', unavailable: false }
      });
      if (flacQuality && existsSync(flacQuality.path)) {
        return { quality: 'flac', path: flacQuality.path, wasRequested: true };
      }

      return null;
    }

    for (const quality of priorityList) {
      const wasRequested = quality === requestedQuality;

      if (song.standardPath && song.standardQuality === quality && existsSync(song.standardPath)) {
        return { quality, path: song.standardPath, wasRequested };
      }

      const songQuality = await this.songQualityRepository.findOne({
        where: { songId: song.id, quality, unavailable: false }
      });

      if (songQuality && existsSync(songQuality.path)) {
        return { quality, path: songQuality.path, wasRequested };
      }
    }

    return null;
  }

  private async isQualityUnavailable(songId: string, quality: string): Promise<boolean> {
    const songQuality = await this.songQualityRepository.findOne({
      where: { songId, quality, unavailable: true }
    });
    return !!songQuality;
  }

  private async markQualityUnavailable(songId: string, quality: string, extension: string = '.mp3'): Promise<void> {
    const existing = await this.songQualityRepository.findOne({
      where: { songId, quality }
    });

    if (existing) {
      existing.unavailable = true;
      await this.songQualityRepository.update({ id: songId, quality }, { unavailable: true });
    } else {
      const songQuality = this.songQualityRepository.create({
        songId,
        quality,
        path: null,
        extension,
        unavailable: true,
        size: 0
      });
      await this.songQualityRepository.save(songQuality);
    }

    console.log(`❌ Marked quality ${quality} as unavailable for song ${songId}`);
  }

  async streamSong(
    songId: string,
    res: Response,
    quality: QualityPreference = '320'
  ): Promise<void> {
    const song = await this.songRepository.findOne({
      where: { id: songId },
      relations: ['qualities']
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    const isUnavailable = await this.isQualityUnavailable(songId, quality);
    const qualityResult = await this.findBestAvailableQualityWithFallback(song, quality);

    if (isUnavailable && qualityResult) {
      if (!qualityResult.wasRequested) {
        console.log(`⚠️ Requested quality ${quality} not available, using fallback: ${qualityResult.quality}`);
        res.setHeader('X-Quality-Fallback', qualityResult.quality);
        res.setHeader('X-Requested-Quality', quality);
      }

      console.log(`📂 Streaming from downloaded file (${qualityResult.quality}):`, qualityResult.path);
      return this.streamFromFile(qualityResult.path, res);
    }

    if (isUnavailable) {
      console.log(`⚠️ Requested quality ${quality} is marked unavailable, trying fallback`);
      const fallbackQualities = this.QUALITY_HIERARCHY[quality]?.slice(1) || [];

      for (const fallbackQuality of fallbackQualities) {
        const fallbackResult = await this.findBestAvailableQualityWithFallback(song, fallbackQuality as QualityPreference);
        if (fallbackResult) {
          res.setHeader('X-Quality-Fallback', fallbackResult.quality);
          res.setHeader('X-Requested-Quality', quality);
          console.log(`📂 Using fallback quality ${fallbackResult.quality}`);
          return this.streamFromFile(fallbackResult.path, res);
        }
      }
    }

    const cacheKey = this.getCacheKey(songId, quality);
    const cachedPath = this.streamCache.get(cacheKey);
    if (cachedPath && existsSync(cachedPath)) {
      console.log('💾 Streaming from cached temp file:', cachedPath);
      return this.streamFromFile(cachedPath, res);
    }

    const existingDownload = this.activeDownloads.get(cacheKey);
    if (existingDownload) {
      if (existingDownload.filePath) {
        console.log('♻️ Joining existing download');
        return this.joinExistingDownload(existingDownload, res);
      } else {
        console.log('⏳ Download in progress, waiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (existingDownload.filePath) {
          return this.joinExistingDownload(existingDownload, res);
        }
      }
    }

    const lockKey = `${songId}-${quality}`;

    if (this.downloadLocks.has(lockKey)) {
      console.log('🔒 Download already starting, waiting for lock...');
      await this.downloadLocks.get(lockKey);

      const qualityResultAfterLock = await this.findBestAvailableQualityWithFallback(song, quality);
      if (qualityResultAfterLock) {
        return this.streamFromFile(qualityResultAfterLock.path, res);
      }
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    this.downloadLocks.set(lockKey, lockPromise);

    try {
      console.log(`⬇️ Starting new download: ${song.title} - ${song.artistName} (${quality})`);
      await this.downloadAndStream(song, res, quality);
    } finally {
      releaseLock!();
      this.downloadLocks.delete(lockKey);
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

  private async joinExistingDownload(
    download: ActiveDownload,
    res: Response
  ): Promise<void> {
    console.log('🔄 Client joining existing download');
    console.log('📊 Active streams before join:', download.activeStreams.size);

    const passThrough = new PassThrough();
    download.activeStreams.add(passThrough);

    console.log('📊 Active streams after join:', download.activeStreams.size);

    res.on('close', () => {
      console.log('❌ Client disconnected from joined download');
      download.activeStreams.delete(passThrough);
      passThrough.end();
      console.log('📊 Remaining active streams:', download.activeStreams.size);
    });

    res.on('error', (error) => {
      console.error('❌ Response error in joinExistingDownload:', error);
    });

    if (!download.filePath || !existsSync(download.filePath)) {
      console.error('❌ Download file not found:', download.filePath);
      res.status(404).json({ error: 'Download file not found' });
      return;
    }

    try {
      const stats = await import('fs/promises').then(fs => fs.stat(download.filePath));
      const currentSize = stats.size;
      const ext = path.extname(download.filePath).replace('.incomplete', '').toLowerCase();
      const mimeType = this.getMimeType(ext);

      console.log('📊 Joining download - file stats:', {
        filePath: download.filePath,
        currentSize,
        ext,
        mimeType
      });

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      console.log('✅ Headers sent for joined client');

      passThrough.pipe(res);

      passThrough.on('error', (error) => {
        console.error('❌ PassThrough error:', error);
      });

      console.log('📖 Reading catch-up data from 0 to', currentSize - 1);
      const currentStream = createReadStream(download.filePath, {
        start: 0,
        end: currentSize - 1
      });

      let bytesRead = 0;
      currentStream.on('data', (chunk) => {
        bytesRead += chunk.length;
      });

      currentStream.pipe(passThrough, { end: false });

      currentStream.on('end', () => {
        console.log('✅ Client caught up, read', bytesRead, 'bytes');
        console.log('🎧 Client now receiving live broadcast');
      });

      currentStream.on('error', (error) => {
        console.error('❌ Catch-up stream error:', error);
        passThrough.end();
      });

    } catch (error) {
      console.error('❌ Error joining download:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to join download' });
      }
    }
  }

  private async downloadAndStream(
    song: Song,
    res: Response,
    requestedQuality: QualityPreference
  ): Promise<void> {
    const input = formatSldlInputStr(song);
    console.log('Input:', input);

    const timestamp = Date.now();
    const streamDirName = `${song.id}-${requestedQuality}-${timestamp}`;
    const streamDir = path.join(this.tempDir, streamDirName);
    const cacheKey = this.getCacheKey(song.id, requestedQuality);

    // Create dedicated directory for this stream
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
    };

    this.activeDownloads.set(cacheKey, download);

    let headersSent = false;
    let streamingStarted = false;
    let downloadFailed = false;
    let fileDetected = false; // Track if we've already detected a file

    const cleanup = async () => {
      // Stop file watcher
      if (download.watcher) {
        download.watcher.close();
        download.watcher = null;
        console.log('🛑 File watcher closed');
      }

      this.activeDownloads.delete(cacheKey);
    };

    res.on('close', () => {
      console.log('❌ Initial client disconnected');
      download.activeStreams.delete(passThrough);
      passThrough.end();

      if (download.activeStreams.size === 0 && !download.isComplete) {
        console.log('🛑 No more clients, aborting download');

        // Kill the SLDL process if it's still running
        if (download.process && !download.process.killed) {
          download.process.kill('SIGTERM');
          console.log('🛑 Killed SLDL process');
        }

        cleanup();

        // Clean up incomplete files and directory
        setTimeout(async () => {
          try {
            const files = await readdir(streamDir);
            for (const file of files) {
              await unlink(path.join(streamDir, file));
            }
            await import('fs/promises').then(fs => fs.rm(streamDir, { recursive: true }));
            console.log('🧹 Cleaned up stream directory after abort');
          } catch (err) {
            console.error('Failed to clean up stream directory:', err);
          }
        }, 1000);
      }
    });

    res.on('error', (error) => {
      console.error('❌ Response error in downloadAndStream:', error);
    });

    // Set up file watcher for the stream directory
    download.watcher = watch(streamDir, { persistent: false }, async (eventType, filename) => {
      // Ignore if we've already detected and started streaming a file
      if (!filename || fileDetected) return;

      console.log(`👁️ File watcher event: ${eventType} - ${filename}`);

      // Ignore directory itself
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

      // Only process .incomplete files on first detection
      if (!filename.endsWith('.incomplete')) {
        console.log('⏭️ Skipping final file (already processed incomplete):', filename);
        return;
      }

      // **CRITICAL FIX: Set fileDetected IMMEDIATELY before any async operations**
      fileDetected = true;
      console.log('🔒 File detection locked');

      const filePath = path.join(streamDir, filename);

      // Wait for file to exist and have initial content
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds max wait
      let fileReady = false;

      while (attempts < maxAttempts && !fileReady) {
        await new Promise(resolve => setTimeout(resolve, 100));

        if (!existsSync(filePath)) {
          attempts++;
          continue;
        }

        try {
          const stats = await import('fs/promises').then(fs => fs.stat(filePath));
          // Wait for at least 64KB of data before starting stream
          if (stats.size >= 65536) {
            fileReady = true;
            console.log(`✅ File ready with ${stats.size} bytes after ${attempts * 100}ms`);
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
        fileDetected = false; // Reset on failure
        return;
      }

      fileDetected = true;
      streamingStarted = true;

      download.filePath = filePath;
      this.streamCache.set(cacheKey, filePath);

      const ext = path.extname(filename).replace('.incomplete', '').toLowerCase();
      download.actualQuality = ext === '.flac' ? 'flac' : requestedQuality;

      console.log('📁 FILE DETECTED via watcher:', filePath);
      console.log('📊 Actual quality:', download.actualQuality, '(requested:', requestedQuality, ')');
      if (headersSent) {
        console.log('⚠️ Headers already sent, skipping');
        return;
      }

      headersSent = true;

      const mimeType = this.getMimeType(ext);
      const currentSize = (await import('fs/promises').then(fs => fs.stat(filePath))).size;

      console.log('✅ Starting progressive stream with', currentSize, 'bytes');

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
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

    // Execute SLDL directly
    const configPath = process.env.SLDL_CONFIG_PATH || '~/.config/sldl/sldl.conf';
    const args = [
      input,
      '-p', streamDir,
      '-c', configPath,
      '--no-progress',
    ];

    if (requestedQuality == 'flac') {
      args.push('--format', 'flac');
      args.push('--pref-min-bitrate', '500');
    } else {
      args.push('--pref-min-bitrate', (parseInt(requestedQuality) - 20).toString());
      args.push('--pref-max-bitrate', (parseInt(requestedQuality) + 20).toString());
    }

    const sldlPath = process.env.SLDL_PATH || 'sldl';

    console.log('🚀 Spawning SLDL process directly');
    console.log('📋 SLDL command:', sldlPath, args.join(' '));

    // Spawn SLDL directly using setImmediate to avoid blocking
    setImmediate(async () => {
      const { spawn } = await import('child_process');
      const sldl = spawn(sldlPath, args);
      download.process = sldl;

      console.log('🎯 SLDL process started with PID:', sldl.pid);

      sldl.stdout.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        console.log('SLDL stdout:', output);

        if (output.includes('NotFound') || output.includes('No results')) {
          console.log('⚠️ No results found for requested quality');
          downloadFailed = true;
        }
      });

      sldl.stderr.on('data', (data: Buffer) => {
        const errorOutput = data.toString().trim();
        console.error('SLDL stderr:', errorOutput);

        if (errorOutput.includes('ListenException') || errorOutput.includes('port may be in use')) {
          console.error('❌ Port conflict detected');
          downloadFailed = true;
        }
      });

      sldl.on('error', async (error) => {
        console.error('❌ SLDL process error:', error);
        download.isComplete = true;
        await cleanup();

        if (!headersSent) {
          res.status(500).json({ error: 'Failed to download song' });
        } else {
          download.activeStreams.forEach(stream => stream.end());
        }
      });

      sldl.on('close', async (code) => {
        console.log('SLDL process closed with code:', code);
        download.isComplete = true;

        // Give file watcher a moment to detect any final file changes
        await new Promise(resolve => setTimeout(resolve, 500));

        if (code === 0 && download.filePath && !downloadFailed) {
          // Update filePath to non-.incomplete version if it was renamed
          if (download.filePath.endsWith('.incomplete')) {
            const withoutIncomplete = download.filePath.replace('.incomplete', '');
            if (existsSync(withoutIncomplete)) {
              console.log('📝 File completed, updating path:', withoutIncomplete);
              download.filePath = withoutIncomplete;
              this.streamCache.set(cacheKey, withoutIncomplete);
            }
          }

          await this.handleSuccessfulDownload(song, download);
        } else {
          console.error('❌ SLDL failed with code:', code);

          if (!downloadFailed || code === 1) {
            const ext = requestedQuality === 'flac' ? '.flac' : '.mp3';
            await this.markQualityUnavailable(song.id, requestedQuality, ext);
          }

          if (!headersSent) {
            const fallbackResult = await this.findBestAvailableQualityWithFallback(
              song,
              requestedQuality
            );

            if (fallbackResult && !fallbackResult.wasRequested) {
              console.log(`📂 Providing fallback quality: ${fallbackResult.quality}`);
              res.setHeader('X-Quality-Fallback', fallbackResult.quality);
              res.setHeader('X-Requested-Quality', requestedQuality);
              await cleanup();
              return this.streamFromFile(fallbackResult.path, res);
            }

            res.status(404).json({
              error: 'Requested quality not found',
              requestedQuality,
              message: downloadFailed
                ? 'Download service error. Please try again.'
                : `The ${requestedQuality} quality is not available for this track`
            });
          } else {
            download.activeStreams.forEach(stream => stream.end());
          }

          if (download.filePath && existsSync(download.filePath)) {
            unlink(download.filePath).catch(err =>
              console.error('Failed to clean up failed file:', err)
            );
          }
        }

        // Clean up directory
        await cleanup();
        setTimeout(async () => {
          try {
            await import('fs/promises').then(fs => fs.rm(streamDir, { recursive: true }));
            console.log('🧹 Cleaned up stream directory:', streamDir);
          } catch (err) {
            console.error('Failed to remove stream directory:', err);
          }
        }, 5000);
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

        // Handle file rename from .incomplete to final name
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
          console.log('⚠️ File no longer exists, checking for renamed version');

          // Check if file was renamed
          if (currentFilePath.endsWith('.incomplete')) {
            const withoutIncomplete = currentFilePath.replace('.incomplete', '');
            if (existsSync(withoutIncomplete)) {
              console.log('✅ Found renamed file:', withoutIncomplete);
              currentFilePath = withoutIncomplete;
              download.filePath = currentFilePath;
              isReading = false;
              return;
            }
          }

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
        if (quality === '320' || !song.standardPath) {
          song.standardPath = permanentPath;
          song.standardQuality = quality;
        }
      }

      song.duration = await this.extractDuration(permanentPath);
      song.metadata = {
        ...song.metadata,
        fileSize: stats.size,
        format: ext.substring(1),
        quality,
        downloadedAt: new Date().toISOString(),
      };

      await this.songRepository.save(song);
      console.log('✅ Song entity updated');

      const existingQuality = await this.songQualityRepository.findOne({
        where: { songId: song.id, quality }
      });

      if (existingQuality) {
        existingQuality.path = permanentPath;
        existingQuality.extension = ext;
        existingQuality.unavailable = false;
        existingQuality.size = stats.size;
        await this.songQualityRepository.save(existingQuality);
        console.log('✅ Updated existing SongQuality entry');
      } else {
        const songQuality = this.songQualityRepository.create({
          songId: song.id,
          quality,
          path: permanentPath,
          extension: ext,
          unavailable: false,
          size: stats.size
        });
        await this.songQualityRepository.save(songQuality);
        console.log('✅ Created new SongQuality entry');
      }

      const cacheKey = this.getCacheKey(song.id, download.requestedQuality);
      this.streamCache.set(cacheKey, permanentPath);

      setTimeout(async () => {
        try {
          if (existsSync(finalTempPath!)) {
            await unlink(finalTempPath!);
            console.log('🧹 Cleaned up temp file:', finalTempPath);
          }
          // Clean up stream directory
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

  private async extractDuration(filePath: string): Promise<number | null> {
    // TODO: Implement using ffprobe
    return null;
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