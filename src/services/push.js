const fetch = require('node-fetch');

async function sendExpoPush(pushToken, title, body, data = {}) {
  if (!pushToken) {
    return { success: false, reason: 'no_token' };
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN
          ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high',
      }),
    });

    const result = await response.json();
    return { success: response.ok, data: result };
  } catch (err) {
    console.error('Expo push error:', err);
    return { success: false, reason: err.message };
  }
}

module.exports = { sendExpoPush };
