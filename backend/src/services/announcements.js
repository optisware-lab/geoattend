const pool = require('../config/database');
const { sendExpoPushNotifications } = require('./pushNotificationService');

// One-time phone notifications to all staff, sent by the server right after
// the deploy that adds them. Each has a key; the key is recorded in
// app_announcements before sending, so restarts, a second server instance or
// later deploys never send it again. To announce something new, add an entry
// with a new key (and keep old ones, so they stay marked as sent).
const ANNOUNCEMENTS = [
  {
    key: '2026-11-offline-signin',
    title: 'GeoAttend updated',
    body: "No data? You can now sign in and out without internet. It's sent when you're back online. Open GeoAttend to see more.",
  },
];

const EXPO_BATCH = 100; // Expo accepts up to 100 messages per request

async function sendPendingAnnouncements() {
  await pool.withOwnerContext(async (client) => {
    await client.query(`CREATE TABLE IF NOT EXISTS app_announcements (
      key VARCHAR(80) PRIMARY KEY,
      sent_at TIMESTAMP DEFAULT NOW(),
      recipients INTEGER DEFAULT 0
    )`);

    for (const a of ANNOUNCEMENTS) {
      // Claim it first: only the instance whose insert succeeds sends
      const claimed = await client.query(
        'INSERT INTO app_announcements (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key',
        [a.key]
      );
      if (claimed.rowCount === 0) continue;

      const tokens = await client.query(
        `SELECT DISTINCT push_token FROM staff
         WHERE is_active = true AND member_type = 'staff'
           AND push_token LIKE 'ExponentPushToken[%'`
      );
      const messages = tokens.rows.map((r) => ({
        to: r.push_token,
        title: a.title,
        body: a.body,
        sound: 'default',
        data: { type: 'announcement', key: a.key },
      }));
      for (let i = 0; i < messages.length; i += EXPO_BATCH) {
        await sendExpoPushNotifications(messages.slice(i, i + EXPO_BATCH));
      }
      await client.query('UPDATE app_announcements SET recipients = $2 WHERE key = $1', [a.key, messages.length]);
      console.log(`[Announcement] "${a.key}" sent to ${messages.length} phone(s)`);
    }
  });
}

module.exports = { sendPendingAnnouncements, ANNOUNCEMENTS };
