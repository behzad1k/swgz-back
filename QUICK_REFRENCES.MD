# Quick Reference Guide

## 🎬 Getting Started in 5 Minutes

```bash
# 1. Setup database
mysql -u root -p
CREATE DATABASE slsk_music;

# 2. Clone and install
git clone <repo>
cd swgz-api
npm install

# 3. Configure
cp .env.example .env
# Edit .env with database credentials

# 4. Create sldl config
mkdir config
echo "username = your_slsk_user" > config/sldl.conf
echo "password = your_slsk_pass" >> config/sldl.conf

# 5. Create admin
npm run seed

# 6. Start
npm run start:dev
```

**Default Admin:** `admin@swgz.com` / `SuperAdmin@2025`

---

## 📌 Essential Endpoints

### Auth
```
POST /api/auth/signup              # Register
GET  /api/auth/confirm-email       # Confirm email
POST /api/auth/login               # Login
GET  /api/auth/google              # OAuth
```

### Music
```
GET  /api/music/search?q=query     # Search songs
POST /api/music/play/:id           # Record play (+1 swagz)
GET  /api/music/recently-played    # History
GET  /api/music/most-listened      # Stats
```

### Library
```
GET  /api/library                  # Get library
POST /api/library/add              # Add song (+2 swagz if liked)
POST /api/library/like/:id         # Toggle like
GET  /api/library/liked            # Liked songs
```

### Playlists
```
GET  /api/playlists                # User's playlists
POST /api/playlists                # Create
POST /api/playlists/:id/songs      # Add song
POST /api/playlists/import/spotify # Import (Premium)
```

### Social
```
POST /api/social/stalk/:userId     # Follow
POST /api/social/repost/:songId    # Repost (+5 swagz)
GET  /api/social/feed              # Activity feed
GET  /api/social/stalkers          # Followers
GET  /api/social/stalkings         # Following
```

### Comments
```
POST /api/comments                 # Create (+3 swagz)
GET  /api/comments/song/:id        # Get comments
PUT  /api/comments/:id             # Edit
DELETE /api/comments/:id           # Delete
```

### Profile
```
GET  /api/profile/:username        # View profile
PUT  /api/profile/me               # Update own
GET  /api/profile/search?q=user    # Search users
```

### Swagz
```
GET  /api/swagz/balance            # Check swagz
POST /api/swagz/upgrade-premium    # Upgrade (1000 swagz)
```

### Admin
```
GET  /api/admin/users              # All users
PUT  /api/admin/users/:id/upgrade  # Upgrade to premium
GET  /api/admin/stats              # Platform stats
```

---

## 🔑 Authentication Headers

**JWT (for web):**
```
Authorization: Bearer <jwt-token>
```

**API Key (for mobile/apps):**
```
X-API-Key: <api-key>
```

Both work on all protected endpoints!

---

## 💰 Swagz System

| Action | Swagz |
|--------|-------|
| Stream | +1 |
| Like | +2 |
| Comment | +3 |
| Repost | +5 |
| Login Daily | +10 |
| **Upgrade to Premium** | **-1000** |

---

## 📦 Subscription Limits

| Feature | Free | Premium |
|---------|------|---------|
| Library songs | 100 | ∞ |
| Playlists | 3 | ∞ |
| Quality | MP3 | FLAC |
| Imports | ✗ | ✓ |
| Comments | ✓ | ✓ |
| Social | ✓ | ✓ |

---

## 🗄️ Database Tables

```
users              # Accounts + swagz
songs              # Music metadata + counts
library_songs      # User's library
playlists          # User playlists
playlist_songs     # Playlist contents
comments           # Song comments
stalkers           # Follow relationships
reposts            # User reposts
activities         # Activity feed
search_history     # Search tracking
play_history       # Play tracking
```

---

## 🐛 Common Issues

**Can't login after signup:**
- Check email confirmation
- Look for confirmation link in email

**Downloads failing:**
- Verify sldl.conf credentials
- Test: `sldl "test" --print results`

**Database errors:**
- Check MySQL is running
- Verify .env credentials
- Check port 3306 is open

**Email not sending:**
- Configure SMTP in .env
- For Gmail: use App Password

---

## 📞 Testing with cURL

**Register:**
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

**Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

**Search Music:**
```bash
curl http://localhost:3000/api/music/search?q=daft+punk \
  -H "X-API-Key: your-api-key"
```

**Like a Song:**
```bash
curl -X POST http://localhost:3000/api/library/like/song-uuid \
  -H "X-API-Key: your-api-key"
```

**Get Feed:**
```bash
curl http://localhost:3000/api/social/feed \
  -H "X-API-Key: your-api-key"
```

---

## 🎨 Module Structure

```
src/
├── modules/
│   ├── auth/           # Login, OAuth, JWT
│   ├── users/          # User entity
│   ├── music/          # Search, SLSK, metadata
│   ├── library/        # User library
│   ├── playlist/       # Playlists + imports
│   ├── download/       # Download queue
│   ├── comments/       # Comments system
│   ├── social/         # Stalker, reposts, feed
│   ├── profile/        # User profiles
│   ├── swagz/          # Scoring system
│   ├── admin/          # Admin panel
│   └── subscription/   # Plan management
```

---

## 🚀 Deployment Commands

**PM2:**
```bash
npm run build
pm2 start dist/main.js --name slsk-api
pm2 save
```

**Docker:**
```bash
docker-compose up -d
docker-compose logs -f
```

**SystemD:**
```bash
sudo systemctl start swgz-api
sudo systemctl status swgz-api
```

---

## 🔍 Useful Queries

**Find user by email:**
```sql
SELECT * FROM users WHERE email = 'user@example.com';
```

**Check user's swagz:**
```sql
SELECT username, swagz, subscriptionPlan FROM users 
WHERE email = 'user@example.com';
```

**Most liked songs:**
```sql
SELECT title, artist, likeCount FROM songs 
ORDER BY likeCount DESC LIMIT 10;
```

**User's stalkers count:**
```sql
SELECT COUNT(*) FROM stalkers WHERE stalkingId = 'user-uuid';
```

---

## 📊 Monitoring

**Health check:**
```bash
curl http://localhost:3000/api/health
```

**Check logs:**
```bash
# PM2
pm2 logs slsk-api

# SystemD
sudo journalctl -u swgz-api -f

# Docker
docker-compose logs -f
```

---

## 🎯 Quick Feature Test

1. **Register** → `/api/auth/signup`
2. **Confirm email** → Click link
3. **Login** → Get API key
4. **Search** → Find a song
5. **Play** → +1 swagz
6. **Like** → +2 swagz
7. **Comment** → +3 swagz
8. **Repost** → +5 swagz
9. **Stalk someone** → Follow
10. **Check feed** → See activity
11. **View profile** → See stats
12. **Earn 1000 swagz** → Upgrade to premium!

---

## 🔐 Security Checklist

- [ ] Change default admin password
- [ ] Set strong JWT_SECRET
- [ ] Configure SMTP properly
- [ ] Enable HTTPS in production
- [ ] Setup firewall rules
- [ ] Use environment variables
- [ ] Regular database backups
- [ ] Monitor logs

---

## 📚 Documentation Files

- `README.md` - Main documentation
- `SETUP_GUIDE.md` - Installation steps
- `SOCIAL_FEATURES_API.md` - Social API docs
- `FEATURES_SUMMARY.md` - Complete feature list
- `QUICK_REFERENCE.md` - This file!

---

## 💡 Pro Tips

1. **Use API keys** for mobile apps (more secure than JWT)
2. **Enable private profile** for privacy
3. **Import playlists** to quickly build library (Premium)
4. **Check swagz daily** to track progress
5. **Stalk active users** for better feed
6. **Comment & repost** to earn swagz fast
7. **Use search history** to find previous queries
8. **Most listened** shows your taste over time

---

## 🎵 Swagz to Premium Path

```
Start: 0 swagz
↓
Stream 100 songs: +100 swagz
Like 50 songs: +100 swagz  
Comment 30 times: +90 swagz
Repost 20 songs: +100 swagz
Login 70 days: +700 swagz
↓
Total: 1090 swagz
↓
Upgrade to Premium! 🎉
```

Or get admin to upgrade you instantly! 😉