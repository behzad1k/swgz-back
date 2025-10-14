import { Injectable, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { createReadStream, existsSync, watch, FSWatcher } from 'fs';
import { unlink, mkdir, readdir, rm } from 'fs/promises';
import path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatSldlInputStr } from '../../utils/formatter';
import { Song } from './entities/song.entity';
import { PassThrough } from 'stream';

interface ActiveDownload {
  process: ChildProcess;
  activeStreams: Set<PassThrough>; // Set of active PassThrough streams
  filePath: string | null;
  isComplete: boolean;
}

@Injectable()
export class StreamingService {
  private streamCache = new Map<string, string>(); // songId -> file path in temp or downloads
  private activeDownloads = new Map<string, ActiveDownload>(); // songId -> download info
  private tempDir: string;
  private downloadsDir: string;

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

  async streamSong(
    songId: string,
    res: Response,
    preferFlac: boolean = false
  ): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id: songId } });
    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // 1. Check if song is already downloaded
    if (song.downloadedPath && existsSync(song.downloadedPath)) {
      console.log('📂 Streaming from downloaded file:', song.downloadedPath);
      return this.streamFromFile(song.downloadedPath, res);
    }

    // 2. Check if song is in cache (temp directory)
    const cachedPath = this.streamCache.get(songId);
    if (cachedPath && existsSync(cachedPath)) {
      console.log('💾 Streaming from cached temp file:', cachedPath);
      return this.streamFromFile(cachedPath, res);
    }

    // 3. Check if song is currently being downloaded
    const existingDownload = this.activeDownloads.get(songId);
    if (existingDownload && existingDownload.filePath) {
      console.log('♻️ Joining existing download');
      return this.joinExistingDownload(existingDownload, res);
    }

    // 4. Check temp directory for existing incomplete/complete files
    const existingTempFile = await this.findSongInTempDir(songId);
    if (existingTempFile) {
      console.log('🔍 Found existing temp file:', existingTempFile);
      this.streamCache.set(songId, existingTempFile);
      return this.streamFromFile(existingTempFile, res);
    }

    // 5. Start new download and stream
    console.log('⬇️ Starting new download for:', song.title, '-', song.artistName);
    return this.downloadAndStream(song, res, preferFlac);
  }

  private async findSongInTempDir(songId: string): Promise<string | null> {
    try {
      const files = await readdir(this.tempDir);
      const audioExtensions = ['.mp3', '.flac', '.opus', '.m4a', '.ogg'];

      // Look for files that start with songId
      const matchingFiles = files.filter(file => {
        const startsWithSongId = file.startsWith(`${songId}-`);
        const hasAudioExt = audioExtensions.some(ext =>
          file.endsWith(ext) || file.endsWith(ext + '.incomplete')
        );
        return startsWithSongId && hasAudioExt;
      });

      if (matchingFiles.length > 0) {
        // Prefer complete files over incomplete
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
      stream.on('data', (chunk) => console.log('📦 Streaming chunk:', chunk.length, 'bytes'));
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

    // Handle client disconnect
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

    // Get current file size and start streaming from beginning
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

      // Read from beginning up to current size
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
    preferFlac: boolean
  ): Promise<void> {
    const format = preferFlac ? 'flac,mp3' : 'mp3,flac';
    const input = formatSldlInputStr(song);
    console.log('Input:', input);

    // Use songId as prefix for temp files
    const tempFilePrefix = `${song.id}-${Date.now()}`;

    const passThrough = new PassThrough();

    const download: ActiveDownload = {
      process: null as any,
      activeStreams: new Set([passThrough]),
      filePath: null,
      isComplete: false
    };

    this.activeDownloads.set(song.id, download);

    let headersSent = false;
    let streamingStarted = false;

    const cleanup = () => {
      this.activeDownloads.delete(song.id);
    };

    // Handle client disconnect
    res.on('close', () => {
      console.log('❌ Initial client disconnected');
      console.log('📊 Active streams before removal:', download.activeStreams.size);
      download.activeStreams.delete(passThrough);
      passThrough.end();
      console.log('📊 Active streams after removal:', download.activeStreams.size);

      // If no more clients, abort download
      if (download.activeStreams.size === 0 && !download.isComplete) {
        console.log('🛑 No more clients, aborting download');
        cleanup();
        if (download.process) {
          download.process.kill('SIGTERM');
        }

        // Clean up incomplete file
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

    // Helper function to find and start streaming the file
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
        this.streamCache.set(song.id, filePath);

        console.log('📁 FILE DETECTED:', filePath);

        const stats = await import('fs/promises').then(fs => fs.stat(filePath));
        const currentSize = stats.size;

        if (!streamingStarted && currentSize >= 0) {
          streamingStarted = true;
          headersSent = true;

          const ext = path.extname(filePath).replace('.incomplete', '').toLowerCase();
          const mimeType = this.getMimeType(ext);

          console.log('✅ Starting progressive stream with', currentSize, 'bytes');
          console.log('📊 Active streams:', download.activeStreams.size);

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

    // NOW SPAWN SLDL
    console.log('🚀 Spawning SLDL process...');

    const configPath = process.env.SLDL_CONFIG_PATH || '~/.config/sldl/sldl.conf';
    const args = [
      input,
      '-p', this.tempDir,
      '--pref-format', format,
      '-c', configPath,
      '--no-progress',
      '--name-format', tempFilePrefix,
    ];

    const sldl = spawn(process.env.SLDL_PATH || 'sldl', args);
    download.process = sldl;

    // Parse SLDL output
    sldl.stdout.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      console.log('SLDL stdout:', output);

      // When SLDL reports download is in progress, find file and start streaming
      if (output.includes('InProgress:') && !streamingStarted) {
        console.log('🎯 InProgress detected! Finding file and starting stream...');
        // Give SLDL a moment to create the file
        setTimeout(() => {
          findFileAndStartStreaming();
        }, 100);
      }
    });

    sldl.stderr.on('data', (data: Buffer) => {
      console.log('SLDL stderr:', data.toString().trim());
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

      if (code === 0 && download.filePath) {
        await this.handleSuccessfulDownload(song, download);
      } else {
        console.error('❌ SLDL exited with code:', code);
        if (!headersSent) {
          res.status(404).json({ error: 'Song not found or download failed' });
        } else {
          download.activeStreams.forEach(stream => stream.end());
        }

        // Clean up failed download
        if (download.filePath && existsSync(download.filePath)) {
          unlink(download.filePath).catch(err =>
            console.error('Failed to clean up failed file:', err)
          );
        }
      }
    });
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

        // Check if file was renamed (incomplete -> complete)
        if (currentFilePath.endsWith('.incomplete')) {
          const withoutIncomplete = currentFilePath.replace('.incomplete', '');
          if (existsSync(withoutIncomplete) && !existsSync(currentFilePath)) {
            console.log('📝 File renamed from .incomplete:', withoutIncomplete);
            currentFilePath = withoutIncomplete;
            download.filePath = currentFilePath;
            this.streamCache.set(
              Array.from(this.activeDownloads.entries())
              .find(([_, d]) => d === download)?.[0] || '',
              currentFilePath
            );
          }
        }

        if (!existsSync(currentFilePath)) {
          isReading = false;
          return;
        }

        const stats = await import('fs/promises').then(fs => fs.stat(currentFilePath));
        const currentSize = stats.size;

        // Read new data if available
        if (currentSize > lastPosition) {
          const bytesToRead = currentSize - lastPosition;
          console.log('📖 Reading new data:', bytesToRead, 'bytes from position', lastPosition);

          const chunk = await this.readFileChunk(currentFilePath, lastPosition, currentSize - 1);
          totalBytesBroadcast += chunk.length;

          console.log('📡 Broadcasting', chunk.length, 'bytes to', download.activeStreams.size, 'clients');
          console.log('📊 Total bytes broadcast so far:', totalBytesBroadcast);

          // Broadcast to all connected clients
          let successfulWrites = 0;
          download.activeStreams.forEach((passThrough) => {
            if (!passThrough.destroyed) {
              const written = passThrough.write(chunk);
              if (written) {
                successfulWrites++;
              } else {
                console.log('⚠️ Backpressure on a client stream');
                passThrough.once('drain', () => {
                  console.log('💧 Stream drained for a client');
                });
              }
            } else {
              console.log('⚠️ Found destroyed stream, should be cleaned up');
            }
          });

          console.log('✅ Successfully wrote to', successfulWrites, '/', download.activeStreams.size, 'clients');

          lastPosition = currentSize;
        }

        // End all streams if download is finished and we've read all data
        if (download.isComplete && currentSize === lastPosition) {
          clearInterval(tailInterval);
          console.log('✅ Progressive streaming completed');
          console.log('📊 Final stats: Total bytes broadcast:', totalBytesBroadcast);
          console.log('📊 Ending', download.activeStreams.size, 'active streams');
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
    console.log('📚 readFileChunk:', { filePath: path.basename(filePath), start, end, size: end - start + 1 });
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(filePath, { start, end });

      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log('✅ Chunk read complete:', buffer.length, 'bytes');
        resolve(buffer);
      });
      stream.on('error', (error) => {
        console.error('❌ readFileChunk error:', error);
        reject(error);
      });
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

      // If still has .incomplete, check for renamed version
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

      // Wait briefly for streams to finish
      console.log('⏳ Waiting briefly for streams to complete...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const stats = await import('fs/promises').then(fs => fs.stat(finalTempPath!));
      const ext = path.extname(finalTempPath).toLowerCase();

      // Determine quality from file
      let quality = 'standard';
      if (ext === '.flac') {
        quality = 'flac';
      } else if (stats.size > 10 * 1024 * 1024) { // > 10MB, likely 320kbps
        quality = '320';
      }

      // Copy to permanent storage with new name: {songId}-{quality}-{timestamp}.{ext}
      const timestamp = Date.now();
      const permanentFileName = `${song.id}-${quality}-${timestamp}${ext}`;
      const permanentPath = path.join(this.downloadsDir, permanentFileName);

      // Use copyFile instead of rename to keep the temp file
      await import('fs/promises').then(fs => fs.copyFile(finalTempPath!, permanentPath));
      console.log('✅ Copied to permanent storage:', permanentPath);

      // Update song in database
      song.downloadedPath = permanentPath;
      song.duration = await this.extractDuration(permanentPath);
      song.metadata = {
        fileSize: stats.size,
        format: ext.substring(1),
        quality,
        downloadedAt: new Date().toISOString(),
      };

      await this.songRepository.save(song);
      console.log('✅ Database updated for song:', song.id);

      // Update cache with permanent path
      this.streamCache.set(song.id, permanentPath);

      // Clean up temp file after a delay
      setTimeout(async () => {
        try {
          if (existsSync(finalTempPath!)) {
            await unlink(finalTempPath!);
            console.log('🧹 Cleaned up temp file:', finalTempPath);
          }
        } catch (error) {
          console.error('Failed to clean up temp file:', error);
        }
      }, 5000); // Wait 5 seconds before cleanup

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
    // Example: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 file.mp3
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