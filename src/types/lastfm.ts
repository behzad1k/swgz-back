namespace LastFM {
  export interface Track {
    name:	string
    artist:	string
    url:	string
    streamable:	boolean
    listeners: number
    image: Image[]
    mbid:	string
  }

  export interface Image {
    "#text":	string
    size:	string
  }

  export interface Album {
    id: number
    name:	string
    artist:	string
    url:	string
    image: Image[]
  }

  export interface Artist {
    name:	string
    url:	string
    streamable:	boolean
    listeners: number
    image_small: Image
    image: Image
    mbid:	string
  }
}