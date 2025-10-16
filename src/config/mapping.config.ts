export const EXTERNAL_MAPPINGS = {
  lastFM: {
    track: {
      title: 'name',
      externalListens: 'listeners',
      lastFMLink: 'url',
      artistName: (data: any) => typeof data.artist == 'string' ? data.artist : data.artist.name,
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
      pfp: 'pfp',
      rankForArtist: (data: any)=> data['@attr']?.rank,
      artistName: (data: any)=> data.artist.name,
      albumCover: (data: any) => data.image ? (Array.isArray(data.image) ? data.image[data.image.length -1]['#text'] : data.image['#text']) : ''
    }
  },
  discogs: {
    track: {
      title: 'title',
      artist: (data: any) => data.artists?.[0]?.name,
      albumCover: (data: any) => data.cover_image || data.thumb,
    }
  },
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
