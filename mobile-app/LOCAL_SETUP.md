# Mobile App Local Development Setup

## Problem Fixed
The mobile app was trying to connect to the Render backend (https://geofence-app-jjpa.onrender.com/api) which is not responding, causing network errors.

## Changes Made

### 1. ✅ API Configuration (.env file)
Added `EXPO_PUBLIC_API_BASE_URL` to use your local backend instead of Render.

### 2. ✅ SafeAreaView Warning Fixed
Screens use `react-native-safe-area-context` instead of the deprecated `react-native` SafeAreaView.

---

## How to Connect Mobile App to Local Backend

### Step 1: Find Your Computer's IP Address

**On Windows:**
1. Open Command Prompt (cmd)
2. Type: `ipconfig`
3. Look for "Wireless LAN adapter Wi-Fi" or "Ethernet adapter"
4. Find the **IPv4 Address** (e.g., 192.168.1.100)

**Example output:**
```
Wireless LAN adapter Wi-Fi:
   IPv4 Address. . . . . . . . . . . : 192.168.1.100
```

### Step 2: Update .env File

Open `mobile-app/.env` and update the API URL with your IP address:

```bash
# Replace localhost with your actual IP address
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.100:5000/api
```

**Important:**
- ❌ Don't use `localhost` or `127.0.0.1` - it won't work on physical devices/emulators
- ✅ Use your computer's actual IP address (e.g., 192.168.1.100)
- Make sure you're on the same WiFi network as your development machine

### Step 3: Start Backend Server

```bash
cd backend
npm run dev
```

The backend should start on port 5000.

### Step 4: Restart Mobile App

After changing the .env file, you MUST restart the Expo development server:

1. Stop the current Expo server (Ctrl+C)
2. Clear the cache and restart:
   ```bash
   cd mobile-app
   npx expo start -c
   ```
3. Press 'r' to reload the app on your device/emulator

---

## Testing the Connection

### 1. Backend Health Check
First, verify your backend is running:

```bash
# Test from your computer's browser:
http://localhost:5000/api/health

# OR test with curl:
curl http://localhost:5000/api/health
```

You should see: `{"status":"ok"}`

### 2. From Mobile Device
If your backend is running and you've updated the IP address correctly, the app should now connect successfully.

---

## Troubleshooting

### Error: "Network Error" persists

**1. Check Backend is Running**
```bash
cd backend
npm run dev
```

**2. Verify IP Address is Correct**
- Run `ipconfig` again
- Make sure you're using the IPv4 address
- Update `.env` with the correct IP

**3. Check Firewall**
Windows Firewall might be blocking connections. Allow Node.js through firewall:
- Search "Windows Defender Firewall"
- Click "Allow an app through firewall"
- Find Node.js and make sure both Private and Public are checked

**4. Same Network**
Make sure your computer and phone/emulator are on the same WiFi network.

**5. Clear Expo Cache**
```bash
cd mobile-app
npx expo start -c
```

### Error: "Connection refused"

- Backend is not running on port 5000
- Start backend: `cd backend && npm run dev`

### Error: "Timeout"

- Wrong IP address in .env
- Firewall blocking connections
- Not on same WiFi network

---

## Production vs Development

### Development (Local)
```bash
# mobile-app/.env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.100:5000/api
```

### Production (Deployed)
```bash
# mobile-app/.env
EXPO_PUBLIC_API_BASE_URL=https://geoattend-api-pc49.onrender.com/api
```

Or update `app.json`:
```json
{
  "expo": {
    "extra": {
      "API_BASE_URL": "https://your-production-backend.com/api"
    }
  }
}
```

---

## Quick Reference

**Backend Start:**
```bash
cd backend && npm run dev
```

**Mobile App Start:**
```bash
cd mobile-app && npx expo start -c
```

**Find IP Address:**
```bash
ipconfig
```

**Update .env:**
```bash
EXPO_PUBLIC_API_BASE_URL=http://YOUR_IP:5000/api
```

---

## Warnings Fixed

### ✅ SafeAreaView Deprecation
- **Before:** `import { SafeAreaView } from 'react-native'`
- **After:** `import { SafeAreaView } from 'react-native-safe-area-context'`

This warning should no longer appear in your console.
