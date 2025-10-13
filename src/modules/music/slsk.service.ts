import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import * as process from 'node:process';

@Injectable()
export class SlskService {
  private configPath = process.env.SLDL_CONFIG_PATH || 'config/sldl.conf';

  async search(query: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const args = [query, '--print', 'json-all', '-c', this.configPath, '--no-progress'];
      const sldl = spawn(process.env.SLDL_PATH, args);

      let output = '';
      let errorOutput = '';

      sldl.stdout.on('data', (data) => {
        output += data.toString();
      });

      sldl.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      sldl.on('close', (code) => {
        if (code === 0 && output) {
          try {
            const results = JSON.parse(output);
            resolve(Array.isArray(results) ? results : [results]);
          } catch (e) {
            resolve([]);
          }
        } else {
          resolve([]);
        }
      });

      sldl.on('error', (error) => {
        console.log('sldl error: ', error);
        reject(error);
      });
    });
  }

  async checkFlacAvailability(artist: string, title: string): Promise<boolean> {
    return new Promise((resolve) => {
      const query = `artist=${artist}, title=${title}`;
      const args = [query, '--print', 'json-all', '--pref-format', 'flac', '-c', this.configPath, '--no-progress'];
      const sldl = spawn(process.env.SLDL_PATH, args);

      let output = '';

      sldl.stdout.on('data', (data) => {
        output += data.toString();
      });

      sldl.on('close', () => {
        try {
          const results = JSON.parse(output);
          const hasFlac = Array.isArray(results)
            ? results.some((r) => r.format?.toLowerCase() === 'flac')
            : results.format?.toLowerCase() === 'flac';
          resolve(hasFlac);
        } catch (e) {
          resolve(false);
        }
      });

      sldl.on('error', () => {
        resolve(false);
      });
    });
  }

  buildDownloadCommand(options: any): string[] {
    const args = [options.input, '-c', this.configPath, '--no-progress'];

    if (options.path) args.push('-p', options.path);
    if (options.format) args.push('--pref-format', options.format);
    if (options.album) args.push('-a');

    return args;
  }
}