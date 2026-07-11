const express = require('express');
const multer = require('multer');
const {
  createSOSEvent,
  getActiveSOS,
  getSOSById,
  markResolved,
  assignTeam,
  updateTeamLocation,
  updateTeamStatus,
  verifySOS,
  setEscalated,
} = require('../services/neo4j');
const { classifySeverity } = require('../services/groq');
const { calculateHeuristicScore } = require('../services/severity');
const { uploadPhoto } = require('../services/storage');
const { generateIncidentId, generatePersonId } = require('../utils/incidentId');
const { emitEvent } = require('../utils/socket');
const { validate, createSOSSchema, assignTeamSchema, teamLocationSchema, teamStatusSchema } = require('../middleware/validator');
const { authenticateJWT, authorizeRoles, ROLES } = require('../middleware/jwt');
const { queues } = require('../queues');
const { NOTIFICATION_TYPES } = require('../services/notification');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

    // Apply heuristic severity scoring
    const sosDataForHeuristic = {
      condition_text,
      disaster_type,
    };
    severity = calculateHeuristicScore(sosDataForHeuristic);

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

    await queues.routing.add('route-sos', { incident_id });

    if (data.next_of_kin_phone) {
      await queues.notification.add('send-notification', {
        phone: data.next_of_kin_phone,
        type: NOTIFICATION_TYPES.SOS_CREATED,
        sos: payload.sos,
        person: payload.person,
      });
    }

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

router.post('/:id/resolve', authenticateJWT, authorizeRoles(ROLES.VERIFIED_RESPONDER, ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const sos = await markResolved(req.params.id, req.user?.id);
    if (!sos) {
      return res.status(404).json({ error: 'SOS event not found' });
    }
    const payload = await getSOSById(req.params.id);
    emitEvent('sos_updated', payload);
    
    if (payload.person?.next_of_kin_phone) {
      await queues.notification.add('send-notification', {
        phone: payload.person.next_of_kin_phone,
        type: NOTIFICATION_TYPES.SOS_RESOLVED,
        sos: payload.sos,
        person: payload.person,
      });
    }
    
    return res.json({ success: true, sos });
  } catch (err) {
    console.error('POST /sos/:id/resolve error:', err);
    return res.status(500).json({ error: 'Failed to resolve SOS event' });
  }
});

router.post('/:id/assign', authenticateJWT, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), validate(assignTeamSchema), async (req, res) => {
  try {
    const result = await assignTeam(req.params.id, req.validated.team_id, req.user?.id);
    if (!result) {
      return res.status(404).json({ error: 'SOS or team not found, or team unavailable' });
    }
    const payload = await getSOSById(req.params.id);
    emitEvent('sos_updated', payload);
    
    if (payload.person?.next_of_kin_phone) {
      await queues.notification.add('send-notification', {
        phone: payload.person.next_of_kin_phone,
        type: NOTIFICATION_TYPES.SOS_ASSIGNED,
        sos: payload.sos,
        person: payload.person,
      });
    }
    
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('POST /sos/:id/assign error:', err);
    return res.status(500).json({ error: 'Failed to assign team' });
  }
});

router.post('/:id/escalate', authenticateJWT, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const sos = await setEscalated(req.params.id, req.user?.id);
    if (!sos) {
      return res.status(404).json({ error: 'SOS event not found' });
    }
    const payload = await getSOSById(req.params.id);
    emitEvent('sos_updated', payload);
    
    if (payload.person?.next_of_kin_phone) {
      await queues.notification.add('send-notification', {
        phone: payload.person.next_of_kin_phone,
        type: NOTIFICATION_TYPES.SOS_ESCALATED,
        sos: payload.sos,
        person: payload.person,
      });
    }
    
    return res.json({ success: true, sos });
  } catch (err) {
    console.error('POST /sos/:id/escalate error:', err);
    return res.status(500).json({ error: 'Failed to escalate SOS event' });
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

router.post('/team-status', authenticateJWT, authorizeRoles(ROLES.VERIFIED_RESPONDER, ROLES.ADMIN, ROLES.SUPER_ADMIN), validate(teamStatusSchema), async (req, res) => {
  try {
    const team = await updateTeamStatus(
      req.validated.team_id,
      req.validated.status,
      req.validated.incident_id
    );
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    emitEvent('team_status', {
      team_id: req.validated.team_id,
      status: req.validated.status,
      incident_id: req.validated.incident_id,
    });
    return res.json({ success: true, team });
  } catch (err) {
    console.error('POST /sos/team-status error:', err);
    return res.status(500).json({ error: 'Failed to update team status' });
  }
});

router.post('/:incident_id/verify', authenticateJWT, authorizeRoles(ROLES.VERIFIED_RESPONDER, ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const { is_false_report } = req.body;
    const sos = await verifySOS(req.params.incident_id, req.user.id, is_false_report);
    if (!sos) {
      return res.status(404).json({ error: 'SOS event not found' });
    }
    const payload = await getSOSById(req.params.incident_id);
    emitEvent('sos_updated', payload);
    return res.json({ success: true, sos });
  } catch (err) {
    console.error('POST /sos/:incident_id/verify error:', err);
    return res.status(500).json({ error: 'Failed to verify SOS' });
  }
});


module.exports = router;
