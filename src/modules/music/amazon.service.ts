import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { applyMapping, EXTERNAL_MAPPINGS } from '../../config/mapping.config';
import { SearchFilter } from '../../types';
import { SEARCH_FILTERS } from '../../utils/enums';
import { Album } from './entities/album.entity';
import { Artist } from './entities/artist.entity';
import { Song } from './entities/song.entity';

@Injectable()
export class AmazonService {
  private baseUrl = 'https://amazon-music-api.vercel.app';
  private accessToken = process.env.AMAZON_ACCESS_TOKEN;

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  async formatResult(result: any[], filter: SEARCH_FILTERS, key: string = 'albumCover'): Promise<any> {
    const finalResult = [];

    try {
      result.forEach((item) => {
        const formatted = { ...item };
        finalResult.push(applyMapping(formatted, EXTERNAL_MAPPINGS.amazon[filter] || {}));
      });
    } catch (e) {
      console.log('Amazon format error:', e?.message);
    }

    return finalResult;
  }

  async trackSearch(query: string, limit = 20): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: { query, type: 'track', max_results: limit },
        headers: this.getHeaders(),
        timeout: 10000
      });

      return response.data?.results || response.data?.results?.tracks || [];
    } catch (error) {
      console.error('Amazon track search error:', error?.response?.data || error?.message);
      return [];
    }
  }

  async albumSearch(query: string, limit = 20): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: { query, type: 'album', max_results: limit },
        headers: this.getHeaders(),
        timeout: 10000
      });
      return response.data?.results || response.data?.results?.albums || [];
    } catch (error) {
      console.error('Amazon album search error:', error?.response?.data || error?.message);
      return [];
    }
  }

  async artistSearch(query: string, limit = 20): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: { query, type: 'artist', max_results: limit },
        headers: this.getHeaders(),
        timeout: 10000
      });
      console.log(response.data);
      return response.data?.results || response.data?.results?.artists || [];
    } catch (error) {
      console.error('Amazon artist search error:', error?.response?.data || error?.message);
      return [];
    }
  }

  async generalSearch(query: string, limit = 20): Promise<{
    tracks: any[];
    albums: any[];
    artists: any[];
  }> {
    try {
      // Amazon API might support searching all types at once
      // If not specified, it returns all types
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: { query, limit },
        headers: this.getHeaders(),
        timeout: 10000
      });
      console.log(response.data.results);
      const data = response.data;

      return {
        tracks: data?.tracks || data?.results?.tracks || [],
        albums: data?.albums || data?.results?.albums || [],
        artists: data?.artists || data?.results?.artists || []
      };
    } catch (error) {
      console.error('Amazon general search error:', error?.response?.data || error?.message);
      return {
        tracks: [],
        albums: [],
        artists: []
      };
    }
  }

  async getArtistData(artist: Artist): Promise<any> {
    try {
      // If we have an ASIN/ID, use it directly
      if (artist.asin) {
        const response = await axios.get(`${this.baseUrl}/artist`, {
          params: { id: artist.asin },
          headers: this.getHeaders(),
          timeout: 10000
        });
        return response.data;
      }

      // Otherwise search for the artist
      const searchResult = await this.artistSearch(artist.name, 1);
      if (searchResult.length === 0) return null;

      const artistId = searchResult[0].asin || searchResult[0].id;
      const response = await axios.get(`${this.baseUrl}/artist`, {
        params: { id: artistId },
        headers: this.getHeaders(),
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Amazon get artist data error:', error?.response?.data || error?.message);
      return null;
    }
  }

  async getSimilarTracks(song: Song, limit = 5): Promise<any[]> {
    try {
      // Amazon Music API doesn't have a direct "similar tracks" endpoint
      // Workaround: search for tracks by the same artist
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: {
          query: `${song.artistName}`,
          type: 'track',
          limit: limit * 2
        },
        headers: this.getHeaders(),
        timeout: 10000
      });

      const tracks = response.data?.tracks || response.data?.results?.tracks || [];

      // Filter out the original song
      return tracks
      .filter(track =>
        track.title?.toLowerCase() !== song.title?.toLowerCase()
      )
      .slice(0, limit);
    } catch (error) {
      console.error('Amazon get similar tracks error:', error?.response?.data || error?.message);
      return [];
    }
  }

  async getArtistTopSongs(artist: Artist, limit = 10): Promise<any[]> {
    try {
      const artistData = await this.getArtistData(artist);

      if (!artistData) {
        // Fallback: search for tracks by artist name
        const response = await axios.get(`${this.baseUrl}/search`, {
          params: { query: artist.name, type: 'track', limit },
          headers: this.getHeaders(),
          timeout: 10000
        });
        return response.data?.tracks || response.data?.results?.tracks || [];
      }

      // If artist data includes top tracks, return them
      if (artistData.topTracks) {
        return artistData.topTracks.slice(0, limit);
      }

      // Otherwise, get tracks from albums
      const albums = artistData.albums || [];
      const tracks = [];

      for (const album of albums.slice(0, 3)) {
        if (tracks.length >= limit) break;

        try {
          const albumData = await this.getAlbumData(album.asin || album.id);
          if (albumData?.tracks) {
            tracks.push(...albumData.tracks);
          }
        } catch (e) {
          console.error('Error fetching album:', e?.message);
        }
      }

      return tracks.slice(0, limit);
    } catch (error) {
      console.error('Amazon get artist top songs error:', error?.response?.data || error?.message);
      return [];
    }
  }

  async getArtistAlbums(artist: Artist, limit = 10): Promise<any[]> {
    try {
      const artistData = await this.getArtistData(artist);

      if (!artistData) {
        // Fallback: search for albums by artist name
        const response = await axios.get(`${this.baseUrl}/search`, {
          params: { query: artist.name, type: 'album', limit },
          headers: this.getHeaders(),
          timeout: 10000
        });
        return response.data?.albums || response.data?.results?.albums || [];
      }

      // Return albums from artist data
      return (artistData.albums || []).slice(0, limit);
    } catch (error) {
      console.error('Amazon get artist albums error:', error?.response?.data || error?.message);
      return [];
    }
  }

  private async getAlbumData(albumId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/album`, {
        params: { id: albumId },
        headers: this.getHeaders(),
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Amazon get album error:', error?.response?.data || error?.message);
      return null;
    }
  }

  removeCachedDuplicateSongs(cachedArray: Song[], array2: any[]) {
    const cachedAsins = new Set(cachedArray.map(t => t.asin).filter(Boolean));
    const cachedKeys = new Set(
      cachedArray.map(t => `${t.title?.toLowerCase()}:${t.artistName?.toLowerCase()}`)
    );

    return array2?.filter((externalTrack) => {
      const key = `${(externalTrack.title || externalTrack.name)?.toLowerCase()}:${(externalTrack.artist?.name || externalTrack.artistName)?.toLowerCase()}`;
      const trackUrl = externalTrack.deeplink || externalTrack.link || externalTrack.url;
      const trackAsin = externalTrack.asin || externalTrack.id;

      return !cachedAsins.has(trackAsin)
        && !cachedKeys.has(key);
    });
  }

  removeCachedDuplicateArtists(cachedArray: Artist[], array2: any[]) {
    const cachedAsins = new Set(cachedArray.map(t => t.asin).filter(Boolean));
    const cachedNames = new Set(cachedArray.map(t => t.name?.toLowerCase()));

    return array2?.filter((externalArtist) => {
      const artistAsin = externalArtist.asin

      return !cachedAsins.has(artistAsin)
        && !cachedNames.has(externalArtist.name?.toLowerCase());
    });
  }


  removeCachedDuplicateAlbums(cachedArray: Album[], array2: any[]) {
    const cachedMBIDs = new Set(cachedArray.map(t => t.asin));
    const cachedNames = new Set(cachedArray.map(t => t.title));

    return array2?.filter((externalArtist) => {
      return !cachedMBIDs.has(externalArtist.asin)
        && !cachedNames.has(externalArtist.name);
    });
  }

}