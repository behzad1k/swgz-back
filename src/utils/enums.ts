export enum EXTERNAL_SOURCES {
  lastFM = 'lastFM',
  discogs = 'discogs',
  sldl = 'sldl',
}

export enum SEARCH_FILTERS {
  all = 'all',
  album = 'album',
  artist = 'artist',
  track = 'track',
}

export enum TaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum TaskType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}