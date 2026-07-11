const express = require('express');
const { parseInboundWebhook } = require('../services/twilio');
const { createSOSEvent } = require('../services/neo4j');
const { generateIncidentId, generatePersonId } = require('../utils/incidentId');
const { emitEvent } = require('../utils/socket');

const router = express.Router();

router.post('/webhook', async (req, res) => {
  try {
    const parsed = parseInboundWebhook(req.body);

    if (parsed.type === 'inbound_sos' && parsed.data) {
      const d = parsed.data;
      if (d.lat && d.lng) {
        const incident_id = generateIncidentId();
        const person_id = generatePersonId();

        await createSOSEvent({
          incident_id,
          person_id,
          name: 'SMS User',
          age: 0,
          language: 'en',
          phone: d.phone || '',
          lat: d.lat,
          lng: d.lng,
          severity: d.severity || 3,
          disaster_type: 'unknown',
          condition_text: d.condition_text || 'Inbound SMS SOS',
          photo_url: null,
          accuracy_m: 0,
          channel: 'sms',
        });

        emitEvent('new_sos', { incident_id, channel: 'sms' });
      }
    }

    return res.status(200).json({ received: true, type: parsed.type });
  } catch (err) {
    console.error('SMS webhook error:', err);
    return res.status(200).json({ received: true, error: 'processed with errors' });
  }
});

router.post('/send-alert', async (req, res) => {
  try {
    const { sendSimpleSMS } = require('../services/twilio');
    const { message, phone } = req.body;
    const targetPhone = phone || process.env.SUPERVISOR_PHONE;
    if (!targetPhone) {
      return res.status(400).json({ error: 'No phone number provided or configured' });
    }
    const result = await sendSimpleSMS(targetPhone, message);
    return res.json(result);
  } catch (err) {
    console.error('Send alert SMS error:', err);
    return res.status(500).json({ error: 'Failed to send alert SMS' });
  }
});

router.post('/', async (req, res) => {
  return router.handle({ ...req, url: '/webhook' }, res);
});

module.exports = router;
