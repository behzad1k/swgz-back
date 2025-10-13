import { Injectable, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { createReadStream, existsSync } from 'fs';
import { unlink, mkdir } from 'fs/promises';
import path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatSldlInputStr } from '../../utils/formatter';
import { Song } from './entities/song.entity';
import { PassThrough } from 'stream';

interface ActiveDownload {
  process: ChildProcess;
  passThrough: PassThrough;
}

@Injectable()
export class StreamingService {
  private streamCache = new Map<string, string>(); // songId -> file path
  private activeDownloads = new Map<string, ActiveDownload>();
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

  async streamSong(songId: string, res: Response, preferFlac: boolean = false): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id: songId } });
    if (!song) {
      throw new NotFoundException('Song not found');
    }

    // 1. Check if song is already downloaded
    if (song.downloadedPath && existsSync(song.downloadedPath)) {
      console.log('📂 Streaming from downloaded file:', song.downloadedPath);
      return this.streamFromFile(song.downloadedPath, res);
    }

    // 2. Check cache (temporary files)
    const cachedPath = this.streamCache.get(songId);
    if (cachedPath && existsSync(cachedPath)) {
      console.log('💾 Streaming from cache:', cachedPath);
      return this.streamFromFile(cachedPath, res);
    }

    // 3. Download and stream
    console.log('⬇️ Starting SLDL download for:', song.title, '-', song.artistName);
    return this.downloadAndStream(song, res, preferFlac);
  }

  private async streamFromFile(filePath: string, res: Response): Promise<void> {
    try {
      const stat = await import('fs/promises').then(fs => fs.stat(filePath));
      const fileSize = stat.size;
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(ext);

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });

      const stream = createReadStream(filePath);
      stream.pipe(res);

      stream.on('error', (error) => {
        console.error('❌ Stream error:', error);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
    } catch (error) {
      console.error('❌ streamFromFile error:', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  }

  private async downloadAndStream(song: Song, res: Response, preferFlac: boolean): Promise<void> {
    const downloadKey = `${song.id}-${preferFlac ? 'flac' : 'mp3'}`;

    // Check if already downloading
    const existingDownload = this.activeDownloads.get(downloadKey);
    if (existingDownload) {
      console.log('♻️ Reusing existing download stream');
      existingDownload.passThrough.pipe(res);
      return;
    }

    const format = preferFlac ? 'flac,mp3' : 'mp3';
    const input = formatSldlInputStr(song);
    console.log(input);
    const tempFileName = `${song.id}-${Date.now()}`;

    const configPath = process.env.SLDL_CONFIG_PATH || '~/.config/sldl/sldl.conf';
    const args = [
      input,
      '-p', this.tempDir,
      '--pref-format', format,
      '-c', configPath,
      '--no-progress',
      '--name-format', tempFileName,
    ];

    const sldl = spawn(process.env.SLDL_PATH || 'sldl', args);
    const passThrough = new PassThrough();

    let headersSent = false;
    let streamingStarted = false;
    let sldlFinished = false;
    let downloadedFilePath: string | null = null;
    let fileStream: any = null;
    let checkInterval: NodeJS.Timeout;
    let tailInterval: NodeJS.Timeout;
    let lastSize = 0;

    const BUFFER_THRESHOLD = 64 * 1024; // 64KB

    this.activeDownloads.set(downloadKey, { process: sldl, passThrough });

    // Handle client disconnect
    res.on('close', () => {
      if (!res.writableEnded) {
        console.log('Client disconnected, cleaning up');
        if (checkInterval) clearInterval(checkInterval);
        if (tailInterval) clearInterval(tailInterval);
        if (fileStream) fileStream.destroy();
        this.abortDownload(downloadKey);
      }
    });

    // Parse SLDL output to get actual filename
    sldl.stdout.on('data', (data: Buffer) => {
      const output = data.toString().trim();

      const initMatch = output.match(/Initialize:\s+(.+?)\s+\[(.+?)\]/);
      const succeededMatch = output.match(/Succeeded:\s+(.+?)\s+\[(.+?)\]/);

      if (initMatch || succeededMatch) {
        const match = initMatch || succeededMatch;
        const fullPath = match[1].trim();
        const metadata = match[2].trim(); // e.g., "315s/320kbps/12.1MB"

        // Extract filename from path (remove directory traversal)
        const filenameParts = fullPath.split(/[\/\\]/);
        const fileName = filenameParts[filenameParts.length - 1];
        downloadedFilePath = path.join(this.tempDir, fileName);

        console.log('📁 Download file:', fileName);
        console.log('📊 Metadata:', metadata);
      }
    });

    sldl.stderr.on('data', (data: Buffer) => {
      console.log('SLDL:', data.toString().trim());
    });

    // Monitor file as it's being written
    checkInterval = setInterval(async () => {
      try {
        let fileToCheck: string | null = null;

        // Try to find the file
        if (downloadedFilePath && existsSync(downloadedFilePath)) {
          fileToCheck = downloadedFilePath;
        } else {
          // Search for file with base name and common extensions
          const basePath = path.join(this.tempDir, tempFileName);
          const extensions = ['.mp3', '.opus', '.flac', '.m4a', '.ogg'];

          for (const ext of extensions) {
            const testPath = basePath + ext;
            if (existsSync(testPath)) {
              fileToCheck = testPath;
              downloadedFilePath = testPath;
              break;
            }
          }
        }

        if (!fileToCheck) return;

        const stats = await import('fs/promises').then(fs => fs.stat(fileToCheck));
        const currentSize = stats.size;

        // Start streaming once we have enough data
        if (!streamingStarted && currentSize >= BUFFER_THRESHOLD) {
          streamingStarted = true;
          headersSent = true;
          clearInterval(checkInterval);

          const ext = path.extname(fileToCheck).toLowerCase();
          const mimeType = this.getMimeType(ext);

          console.log('✅ Starting stream, size:', currentSize, 'bytes');

          res.writeHead(200, {
            'Content-Type': mimeType,
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
          });

          passThrough.pipe(res);
          fileStream = createReadStream(fileToCheck);

          fileStream.on('data', (chunk: Buffer) => passThrough.write(chunk));
          fileStream.on('end', () => {
            if (!sldlFinished) {
              this.startTailing(fileToCheck, passThrough, tailInterval, lastSize, () => sldlFinished);
            } else {
              passThrough.end();
            }
          });
          fileStream.on('error', (error) => {
            console.error('❌ Stream error:', error);
            passThrough.end();
          });
        }

        lastSize = currentSize;
      } catch (error) {
        // Ignore, file not ready yet
      }
    }, 50);

    sldl.on('error', (error) => {
      console.error('❌ SLDL error:', error);
      sldlFinished = true;
      clearInterval(checkInterval);
      if (tailInterval) clearInterval(tailInterval);
      this.activeDownloads.delete(downloadKey);

      if (!headersSent) {
        res.status(500).json({ error: 'Failed to download song' });
      }
    });

    sldl.on('close', async (code) => {
      sldlFinished = true;
      clearInterval(checkInterval);
      this.activeDownloads.delete(downloadKey);

      if (code === 0 && downloadedFilePath) {
        await this.handleSuccessfulDownload(song, downloadedFilePath, res, streamingStarted, headersSent);
      } else {
        console.error('❌ SLDL exited with code:', code);
        if (!headersSent) {
          res.status(404).json({ error: 'Song not found' });
        }
      }
    });
  }

  private async handleSuccessfulDownload(
    song: Song,
    tempFilePath: string,
    res: Response,
    streamingStarted: boolean,
    headersSent: boolean
  ): Promise<void> {
    try {
      // Find the actual downloaded file
      let finalPath = tempFilePath;

      if (!existsSync(tempFilePath)) {
        finalPath = await this.findDownloadedFile(tempFilePath);
      }

      if (!existsSync(finalPath)) {
        console.error('❌ Downloaded file not found');
        if (!headersSent) {
          res.status(404).json({ error: 'Downloaded file not found' });
        }
        return;
      }

      // Get file stats and metadata
      const stats = await import('fs/promises').then(fs => fs.stat(finalPath));
      const ext = path.extname(finalPath).toLowerCase();

      // Move file to permanent downloads directory
      const permanentFileName = `${song.id}${ext}`;
      const permanentPath = path.join(this.downloadsDir, permanentFileName);

      await import('fs/promises').then(fs => fs.rename(finalPath, permanentPath));
      console.log('✅ Moved to permanent storage:', permanentPath);

      // Update song in database
      song.downloadedPath = permanentPath;
      song.duration = await this.extractDuration(permanentPath); // Implement if needed
      song.metadata = {
        fileSize: stats.size,
        format: ext.substring(1),
        downloadedAt: new Date().toISOString(),
      };

      await this.songRepository.save(song);
      console.log('✅ Database updated for song:', song.id);

      // Cache the permanent path
      this.streamCache.set(song.id, permanentPath);

      // If streaming never started, stream the complete file now
      if (!streamingStarted) {
        console.log('📂 Streaming complete file');
        return this.streamFromFile(permanentPath, res);
      }

      // store other data of the song:



    } catch (error) {
      console.error('❌ Error handling download:', error);
      if (!headersSent) {
        res.status(500).json({ error: 'Failed to process downloaded file' });
      }
    }
  }

  private async findDownloadedFile(basePath: string): Promise<string> {
    const dir = path.dirname(basePath);
    const files = await import('fs/promises').then(fs => fs.readdir(dir));

    let newestFile: string | null = null;
    let newestTime = 0;

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await import('fs/promises').then(fs => fs.stat(filePath));
      if (stats.mtimeMs > newestTime) {
        newestTime = stats.mtimeMs;
        newestFile = filePath;
      }
    }

    return newestFile || basePath;
  }

  private startTailing(
    filePath: string,
    passThrough: PassThrough,
    tailInterval: NodeJS.Timeout,
    lastPosition: number,
    isFinished: () => boolean
  ): void {
    tailInterval = setInterval(async () => {
      try {
        const stats = await import('fs/promises').then(fs => fs.stat(filePath));
        const currentSize = stats.size;

        if (currentSize > lastPosition) {
          const newDataStream = createReadStream(filePath, {
            start: lastPosition,
            end: currentSize - 1
          });

          newDataStream.on('data', (chunk: Buffer) => passThrough.write(chunk));
          lastPosition = currentSize;
        }

        if (isFinished() && currentSize === lastPosition) {
          clearInterval(tailInterval);
          passThrough.end();
        }
      } catch (error) {
        clearInterval(tailInterval);
      }
    }, 100);
  }

  private abortDownload(downloadKey: string): void {
    const download = this.activeDownloads.get(downloadKey);
    if (download) {
      download.process.kill('SIGTERM');
      download.passThrough.end();
      this.activeDownloads.delete(downloadKey);
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
    // TODO: Implement using ffprobe or similar
    // For now, return null
    return null;
  }

  async clearTempCache(): Promise<void> {
    console.log('🧹 Clearing temporary cache');
    this.streamCache.clear();

    try {
      const files = await import('fs/promises').then(fs => fs.readdir(this.tempDir));
      for (const file of files) {
        await unlink(path.join(this.tempDir, file));
      }
    } catch (error) {
      console.error('Error clearing temp cache:', error);
    }
  }
}