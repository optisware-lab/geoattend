# GeoAttend - Geofenced Attendance Management System

A complete attendance management system designed for institutions in Ghana, featuring GPS geofence verification, QR code check-in, and comprehensive reporting.

## Architecture

```
├── backend/              # Node.js + Express REST API
├── admin-dashboard/      # React web dashboard for administrators
└── mobile-app/           # React Native (Expo) mobile app for staff
```

## Features

### Mobile App (Staff)
- Login with staff ID and password
- GPS-based check-in/check-out within geofence radius
- QR code scanning from staff ID cards
- Real-time geofence distance indicator
- Personal attendance history
- Late arrival detection

### Admin Dashboard
- Real-time attendance monitoring
- Staff management (add, edit, activate/deactivate)
- QR code generation for staff ID cards
- Institution geofence configuration (set coordinates and radius)
- Attendance rules (work hours, late threshold, working days)
- Reports with date/department/staff filters
- Export reports to Excel and PDF
- Weekly attendance trend charts

### Security
- JWT authentication with rate limiting
- GPS geofence enforcement (check-in blocked outside radius)
- Duplicate check-in prevention
- Device ID and timestamp logging
- Helmet security headers + CORS

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js, Express, PostgreSQL |
| Admin Dashboard | React, Chart.js, React Router |
| Mobile App | React Native (Expo), Expo Location, Expo Camera |
| Auth | JWT, bcrypt |
| Reports | excel4node, PDFKit |
| QR Codes | qrcode library |

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Expo CLI (`npm install -g expo-cli`)

### 1. Database Setup

```bash
# Create the database
createdb geofence_attendance

# Or via psql
psql -U postgres -c "CREATE DATABASE geofence_attendance;"
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your database credentials and JWT secret

npm install
npm run migrate    # Create tables
npm run seed       # Create default admin + sample institution
npm run dev        # Start development server (port 5000)
```

Default admin login: `ADMIN001` / `Admin@123`

### 3. Admin Dashboard

```bash
cd admin-dashboard
npm install
npm start          # Starts on port 3000
```

### 4. Mobile App

```bash
cd mobile-app
npm install

# Update API URL in src/services/api.js to your server IP
# e.g., http://192.168.1.100:5000/api

npm start          # Or: expo start
# Scan QR code with Expo Go app on your Android device
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Staff login |
| GET | `/api/auth/profile` | Get current user profile |
| PUT | `/api/auth/change-password` | Change password |

### Attendance
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/attendance/check-in` | Check in (GPS/QR/NFC) |
| POST | `/api/attendance/check-out` | Check out |
| GET | `/api/attendance/today` | Today's status |
| GET | `/api/attendance/my-attendance` | Personal history |

### Staff Management (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/staff` | List all staff |
| POST | `/api/staff` | Create staff member |
| PUT | `/api/staff/:id` | Update staff member |
| GET | `/api/staff/:id/qr-code` | Get staff QR code |
| PUT | `/api/staff/:id/reset-password` | Reset password |

### Reports (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/dashboard` | Dashboard statistics |
| GET | `/api/reports/realtime` | Real-time attendance |
| GET | `/api/reports/attendance` | Filtered attendance report |
| GET | `/api/reports/weekly-summary` | 7-day summary |
| GET | `/api/reports/export/excel` | Download Excel report |
| GET | `/api/reports/export/pdf` | Download PDF report |

### Institution Settings (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/institutions/current` | Get institution info |
| PUT | `/api/institutions/current` | Update institution/geofence |
| GET | `/api/institutions/rules` | Get attendance rules |
| PUT | `/api/institutions/rules` | Update attendance rules |

## Geofence Configuration

Set the institution's GPS coordinates and radius in the admin dashboard under **Settings > Institution & Geofence**. The system uses the Haversine formula to calculate distance between the staff member's device and the institution center.

- **Recommended radius**: 100-500 meters depending on campus size
- **Default**: 200 meters (Accra coordinates: 5.6037, -0.1870)

## Hardware Integration

### QR Code ID Cards
1. Generate QR codes via admin dashboard (Staff > Select Staff > QR Code)
2. Print QR codes on staff ID cards
3. Staff scan their ID card QR code using the mobile app or a tablet at the entrance

### Tablet-Based Entrance Kiosk
Deploy the mobile app on a tablet at the entrance. Staff scan their QR code ID cards for check-in.

### NFC/RFID (Optional)
The backend supports `nfc` as a check-in method. Integrate with NFC readers by sending check-in requests with `method: 'nfc'`.

## Multi-Institution Support

The system supports multiple institutions via the `institutions` table. Super admins can create and manage multiple institutions. Each staff member belongs to one institution, and geofence boundaries are per-institution.

## Deployment

### Backend (DigitalOcean/AWS)
```bash
# Use PM2 for production
npm install -g pm2
cd backend
pm2 start src/server.js --name geoattend-api
```

### Admin Dashboard
```bash
cd admin-dashboard
npm run build
# Serve the build/ folder with Nginx or upload to a CDN
```

### Mobile App
```bash
cd mobile-app
expo build:android    # Generate APK
# Or use EAS Build for production builds
```

## License

MIT
