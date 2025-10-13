// dtos/external/lastfm.dto.ts
export interface LastFmTrackDto {
  name: string;
  artist: string | { name: string; mbid: string };
  album?: string | { title: string; mbid: string };
  duration?: string;
  image?: Array<{ '#text': string; size: string }>;
  mbid?: string;
  url?: string;
}

export interface LastFmArtistDto {
  name: string;
  mbid?: string;
  url?: string;
  image?: Array<{ '#text': string; size: string }>;
  listeners?: string;
  playcount?: string;
}

// dtos/external/discogs.dto.ts
export interface DiscogsReleaseDto {
  id: number;
  title: string;
  artists: Array<{ name: string; id: number }>;
  year?: number;
  thumb?: string;
  cover_image?: string;
  uri?: string;
}

// dtos/external/slsk.dto.ts
export interface SlskTrackDto {
  filename: string;
  path: string;
  size: number;
  bitrate?: number;
  duration?: number;
  samplerate?: number;
}