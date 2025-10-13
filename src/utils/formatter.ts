import { Song } from '../modules/music/entities/song.entity';

export const formatSldlInputStr = (song: Partial<Song>) => `${song.title ? `title=${song.title}, ` : ''}${song.artistName ? `artist=${song.artistName}, ` : ''}${song.albumName ? `album=${song.albumName}` : ''}`