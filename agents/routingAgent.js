require('dotenv').config();
const {
  getSOSById,
  findNearestAvailableTeam,
  assignTeam,
} = require('../src/services/neo4j');
const { emitEvent } = require('../src/utils/socket');
const { sendExpoPush } = require('../src/services/push');

async function runRouting(incident_id) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Routing agent for ${incident_id}`);

  if (!incident_id) {
    return { success: false, reason: 'missing_incident_id' };
  }

  try {
    const sosData = await getSOSById(incident_id);
    if (!sosData) {
      return { success: false, reason: 'sos_not_found' };
    }

    const { sos } = sosData;
    if (sos.status !== 'open') {
      return { success: false, reason: 'sos_not_open', status: sos.status };
    }

    const nearest = await findNearestAvailableTeam(sos.lat, sos.lng);
    if (!nearest) {
      console.log(`[${timestamp}] No available team for ${incident_id}`);
      return { success: false, reason: 'no_available_team' };
    }

    const assignment = await assignTeam(incident_id, nearest.team.id);
    if (!assignment) {
      return { success: false, reason: 'assignment_failed' };
    }

    const payload = await getSOSById(incident_id);
    emitEvent('sos_updated', payload);

    if (nearest.team.push_token) {
      await sendExpoPush(
        nearest.team.push_token,
        'New SOS Assignment',
        `${sos.disaster_type} - Severity ${sos.severity} at ${sos.lat.toFixed(4)}, ${sos.lng.toFixed(4)}`,
        { incident_id, type: 'assignment' }
      );
    }

    console.log(`[${timestamp}] Assigned ${nearest.team.name} to ${incident_id} (${nearest.distance_m}m)`);

    return {
      success: true,
      incident_id,
      team_id: nearest.team.id,
      team_name: nearest.team.name,
      distance_m: nearest.distance_m,
    };
  } catch (err) {
    console.error(`[${timestamp}] Routing agent error:`, err);
    throw err;
  }
}

if (require.main === module) {
  const incident_id = process.argv.find((a) => a.startsWith('--incident_id='))?.split('=')[1]
    || process.env.INCIDENT_ID
    || process.argv[2];

  runRouting(incident_id)
    .then((result) => {
      console.log('Routing agent completed:', JSON.stringify(result));
      process.exit(result.success ? 0 : 1);
    })
    .catch(() => process.exit(1));
}

module.exports = { runRouting };
