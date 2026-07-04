const fetch = require('node-fetch');

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('91') && digits.length > 10) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (digits.length > 10) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

async function sendSMS(phone, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio credentials not configured; skipping SMS');
    return { success: false, reason: 'not_configured' };
  }

  try {
    const toNumber = normalizePhone(phone);
    if (!toNumber) {
      return { success: false, reason: 'invalid_phone' };
    }

    const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Body: message,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Twilio sendSMS error:', response.status, data);
      return { success: false, reason: data.message || 'twilio_error' };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Twilio sendSMS error:', err);
    return { success: false, reason: err.message };
  }
}

async function sendSimpleSMS(phone, message) {
  return sendSMS(phone, message);
}

function parseInboundWebhook(body) {
  if (!body) return { type: 'unknown', data: null };

  const text = body.Body || body.body || body.text || body.message || body.content || '';
  const phone = body.From || body.from || body.mobile || body.sender || body.telNum || '';

  if (text.toUpperCase().startsWith('SOS') || text.includes('|')) {
    const parts = text.split('|');
    if (parts.length >= 3) {
      return {
        type: 'inbound_sos',
        data: {
          phone,
          lat: parseFloat(parts[1]),
          lng: parseFloat(parts[2]),
          severity: parts[3] ? parseInt(parts[3], 10) : 3,
          condition_text: parts[4] || 'SMS SOS',
          channel: 'sms',
        },
      };
    }
  }

  if (body.CRQID && String(body.CRQID).startsWith('SOS-')) {
    return {
      type: 'inbound_sos',
      data: {
        incident_id: body.CRQID,
        phone,
        channel: 'sms',
      },
    };
  }

  return { type: 'unknown', data: body };
}

function buildEscalationMessage(sos, person) {
  const name = person?.name || 'Unknown';
  const phone = person?.phone || 'N/A';
  return `ESCALATION: ${sos.incident_id} | Severity ${sos.severity} | ${sos.disaster_type} | ${name} (${phone}) | Lat ${sos.lat}, Lng ${sos.lng}`;
}

module.exports = { sendSMS, sendSimpleSMS, parseInboundWebhook, buildEscalationMessage };
