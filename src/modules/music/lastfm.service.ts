import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { applyMapping, EXTERNAL_MAPPINGS } from '../../config/mapping.config';
import { SearchFilter } from '../../types';
import { SEARCH_FILTERS } from '../../utils/enums';
import { Artist } from './entities/artist.entity';
import { Song } from './entities/song.entity';
import Track = LastFM.Track;

@Injectable()
export class LastfmService {
  private lastFmApiKey = process.env.LASTFM_API_KEY;

  async formatResult(result: any, filter: SEARCH_FILTERS, key: string = 'albumCover'): Promise<any> {
    try {
      const fetchResult = await Promise.all(result.map(obj =>
        axios.get(obj.url, {
          timeout: 5000,
          maxRedirects: 3,
          headers: { 'User-Agent': 'Mozilla/5.0' } // Some sites require this
        })
      ));
      fetchResult.map((data, index) => {
        const coverRegex = /<meta[^>]*(?:property|name)=["'](og:)(image)["'][^>]*content=["']([^"']+)["'][^>]*>/gi.exec(data.data);
        if (filter == SEARCH_FILTERS.track) {
          const albumNameRegex = (/<a[^>]*class="link-block-target"[^>]*>([^<]+)<\/a>/gi).exec(data.data);
          const durationRegex = (/<dd[^>]*class="catalogue-metadata-description"[^>]*>([^<]+)<\/dd>/gi).exec(data.data);
          if (albumNameRegex && albumNameRegex[1]) result[index]['albumName'] = albumNameRegex[1];
          if (durationRegex && durationRegex[1]) {
            const duration = durationRegex[1].trim().split(':');
            let finalDuration = parseInt(duration[duration.length - 2].substring(duration[duration.length - 2].length - 2)) * 60 + parseInt(duration[duration.length - 1]);
            if (duration.length > 2) {
              finalDuration = finalDuration + (parseInt(duration[0]) * 3600);
            }
            result[index]['duration'] = finalDuration;
          }
        }
        if (coverRegex && coverRegex[3]) result[index][key] = coverRegex[3];
        result[index] = applyMapping<Track>(result[index], EXTERNAL_MAPPINGS.lastFM[filter]);
      });
    } catch (e) {
      console.log(e?.message);
      console.log(e?.response?.data);
    }
    return result;
  }

  async trackSearch(query: string, limit = 10): Promise<LastFM.Track[]> {
    const result = await this.search(query, SEARCH_FILTERS.track, limit);
    return result.trackmatches.track;
  }

  async albumSearch(query: string, limit = 10): Promise<LastFM.Album[]> {
    const result = await this.search(query, SEARCH_FILTERS.album, limit);
    return result.albummatches.album;
  }

  async artistSearch(query: string, limit = 30): Promise<LastFM.Artist[]> {
    const result = await this.search(query, SEARCH_FILTERS.artist, limit);
    return result.artistmatches.artist;
  }

  private async search(query: string, filter: SearchFilter, limit: number) {
    try {
      const params = {
        method: `${filter}.search`,
        api_key: this.lastFmApiKey,
        format: 'json',
        limit
      };
      params[filter] = query;
      const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
        params
      });

      return response.data.results || [];
    } catch (error) {
      return [];
    }
  }

  async getArtistData(artist: Artist): Promise<Artist> {
    const params: any = {
      method: 'artist.getinfo',
      api_key: this.lastFmApiKey,
      format: 'json',
      artist: artist.name,
    };
    if (artist.mbid) params.mbid = artist.mbid;
    const response = await axios.get('http://ws.audioscrobbler.com/2.0/', { params });
    return response.data.artist;
  }

  async getSimilarTracks(song: Song, limit = 5): Promise<Song[]> {
    const params: any = {
      method: 'track.getsimilar',
      api_key: this.lastFmApiKey,
      format: 'json',
      track: song.title,
      artist: song.artistName,
      limit
    };
    if (song.mbid) {
      params.mbid = song.mbid;
    }
    const response = await axios.get('http://ws.audioscrobbler.com/2.0/', { params });
    console.log(response.data);
    return response.data.similartracks.track;
  }

  removeCachedDuplicateSongs(cachedArray: Song[], array2: any[]) {
    const cachedLinks = new Set(cachedArray.map(t => t.lastFMLink));
    const cachedMBIDs = new Set(cachedArray.map(t => t.mbid));
    const cachedKeys = new Set(
      cachedArray.map(t => `${t.title.toLowerCase()}:${t.artistName.toLowerCase()}`)
    );

    return array2.filter((externalTrack) => {
      const key = `${externalTrack.name.toLowerCase()}:${(externalTrack.artist || externalTrack.artist?.name).toString()?.toLowerCase()}`;
      return !cachedLinks.has(externalTrack.url)
        && !cachedMBIDs.has(externalTrack.mbid)
        && !cachedKeys.has(key);
    });
  }

  removeCachedDuplicateArtists(cachedArray: Artist[], array2: any[]) {
    const cachedLinks = new Set(cachedArray.map(t => t.lastFMLink));
    const cachedMBIDs = new Set(cachedArray.map(t => t.mbid));
    const cachedNames = new Set(cachedArray.map(t => t.name));

    return array2.filter((externalArtist) => {
      return !cachedLinks.has(externalArtist.url)
        && !cachedMBIDs.has(externalArtist.mbid)
        && !cachedNames.has(externalArtist.name);
    });
  }
}