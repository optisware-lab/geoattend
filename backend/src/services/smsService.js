const https = require('https');

const sendSMS = async (to, message) => {
  const provider = process.env.SMS_PROVIDER || 'none';
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || 'GeoAttend';

  if (provider === 'none' || !apiKey) {
    console.log(`[SMS MOCK] To: ${to} | Message: ${message}`);
    return { success: true, mock: true };
  }

  try {
    if (provider === 'arkesel') {
      return await new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          sender: senderId,
          message,
          recipients: [to],
        });

        const req = https.request({
          hostname: 'sms.arkesel.com',
          path: '/api/v2/sms/send',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ success: true, data }));
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    } else if (provider === 'hubtel') {
      return await new Promise((resolve, reject) => {
        const clientId = process.env.SMS_CLIENT_ID;
        const params = new URLSearchParams({ From: senderId, To: to, Content: message });

        const req = https.get({
          hostname: 'smsc.hubtel.com',
          path: `/v1/messages/send?${params.toString()}`,
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${apiKey}`).toString('base64'),
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ success: true, data }));
        });
        req.on('error', reject);
      });
    }

    return { success: false, error: `Unknown provider: ${provider}` };
  } catch (err) {
    console.error('SMS send error:', err.message);
    return { success: false, error: err.message };
  }
};

const sendCheckInReminder = async (phone, name) => {
  return sendSMS(phone, `Hi ${name}, this is a reminder to check in at work today. - GeoAttend`);
};

const sendLateAlert = async (phone, name, time) => {
  return sendSMS(phone, `${name}, you checked in late today at ${time}. Please ensure punctuality. - GeoAttend`);
};

const sendAbsentAlert = async (phone, name, date) => {
  return sendSMS(phone, `${name}, you were absent on ${date}. If this is an error, please contact your admin. - GeoAttend`);
};

module.exports = {
  sendSMS,
  sendCheckInReminder,
  sendLateAlert,
  sendAbsentAlert,
};
