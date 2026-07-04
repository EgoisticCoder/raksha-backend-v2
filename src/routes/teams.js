const express = require('express');
const { getAllTeams, assignTeam, registerTeamPushToken } = require('../services/neo4j');
const { emitEvent } = require('../utils/socket');
const { validate, assignTeamSchema, registerTokenSchema } = require('../middleware/validator');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const teams = await getAllTeams();
    return res.json(teams);
  } catch (err) {
    console.error('GET /teams error:', err);
    return res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

router.post('/assign', validate(assignTeamSchema), async (req, res) => {
  try {
    const { incident_id, team_id } = req.validated;
    const result = await assignTeam(incident_id, team_id);
    if (!result) {
      return res.status(404).json({ error: 'Assignment failed' });
    }
    emitEvent('sos_updated', result);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('POST /teams/assign error:', err);
    return res.status(500).json({ error: 'Failed to assign team' });
  }
});

router.post('/register-token', validate(registerTokenSchema), async (req, res) => {
  try {
    const team = await registerTeamPushToken(req.validated.team_id, req.validated.push_token);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    return res.json({ success: true, team_id: team.id });
  } catch (err) {
    console.error('POST /teams/register-token error:', err);
    return res.status(500).json({ error: 'Failed to register push token' });
  }
});

module.exports = router;
