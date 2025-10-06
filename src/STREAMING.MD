# Music Streaming Documentation

## How Streaming Works

The application uses an **intelligent streaming system** that downloads and streams simultaneously, providing instant playback without waiting for full downloads.

### Architecture

```
Client Request
     ↓
StreamingService
     ↓
┌────────────────┐
│ Check Cache    │ → If cached: Stream immediately
└────────────────┘
     ↓ Not cached
┌────────────────┐
│ Check Library  │ → If downloaded: Stream from library
└────────────────┘
     ↓ Not in library
┌────────────────┐
│ Stream from    │
│ SLDL Download  │
└────────────────┘
     ↓
Start sldl download → Write to temp file
     ↓
After 256KB buffered → Start streaming to client
     ↓
Continue writing to temp + streaming to client simultaneously
     ↓
Download complete → Cache file for 1 hour
```

## Streaming Endpoint

### Stream a Song

```http
GET /api/music/stream/:songId?flac=true
X-API-Key: your-api-key
```

**Query Parameters:**
- `flac` (optional, boolean) - Request FLAC quality (Premium only)

**Response:**
- Content-Type: `audio/mpeg` or `audio/flac`
- Transfer-Encoding: `chunked` (for live streaming)
- Audio stream data

**Example:**
```bash
# Stream MP3 (Free/Premium)
curl http://localhost:3000/api/music/stream/song-uuid \
  -H "X-API-Key: your-api-key" \
  --output song.mp3

# Stream FLAC (Premium only)
curl http://localhost:3000/api/music/stream/song-uuid?flac=true \
  -H "X-API-Key: your-api-key" \
  --output song.flac
```

## Key Features

### 1. Instant Playback
- Starts streaming after buffering only **256KB** (~2 seconds of audio)
- No need to wait for full download
- Progressive streaming as download continues

### 2. Smart Caching
- **First playback**: Stream while downloading
- **Subsequent playbacks**: Stream from cached file instantly
- Cache expires after 1 hour
- Automatic cleanup to save disk space

### 3. Multiple Source Priority
1. **Memory cache** - Fastest (if recently played)
2. **User library** - Fast (if song in library)
3. **Live download** - Stream while downloading from SLSK

### 4. Quality Options
- **Free users**: MP3 only
- **Premium users**: FLAC or MP3
- Automatic fallback to MP3 if FLAC unavailable

### 5. Concurrent Handling
- Prevents duplicate downloads of same song
- Returns error if song already being downloaded
- Multiple users can stream different songs simultaneously

## Client Implementation

### HTML5 Audio Player

```html
<audio id="player" controls>
  <source 
    src="http://localhost:3000/api/music/stream/song-uuid" 
    type="audio/mpeg">
</audio>

<script>
const player = document.getElementById('player');
const apiKey = 'your-api-key';

function playSong(songId, preferFlac = false) {
  const url = `http://localhost:3000/api/music/stream/${songId}${preferFlac ? '?flac=true' : ''}`;
  
  fetch(url, {
    headers: { 'X-API-Key': apiKey }
  })
    .then(response => response.blob())
    .then(blob => {
      const audioUrl = URL.createObjectURL(blob);
      player.src = audioUrl;
      player.play();
      
      // Record play
      fetch(`http://localhost:3000/api/music/play/${songId}`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey }
      });
    });
}
</script>
```

### React Native

```javascript
import { Audio } from 'expo-av';

async function playSong(songId, apiKey, preferFlac = false) {
  const url = `${API_URL}/music/stream/${songId}${preferFlac ? '?flac=true' : ''}`;
  
  const { sound } = await Audio.Sound.createAsync(
    { 
      uri: url,
      headers: { 'X-API-Key': apiKey }
    },
    { shouldPlay: true }
  );
  
  // Record play
  await fetch(`${API_URL}/music/play/${songId}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey }
  });
  
  return sound;
}
```

### JavaScript Fetch API

```javascript
async function streamSong(songId, apiKey) {
  const response = await fetch(
    `http://localhost:3000/api/music/stream/${songId}`,
    {
      headers: { 'X-API-Key': apiKey }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to stream song');
  }
  
  // Get the stream
  const reader = response.body.getReader();
  const chunks = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  // Create blob and play
  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  
  const audio = new Audio(url);
  audio.play();
  
  // Don't forget to record the play
  await fetch(`http://localhost:3000/api/music/play/${songId}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey }
  });
}
```

## Performance Characteristics

### Buffering
- **Buffer size**: 256KB before streaming starts
- **Typical wait time**: 2-5 seconds depending on connection
- **Continuous buffering**: As download progresses

### Cache Management
- **Cache duration**: 1 hour per song
- **Auto-cleanup**: Runs after cache expiration
- **Storage**: Temp directory (`temp/streams/`)

### Network Usage
- **Download once**: Cache shared across requests
- **Bandwidth**: Optimized by caching
- **Concurrent streams**: Supported for different songs

## Error Handling

### Common Errors

**403 Forbidden:**
```json
{
  "error": "FLAC streaming requires premium subscription"
}
```

**404 Not Found:**
```json
{
  "error": "Song not found on network"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Failed to stream song"
}
```

**409 Conflict:**
```json
{
  "error": "Download already in progress"
}
```

### Retry Logic

```javascript
async function streamWithRetry(songId, apiKey, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await streamSong(songId, apiKey);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
```

## Advanced Usage

### Preloading Next Song

```javascript
class MusicPlayer {
  currentSong = null;
  nextSongPreloaded = null;
  
  async playQueue(queue, apiKey) {
    for (let i = 0; i < queue.length; i++) {
      const song = queue[i];
      
      // Preload next song
      if (i + 1 < queue.length) {
        this.preloadSong(queue[i + 1].id, apiKey);
      }
      
      await this.playSong(song.id, apiKey);
    }
  }
  
  async preloadSong(songId, apiKey) {
    // Start streaming in background (browser will cache)
    fetch(`${API_URL}/music/stream/${songId}`, {
      headers: { 'X-API-Key': apiKey }
    });
  }
}
```

### Quality Switching

```javascript
async function playWithQualitySwitching(songId, apiKey, user) {
  let preferFlac = user.subscriptionPlan === 'premium';
  
  try {
    // Try FLAC first for premium users
    if (preferFlac) {
      return await playSong(songId, apiKey, true);
    }
  } catch (error) {
    console.log('FLAC unavailable, falling back to MP3');
  }
  
  // Fallback to MP3
  return await playSong(songId, apiKey, false);
}
```

## Production Considerations

### CDN Integration

For production, consider serving streams through a CDN:

```javascript
// Proxy through CDN
const cdnUrl = `https://cdn.yourdomain.com/stream/${songId}`;
// CDN forwards to: https://api.yourdomain.com/music/stream/${songId}
```

### Load Balancing

```nginx
upstream streaming_backend {
  least_conn;
  server api1.yourdomain.com:3000;
  server api2.yourdomain.com:3000;
  server api3.yourdomain.com:3000;
}

location /api/music/stream {
  proxy_pass http://streaming_backend;
  proxy_buffering off;
  proxy_cache_bypass $http_upgrade;
}
```

### Monitoring

```javascript
// Log streaming metrics
class StreamingMetrics {
  trackStream(songId, userId, quality, bufferTime) {
    // Send to analytics
    analytics.track('song_streamed', {
      songId,
      userId,
      quality,
      bufferTime,
      timestamp: new Date()
    });
  }
}
```

## Troubleshooting

### Slow Buffering
- Check SLSK network connection
- Verify server bandwidth
- Consider increasing `BUFFER_THRESHOLD`

### Cache Not Working
- Check `temp/streams/` directory permissions
- Verify disk space available
- Check `STREAM_TEMP_DIR` environment variable

### FLAC Not Streaming
- Verify user has premium subscription
- Check if FLAC available on network
- Falls back to MP3 automatically

## Configuration

### Environment Variables

```bash
# Streaming temp directory
STREAM_TEMP_DIR=temp/streams

# Optional: Adjust buffer threshold (in bytes)
STREAM_BUFFER_THRESHOLD=262144  # 256KB

# Optional: Cache duration (in milliseconds)
STREAM_CACHE_DURATION=3600000   # 1 hour
```

### Customizing Buffer Threshold

Edit `streaming.service.ts`:

```typescript
const BUFFER_THRESHOLD = 512 * 1024; // Increase to 512KB for slower connections
```

## FAQ

**Q: Does streaming count towards play history?**  
A: Yes, call `/api/music/play/:id` after starting stream.

**Q: Can multiple users stream the same song?**  
A: Yes, cached file is shared across all users.

**Q: What happens if download fails mid-stream?**  
A: Stream ends, client receives incomplete data. Implement retry logic.

**Q: How much disk space is needed?**  
A: Depends on cache size. Average song: 3-10MB. Cache auto-cleans after 1 hour.

**Q: Can I disable caching?**  
A: Yes, modify `StreamingService` to skip cache storage.

**Q: Is seeking/skipping supported?**  
A: Yes for cached files via byte ranges. Not supported during live download.

## Summary

✅ **Instant streaming** - 2-5 second buffer time  
✅ **Simultaneous download** - No full download wait  
✅ **Smart caching** - Faster subsequent plays  
✅ **Quality options** - MP3/FLAC based on subscription  
✅ **Resource efficient** - Auto-cleanup, shared cache  
✅ **Production ready** - Error handling, concurrent support