import { Injectable, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ChildProcess } from 'child_process';
import { createReadStream, existsSync, watch, FSWatcher } from 'fs';
import { unlink, mkdir, readdir } from 'fs/promises';
import path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Song } from './entities/song.entity';
import { PassThrough } from 'stream';

interface ActiveDownload {
  process: ChildProcess | null;
  activeStreams: Set<PassThrough>;
  filePath: string | null;
  isComplete: boolean;
  streamDir: string;
  watcher: FSWatcher | null;
  jobName: string;
  status: 'searching' | 'downloading' | 'ready' | 'failed';
  error?: string;
  progress: number;
  quality?: string;
  duration?: number;
  fileSize?: number;
}

@Injectable()
export class YtdlpStreamingService {
  private streamCache = new Map<string, string>();
  private activeDownloads = new Map<string, ActiveDownload>();
  private tempDir: string;
  private downloadsDir: string;
  private preferAudioVersion: boolean;

  constructor(
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
  ) {
    this.tempDir = process.env.STREAM_TEMP_DIR || path.join(process.cwd(), 'temp', 'streams');
    this.downloadsDir = process.env.DOWNLOADS_DIR || path.join(process.cwd(), 'downloads');
    this.preferAudioVersion = process.env.PREFER_AUDIO_VERSION === 'true';
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

  private getCacheKey(songId: string): string {
    return songId;
  }

  /**
   * Get download status for a song
   */
  getDownloadStatus(songId: string): {
    status: string;
    progress: number;
    quality?: string;
    duration?: number;
    fileSize?: number;
    error?: string;
    message?: string;
  } {
    const cacheKey = this.getCacheKey(songId);
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
      quality: download.quality,
      duration: download.duration,
      fileSize: download.fileSize,
      error: download.error,
      message: this.getStatusMessage(download.status, download.progress),
    };
  }

  private getStatusMessage(status: string, progress: number): string {
    switch (status) {
      case 'searching':
        return 'Searching for track on YouTube...';
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
  async startBackgroundDownload(songId: string): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id: songId } });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // Check if already downloading
    const cacheKey = this.getCacheKey(songId);
    if (this.activeDownloads.has(cacheKey)) {
      console.log('⚠️ Download already in progress for song:', songId);
      return;
    }

    // Check if already cached
    if (song.standardPath && existsSync(song.standardPath)) {
      console.log('✅ Song already cached:', songId);
      return;
    }

    const timestamp = Date.now();
    const streamDirName = `${song.id}-${timestamp}`;
    const streamDir = path.join(this.tempDir, streamDirName);

    await mkdir(streamDir, { recursive: true });

    const download: ActiveDownload = {
      process: null,
      activeStreams: new Set(),
      filePath: null,
      isComplete: false,
      streamDir,
      watcher: null,
      jobName: `ytdlp-${streamDirName}`,
      status: 'searching',
      progress: 0,
    };

    this.activeDownloads.set(cacheKey, download);

    // Setup file watcher
    this.setupFileWatcher(download, streamDir, song);

    // Start download process
    this.performDownload(song, download, streamDir).catch(error => {
      console.error('Background download error:', error);
      download.status = 'failed';
      download.error = error.message;
    });
  }

  async streamSong(songId: string, res: Response): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id: songId } });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // This should not happen as music.service checks cache first
    // But just in case...
    if (song.standardPath && existsSync(song.standardPath)) {
      console.log(`📂 Playing cached file: ${song.standardPath}`);
      return this.streamFromFile(song.standardPath, res);
    }

    const cacheKey = this.getCacheKey(songId);
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
    await this.downloadAndStream(song, res);
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

    const ext = path.extname(download.filePath).replace('.part', '').toLowerCase();
    const mimeType = this.getMimeType(ext);

    try {
      const stats = await import('fs/promises').then(fs => fs.stat(download.filePath!));

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Quality': download.quality || 'standard',
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
      const ext = path.extname(filePath).toLowerCase();
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

  private setupFileWatcher(download: ActiveDownload, streamDir: string, song: Song): void {
    let fileDetected = false;

    download.watcher = watch(streamDir, { persistent: false }, async (eventType, filename) => {
      if (!filename || fileDetected) return;

      const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg', '.webm', '.aac', '.wav'];
      const isAudioFile = audioExtensions.some(ext =>
        filename.endsWith(ext) || filename.endsWith(ext + '.part')
      );

      if (!isAudioFile) return;

      fileDetected = true;
      console.log('🔒 File detection locked');

      const filePath = path.join(streamDir, filename);
      const isPartFile = filename.endsWith('.part');

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
          const threshold = isPartFile ? 32768 : 65536;

          if (stats.size >= threshold) {
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

      const ext = path.extname(filename).replace('.part', '').toLowerCase();
      download.filePath = filePath;
      download.status = 'ready';
      download.progress = 50;
      download.quality = this.determineQualityFromExtension(ext);

      const cacheKey = this.getCacheKey(song.id);
      this.streamCache.set(cacheKey, filePath);

      console.log('📁 FILE DETECTED:', filePath);
      console.log('📊 Quality:', download.quality);

      // Start progressive tailing for active streams
      if (download.activeStreams.size > 0) {
        this.startProgressiveTailing(filePath, download, 0);
      }
    });
  }

  private determineQualityFromExtension(ext: string): string {
    if (ext === '.flac') return 'flac';
    return '320'; // Assume 320 for MP3
  }

  private async downloadAndStream(song: Song, res: Response): Promise<void> {
    const timestamp = Date.now();
    const streamDirName = `${song.id}-${timestamp}`;
    const streamDir = path.join(this.tempDir, streamDirName);
    const cacheKey = this.getCacheKey(song.id);

    await mkdir(streamDir, { recursive: true });
    console.log('📁 Created stream directory:', streamDir);

    const passThrough = new PassThrough();

    const download: ActiveDownload = {
      process: null,
      activeStreams: new Set([passThrough]),
      filePath: null,
      isComplete: false,
      streamDir,
      watcher: null,
      jobName: `ytdlp-${streamDirName}`,
      status: 'searching',
      progress: 0,
    };

    this.activeDownloads.set(cacheKey, download);

    let headersSent = false;

    const cleanup = async (shouldDeleteFile: boolean = false) => {
      if (download.watcher) {
        download.watcher.close();
        download.watcher = null;
      }

      setTimeout(async () => {
        this.activeDownloads.delete(cacheKey);

        try {
          if (shouldDeleteFile && download.filePath && existsSync(download.filePath)) {
            await unlink(download.filePath);
          }

          if (existsSync(streamDir)) {
            const files = await readdir(streamDir);
            for (const file of files) {
              await unlink(path.join(streamDir, file));
            }
            await import('fs/promises').then(fs => fs.rm(streamDir, { recursive: true }));
          }
        } catch (err) {
          console.error('Failed to clean up:', err);
        }
      }, 5000);
    };

    res.on('close', () => {
      console.log('❌ Client disconnected');
      download.activeStreams.delete(passThrough);
      passThrough.end();

      // Don't kill download, let it complete for caching
      if (download.activeStreams.size === 0) {
        console.log('ℹ️ No more clients, but continuing download for cache');
      }
    });

    res.on('error', (error) => {
      console.error('❌ Response error:', error);
    });

    // Setup file watcher with streaming support
    let fileDetected = false;
    download.watcher = watch(streamDir, { persistent: false }, async (eventType, filename) => {
      if (!filename || fileDetected) return;

      const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg', '.webm', '.aac', '.wav'];
      const isAudioFile = audioExtensions.some(ext =>
        filename.endsWith(ext) || filename.endsWith(ext + '.part')
      );

      if (!isAudioFile) return;

      fileDetected = true;
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
          const threshold = filename.endsWith('.part') ? 32768 : 65536;

          if (stats.size >= threshold) {
            fileReady = true;
            download.fileSize = stats.size;
          } else {
            attempts++;
          }
        } catch (error) {
          attempts++;
        }
      }

      if (!fileReady) {
        fileDetected = false;
        return;
      }

      const ext = path.extname(filename).replace('.part', '').toLowerCase();
      download.filePath = filePath;
      download.status = 'ready';
      download.progress = 50;
      download.quality = this.determineQualityFromExtension(ext);
      this.streamCache.set(cacheKey, filePath);

      if (headersSent) return;

      headersSent = true;
      const mimeType = this.getMimeType(ext);

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Quality': download.quality,
      });

      passThrough.pipe(res);
      this.startProgressiveTailing(filePath, download, 0);
    });

    // Perform download
    await this.performDownload(song, download, streamDir);

    if (download.status === 'failed' && !headersSent) {
      res.status(404).json({
        error: download.error || 'Download failed',
      });
      await cleanup(true);
    }
  }

  private async performDownload(song: Song, download: ActiveDownload, streamDir: string): Promise<void> {
    let sourceUrl = song.youtubeLink;

    if (!sourceUrl) {
      download.status = 'searching';
      const success = await this.searchAndDownloadYouTubeTrack(song, streamDir, download);

      if (!success) {
        download.status = 'failed';
        download.error = 'Track not found on YouTube';
        return;
      }
    } else {
      download.status = 'downloading';
      const success = await this.downloadVideo(sourceUrl, streamDir, download, song);

      if (!success) {
        download.status = 'failed';
        download.error = 'Download failed';
        return;
      }
    }

    download.progress = 100;
  }

  private async searchAndDownloadYouTubeTrack(
    song: Song,
    streamDir: string,
    download: ActiveDownload
  ): Promise<boolean> {
    try {
      const searchQuery = this.buildSearchQuery(song);

      if (!searchQuery) {
        console.error('❌ Cannot build search query');
        return false;
      }

      console.log('🔍 Searching YouTube for:', searchQuery);

      const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
      let videoUrl: string;

      if (this.preferAudioVersion) {
        console.log('🎯 Searching top 5 results...');

        const searchUrl = `ytsearch5:${searchQuery}`;
        const searchArgs = [
          searchUrl,
          '--dump-json',
          '--no-warnings',
          '--no-playlist',
          '--skip-download',
        ];

        const { spawn } = await import('child_process');
        const searchProcess = spawn(ytdlpPath, searchArgs);

        let jsonOutput = '';

        searchProcess.stdout.on('data', (data: Buffer) => {
          jsonOutput += data.toString();
        });

        const searchResults = await new Promise<any[]>((resolve) => {
          searchProcess.on('close', async (code) => {
            if (code !== 0) {
              resolve([]);
              return;
            }

            try {
              const lines = jsonOutput.trim().split('\n').filter(line => line.trim());
              const videos = lines.map(line => JSON.parse(line));
              resolve(videos);
            } catch (parseError) {
              resolve([]);
            }
          });

          searchProcess.on('error', () => resolve([]));
        });

        if (searchResults.length === 0) {
          return false;
        }

        let bestMatch = searchResults[0];

        for (const video of searchResults) {
          const title = video.title.toLowerCase();
          if (title.includes('official audio') || title.includes('audio')) {
            bestMatch = video;
            break;
          }
        }

        videoUrl = bestMatch.webpage_url || bestMatch.url;

        song.youtubeLink = videoUrl;
        song.youtubeId = bestMatch.id;
        song.duration = bestMatch.duration;
        download.duration = bestMatch.duration;
        song.metadata = {
          ...song.metadata,
          youtubeTitle: bestMatch.title,
          youtubeDuration: bestMatch.duration,
          youtubeUploader: bestMatch.uploader,
        };
        await this.songRepository.save(song);

      } else {
        const searchUrl = `ytsearch1:${searchQuery}`;
        videoUrl = searchUrl;
      }

      download.status = 'downloading';
      return await this.downloadVideo(videoUrl, streamDir, download, song);

    } catch (error) {
      console.error('❌ YouTube search error:', error);
      return false;
    }
  }

  private async downloadVideo(
    videoUrl: string,
    streamDir: string,
    download: ActiveDownload,
    song?: Song
  ): Promise<boolean> {
    const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
    const outputTemplate = path.join(streamDir, '%(title)s.%(ext)s');

    const downloadArgs = [
      videoUrl,
      '-f', 'bestaudio/best',
      '-o', outputTemplate,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '320',
      '--no-playlist',
      '--no-check-certificates',
      '--prefer-free-formats',
      '--add-metadata',
      '--embed-thumbnail',
      '--newline',
      '--no-warnings',
      '--ignore-errors',
      '--print-json',
    ];

    const ffmpegPath = process.env.FFMPEG_PATH;
    if (ffmpegPath) {
      downloadArgs.push('--ffmpeg-location', ffmpegPath);
    }

    const { spawn } = await import('child_process');
    const ytdlp = spawn(ytdlpPath, downloadArgs);
    download.process = ytdlp;

    let jsonOutput = '';
    let notFound = false;

    ytdlp.stdout.on('data', (data: Buffer) => {
      const output = data.toString().trim();

      if (output.startsWith('{')) {
        jsonOutput += output;
      } else {
        const progressMatch = output.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
          download.progress = Math.min(90, parseFloat(progressMatch[1]));
        }
      }

      if (output.toLowerCase().includes('not available') ||
        output.toLowerCase().includes('not found')) {
        notFound = true;
      }
    });

    ytdlp.stderr.on('data', (data: Buffer) => {
      const errorOutput = data.toString().trim();
      if (errorOutput && !errorOutput.includes('WARNING')) {
        console.error('yt-dlp stderr:', errorOutput);
      }
    });

    return new Promise((resolve) => {
      ytdlp.on('close', async (code) => {
        if (code === 0 && !notFound) {
          if (jsonOutput && song && !this.preferAudioVersion) {
            try {
              const videoInfo = JSON.parse(jsonOutput);
              song.youtubeLink = videoInfo.webpage_url || videoInfo.url;
              song.youtubeId = videoInfo.id;
              song.duration = videoInfo.duration;
              download.duration = videoInfo.duration;
              song.metadata = {
                ...song.metadata,
                youtubeTitle: videoInfo.title,
                youtubeDuration: videoInfo.duration,
                youtubeUploader: videoInfo.uploader,
              };
              await this.songRepository.save(song);
            } catch (parseError) {
              console.warn('⚠️ Could not parse video info');
            }
          }

          await this.handleStreamComplete(song, download);
          resolve(true);
        } else {
          resolve(false);
        }
      });

      ytdlp.on('error', () => resolve(false));
    });
  }

  private buildSearchQuery(song: Song): string | null {
    const artist = song.artistName;
    const title = song.title;

    if (!title) return null;
    if (artist) return `${artist} ${title}`;
    return title;
  }

  private startProgressiveTailing(
    initialFilePath: string,
    download: ActiveDownload,
    startPosition: number
  ): void {
    let lastPosition = startPosition;
    let currentFilePath = initialFilePath;
    let isReading = false;
    let fileNotFoundCount = 0;
    const maxFileNotFoundAttempts = 5;

    const tailInterval = setInterval(async () => {
      if (isReading) return;

      if (download.activeStreams.size === 0) {
        console.log('⚠️ No active streams, stopping tailing');
        clearInterval(tailInterval);
        return;
      }

      try {
        isReading = true;

        if (currentFilePath.endsWith('.part')) {
          const withoutPart = currentFilePath.replace('.part', '');
          if (existsSync(withoutPart) && !existsSync(currentFilePath)) {
            currentFilePath = withoutPart;
            download.filePath = currentFilePath;
            fileNotFoundCount = 0;
          }
        }

        if (!existsSync(currentFilePath)) {
          fileNotFoundCount++;

          if (fileNotFoundCount === 1) {
            const dir = path.dirname(currentFilePath);
            const baseNameWithoutExt = path.basename(currentFilePath, path.extname(currentFilePath)).replace('.part', '');

            const possibleExtensions = ['.mp3', '.m4a', '.opus', '.ogg'];

            for (const ext of possibleExtensions) {
              const testPath = path.join(dir, baseNameWithoutExt + ext);
              if (existsSync(testPath)) {
                currentFilePath = testPath;
                download.filePath = currentFilePath;
                fileNotFoundCount = 0;
                lastPosition = 0;
                isReading = false;
                return;
              }
            }
          }

          if (fileNotFoundCount >= maxFileNotFoundAttempts) {
            clearInterval(tailInterval);
            download.activeStreams.forEach(stream => {
              if (!stream.destroyed) stream.end();
            });
          }

          isReading = false;
          return;
        }

        fileNotFoundCount = 0;

        const stats = await import('fs/promises').then(fs => fs.stat(currentFilePath));
        const currentSize = stats.size;

        if (currentSize > lastPosition) {
          const chunk = await this.readFileChunk(currentFilePath, lastPosition, currentSize - 1);

          download.activeStreams.forEach((passThrough) => {
            if (!passThrough.destroyed) {
              passThrough.write(chunk);
            }
          });

          lastPosition = currentSize;
        }

        if (download.isComplete && currentSize === lastPosition) {
          clearInterval(tailInterval);
          download.activeStreams.forEach(stream => {
            if (!stream.destroyed) stream.end();
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

  private async readFileChunk(filePath: string, start: number, end: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(filePath, { start, end });

      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (error) => reject(error));
    });
  }

  private async handleStreamComplete(song: Song | undefined, download: ActiveDownload): Promise<void> {
    if (!song) return;

    try {
      const freshSong = await this.songRepository.findOne({ where: { id: song.id } });
      if (!freshSong) return;

      const finalTempPath = download.filePath;
      if (!finalTempPath || !existsSync(finalTempPath)) return;

      const stats = await import('fs/promises').then(fs => fs.stat(finalTempPath));
      const ext = path.extname(finalTempPath).toLowerCase();
      const quality = this.determineQuality(finalTempPath, stats.size);

      // Check if song should be permanently cached (10+ plays)
      if (freshSong.playCount >= 10) {
        console.log('💾 Song popular, saving to permanent storage');

        const timestamp = Date.now();
        const permanentFileName = `${freshSong.id}-${quality}-${timestamp}${ext}`;
        const permanentPath = path.join(this.downloadsDir, permanentFileName);

        await import('fs/promises').then(fs => fs.copyFile(finalTempPath, permanentPath));

        freshSong.standardPath = permanentPath;
        freshSong.standardQuality = quality;
        await this.songRepository.save(freshSong);

        const cacheKey = this.getCacheKey(freshSong.id);
        this.streamCache.set(cacheKey, permanentPath);
      } else {
        console.log(`🕐 Song not popular enough (${freshSong.playCount} plays), keeping temporary`);
        // Note: MusicService will handle scheduling deletion via scheduleTemporaryFileDeletion
      }
    } catch (error) {
      console.error('❌ Error in handleStreamComplete:', error);
    }
  }

  private determineQuality(filePath: string, fileSize: number): string {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.flac') return 'flac';

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

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.webm': 'audio/webm',
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
        await import('fs/promises').then(fs => fs.rm(dirPath, { recursive: true }));
      }
      console.log('✅ Temp cache cleared');
    } catch (error) {
      console.error('❌ Error clearing temp cache:', error);
    }
  }
}