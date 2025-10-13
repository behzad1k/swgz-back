import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SearchFilter } from '../../types';

@Injectable()
export class DiscogsService {
  private discogsConsumerKey = process.env.DISCOGS_CONSUMER_KEY;
  private discogsConsumerSecret = process.env.DISCOGS_CONSUMER_SECRET;

  async search(query: string, filter: SearchFilter = null, limit: number = 10) {
    try {
      const params: any = {
        key: this.discogsConsumerKey,
        secret: this.discogsConsumerSecret,
        q: query,
        per_page: limit,
      }

      switch (filter) {
        case 'album':
          params['format'] = 'album';
          break;
        case 'track':
          params['format'] = 'single';
          break;
        case 'artist':
          params['type'] = 'artist';
          break;
      }

      const response = await axios.get('https://api.discogs.com/database/search', {
        params
      });

      return response.data.results || []
    } catch (error) {
      return [];
    }
  }
}