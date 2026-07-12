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
  getAllTeams,
} = require('../services/neo4j');
const { uploadPhoto } = require('../services/storage');
const { generateIncidentId, generatePersonId } = require('../utils/incidentId');
const { emitEvent } = require('../utils/socket');
const { validate, createSOSSchema, assignTeamSchema, teamLocationSchema, teamStatusSchema } = require('../middleware/validator');
const { authenticateJWT, authorizeRoles, ROLES } = require('../middleware/jwt');
const { queues } = require('../queues');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Keyword-based disaster classification
function classifyIncident(text) {
  const lowerText = (text || '').toLowerCase();
  
  if (lowerText.includes('fire') || lowerText.includes('wildfire') || lowerText.includes('burn')) {
    return { severity: 5, type: 'wildfire' };
  }
  if (lowerText.includes('flood') || lowerText.includes('water')) {
    return { severity: 4, type: 'flood' };
  }
  if (lowerText.includes('earthquake') || lowerText.includes('quake') || lowerText.includes('tremor')) {
    return { severity: 5, type: 'earthquake' };
  }
  if (lowerText.includes('landslide') || lowerText.includes('mudslide')) {
    return { severity: 4, type: 'landslide' };
  }
  if (lowerText.includes('medical') || lowerText.includes('hurt') || lowerText.includes('injured')) {
    return { severity: 4, type: 'medical' };
  }
  
  return { severity: 3, type: 'general' };
}

// Haversine formula to calculate distance in km
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180; 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
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

    // Classify disaster from condition text
    const classification = classifyIncident(data.condition_text);
    const severity = data.severity || classification.severity;
    const disaster_type = data.disaster_type || classification.type;
    const condition_text = data.condition_text;

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

router.get('/:incident_id/teams', async (req, res) => {
  try {
    const sos = await getSOSById(req.params.incident_id);
    if (!sos) {
      return res.status(404).json({ error: 'SOS not found' });
    }
    
    const allTeams = await getAllTeams();
    const sosLat = sos.sos.lat;
    const sosLng = sos.sos.lng;
    
    // Calculate distance for each team and sort by distance
    const teamsWithDistance = allTeams.map(team => {
      const distance = calculateHaversineDistance(
        team.lat,
        team.lng,
        sosLat,
        sosLng
      );
      return {
        ...team,
        distance_km: parseFloat(distance.toFixed(2))
      };
    }).sort((a, b) => a.distance_km - b.distance_km);
    
    return res.json(teamsWithDistance);
  } catch (err) {
    console.error('GET /sos/:incident_id/teams error:', err);
    return res.status(500).json({ error: 'Failed to fetch teams' });
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
