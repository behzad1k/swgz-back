import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { SearchFilter } from '../../types';
import { DiscogsService } from './discogs.service';
import { PlayHistory } from '../library/entities/play-history.entity';
import { Song } from './entities/song.entity';
import { SearchHistory } from './entities/search-history.entity';
import { User } from '../users/entities/user.entity';
import { LastfmService } from './lastfm.service';
import { SlskService } from './slsk.service';
import { SwagzService, SwagzAction } from '../swagz/swagz.service';

@Injectable()
export class ArtistService {
  constructor(
    @InjectRepository(Song)
    private songRepository: Repository<Song>,
    private lastFMService: LastfmService,
  ) {}


}