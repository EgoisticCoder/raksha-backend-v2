const fetch = require('node-fetch');

const MSG91_SEND_URL = 'https://control.msg91.com/api/v5/flow/';

async function sendSMS(phone, message) {
  if (!process.env.MSG91_AUTH_KEY) {
    console.warn('MSG91_AUTH_KEY not configured; skipping SMS');
    return { success: false, reason: 'not_configured' };
  }

  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const response = await fetch(MSG91_SEND_URL, {
      method: 'POST',
      headers: {
        authkey: process.env.MSG91_AUTH_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: process.env.MSG91_TEMPLATE_ID || '',
        short_url: '0',
        recipients: [
          {
            mobiles: cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`,
            var: message,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('MSG91 sendSMS error:', response.status, errText);
      return { success: false, reason: errText };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error('MSG91 sendSMS error:', err);
    return { success: false, reason: err.message };
  }
}

async function sendSimpleSMS(phone, message) {
  if (!process.env.MSG91_AUTH_KEY) {
    console.warn('MSG91_AUTH_KEY not configured; skipping SMS');
    return { success: false, reason: 'not_configured' };
  }

  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const mobile = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
    const senderId = process.env.MSG91_SENDER_ID || 'RAKSHA';
    const url = `https://control.msg91.com/api/sendhttp.php?authkey=${process.env.MSG91_AUTH_KEY}&mobiles=${mobile}&message=${encodeURIComponent(message)}&sender=${senderId}&route=4&country=91`;

    const response = await fetch(url);
    const text = await response.text();
    return { success: response.ok, data: text };
  } catch (err) {
    console.error('MSG91 sendSimpleSMS error:', err);
    return { success: false, reason: err.message };
  }
}

function parseInboundWebhook(body) {
  if (!body) return { type: 'unknown', data: null };

  if (body.eventName || body.event || body.status) {
    return {
      type: 'delivery_report',
      data: {
        status: body.status || body.eventName,
        phone: body.telNum || body.mobile,
        requestId: body.requestId || body.CRQID,
        failureReason: body.failureReason,
      },
    };
  }

  const text = body.text || body.message || body.content || body.body || '';
  const phone = body.from || body.mobile || body.sender || body.telNum || '';

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
