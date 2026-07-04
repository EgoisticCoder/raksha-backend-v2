const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const {
  createSOSEvent,
  getActiveSOS,
  getSOSById,
  markResolved,
  assignTeam,
  updateTeamLocation,
} = require('../services/neo4j');
const { classifySeverity } = require('../services/groq');
const { uploadPhoto } = require('../services/storage');
const { generateIncidentId, generatePersonId } = require('../utils/incidentId');
const { emitEvent } = require('../utils/socket');
const { validate, createSOSSchema, assignTeamSchema, teamLocationSchema } = require('../middleware/validator');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function triggerRoutingWebhook(incident_id) {
  if (!process.env.BACKEND_URL) return;
  try {
    await fetch(`${process.env.BACKEND_URL}/sos/webhook/routing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': process.env.ROUTING_WEBHOOK_SECRET || '',
      },
      body: JSON.stringify({ incident_id }),
    });
  } catch (err) {
    console.error('Routing webhook trigger error:', err);
  }
}

router.post('/', upload.single('photo'), validate(createSOSSchema), async (req, res) => {
  try {
    const data = req.validated;
    const incident_id = generateIncidentId();
    const person_id = generatePersonId();
    let photo_url = data.photo_url || null;

    if (req.file) {
      const uploaded = await uploadPhoto(req.file.buffer, req.file.mimetype, incident_id);
      if (uploaded) photo_url = uploaded;
    }

    let severity = data.severity;
    let disaster_type = data.disaster_type;
    let condition_text = data.condition_text;

    if (photo_url && !severity) {
      const vision = await classifySeverity(photo_url);
      severity = vision.severity;
      disaster_type = vision.disaster_type;
      condition_text = condition_text || vision.condition_text;
    }

    severity = severity || 3;

    const result = await createSOSEvent({
      ...data,
      incident_id,
      person_id,
      photo_url,
      severity,
      disaster_type,
      condition_text,
    });

    const payload = await getSOSById(incident_id);
    emitEvent('new_sos', payload);

    triggerRoutingWebhook(incident_id).catch(console.error);

    return res.status(201).json({
      incident_id: result.incident_id,
      severity,
      disaster_type,
      photo_url,
    });
  } catch (err) {
    console.error('POST /sos error:', err);
    return res.status(500).json({ error: 'Failed to create SOS event' });
  }
});

router.get('/active', async (req, res) => {
  try {
    const active = await getActiveSOS();
    return res.json(active);
  } catch (err) {
    console.error('GET /sos/active error:', err);
    return res.status(500).json({ error: 'Failed to fetch active SOS events' });
  }
});

router.post('/:id/resolve', async (req, res) => {
  try {
    const sos = await markResolved(req.params.id);
    if (!sos) {
      return res.status(404).json({ error: 'SOS event not found' });
    }
    const payload = await getSOSById(req.params.id);
    emitEvent('sos_updated', payload);
    return res.json({ success: true, sos });
  } catch (err) {
    console.error('POST /sos/:id/resolve error:', err);
    return res.status(500).json({ error: 'Failed to resolve SOS event' });
  }
});

router.post('/:id/assign', validate(assignTeamSchema), async (req, res) => {
  try {
    const result = await assignTeam(req.params.id, req.validated.team_id);
    if (!result) {
      return res.status(404).json({ error: 'SOS or team not found, or team unavailable' });
    }
    const payload = await getSOSById(req.params.id);
    emitEvent('sos_updated', payload);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('POST /sos/:id/assign error:', err);
    return res.status(500).json({ error: 'Failed to assign team' });
  }
});

router.post('/team-location', validate(teamLocationSchema), async (req, res) => {
  try {
    const team = await updateTeamLocation(
      req.validated.team_id,
      req.validated.lat,
      req.validated.lng
    );
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    emitEvent('team_location', { team_id: req.validated.team_id, lat: req.validated.lat, lng: req.validated.lng });
    return res.json({ success: true, team });
  } catch (err) {
    console.error('POST /sos/team-location error:', err);
    return res.status(500).json({ error: 'Failed to update team location' });
  }
});

router.post('/webhook/routing', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (process.env.ROUTING_WEBHOOK_SECRET && secret !== process.env.ROUTING_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const { runRouting } = require('../../agents/routingAgent');
    const result = await runRouting(req.body.incident_id);
    return res.json(result);
  } catch (err) {
    console.error('Routing webhook error:', err);
    return res.status(500).json({ error: 'Routing failed' });
  }
});

module.exports = router;
