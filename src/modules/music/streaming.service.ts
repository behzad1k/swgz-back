import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { createReadStream, existsSync, watch, FSWatcher } from 'fs';
import { unlink, mkdir, readdir, rm } from 'fs/promises';
import path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityPreference } from '../../types';
import { formatSldlInputStr } from '../../utils/formatter';
import { Song } from './entities/song.entity';
import { SongQuality } from './entities/song-quality.entity';
import { PassThrough } from 'stream';

interface ActiveDownload {
  process: ChildProcess;
  activeStreams: Set<PassThrough>;
  filePath: string | null;
  isComplete: boolean;
  requestedQuality: QualityPreference;
  actualQuality: string | null; // What was actually downloaded
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
  private downloadLocks = new Map<string, Promise<void>>(); // Prevent concurrent downloads
  private tempDir: string;
  private downloadsDir: string;

  // Quality priority hierarchy - based on slsk-batchdl's format preferences
  private readonly QUALITY_HIERARCHY = {
    'flac': ['flac'],
    '320': ['320', 'v0', '256', '192', '128'], // 320kbps priority with fallbacks
    'v0': ['v0', '320', '256', '192', '128'],
    '256': ['256', '320', 'v0', '192', '128'],
    '192': ['192', '256', '320', 'v0', '128'],
    '128': ['128', '192', '256', '320', 'v0'],
    'standard': ['320', 'v0', '256', '192', '128'], // same as 320
  };

  constructor(
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
    @InjectRepository(SongQuality)
    private songQualityRepository: Repository<SongQuality>,
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

  /**
   * Find best available quality with fallback logic
   */
  private async findBestAvailableQualityWithFallback(
    song: Song,
    requestedQuality: QualityPreference
  ): Promise<QualityFallbackResult | null> {
    // Build priority list based on requested quality
    const priorityList = this.QUALITY_HIERARCHY[requestedQuality] || ['320', 'v0', '256', '192'];

    // Check if requested quality is FLAC
    if (requestedQuality === 'flac') {
      if (song.flacPath && existsSync(song.flacPath)) {
        return { quality: 'flac', path: song.flacPath, wasRequested: true };
      }

      // Check SongQuality table for FLAC
      const flacQuality = await this.songQualityRepository.findOne({
        where: { songId: song.id, quality: 'flac', unavailable: false }
      });
      if (flacQuality && existsSync(flacQuality.path)) {
        return { quality: 'flac', path: flacQuality.path, wasRequested: true };
      }

      // No fallback for FLAC - it's either available or not
      return null;
    }

    // For non-FLAC qualities, check in priority order
    for (const quality of priorityList) {
      const wasRequested = quality === requestedQuality;

      // Check standard path if it matches this quality
      if (song.standardPath && song.standardQuality === quality && existsSync(song.standardPath)) {
        return { quality, path: song.standardPath, wasRequested };
      }

      // Check SongQuality table
      const songQuality = await this.songQualityRepository.findOne({
        where: { songId: song.id, quality, unavailable: false }
      });

      if (songQuality && existsSync(songQuality.path)) {
        return { quality, path: songQuality.path, wasRequested };
      }
    }

    return null;
  }

  /**
   * Check if a quality is marked as unavailable for this song
   */
  private async isQualityUnavailable(songId: string, quality: string): Promise<boolean> {
    const songQuality = await this.songQualityRepository.findOne({
      where: { songId, quality, unavailable: true }
    });
    return !!songQuality;
  }

  /**
   * Mark a quality as unavailable for this song
   */
  private async markQualityUnavailable(songId: string, quality: string, extension: string = '.mp3'): Promise<void> {
    const existing = await this.songQualityRepository.findOne({
      where: { songId, quality }
    });

    if (existing) {
      existing.unavailable = true;
      await this.songQualityRepository.save(existing);
    } else {
      const songQuality = this.songQualityRepository.create({
        songId,
        quality,
        path: '', // Empty path since unavailable
        extension,
        unavailable: true,
      });
      await this.songQualityRepository.save(songQuality);
    }

    console.log(`❌ Marked quality ${quality} as unavailable for song ${songId}`);
  }

  async streamSong(
    songId: string,
    res: Response,
    preferFlac: boolean = false
  ): Promise<void> {
    const song = await this.songRepository.findOne({
      where: { id: songId },
      relations: ['qualities']
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    const requestedQuality: QualityPreference = preferFlac ? 'flac' : '320';

    // 1. Check if requested quality is marked unavailable
    const isUnavailable = await this.isQualityUnavailable(songId, requestedQuality);

    // 2. Find best available quality (with fallback)
    const qualityResult = await this.findBestAvailableQualityWithFallback(song, requestedQuality);

    if (isUnavailable && qualityResult) {
      if (!qualityResult.wasRequested) {
        // Return error with fallback info
        console.log(`⚠️ Requested quality ${requestedQuality} not available, using fallback: ${qualityResult.quality}`);

        // Set custom header to inform client about fallback
        res.setHeader('X-Quality-Fallback', qualityResult.quality);
        res.setHeader('X-Requested-Quality', requestedQuality);
      }

      console.log(`📂 Streaming from downloaded file (${qualityResult.quality}):`, qualityResult.path);
      return this.streamFromFile(qualityResult.path, res);
    }

    // 3. If requested quality is unavailable, try fallback before downloading
    if (isUnavailable) {
      console.log(`⚠️ Requested quality ${requestedQuality} is marked unavailable, trying fallback`);
      const fallbackQualities = this.QUALITY_HIERARCHY[requestedQuality]?.slice(1) || [];

      for (const fallbackQuality of fallbackQualities) {
        const fallbackResult = await this.findBestAvailableQualityWithFallback(song, fallbackQuality as QualityPreference);
        if (fallbackResult) {
          res.setHeader('X-Quality-Fallback', fallbackResult.quality);
          res.setHeader('X-Requested-Quality', requestedQuality);
          console.log(`📂 Using fallback quality ${fallbackResult.quality}`);
          return this.streamFromFile(fallbackResult.path, res);
        }
      }
    }

    // 4. Check cache
    const cacheKey = this.getCacheKey(songId, requestedQuality);
    const cachedPath = this.streamCache.get(cacheKey);
    if (cachedPath && existsSync(cachedPath)) {
      console.log('💾 Streaming from cached temp file:', cachedPath);
      return this.streamFromFile(cachedPath, res);
    }

    // 5. Check if currently downloading
    const existingDownload = this.activeDownloads.get(cacheKey);
    if (existingDownload) {
      if (existingDownload.filePath) {
      console.log('♻️ Joining existing download');
      return this.joinExistingDownload(existingDownload, res);
      } else {
        console.log('⏳ Download in progress, waiting...');
        // Wait for download to start producing a file
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (existingDownload.filePath) {
          return this.joinExistingDownload(existingDownload, res);
        }
      }
    }

    // 6. Check temp directory
    const existingTempFile = await this.findSongInTempDir(songId, requestedQuality);
    if (existingTempFile) {
      console.log('🔍 Found existing temp file:', existingTempFile);
      this.streamCache.set(cacheKey, existingTempFile);
      return this.streamFromFile(existingTempFile, res);
    }

    // 6. Start new download with lock - CRITICAL FIX
    const lockKey = `${songId}-${requestedQuality}`;

    if (this.downloadLocks.has(lockKey)) {
      console.log('🔒 Download already starting, waiting for lock...');
      await this.downloadLocks.get(lockKey);

      // After lock released, check if file is now available
      const qualityResultAfterLock = await this.findBestAvailableQualityWithFallback(song, requestedQuality);
      if (qualityResultAfterLock) {
        return this.streamFromFile(qualityResultAfterLock.path, res);
      }
    }

    // Create lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    this.downloadLocks.set(lockKey, lockPromise);

    try {
    console.log(`⬇️ Starting new download: ${song.title} - ${song.artistName} (${requestedQuality})`);
      await this.downloadAndStream(song, res, requestedQuality);
    } finally {
      // Release lock
      releaseLock!();
      this.downloadLocks.delete(lockKey);
    }
  }

  private async findSongInTempDir(
    songId: string,
    quality: QualityPreference
  ): Promise<string | null> {
    try {
      const files = await readdir(this.tempDir);
      const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg'];

      const matchingFiles = files.filter(file => {
        const startsWithSongId = file.startsWith(`${songId}-${quality}-`);
        const hasAudioExt = audioExtensions.some(ext =>
          file.endsWith(ext) || file.endsWith(ext + '.incomplete')
        );
        return startsWithSongId && hasAudioExt;
      });

      if (matchingFiles.length > 0) {
        const completeFile = matchingFiles.find(f => !f.endsWith('.incomplete'));
        const fileToUse = completeFile || matchingFiles[0];
        return path.join(this.tempDir, fileToUse);
      }

      return null;
    } catch (error) {
      return null;
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
    const format = this.buildFormatPreference(requestedQuality);
    const input = formatSldlInputStr(song);
    console.log('Input:', input);
    console.log('Format preference:', format);

    const tempFilePrefix = `${song.id}-${requestedQuality}-${Date.now()}`;
    const cacheKey = this.getCacheKey(song.id, requestedQuality);

    const passThrough = new PassThrough();

    const download: ActiveDownload = {
      process: null as any,
      activeStreams: new Set([passThrough]),
      filePath: null,
      isComplete: false,
      requestedQuality: requestedQuality,
      actualQuality: null,
    };

    this.activeDownloads.set(cacheKey, download);

    let headersSent = false;
    let streamingStarted = false;
    let downloadFailed = false;

    const cleanup = () => {
      this.activeDownloads.delete(cacheKey);
    };

    res.on('close', () => {
      console.log('❌ Initial client disconnected');
      download.activeStreams.delete(passThrough);
      passThrough.end();

      if (download.activeStreams.size === 0 && !download.isComplete) {
        console.log('🛑 No more clients, aborting download');
        cleanup();
        if (download.process && !download.process.killed) {
          download.process.kill('SIGTERM');
        }

        if (download.filePath && existsSync(download.filePath)) {
          unlink(download.filePath).catch(err =>
            console.error('Failed to clean up incomplete file:', err)
          );
        }
      }
    });

    res.on('error', (error) => {
      console.error('❌ Response error in downloadAndStream:', error);
    });

    const findFileAndStartStreaming = async () => {
      if (streamingStarted) return;

      try {
        const files = await readdir(this.tempDir);
        const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg'];
        const audioFile = files.find(file =>
          file.startsWith(tempFilePrefix) &&
          audioExtensions.some(ext => file.endsWith(ext) || file.endsWith(ext + '.incomplete'))
        );

        if (!audioFile) {
          console.log('⏳ File not found yet, will retry...');
          return;
        }

        const filePath = path.join(this.tempDir, audioFile);
        download.filePath = filePath;
        this.streamCache.set(cacheKey, filePath);

        // CRITICAL FIX: Detect actual quality from filename
        const ext = path.extname(audioFile).replace('.incomplete', '').toLowerCase();
        download.actualQuality = ext === '.flac' ? 'flac' : requestedQuality;

        console.log('📁 FILE DETECTED:', filePath);
        console.log('📊 Actual quality:', download.actualQuality, '(requested:', requestedQuality, ')');

        const stats = await import('fs/promises').then(fs => fs.stat(filePath));
        const currentSize = stats.size;

        if (!streamingStarted && currentSize >= 0) {
          streamingStarted = true;
          headersSent = true;

          const ext = path.extname(filePath).replace('.incomplete', '').toLowerCase();
          const mimeType = this.getMimeType(ext);

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
        }
      } catch (error) {
        console.error('❌ Error finding file:', error);
      }
    };

    console.log('🚀 Spawning SLDL process...');

    const configPath = process.env.SLDL_CONFIG_PATH || '~/.config/sldl/sldl.conf';
    const args = [
      input,
      '-p', this.tempDir,
      '--pref-format', format,
     '--format', format, // CRITICAL: Add --format to enforce strict matching
      '-c', configPath,
      '--no-progress',
      '--name-format', tempFilePrefix,
    ];

    const sldl = spawn(process.env.SLDL_PATH || 'sldl', args);
    download.process = sldl;

    sldl.stdout.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      console.log('SLDL stdout:', output);

     if (output.includes('InProgress:') && !streamingStarted) {
       console.log('🎯 InProgress detected! Finding file and starting stream...');
       setTimeout(() => {
         findFileAndStartStreaming();
       }, 100);
     }

      // Detect if no results were found
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


    sldl.on('error', (error) => {
      console.error('❌ SLDL process error:', error);
      download.isComplete = true;
      cleanup();

      if (!headersSent) {
        res.status(500).json({ error: 'Failed to download song' });
      } else {
        download.activeStreams.forEach(stream => stream.end());
      }
    });

    sldl.on('close', async (code) => {
      console.log('SLDL process closed with code:', code);
      download.isComplete = true;
      cleanup();

      // CRITICAL FIX: Only mark as unavailable if actually failed
      if (code === 0 && download.filePath && !downloadFailed) {
        await this.handleSuccessfulDownload(song, download);
      } else {
        console.error('❌ SLDL failed with code:', code);

        // Only mark unavailable if it was a true "not found", not a connection error
        if (!downloadFailed || code === 1) {
        const ext = requestedQuality === 'flac' ? '.flac' : '.mp3';
        await this.markQualityUnavailable(song.id, requestedQuality, ext);
        }

        if (!headersSent) {
          // Try to provide fallback
          const fallbackResult = await this.findBestAvailableQualityWithFallback(
            song,
            requestedQuality
          );

          if (fallbackResult && !fallbackResult.wasRequested) {
            console.log(`📂 Providing fallback quality: ${fallbackResult.quality}`);
            res.setHeader('X-Quality-Fallback', fallbackResult.quality);
            res.setHeader('X-Requested-Quality', requestedQuality);
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
    });
  }

  /**
   * Build format preference string for sldl
   * Based on: https://github.com/fiso64/slsk-batchdl#file-conditions
   */
  private buildFormatPreference(quality: QualityPreference): string {
    switch (quality) {
      case 'flac':
        return 'flac';
      case '320':
        return '320'; // Only 320, no fallback in sldl command
      case 'v0':
        return 'v0';
      case '256':
        return '256';
      case '192':
        return '192';
      case '128':
        return '128';
      case 'standard':
        return '320'; // Default to 320 for "standard"
      case 'any':
        return 'mp3';
      default:
        return '320';
    }
  }

  private determineQuality(filePath: string, fileSize: number): string {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.flac') {
      return 'flac';
    }

    // Heuristics for MP3 quality (3-4 minute average song)
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

      // Update song entity
      if (quality === 'flac') {
        song.flacPath = permanentPath;
        song.hasFlac = true;
      } else {
        // Prioritize 320kbps for standardPath
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

      // Create or update SongQuality entry
      const existingQuality = await this.songQualityRepository.findOne({
        where: { songId: song.id, quality }
      });

      if (existingQuality) {
        existingQuality.path = permanentPath;
        existingQuality.extension = ext;
        existingQuality.unavailable = false; // Mark as available now
        await this.songQualityRepository.save(existingQuality);
        console.log('✅ Updated existing SongQuality entry');
      } else {
        const songQuality = this.songQualityRepository.create({
          songId: song.id,
          quality,
          path: permanentPath,
          extension: ext,
          unavailable: false,
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
        } catch (error) {
          console.error('Failed to clean up temp file:', error);
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
      const files = await readdir(this.tempDir);
      for (const file of files) {
        await unlink(path.join(this.tempDir, file));
      }
      console.log('✅ Temp cache cleared');
    } catch (error) {
      console.error('❌ Error clearing temp cache:', error);
    }
  }
}