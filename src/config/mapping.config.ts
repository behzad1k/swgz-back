export const EXTERNAL_MAPPINGS = {
  lastFM: {
    track: {
      title: 'name',
      externalListens: 'listeners',
      lastFMLink: 'url',
      artistName: (data: any) => data.artist ? typeof data.artist == 'string' ? data.artist : data.artist.name : '',
      albumName: 'albumName',
      albumCover: 'albumCover',
      mbid: 'mbid',
      duration: 'duration',
    },
    artist: {
      name: 'name',
      mbid: 'mbid',
      lastFMLink: 'url',
      pfp: 'pfp',
      externalListeners: (data: any)=> data.stats ? data.stats?.listeners : data.listeners,
      externalPlays: (data: any)=> data.stats?.playcount,
      bio: (data: any)=> data.bio?.summary,
      fullBio: (data: any)=> data.bio?.content,
    },
    album: {
      title: 'name',
      mbid: 'mbid',
      lastFMLink: 'url',
      externalListens: 'listeners',
      externalPlays: 'playcount',
      tracks: (data: any) => data.tracks,
      artistName: (data: any)=> data.artist,
      albumCover: (data: any) => data.image ? (Array.isArray(data.image) ? data.image[data.image.length -1]['#text'] : data.image['#text']) : '',
      releaseDate: (data: any)=> data.wiki ? data.wiki?.published : null,
      description: (data: any) => data.wiki? data?.wiki?.content : null
    }
  },
  discogs: {
    track: {
      title: 'title',
      artist: (data: any) => data.artists?.[0]?.name,
      albumCover: (data: any) => data.cover_image || data.thumb,
    }
  },
  amazon: {
    track: {
      title: 'title',
      asin: 'asin',
      duration: 'duration',
      externalId: 'id',
      amazonUrl: 'url',
      albumCover: 'image',
      artistName: (data: any) => data.artist ? typeof data.artist == 'string' ? data.artist : data.artist?.name : '',
      releaseData: 'original_release_date',
      albumName: (data: any) => data.album ? typeof data.album == 'string' ? data.album : data.album.name : '',
      genre: 'genre',
      isExplicit: 'explicit',
    },
    artist: {
      name: 'name',
      asin: 'asin',
      amazonUrl: 'url',
      externalId: 'id',
      pfp: 'image',
      externalListeners: (data: any)=> data.stats ? data.stats?.listeners : data.listeners,
      externalPlays: (data: any)=> data.stats?.playcount,
      bio: (data: any)=> data.bio?.summary,
      fullBio: (data: any)=> data.bio?.content,
    },
    album: {
      title: (data: any) => data.name || data.title,
      artistName: (data: any) => data.artist ? typeof data.artist == 'string' ? data.artist : data.artist.name : '',
      amazonUrl: 'url',
      asin: 'asin',
      externalId: 'id',
      releaseData: 'release_date',
      isExplicit: 'explicit',
      track_count: 'track_count',
      genre: 'genre',
      // externalListens: 'listeners',
      // externalPlays: 'playcount',
      albumCover: 'image',
      // rankForArtist: (data: any)=> data['@attr']?.rank,
    }
  }
};


// Utility to apply mappings
export function applyMapping<T>(source: any, mappingConfig: any): T {
  const result: any = {};

  for (const [targetKey, mapping] of Object.entries(mappingConfig)) {
    if (typeof mapping === 'function') {
      result[targetKey] = mapping(source);
    } else if (typeof mapping === 'string') {
      result[targetKey] = source[mapping];
    }
  }

  return result as T;
}
