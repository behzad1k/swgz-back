import { Request, Response, NextFunction } from 'express';
import { DownloadOptions } from '../types';

export function validateDownloadRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { input } = req.body as DownloadOptions;

  if (!input) {
    res.status(400).json({
      success: false,
      error: 'Missing required field: input'
    });
    return;
  }

  // Note: user/pass are optional - sldl will use credentials from config file if not provided

  // Validate input type if provided
  const validInputTypes = ['csv', 'youtube', 'spotify', 'bandcamp', 'string', 'list'];
  if (req.body.inputType && !validInputTypes.includes(req.body.inputType)) {
    res.status(400).json({
      success: false,
      error: `Invalid inputType. Must be one of: ${validInputTypes.join(', ')}`
    });
    return;
  }

  // Validate print option if provided
  const validPrintOptions = [
    'tracks', 'tracks-full', 'results', 'results-full',
    'json', 'json-all', 'link', 'index', 'index-failed'
  ];
  if (req.body.print && !validPrintOptions.includes(req.body.print)) {
    res.status(400).json({
      success: false,
      error: `Invalid print option. Must be one of: ${validPrintOptions.join(', ')}`
    });
    return;
  }

  // Validate album art option if provided
  const validAlbumArtOptions = ['default', 'largest', 'most'];
  if (req.body.albumArt && !validAlbumArtOptions.includes(req.body.albumArt)) {
    res.status(400).json({
      success: false,
      error: `Invalid albumArt option. Must be one of: ${validAlbumArtOptions.join(', ')}`
    });
    return;
  }

  // Validate numeric fields
  const numericFields = [
    'number', 'offset', 'concurrentDownloads', 'listenPort',
    'failsToDownrank', 'failsToIgnore', 'searchTimeout', 'maxStaleTime',
    'searchesPerTime', 'searchesRenewTime', 'lengthTol', 'minBitrate',
    'maxBitrate', 'minSamplerate', 'maxSamplerate', 'minBitdepth',
    'maxBitdepth', 'prefLengthTol', 'prefMinBitrate', 'prefMaxBitrate',
    'prefMinSamplerate', 'prefMaxSamplerate', 'prefMinBitdepth',
    'prefMaxBitdepth', 'aggregateLengthTol', 'minSharesAggregate'
  ];

  for (const field of numericFields) {
    if (req.body[field] !== undefined) {
      const value = Number(req.body[field]);
      if (isNaN(value) || value < 0) {
        res.status(400).json({
          success: false,
          error: `Invalid ${field}: must be a positive number`
        });
        return;
      }
    }
  }

  next();
}