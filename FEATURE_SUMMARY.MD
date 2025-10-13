# Complete Feature List

## 🎵 Core Music Features

### Search & Discovery
- ✅ Search music via SLSK network
- ✅ Automatic metadata enrichment (Last.fm API)
- ✅ Album covers, duration, album info
- ✅ Track search history
- ✅ FLAC availability check (Premium only)

### Streaming & Downloads
- ✅ Stream music from search results
- ✅ Download to library (auto-download when added)
- ✅ Free: MP3 quality only
- ✅ Premium: FLAC quality support
- ✅ Download queue management
- ✅ Progress tracking

### Personal Library
- ✅ Free: Max 100 songs
- ✅ Premium: Unlimited songs
- ✅ Like/unlike songs
- ✅ Downloaded songs tracking
- ✅ Recently played
- ✅ Most listened statistics

### Playlists
- ✅ Free: Max 3 playlists
- ✅ Premium: Unlimited playlists
- ✅ Create, edit, delete playlists
- ✅ Add/remove songs from playlists
- ✅ Reorder songs (position-based)
- ✅ Import from Spotify (Premium only)
- ✅ Import from YouTube (Premium only)
- ✅ Track playlist source (user/spotify/youtube)

---

## 👥 Social Features

### Comments System
- ✅ Comment on any song (all plans)
- ✅ Reply to comments (threaded)
- ✅ Edit/delete own comments
- ✅ Comment counts per song
- ✅ View all comments on profile
- ✅ +3 swagz per comment

### Stalker/Following System
- ✅ "Stalk" users (follow)
- ✅ "Unstalk" users (unfollow)
- ✅ View stalkers (followers)
- ✅ View stalkings (following)
- ✅ Stalker/stalking counts
- ✅ Privacy controls

### Reposts
- ✅ Repost songs to profile
- ✅ Remove reposts
- ✅ View user's reposts
- ✅ Repost counts per song
- ✅ +5 swagz per repost

### Activity Feed
- ✅ Homepage feed of stalking's activity
- ✅ See likes from stalkings
- ✅ See comments from stalkings
- ✅ See reposts from stalkings
- ✅ Chronological feed
- ✅ Pagination support

### User Profiles
- ✅ Public/private profiles
- ✅ Custom username
- ✅ Bio
- ✅ Avatar URL
- ✅ Swagz display
- ✅ Subscription plan display
- ✅ Stalker/stalking counts
- ✅ Activity timeline (likes, comments, reposts)
- ✅ Privacy: Only stalkers can view private profiles

### Like System
- ✅ Like songs (via library)
- ✅ Like counts per song
- ✅ View all liked songs
- ✅ Like activity in feed
- ✅ +2 swagz per like

---

## 🏆 Swagz Scoring System

### Earning Swagz
| Action | Swagz Earned |
|--------|--------------|
| Stream a song | +1 |
| Like a song | +2 |
| Comment on song | +3 |
| Repost a song | +5 |
| Daily login | +10 |

### Using Swagz
- ✅ View swagz balance
- ✅ **Upgrade to Premium for 1000 swagz**
- ✅ Permanent premium (no expiration)
- ✅ Alternative to paid subscription

---

## 🔐 Authentication & Authorization

### Sign Up / Login
- ✅ Email/password registration
- ✅ Email confirmation required
- ✅ Google OAuth login
- ✅ JWT tokens for web
- ✅ API keys for mobile/apps
- ✅ Password reset (infrastructure ready)

### Authorization
- ✅ Role-based access (User, Admin)
- ✅ Subscription-based features (Free, Premium)
- ✅ Route guards for premium features
- ✅ Profile privacy controls

---

## 💎 Subscription Plans

### Free Plan
- ✅ Search & stream music
- ✅ Max 100 songs in library
- ✅ Max 3 playlists
- ✅ MP3 quality only
- ✅ Auto-download when added to library
- ✅ All social features (comment, repost, stalk)
- ✅ Earn swagz
- ✅ Can upgrade with 1000 swagz
- ❌ No FLAC support
- ❌ No playlist imports

### Premium Plan
- ✅ All Free plan features
- ✅ **Unlimited** songs in library
- ✅ **Unlimited** playlists
- ✅ **FLAC quality** support
- ✅ Import from Spotify
- ✅ Import from YouTube
- ✅ Check FLAC availability endpoint
- ✅ Premium badge on profile

### Getting Premium
1. **Admin upgrade** - Super admin can upgrade any user
2. **Swagz upgrade** - Earn 1000 swagz and upgrade yourself
3. Both methods give permanent premium (no expiration)

---

## 👨‍💼 Admin Panel

### User Management
- ✅ View all users (paginated)
- ✅ Search users by email
- ✅ View user details (with playlists, library)
- ✅ Upgrade user to premium
- ✅ Downgrade user to free
- ✅ Set premium expiration date
- ✅ Delete users

### Platform Statistics
- ✅ Total users
- ✅ Premium users count
- ✅ Free users count
- ✅ Confirmed users
- ✅ Unconfirmed users

### Default Super Admin
- Email: `admin@swgz.com`
- Password: `SuperAdmin@2025`
- Role: ADMIN
- Plan: Premium
- **Change password immediately!**

---

## 🛠️ Technical Features

### Database
- ✅ MySQL 8.0+
- ✅ TypeORM for ORM
- ✅ Auto migrations (dev)
- ✅ Entity relationships
- ✅ Indexes for performance

### API Design
- ✅ RESTful endpoints
- ✅ Consistent response format
- ✅ Pagination support
- ✅ Error handling
- ✅ Request validation
- ✅ CORS enabled

### Security
- ✅ Password hashing (bcrypt)
- ✅ JWT secrets
- ✅ API key authentication
- ✅ Role-based guards
- ✅ Subscription guards
- ✅ Input validation
- ✅ SQL injection protection (TypeORM)

### Performance
- ✅ Download queue management
- ✅ Concurrent download limits
- ✅ Metadata caching
- ✅ Database indexing
- ✅ Pagination for large datasets

### Scheduled Tasks
- ✅ Daily subscription expiration check
- ✅ Auto-downgrade expired premium users
- ✅ Cron job support (NestJS Schedule)

### Email System
- ✅ Email confirmation
- ✅ SMTP integration
- ✅ Gmail support
- ✅ Customizable templates

### Third-party Integrations
- ✅ SLSK network (slsk-batchdl)
- ✅ Last.fm API (metadata)
- ✅ Spotify API (playlist import)
- ✅ YouTube API (playlist import)
- ✅ Google OAuth

---

## 📱 Client App Features (Your Implementation)

The API supports these features for your client:

### Homepage
- Show activity feed from stalkings
- Display trending songs (most liked/played)
- Swagz balance widget
- Quick access to library

### Music Player
- Stream songs
- Record play history (earn swagz)
- Like/unlike (earn swagz)
- Comment (earn swagz)
- Repost (earn swagz)
- View song stats (likes, comments, reposts)

### Profile Pages
- View own profile
- Edit profile (username, bio, avatar, privacy)
- View other user profiles (respects privacy)
- See user's likes, comments, reposts
- Stalker/stalking lists

### Discovery
- Search music
- Search users
- Browse by genre/artist (via search)
- See what's popular (like counts)

### Social
- Comment threads on songs
- Activity feed
- User profiles
- Stalk/unstalk
- Repost system

---

## 🚀 Deployment Ready

### Docker Support
- ✅ Dockerfile included
- ✅ docker-compose.yml
- ✅ MySQL container
- ✅ Volume management

### Production Options
- ✅ PM2 support
- ✅ SystemD service
- ✅ Nginx reverse proxy config
- ✅ SSL/HTTPS ready
- ✅ Environment variables

### Monitoring
- ✅ Health check endpoint
- ✅ Logging system
- ✅ Error tracking
- ✅ Database connection pooling

---

## 📊 Data Tracking

### User Analytics
- Search queries
- Play history
- Most listened songs
- Recent activity
- Swagz earnings history

### Song Analytics
- Play counts
- Like counts
- Comment counts
- Repost counts
- FLAC availability

### Platform Analytics
- Total users
- Premium conversion rate
- Average swagz per user
- Most popular songs
- User engagement metrics

---

## 🔄 API Response Formats

### Success Response
```json
{
  "id": "...",
  "data": {...},
  "message": "Success"
}
```

### Error Response
```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request"
}
```

### Paginated Response
```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "totalPages": 10
}
```

---

## 🎯 Use Cases

### New User Journey
1. Sign up with email
2. Confirm email
3. Login (get JWT + API key)
4. Search for music
5. Stream songs (earn swagz)
6. Like songs (earn swagz)
7. Add to library (auto-download)
8. Create playlist
9. Comment on songs (earn swagz)
10. Stalk other users
11. See activity feed
12. Earn 1000 swagz
13. Upgrade to premium!

### Premium User Benefits
1. Unlimited library & playlists
2. FLAC quality downloads
3. Import Spotify playlists
4. Import YouTube playlists
5. Premium badge on profile
6. Check FLAC availability
7. All social features

### Social Engagement
1. Discover song
2. Like it (visible on profile)
3. Comment with thoughts
4. Repost to followers
5. Stalk the artist's fans
6. See what they're listening to
7. Engage with their activity

---

## 📝 Future Enhancement Ideas

These features are NOT implemented but could be added:

- Direct messaging between users
- Group playlists (collaborative)
- Music recommendations based on taste
- Badges/achievements system
- Swagz leaderboard
- User-generated playlists discovery
- Song statistics (play graphs)
- Export library to Spotify
- Mobile push notifications
- Real-time activity notifications
- Playlist sharing via link
- Embedded player widget
- API rate limiting
- User blocking feature
- Report inappropriate content
- Moderator role
- Premium subscription via payment gateway