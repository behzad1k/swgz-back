import { Injectable, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ChildProcess } from 'child_process';
import { createReadStream, existsSync, watch, FSWatcher } from 'fs';
import { unlink, mkdir, readdir, rmdir } from 'fs/promises';
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

  async streamSong(
    songId: string,
    res: Response,
  ): Promise<void> {
    const song = await this.songRepository.findOne({
      where: { id: songId }
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // Check if we have a cached/downloaded file
    if (song.standardPath && existsSync(song.standardPath)) {
      console.log(`📂 Playing cached file: ${song.standardPath}`);
      return this.streamFromFile(song.standardPath, res);
    }

    // Need to download
    console.log('⬇️ No cached file, starting download');
    await this.downloadAndStream(song, res);
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

  /**
   * Search for a track on YouTube
   * If PREFER_AUDIO_VERSION=true, searches top 5 results and prefers "Official Audio"
   * Otherwise, downloads first result immediately
   */
  private async searchAndDownloadYouTubeTrack(
    song: Song,
    streamDir: string,
    download: ActiveDownload
  ): Promise<boolean> {
    try {
      const searchQuery = this.buildSearchQuery(song);

      if (!searchQuery) {
        console.error('❌ Cannot build search query - missing song title/artist');
        return false;
      }

      console.log('🔍 Searching YouTube for:', searchQuery);

      const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
      let videoUrl: string;

      if (this.preferAudioVersion) {
        // Two-step: Search top 5, pick best match, then download
        console.log('🎯 Searching top 5 results for best audio match...');

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

        searchProcess.stderr.on('data', (data: Buffer) => {
          const errorOutput = data.toString().trim();
          if (errorOutput) {
            console.error('yt-dlp search stderr:', errorOutput);
          }
        });

        const searchResults = await new Promise<any[]>((resolve) => {
          searchProcess.on('close', async (code) => {
            if (code !== 0) {
              console.error('❌ Search failed with code:', code);
              resolve([]);
              return;
            }

            try {
              const lines = jsonOutput.trim().split('\n').filter(line => line.trim());
              const videos = lines.map(line => JSON.parse(line));
              resolve(videos);
            } catch (parseError) {
              console.error('❌ Failed to parse search results:', parseError);
              resolve([]);
            }
          });

          searchProcess.on('error', (error) => {
            console.error('❌ Search process error:', error);
            resolve([]);
          });
        });

        if (searchResults.length === 0) {
          console.error('❌ No search results found');
          return false;
        }

        // Find best match - prefer "Official Audio"
        let bestMatch = searchResults[0];

        for (const video of searchResults) {
          const title = video.title.toLowerCase();

          if (title.includes('official audio') || title.includes('audio')) {
            console.log('✅ Found preferred audio version:', video.title);
            bestMatch = video;
            break;
          }
        }

        if (bestMatch !== searchResults[0]) {
          console.log('🎯 Selected:', bestMatch.title);
          console.log('   Over first result:', searchResults[0].title);
        } else {
          console.log('🎯 Using first result:', bestMatch.title);
        }

        videoUrl = bestMatch.webpage_url || bestMatch.url;

        // Update song metadata
        song.youtubeLink = videoUrl;
        song.youtubeId = bestMatch.id;
        song.metadata = {
          ...song.metadata,
          youtubeTitle: bestMatch.title,
          youtubeDuration: bestMatch.duration,
          youtubeUploader: bestMatch.uploader,
        };
        await this.songRepository.save(song);

      } else {
        // One-step: Download first result immediately
        console.log('⚡ Fast mode: downloading first result directly');
        const searchUrl = `ytsearch1:${searchQuery}`;
        videoUrl = searchUrl; // yt-dlp will handle the search
      }

      console.log('📺 Downloading from:', videoUrl);

      // Download the video
      return await this.downloadVideo(videoUrl, streamDir, download, song);

    } catch (error) {
      console.error('❌ YouTube search+download error:', error);
      return false;
    }
  }

  /**
   * Download a video from YouTube
   */
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
      '--print-json', // Print JSON after download
    ];

    const ffmpegPath = process.env.FFMPEG_PATH;
    if (ffmpegPath) {
      downloadArgs.push('--ffmpeg-location', ffmpegPath);
    }

    console.log('🚀 Starting download with yt-dlp');
    console.log('📋 Command:', ytdlpPath, downloadArgs.join(' '));

    const { spawn } = await import('child_process');
    const ytdlp = spawn(ytdlpPath, downloadArgs);
    download.process = ytdlp;

    let jsonOutput = '';
    let notFound = false;

    console.log('🎯 yt-dlp download process started with PID:', ytdlp.pid);

    ytdlp.stdout.on('data', (data: Buffer) => {
      const output = data.toString().trim();

      // Capture JSON output
      if (output.startsWith('{')) {
        jsonOutput += output;
      } else {
        console.log('yt-dlp stdout:', output);
      }

      if (output.toLowerCase().includes('not available') ||
        output.toLowerCase().includes('not found') ||
        output.toLowerCase().includes('error')) {
        console.log('⚠️ Track not available');
        notFound = true;
      }

      if (output.toLowerCase().includes('100%') ||
        output.toLowerCase().includes('downloaded')) {
        console.log('✅ Download completed successfully');
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
        console.log('yt-dlp download process closed with code:', code);

        if (code === 0 && !notFound) {
          // Update metadata if we got JSON output and song is provided
          if (jsonOutput && song && !this.preferAudioVersion) {
            try {
              const videoInfo = JSON.parse(jsonOutput);
              song.youtubeLink = videoInfo.webpage_url || videoInfo.url;
              song.youtubeId = videoInfo.id;
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

          console.log('✅ Download succeeded');
          resolve(true);
        } else {
          console.error('❌ Download failed');
          resolve(false);
        }
      });

      ytdlp.on('error', (error) => {
        console.error('❌ yt-dlp download process error:', error);
        resolve(false);
      });
    });
  }

  private buildSearchQuery(song: Song): string | null {
    const artist = song.artistName;
    const title = song.title;

    if (!title) {
      return null;
    }

    if (artist) {
      return `${artist} ${title}`;
    }

    return title;
  }

  private async downloadAndStream(
    song: Song,
    res: Response,
  ): Promise<void> {
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
    };

    this.activeDownloads.set(cacheKey, download);

    let headersSent = false;
    let streamingStarted = false;
    let notFound = false;
    let fileDetected = false;
    let clientDisconnected = false;

    const cleanup = async (shouldDeleteFile: boolean = false) => {
      if (download.watcher) {
        download.watcher.close();
        download.watcher = null;
        console.log('🛑 File watcher closed');
      }
      this.activeDownloads.delete(cacheKey);

      // Clean up temp directory
      setTimeout(async () => {
        try {
          if (shouldDeleteFile && download.filePath && existsSync(download.filePath)) {
            await unlink(download.filePath);
            console.log('🗑️  Deleted temporary file');
          }

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
      console.log('❌ Client disconnected');
      clientDisconnected = true;
      download.activeStreams.delete(passThrough);
      passThrough.end();

      if (download.activeStreams.size === 0 && !download.isComplete) {
        console.log('🛑 No more clients, aborting download');

        if (download.process && !download.process.killed) {
          download.process.kill('SIGTERM');
          console.log('🛑 Killed yt-dlp process');
        }

        cleanup(true);
      }
    });

    res.on('error', (error) => {
      console.error('❌ Response error in downloadAndStream:', error);
    });

    download.watcher = watch(streamDir, { persistent: false }, async (eventType, filename) => {
      if (!filename || fileDetected) return;

      console.log(`👁️ File watcher event: ${eventType} - ${filename}`);

      if (filename === streamDirName) {
        console.log('⏭️ Skipping directory event');
        return;
      }

      const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg', '.webm', '.aac', '.wav'];
      const isAudioFile = audioExtensions.some(ext =>
        filename.endsWith(ext) || filename.endsWith(ext + '.part')
      );

      if (!isAudioFile) {
        console.log('⏭️ Skipping non-audio file:', filename);
        return;
      }

      const filePath = path.join(streamDir, filename);
      const isPartFile = filename.endsWith('.part');

      if (isPartFile) {
        console.log('📥 Detected .part file, checking if ready for streaming:', filename);
      }

      fileDetected = true;
      console.log('🔒 File detection locked');

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
            console.log(`✅ File ready with ${stats.size} bytes after ${attempts * 300}ms`);
          } else {
            console.log(`⏳ File has ${stats.size} bytes, waiting for ${threshold}...`);
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

      streamingStarted = true;
      download.filePath = filePath;
      this.streamCache.set(cacheKey, filePath);

      console.log('📁 FILE DETECTED via watcher:', filePath);

      if (headersSent) {
        console.log('⚠️ Headers already sent, skipping');
        return;
      }

      headersSent = true;

      const ext = path.extname(filename).replace('.part', '').toLowerCase();
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

    // Try to get source URL or search YouTube
    let sourceUrl = song.youtubeLink;

    if (!sourceUrl) {
      console.log('🔍 No YouTube URL found, searching...');
      const success = await this.searchAndDownloadYouTubeTrack(song, streamDir, download);

      if (!success) {
        console.error('❌ Search and download failed');
        notFound = true;

        if (!headersSent) {
          res.status(404).json({
            error: 'Track not found',
            message: 'Could not find this track on YouTube'
          });
        }

        await cleanup(true);
      }

      return;
    }

    // Download from known URL
    console.log('📺 Using saved YouTube URL:', sourceUrl);
    const success = await this.downloadVideo(sourceUrl, streamDir, download);

    if (!success && !headersSent) {
      res.status(404).json({
        error: 'Download failed',
        message: 'Could not download track from YouTube'
      });
      await cleanup(true);
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
    let fileNotFoundCount = 0;
    const maxFileNotFoundAttempts = 5;

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

        // Handle .part file renaming
        if (currentFilePath.endsWith('.part')) {
          const withoutPart = currentFilePath.replace('.part', '');
          if (existsSync(withoutPart) && !existsSync(currentFilePath)) {
            console.log('📝 File renamed from .part:', withoutPart);
            currentFilePath = withoutPart;
            download.filePath = currentFilePath;

            const cacheEntry = Array.from(this.activeDownloads.entries())
            .find(([_, d]) => d === download);
            if (cacheEntry) {
              this.streamCache.set(cacheEntry[0], currentFilePath);
            }

            fileNotFoundCount = 0;
          }
        }

        if (!existsSync(currentFilePath)) {
          fileNotFoundCount++;

          // Check for converted file
          if (fileNotFoundCount === 1) {
            const dir = path.dirname(currentFilePath);
            const baseNameWithoutExt = path.basename(currentFilePath, path.extname(currentFilePath)).replace('.part', '');

            const possibleExtensions = ['.mp3', '.m4a', '.opus', '.ogg'];
            let convertedFile: string | null = null;

            for (const ext of possibleExtensions) {
              const testPath = path.join(dir, baseNameWithoutExt + ext);
              if (existsSync(testPath)) {
                convertedFile = testPath;
                console.log('🔄 Found converted file:', convertedFile);
                break;
              }
            }

            if (convertedFile) {
              currentFilePath = convertedFile;
              download.filePath = currentFilePath;

              const cacheEntry = Array.from(this.activeDownloads.entries())
              .find(([_, d]) => d === download);
              if (cacheEntry) {
                this.streamCache.set(cacheEntry[0], currentFilePath);
              }

              fileNotFoundCount = 0;
              lastPosition = 0;
              console.log('✅ Switched to converted file, continuing tailing');
              isReading = false;
              return;
            }
          }

          if (fileNotFoundCount >= maxFileNotFoundAttempts) {
            if (download.isComplete) {
              console.log('✅ Download complete, file has been processed');
              clearInterval(tailInterval);
              download.activeStreams.forEach(stream => {
                if (!stream.destroyed) {
                  stream.end();
                }
              });
            } else {
              console.log('⚠️ File disappeared but download not marked complete');
            }
            clearInterval(tailInterval);
          }

          isReading = false;
          return;
        }

        fileNotFoundCount = 0;

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

  private async handleStreamComplete(song: Song, download: ActiveDownload): Promise<void> {
    try {
      // Reload song to get latest playCount
      const freshSong = await this.songRepository.findOne({ where: { id: song.id } });
      if (!freshSong) return;

      console.log(`📊 Stream complete. PlayCount: ${freshSong.playCount}`);

      if (freshSong.playCount >= 10) {
        // Move to permanent storage
        const finalTempPath = download.filePath;

        if (!finalTempPath || !existsSync(finalTempPath)) {
          console.error('❌ Downloaded file not found:', finalTempPath);
          return;
        }

        console.log('💾 Song popular (playCount >= 10), saving to permanent storage');

        const stats = await import('fs/promises').then(fs => fs.stat(finalTempPath));
        const ext = path.extname(finalTempPath).toLowerCase();
        const quality = this.determineQuality(finalTempPath, stats.size);

        console.log(`📊 Quality determined: ${quality}`);

        const timestamp = Date.now();
        const permanentFileName = `${freshSong.id}-${quality}-${timestamp}${ext}`;
        const permanentPath = path.join(this.downloadsDir, permanentFileName);

        await import('fs/promises').then(fs => fs.copyFile(finalTempPath, permanentPath));
        console.log('✅ Copied to permanent storage:', permanentPath);

        freshSong.standardPath = permanentPath;
        freshSong.standardQuality = quality;

        await this.songRepository.save(freshSong);
        console.log('✅ Song entity updated with permanent path');

        // Update cache
        const cacheKey = this.getCacheKey(freshSong.id);
        this.streamCache.set(cacheKey, permanentPath);
      } else {
        console.log(`🗑️  Song not popular enough (playCount: ${freshSong.playCount}), will delete temp file`);
      }
    } catch (error) {
      console.error('❌ Error in handleStreamComplete:', error);
    }
  }

  private determineQuality(filePath: string, fileSize: number): string {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.flac') {
      return 'flac';
    }

    // Size-based quality estimation for MP3
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
        await rmdir(dirPath, { recursive: true });
      }
      console.log('✅ Temp cache cleared');
    } catch (error) {
      console.error('❌ Error clearing temp cache:', error);
    }
  }
}