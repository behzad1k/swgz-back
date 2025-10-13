# swgz Nestjs Backend
The backend for swgz streaming service

## Prerequisites

- Node.js 18 or higher
- sldl (slsk-batchdl) installed and accessible from command line
- A Soulseek account

## Installation

1. Clone this repository:
```bash
git clone <your-repo-url>
cd slsk-batchdl-api
```

2. Install dependencies:
```bash
npm install
```

3. Install slsk-batchdl:
    - Download from [releases](https://github.com/fiso64/slsk-batchdl/releases)
    - Add to your system PATH
    - Or use Docker (see Docker section)

4. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your settings
```

5. Create sldl configuration file (optional):
```bash
mkdir -p ~/.config/sldl
nano ~/.config/sldl/sldl.conf
```

Example `sldl.conf`:
```ini
username = your-username
password = your-password
pref-format = flac,mp3
fast-search = true
```

## Development

Run in development mode:
```bash
npm run dev
```

Build for production:
```bash
npm run build
npm start
```

## Project Structure

```
slsk-batchdl-api/
├── src/
│   ├── index.ts                 # Main server file
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   ├── routes/
│   │   ├── download.ts          # Download endpoints
│   │   ├── search.ts            # Search endpoints
│   │   ├── status.ts            # Status endpoints
│   │   └── config.ts            # Config endpoints
│   ├── services/
│   │   ├── downloadService.ts   # Download logic
│   │   ├── searchService.ts     # Search logic
│   │   ├── statusService.ts     # Job status management
│   │   └── configService.ts     # Config management
│   ├── middleware/
│   │   ├── validation.ts        # Request validation
│   │   ├── errorHandler.ts      # Error handling
│   │   └── logger.ts            # Request logging
│   └── utils/
│       └── commandBuilder.ts    # sldl command builder
├── package.json
├── tsconfig.json
└── .env.example
```

## API Documentation

### Base URL
```
http://localhost:3000/api
```

### Endpoints

#### 1. Download Track/Playlist
```http
POST /api/download
Content-Type: application/json

{
  "input": "Artist - Song Title",
  "prefFormat": "flac,mp3"
}
```

**Note:** If you have credentials in `sldl.conf`, you don't need to include `user` and `pass` in requests. The API automatically uses the config file at `SLDL_CONFIG_PATH` (or `config/sldl.conf` by default).

To override config file credentials for a specific request:
```http
{
  "input": "Artist - Song Title",
  "user": "different_username",
  "pass": "different_password"
}
```

Response:
```json
{
  "success": true,
  "jobId": "uuid",
  "message": "Download started",
  "statusUrl": "/api/status/uuid"
}
```

#### 2. Download Album
```http
POST /api/download/album
Content-Type: application/json

{
  "input": "Artist - Album Name",
  "user": "username",
  "pass": "password"
}
```

#### 3. Aggregate Download (All songs by artist)
```http
POST /api/download/aggregate
Content-Type: application/json

{
  "input": "artist=MC MENTAL",
  "user": "username",
  "pass": "password"
}
```

#### 4. Album Aggregate (All albums by artist)
```http
POST /api/download/album-aggregate
Content-Type: application/json

{
  "input": "artist=Artist Name",
  "interactive": false
}
```

#### 5. Search Without Download
```http
POST /api/search
Content-Type: application/json

{
  "input": "Song Title",
  "printType": "results"
}
```

Available printTypes:
- `tracks` - Print all tracks
- `tracks-full` - Extended track info
- `results` - Search results
- `results-full` - Full search results
- `json` - First result as JSON
- `json-all` - All results as JSON
- `link` - slsk:// link
- `index` - sldl index
- `index-failed` - Failed downloads

#### 6. Get Job Status
```http
GET /api/status/:jobId
```

Response:
```json
{
  "success": true,
  "status": {
    "id": "uuid",
    "status": "running",
    "startTime": "2025-01-01T00:00:00.000Z",
    "progress": 45,
    "currentTrack": 9,
    "totalTracks": 20,
    "output": ["..."]
  }
}
```

#### 7. Get All Jobs
```http
GET /api/status
```

#### 8. Cancel Download
```http
DELETE /api/download/:jobId
```

#### 9. Get Configuration
```http
GET /api/config
```

#### 10. Update Configuration
```http
PUT /api/config
Content-Type: application/json

{
  "username": "new-username",
  "pref-format": "flac"
}
```

### Common Options

All download endpoints accept these options:

**Authentication (Optional):**
- `user` - Soulseek username (overrides config file)
- `pass` - Soulseek password (overrides config file)
- `config` - Path to config file (default: `SLDL_CONFIG_PATH` env var or `config/sldl.conf`)
- `profile` - Config profile to use

**Note:** The API automatically loads credentials from your `sldl.conf` file. Only include `user`/`pass` in requests if you need to override the default credentials.

**Basic Options:**
- `path` - Download directory
- `inputType` - Input type: csv, youtube, spotify, bandcamp, string, list
- `nameFormat` - Name format template
- `number` - Max tracks to download
- `offset` - Skip first n tracks
- `reverse` - Download in reverse order

**Search Options:**
- `fastSearch` - Download as soon as match found
- `desperate` - Try harder to find tracks
- `removeFt` - Remove "feat." from searches
- `artistMaybeWrong` - Search without artist

**File Conditions:**
- `format` - Accepted formats (e.g., "mp3,flac")
- `lengthTol` - Length tolerance in seconds
- `minBitrate` / `maxBitrate` - Bitrate range
- `minSamplerate` / `maxSamplerate` - Sample rate range
- `strictTitle` / `strictArtist` / `strictAlbum` - Path must contain field

**Preferred Conditions:**
- `prefFormat` - Preferred formats (default: "mp3")
- `prefLengthTol` - Preferred length tolerance (default: 3)
- `prefMinBitrate` - Preferred min bitrate (default: 200)
- `prefMaxBitrate` - Preferred max bitrate (default: 2500)

**Album Options:**
- `albumTrackCount` - Required track count (e.g., "5+")
- `albumArt` - Album art retrieval: default, largest, most
- `albumArtOnly` - Only download album art
- `albumParallelSearch` - Search albums in parallel

**Spotify Options:**
- `spotifyId` - Spotify client ID
- `spotifySecret` - Spotify client secret
- `spotifyToken` - Spotify access token
- `spotifyRefresh` - Spotify refresh token
- `removeFromSource` - Remove from source playlist

**YouTube Options:**
- `youtubeKey` - YouTube API key
- `getDeleted` - Try to get deleted video titles
- `deletedOnly` - Only download deleted videos

**Advanced:**
- `concurrentDownloads` - Max concurrent downloads
- `searchTimeout` - Search timeout in ms
- `maxStaleTime` - Max time without progress
- `ytDlp` - Use yt-dlp as fallback
- `onComplete` - Command to run on completion
- `config` - Config file path
- `profile` - Config profile to use

## Examples

### Download a Spotify Playlist
```bash
curl -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{
    "input": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    "inputType": "spotify",
    "spotifyId": "your-client-id",
    "spotifySecret": "your-client-secret"
  }'
```

**Note:** Credentials come from your `sldl.conf` file automatically.

### Download Album in FLAC
```bash
curl -X POST http://localhost:3000/api/download/album \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Pink Floyd - Dark Side of the Moon",
    "prefFormat": "flac",
    "albumTrackCount": "9+"
  }'
```

### Search for a Song
```bash
curl -X POST http://localhost:3000/api/search/json \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Radiohead - Creep",
    "all": true
  }'
```

### Download from YouTube with fallback
```bash
curl -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{
    "input": "https://youtube.com/playlist?list=PLxx...",
    "inputType": "youtube",
    "ytDlp": true,
    "getDeleted": true
  }'
```

### Check Download Status
```bash
curl http://localhost:3000/api/status/your-job-id
```

### Download All Albums by Artist
```bash
curl -X POST http://localhost:3000/api/download/album-aggregate \
  -H "Content-Type: application/json" \
  -d '{
    "input": "artist=Daft Punk",
    "minSharesAggregate": 3
  }'
```

## Linux Server Deployment

### Option 1: Using systemd

1. Create a service file:
```bash
sudo nano /etc/systemd/system/slsk-api.service
```

2. Add the following content:
```ini
[Unit]
Description=slsk-batchdl API Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/slsk-batchdl-api
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /path/to/slsk-batchdl-api/dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable slsk-api
sudo systemctl start slsk-api
sudo systemctl status slsk-api
```

4. View logs:
```bash
sudo journalctl -u slsk-api -f
```

### Option 2: Using PM2

1. Install PM2:
```bash
npm install -g pm2
```

2. Start the application:
```bash
pm2 start dist/index.js --name slsk-api
pm2 save
pm2 startup
```

3. Manage the application:
```bash
pm2 status
pm2 logs slsk-api
pm2 restart slsk-api
pm2 stop slsk-api
```

### Option 3: Using Docker

1. Create a Dockerfile:
```dockerfile
FROM node:18-alpine

# Install sldl
RUN apk add --no-cache wget unzip \
    && wget https://github.com/fiso64/slsk-batchdl/releases/latest/download/sldl-linux-x64.zip \
    && unzip sldl-linux-x64.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/sldl \
    && rm sldl-linux-x64.zip

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

2. Create docker-compose.yml:
```yaml
version: '3.8'

services:
  slsk-api:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./downloads:/downloads
      - ./config:/config
    environment:
      - PORT=3000
      - OUTPUT_DIR=/downloads
      - SLDL_CONFIG_PATH=/config/sldl.conf
    restart: unless-stopped
```

3. Run with Docker Compose:
```bash
docker-compose up -d
docker-compose logs -f
```

### Nginx Reverse Proxy

1. Install Nginx:
```bash
sudo apt update
sudo apt install nginx
```

2. Create Nginx configuration:
```bash
sudo nano /etc/nginx/sites-available/slsk-api
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/slsk-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

4. Optional: Add SSL with Let's Encrypt:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Security Considerations

1. **Authentication**: This API doesn't include built-in authentication. Consider:
    - Adding API key authentication
    - Using OAuth2
    - Placing behind VPN or firewall
    - Using Nginx basic auth

2. **Rate Limiting**: Implement rate limiting to prevent abuse:
```bash
npm install express-rate-limit
```

3. **Input Validation**: All inputs are validated, but always sanitize user input

4. **HTTPS**: Always use HTTPS in production

5. **Environment Variables**: Never commit `.env` file to version control

## Troubleshooting

### sldl command not found
- Ensure sldl is installed and in your PATH
- Try specifying full path in the spawn command

### Downloads not starting
- Check Soulseek credentials in config
- Verify network connectivity
- Check sldl logs with `--verbose` option

### Permission errors
- Ensure output directory is writable
- Check user permissions for systemd service

### High memory usage
- Limit concurrent downloads
- Clear old job data periodically

## API Response Codes

- `200` - Success
- `202` - Accepted (download started)
- `400` - Bad Request (validation error)
- `404` - Not Found
- `500` - Internal Server Error

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - See LICENSE file for details

## Credits

- [slsk-batchdl](https://github.com/fiso64/slsk-batchdl) by fiso64
- Built with Express.js and TypeScript

## Support

For issues with:
- This API wrapper: Open an issue on this repository
- slsk-batchdl itself: See the [original repository](https://github.com/fiso64/slsk-batchdl)