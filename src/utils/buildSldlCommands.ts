import { DownloadOptions } from '../types';

export function buildSldlCommand(options: DownloadOptions, outputPath?: string): string[] {
  const args: string[] = [];

  // Input
  if (options.input) {
    args.push(options.input);
  }

  // Use config file by default if not explicitly set to 'none'
  // This will load username/password from the config file
  if (options.config !== 'none') {
    const configPath = options.config || process.env.SLDL_CONFIG_PATH || 'config/sldl.conf';
    args.push('-c', configPath);
  }

  // Authentication (only if explicitly provided in request, otherwise use config file)
  if (options.user) {
    args.push('--user', options.user);
  }
  if (options.pass) {
    args.push('--pass', options.pass);
  }

  // Output path
  if (outputPath || options.path) {
    args.push('-p', outputPath || options.path!);
  }

  // Input type
  if (options.inputType) {
    args.push('--input-type', options.inputType);
  }

  // Name format
  if (options.nameFormat) {
    args.push('--name-format', options.nameFormat);
  }

  // Limits
  if (options.number) {
    args.push('-n', options.number.toString());
  }
  if (options.offset) {
    args.push('-o', options.offset.toString());
  }

  // Flags
  if (options.reverse) args.push('-r');
  if (options.album) args.push('-a');
  if (options.interactive) args.push('-t');
  if (options.aggregate) args.push('-g');
  if (options.verbose) args.push('-v');
  if (options.noProgress) args.push('--no-progress');
  if (options.fastSearch) args.push('--fast-search');
  if (options.desperate) args.push('-d');

  // Profile (after config is loaded)
  if (options.profile) {
    args.push('--profile', options.profile);
  }

  // Concurrent downloads
  if (options.concurrentDownloads) {
    args.push('--concurrent-downloads', options.concurrentDownloads.toString());
  }

  // Playlist options
  if (options.writePlaylist) args.push('--write-playlist');
  if (options.playlistPath) {
    args.push('--playlist-path', options.playlistPath);
  }

  // Skip options
  if (options.noSkipExisting) args.push('--no-skip-existing');
  if (options.noWriteIndex) args.push('--no-write-index');
  if (options.indexPath) {
    args.push('--index-path', options.indexPath);
  }
  if (options.skipCheckCond) args.push('--skip-check-cond');
  if (options.skipCheckPrefCond) args.push('--skip-check-pref-cond');
  if (options.skipMusicDir) {
    args.push('--skip-music-dir', options.skipMusicDir);
  }
  if (options.skipNotFound) args.push('--skip-not-found');

  // Network options
  if (options.listenPort) {
    args.push('--listen-port', options.listenPort.toString());
  }

  // On-complete
  if (options.onComplete) {
    args.push('--on-complete', options.onComplete);
  }

  // Logging
  if (options.logFile) {
    args.push('--log-file', options.logFile);
  }

  // Print options
  if (options.print) {
    args.push('--print', options.print);
  }

  // Text processing
  if (options.removeFt) args.push('--remove-ft');
  if (options.regex) {
    args.push('--regex', options.regex);
  }
  if (options.artistMaybeWrong) args.push('--artist-maybe-wrong');

  // User management
  if (options.failsToDownrank) {
    args.push('--fails-to-downrank', options.failsToDownrank.toString());
  }
  if (options.failsToIgnore) {
    args.push('--fails-to-ignore', options.failsToIgnore.toString());
  }

  // yt-dlp
  if (options.ytDlp) args.push('--yt-dlp');
  if (options.ytDlpArgument) {
    args.push('--yt-dlp-argument', options.ytDlpArgument);
  }

  // Timeouts
  if (options.searchTimeout) {
    args.push('--search-timeout', options.searchTimeout.toString());
  }
  if (options.maxStaleTime) {
    args.push('--max-stale-time', options.maxStaleTime.toString());
  }
  if (options.searchesPerTime) {
    args.push('--searches-per-time', options.searchesPerTime.toString());
  }
  if (options.searchesRenewTime) {
    args.push('--searches-renew-time', options.searchesRenewTime.toString());
  }

  // Spotify options
  if (options.spotifyId) {
    args.push('--spotify-id', options.spotifyId);
  }
  if (options.spotifySecret) {
    args.push('--spotify-secret', options.spotifySecret);
  }
  if (options.spotifyToken) {
    args.push('--spotify-token', options.spotifyToken);
  }
  if (options.spotifyRefresh) {
    args.push('--spotify-refresh', options.spotifyRefresh);
  }
  if (options.removeFromSource) args.push('--remove-from-source');

  // YouTube options
  if (options.youtubeKey) {
    args.push('--youtube-key', options.youtubeKey);
  }
  if (options.getDeleted) args.push('--get-deleted');
  if (options.deletedOnly) args.push('--deleted-only');

  // CSV column options
  if (options.artistCol) {
    args.push('--artist-col', options.artistCol);
  }
  if (options.titleCol) {
    args.push('--title-col', options.titleCol);
  }
  if (options.albumCol) {
    args.push('--album-col', options.albumCol);
  }
  if (options.lengthCol) {
    args.push('--length-col', options.lengthCol);
  }
  if (options.albumTrackCountCol) {
    args.push('--album-track-count-col', options.albumTrackCountCol);
  }
  if (options.ytDescCol) {
    args.push('--yt-desc-col', options.ytDescCol);
  }
  if (options.ytIdCol) {
    args.push('--yt-id-col', options.ytIdCol);
  }
  if (options.timeFormat) {
    args.push('--time-format', options.timeFormat);
  }
  if (options.ytParse) args.push('--yt-parse');

  // File conditions (required)
  if (options.format) {
    args.push('--format', options.format);
  }
  if (options.lengthTol) {
    args.push('--length-tol', options.lengthTol.toString());
  }
  if (options.minBitrate) {
    args.push('--min-bitrate', options.minBitrate.toString());
  }
  if (options.maxBitrate) {
    args.push('--max-bitrate', options.maxBitrate.toString());
  }
  if (options.minSamplerate) {
    args.push('--min-samplerate', options.minSamplerate.toString());
  }
  if (options.maxSamplerate) {
    args.push('--max-samplerate', options.maxSamplerate.toString());
  }
  if (options.minBitdepth) {
    args.push('--min-bitdepth', options.minBitdepth.toString());
  }
  if (options.maxBitdepth) {
    args.push('--max-bitdepth', options.maxBitdepth.toString());
  }
  if (options.strictTitle) args.push('--strict-title');
  if (options.strictArtist) args.push('--strict-artist');
  if (options.strictAlbum) args.push('--strict-album');
  if (options.bannedUsers) {
    args.push('--banned-users', options.bannedUsers);
  }

  // Preferred conditions
  if (options.prefFormat) {
    args.push('--pref-format', options.prefFormat);
  }
  if (options.prefLengthTol) {
    args.push('--pref-length-tol', options.prefLengthTol.toString());
  }
  if (options.prefMinBitrate) {
    args.push('--pref-min-bitrate', options.prefMinBitrate.toString());
  }
  if (options.prefMaxBitrate) {
    args.push('--pref-max-bitrate', options.prefMaxBitrate.toString());
  }
  if (options.prefMinSamplerate) {
    args.push('--pref-min-samplerate', options.prefMinSamplerate.toString());
  }
  if (options.prefMaxSamplerate) {
    args.push('--pref-max-samplerate', options.prefMaxSamplerate.toString());
  }
  if (options.prefMinBitdepth) {
    args.push('--pref-min-bitdepth', options.prefMinBitdepth.toString());
  }
  if (options.prefMaxBitdepth) {
    args.push('--pref-max-bitdepth', options.prefMaxBitdepth.toString());
  }
  if (options.prefBannedUsers) {
    args.push('--pref-banned-users', options.prefBannedUsers);
  }
  if (options.strictConditions) args.push('--strict-conditions');

  // Album options
  if (options.albumTrackCount) {
    args.push('--album-track-count', options.albumTrackCount);
  }
  if (options.albumArt) {
    args.push('--album-art', options.albumArt);
  }
  if (options.albumArtOnly) args.push('--album-art-only');
  if (options.noBrowseFolder) args.push('--no-browse-folder');
  if (options.failedAlbumPath) {
    args.push('--failed-album-path', options.failedAlbumPath);
  }
  if (options.albumParallelSearch) args.push('--album-parallel-search');

  // Aggregate options
  if (options.aggregateLengthTol) {
    args.push('--aggregate-length-tol', options.aggregateLengthTol.toString());
  }
  if (options.minSharesAggregate) {
    args.push('--min-shares-aggregate', options.minSharesAggregate.toString());
  }
  if (options.relaxFiltering) args.push('--relax-filtering');

  return args;
}