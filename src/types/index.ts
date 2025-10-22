export interface DownloadOptions {
  // Input
  input?: string;
  user?: string;
  pass?: string;
  path?: string;
  inputType?: 'csv' | 'youtube' | 'spotify' | 'bandcamp' | 'string' | 'list';
  nameFormat?: string;
  number?: number;
  offset?: number;
  reverse?: boolean;
  config?: string;
  profile?: string;

  // Download settings
  concurrentDownloads?: number;
  writePlaylist?: boolean;
  playlistPath?: string;
  noSkipExisting?: boolean;
  noWriteIndex?: boolean;
  indexPath?: string;
  skipCheckCond?: boolean;
  skipCheckPrefCond?: boolean;
  skipMusicDir?: string;
  skipNotFound?: boolean;

  // Network
  listenPort?: number;

  // Commands
  onComplete?: string;

  // Output
  verbose?: boolean;
  logFile?: string;
  noProgress?: boolean;
  print?: 'tracks' | 'tracks-full' | 'results' | 'results-full' | 'json' | 'json-all' | 'link' | 'index' | 'index-failed';

  // Search
  fastSearch?: boolean;
  removeFt?: boolean;
  regex?: string;
  artistMaybeWrong?: boolean;
  desperate?: boolean;
  failsToDownrank?: number;
  failsToIgnore?: number;

  // yt-dlp
  ytDlp?: boolean;
  ytDlpArgument?: string;

  // Timeouts
  searchTimeout?: number;
  maxStaleTime?: number;
  searchesPerTime?: number;
  searchesRenewTime?: number;

  // Spotify
  spotifyId?: string;
  spotifySecret?: string;
  spotifyToken?: string;
  spotifyRefresh?: string;
  removeFromSource?: boolean;

  // YouTube
  youtubeKey?: string;
  getDeleted?: boolean;
  deletedOnly?: boolean;

  // CSV columns
  artistCol?: string;
  titleCol?: string;
  albumCol?: string;
  lengthCol?: string;
  albumTrackCountCol?: string;
  ytDescCol?: string;
  ytIdCol?: string;
  timeFormat?: string;
  ytParse?: boolean;

  // File conditions (required)
  format?: string;
  lengthTol?: number;
  minBitrate?: number;
  maxBitrate?: number;
  minSamplerate?: number;
  maxSamplerate?: number;
  minBitdepth?: number;
  maxBitdepth?: number;
  strictTitle?: boolean;
  strictArtist?: boolean;
  strictAlbum?: boolean;
  bannedUsers?: string;

  // Preferred conditions
  prefFormat?: string;
  prefLengthTol?: number;
  prefMinBitrate?: number;
  prefMaxBitrate?: number;
  prefMinSamplerate?: number;
  prefMaxSamplerate?: number;
  prefMinBitdepth?: number;
  prefMaxBitdepth?: number;
  prefBannedUsers?: string;
  strictConditions?: boolean;

  // Album mode
  album?: boolean;
  interactive?: boolean;
  albumTrackCount?: string;
  albumArt?: 'default' | 'largest' | 'most';
  albumArtOnly?: boolean;
  noBrowseFolder?: boolean;
  failedAlbumPath?: string;
  albumParallelSearch?: boolean;

  // Aggregate mode
  aggregate?: boolean;
  aggregateLengthTol?: number;
  minSharesAggregate?: number;
  relaxFiltering?: boolean;
}

export interface JobStatus {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  options: DownloadOptions;
  output: string[];
  error?: string;
  progress: number;
  currentTrack?: number;
  totalTracks?: number;
  pid?: number;
}

export interface SearchResult {
  title?: string;
  artist?: string;
  album?: string;
  length?: number;
  bitrate?: number;
  format?: string;
  user?: string;
  path?: string;
}

export interface CronJobConfig {
  name: string;
  expression: string;
  enabled: boolean;
  description?: string;
}

export interface StreamInfo {
  status: 'ready' | 'downloading' | 'searching' | 'not_started';
  ready: boolean;
  filePath?: string;
  quality?: string;
  duration?: number;
  fileSize?: number;
  mimeType?: string;
  progress?: number;
  estimatedTime?: number;
  message?: string;
}

export interface DownloadStatus {
  status: string;
  progress: number;
  message?: string;
  error?: string;
  quality?: string;
  duration?: number;
  fileSize?: number;
}

export type QualityPreference = 'flac' | '320' | '256' | '192' | '128' | 'standard';

export type SearchFilter = 'all' | 'track' | 'artist' | 'album' | 'stalker'