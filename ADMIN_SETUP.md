# Admin Authentication Setup Guide

## Super Admin Login

### Initial Super Admin Account
The super admin account is created automatically when you run the database seed script.

**Credentials:**
- **Staff ID:** `ADMIN001`
- **Password:** `GeoAttend$2026!` (configured in `backend/.env` as `DEFAULT_ADMIN_PASSWORD`)
- **Institution Code:** Leave **EMPTY** when logging in

### How to Seed the Database
If you haven't run the seed script yet:

```bash
cd backend
npm run seed
```

This creates:
1. A default institution called "Sample Institution Ghana"
2. A super admin account (ADMIN001) with role `super_admin`
3. Default attendance rules

### Logging in as Super Admin

1. Go to the admin dashboard login page
2. **Leave Institution Code field EMPTY**
3. Enter Staff ID: `ADMIN001`
4. Enter Password: `GeoAttend$2026!`
5. Click "Sign In"

You'll be redirected to the Super Admin Dashboard where you can create new institutions.

---

## Creating a New Institution with Admin Account

### As Super Admin:

1. Navigate to "Create Institution" page
2. Fill in institution details:
   - Name (required)
   - Address, City, Region
   - Latitude & Longitude (required)
   - Geofence Radius
3. Click "Create Institution"

**What happens automatically:**
- ✅ Institution is created with a unique code (e.g., `RSS` for Rising Soul School; the admin ID is `RSSADMIN`)
- ✅ Admin account is automatically created with:
  - Admin ID from the school code (e.g., `RSSADMIN`)
  - Random password (e.g., `a3f9c12e`)
- ✅ Default attendance rules are created
- ✅ Trial subscription is activated

4. **Copy the admin credentials** displayed on screen
5. **Share with the institution administrator** securely

---

## Institution Admin Login

### As Institution Admin:

1. Receive credentials from super admin:
   - Institution Code: `RSS`
   - Admin ID: `RSSADMIN`
   - Password: `a3f9c12e`

2. Go to admin dashboard login page
3. **Enter Institution Code:** `RSS` (optional for admins)
4. Enter Admin ID: `RSSADMIN` (remembered after the first login)
5. Enter Password: `a3f9c12e`
6. Click "Sign In"

You'll be redirected to your institution's admin dashboard.

**Important:** Change your password after first login for security.

---

## Authentication Hierarchy

```
Super Admin (ADMIN001)
  ├─ Can create institutions
  ├─ Can create admin accounts for institutions
  ├─ Manages all institutions
  └─ Login: No institution code required

Institution Admin (e.g., ADMIN7f3a2b)
  ├─ Manages their own institution only
  ├─ Can create staff accounts
  ├─ Can manage attendance, leave, reports
  └─ Login: Requires institution code

Staff Members
  ├─ Can mark attendance via mobile app
  ├─ Can request leave
  ├─ Cannot access admin dashboard
  └─ Login: Via mobile app only
```

---

## Troubleshooting

### "No account found with Staff ID..."
- Check that you're using the correct institution code
- Verify Staff ID is typed correctly (case-sensitive)
- Contact your super admin if credentials are lost

### Google OAuth removed
- Google sign-in has been removed; use email/Staff ID + password login only
- Only super admin can create admin accounts

### Cannot access admin dashboard
- Only accounts with role `admin` or `super_admin` can access
- Check with your institution administrator
- Regular staff use the mobile app, not the dashboard

---

## Security Notes

1. **Super Admin Password:** Change `DEFAULT_ADMIN_PASSWORD` in `backend/.env` before production
2. **Admin Passwords:** Generated passwords should be changed after first login
3. **Never share** super admin credentials with institution admins
4. Each institution has its own isolated admin account
