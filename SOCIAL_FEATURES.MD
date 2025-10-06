# Social Features API Documentation

## Overview

The app includes comprehensive social features:
- **Comments** - All users can comment on songs
- **Stalkers/Stalkings** - Follow system (called "stalker/stalking" in the app)
- **Reposts** - Share songs to your profile
- **Activity Feed** - See what your stalkings are doing
- **User Profiles** - Public/private profiles with activity
- **Swagz System** - Earn points for activity, upgrade to premium with swagz
- **Like Counts** - See how many users have liked a song

## Swagz Rewards

| Action | Swagz Earned |
|--------|--------------|
| Stream a song | +1 swagz |
| Like a song | +2 swagz |
| Comment on a song | +3 swagz |
| Repost a song | +5 swagz |
| Daily login | +10 swagz |

**Premium Upgrade Cost:** 1000 swagz

---

## Comments API

### Create Comment
```http
POST /api/comments
X-API-Key: your-api-key
Content-Type: application/json

{
  "songId": "song-uuid",
  "content": "Great track!",
  "parentCommentId": "comment-uuid" // Optional for replies
}
```

**Response:**
```json
{
  "id": "comment-uuid",
  "content": "Great track!",
  "songId": "song-uuid",
  "userId": "user-uuid",
  "user": {
    "id": "user-uuid",
    "username": "username",
    "avatarUrl": "https://..."
  },
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

**Rewards:** +3 swagz

### Get Song Comments
```http
GET /api/comments/song/:songId?page=1&limit=20
```

**Response:**
```json
{
  "comments": [...],
  "total": 100,
  "page": 1,
  "totalPages": 5
}
```

### Get Comment Replies
```http
GET /api/comments/:commentId/replies
```

### Update Comment
```http
PUT /api/comments/:id
X-API-Key: your-api-key
Content-Type: application/json

{
  "content": "Updated comment text"
}
```

### Delete Comment
```http
DELETE /api/comments/:id
X-API-Key: your-api-key
```

---

## Social API (Stalker/Following System)

### Stalk a User (Follow)
```http
POST /api/social/stalk/:userId
X-API-Key: your-api-key
```

**Response:**
```json
{
  "id": "stalker-uuid",
  "stalkerId": "your-user-id",
  "stalkingId": "other-user-id",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

### Unstalk a User (Unfollow)
```http
DELETE /api/social/stalk/:userId
X-API-Key: your-api-key
```

### Get My Stalkings (People I Follow)
```http
GET /api/social/stalkings
X-API-Key: your-api-key
```

**Response:**
```json
[
  {
    "id": "user-uuid",
    "username": "username",
    "bio": "User bio",
    "avatarUrl": "https://...",
    "swagz": 500
  }
]
```

### Get My Stalkers (My Followers)
```http
GET /api/social/stalkers
X-API-Key: your-api-key
```

### Get User's Stalkings
```http
GET /api/social/user/:userId/stalkings
```

### Get User's Stalkers
```http
GET /api/social/user/:userId/stalkers
```

### Repost a Song
```http
POST /api/social/repost/:songId
X-API-Key: your-api-key
```

**Rewards:** +5 swagz

### Remove Repost
```http
DELETE /api/social/repost/:songId
X-API-Key: your-api-key
```

### Get User's Reposts
```http
GET /api/social/user/:userId/reposts
```

**Response:**
```json
[
  {
    "id": "song-uuid",
    "title": "Song Title",
    "artist": "Artist Name",
    "albumCover": "https://...",
    "likeCount": 150,
    "commentCount": 45,
    "repostCount": 30
  }
]
```

---

## Activity Feed API

### Get Home Feed
Shows recent activity from users you're stalking (following).

```http
GET /api/social/feed?page=1&limit=20
X-API-Key: your-api-key
```

**Response:**
```json
{
  "activities": [
    {
      "id": "activity-uuid",
      "type": "like",
      "user": {
        "id": "user-uuid",
        "username": "username",
        "avatarUrl": "https://..."
      },
      "song": {
        "id": "song-uuid",
        "title": "Song Title",
        "artist": "Artist Name",
        "albumCover": "https://..."
      },
      "createdAt": "2025-01-01T00:00:00.000Z"
    },
    {
      "id": "activity-uuid",
      "type": "comment",
      "user": {...},
      "song": {...},
      "metadata": "First 100 chars of comment...",
      "commentId": "comment-uuid",
      "createdAt": "2025-01-01T00:00:00.000Z"
    },
    {
      "id": "activity-uuid",
      "type": "repost",
      "user": {...},
      "song": {...},
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "total": 200,
  "page": 1,
  "totalPages": 10
}
```

**Activity Types:**
- `like` - User liked a song
- `comment` - User commented on a song
- `repost` - User reposted a song

### Get User Activity
```http
GET /api/social/activity/:userId
```

Returns the user's recent activities (likes, comments, reposts).

---

## Profile API

### Get User Profile
```http
GET /api/profile/:username
X-API-Key: your-api-key
```

**Response:**
```json
{
  "id": "user-uuid",
  "username": "username",
  "bio": "User bio",
  "avatarUrl": "https://...",
  "isPrivate": false,
  "swagz": 750,
  "subscriptionPlan": "free",
  "stalkerCount": 150,
  "stalkingCount": 80,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "isOwnProfile": false,
  "isStalkingViewer": true
}
```

**Privacy:**
- If profile is private and viewer is not stalking them, returns 403 Forbidden
- Own profile always visible

### Get Profile Activity
```http
GET /api/profile/:username/activity
X-API-Key: your-api-key
```

**Response:**
```json
{
  "activity": [
    {
      "type": "like",
      "song": {...},
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "reposts": [
    {
      "id": "song-uuid",
      "title": "Song Title",
      ...
    }
  ],
  "comments": [
    {
      "id": "comment-uuid",
      "content": "Great song!",
      "song": {...},
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

### Update My Profile
```http
PUT /api/profile/me
X-API-Key: your-api-key
Content-Type: application/json

{
  "username": "new_username",
  "bio": "New bio text",
  "avatarUrl": "https://new-avatar.jpg",
  "isPrivate": true
}
```

### Search Users
```http
GET /api/profile/search?q=username
```

**Response:**
```json
[
  {
    "id": "user-uuid",
    "username": "username",
    "bio": "User bio",
    "avatarUrl": "https://...",
    "swagz": 500
  }
]
```

---

## Swagz API

### Get Swagz Balance
```http
GET /api/swagz/balance
X-API-Key: your-api-key
```

**Response:**
```json
{
  "swagz": 1250,
  "premiumCost": 1000,
  "canUpgrade": true
}
```

### Upgrade to Premium with Swagz
```http
POST /api/swagz/upgrade-premium
X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully upgraded to premium!"
}
```

**Note:** Requires 1000 swagz. Premium is permanent when purchased with swagz.

### Get Premium Cost
```http
GET /api/swagz/premium-cost
```

**Response:**
```json
{
  "cost": 1000
}
```

---

## Updated Song Object

Songs now include social metrics:

```json
{
  "id": "song-uuid",
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "duration": 240,
  "albumCover": "https://...",
  "playCount": 1500,
  "likeCount": 350,
  "commentCount": 78,
  "repostCount": 45,
  "hasFlac": true,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

---

## Updated User Object

Users now include social features:

```json
{
  "id": "user-uuid",
  "email": "user@example.com",
  "username": "username",
  "bio": "User bio",
  "avatarUrl": "https://...",
  "isPrivate": false,
  "swagz": 1250,
  "subscriptionPlan": "premium",
  "role": "user",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

---

## Example Usage Flow

### 1. User discovers a song
```javascript
// Search for music
GET /api/music/search?q=daft punk

// Play and record (earns +1 swagz)
POST /api/music/play/:songId
```

### 2. User likes the song
```javascript
// Add to library with like (earns +2 swagz)
POST /api/library/add
{
  "title": "Get Lucky",
  "artist": "Daft Punk",
  "isLiked": true
}
```

### 3. User comments
```javascript
// Comment on song (earns +3 swagz)
POST /api/comments
{
  "songId": "song-uuid",
  "content": "This is amazing!"
}
```

### 4. User reposts
```javascript
// Repost to profile (earns +5 swagz)
POST /api/social/repost/:songId
```

### 5. User stalks artist fan
```javascript
// Follow another user
POST /api/social/stalk/:userId
```

### 6. User checks feed
```javascript
// See what stalkings are doing
GET /api/social/feed
```

### 7. User upgrades to premium
```javascript
// Check balance
GET /api/swagz/balance
// Returns: { swagz: 1250, canUpgrade: true }

// Upgrade with swagz
POST /api/swagz/upgrade-premium
// Now has unlimited library, playlists, FLAC support!
```

---

## Privacy & Permissions

### Public Profiles
- Anyone can view profile and activity
- Stalkers/stalkings visible
- Activity feed visible

### Private Profiles
- Only stalkers can view profile
- Profile returns 403 for non-stalkers
- Own profile always visible

### Comments
- All users can comment (free and premium)
- Users can only edit/delete own comments
- Comments visible to everyone

---

## Error Responses

```json
{
  "statusCode": 400,
  "message": "Already stalking this user",
  "error": "Bad Request"
}
```

```json
{
  "statusCode": 403,
  "message": "This profile is private",
  "error": "Forbidden"
}
```

```json
{
  "statusCode": 404,
  "message": "User not found",
  "error": "Not Found"
}
```