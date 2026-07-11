const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'neo4j://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USERNAME || 'neo4j',
    process.env.NEO4J_PASSWORD || 'password'
  )
);

function recordToObject(record) {
  const obj = {};
  record.keys.forEach((key) => {
    const val = record.get(key);
    if (val && typeof val === 'object' && val.properties) {
      obj[key] = val.properties;
    } else if (neo4j.isInt(val)) {
      obj[key] = val.toNumber();
    } else if (val && typeof val.toStandardDate === 'function') {
      obj[key] = val.toStandardDate().toISOString();
    } else {
      obj[key] = val;
    }
  });
  return obj;
}

async function createSOSEvent(data) {
  const session = driver.session();
  try {
    const result = await session.run(
      `CREATE (p:Person {
        id: $person_id,
        name: $name, age: $age,
        language: $language, phone: $phone,
        next_of_kin_name: $next_of_kin_name,
        next_of_kin_phone: $next_of_kin_phone
      })
      CREATE (s:SOSEvent {
        incident_id: $incident_id, lat: $lat, lng: $lng,
        severity: $severity, disaster_type: $disaster_type,
        condition_text: $condition_text, photo_url: $photo_url,
        accuracy_m: $accuracy_m, status: 'open',
        channel: $channel, created_at: datetime(),
        tenant_id: $tenant_id,
        verified: false,
        verification_count: 0,
        false_report_flag: false
      })
      CREATE (p)-[:SENT_SOS]->(s)
      RETURN s.incident_id AS incident_id, s AS sos`,
      {
        person_id: data.person_id,
        name: data.name || 'Unknown',
        age: neo4j.int(data.age || 0),
        language: data.language || 'en',
        phone: data.phone || '',
        next_of_kin_name: data.next_of_kin_name || '',
        next_of_kin_phone: data.next_of_kin_phone || '',
        incident_id: data.incident_id,
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lng),
        severity: neo4j.int(data.severity || 3),
        disaster_type: data.disaster_type || 'unknown',
        condition_text: data.condition_text || '',
        photo_url: data.photo_url || null,
        accuracy_m: parseFloat(data.accuracy_m || 0),
        channel: data.channel || 'app',
        tenant_id: data.tenant_id || 'default'
      }
    );
    const row = recordToObject(result.records[0]);
    await logAuditEvent(data.incident_id, 'created', 'System', { status: 'open' });
    return { incident_id: row.incident_id, sos: row.sos };
  } catch (err) {
    console.error('Neo4j createSOSEvent error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function verifySOS(incidentId, verifierId, isFalseReport = false) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {incident_id: $incidentId})
       SET s.verification_count = s.verification_count + 1,
           s.false_report_flag = $isFalseReport OR s.false_report_flag,
           s.verified = s.verification_count >= 2 AND NOT s.false_report_flag
       RETURN s`,
      { incidentId, isFalseReport }
    );
    if (result.records.length === 0) return null;
    await logAuditEvent(incidentId, isFalseReport ? 'flagged_false' : 'verified', verifierId || 'System', {});
    return result.records[0].get('s').properties;
  } catch (err) {
    console.error('Neo4j verifySOS error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function logAuditEvent(incident_id, action, actor, metadata = {}) {
  const session = driver.session();
  try {
    await session.run(
      `CREATE (a:AuditEvent {
        id: randomUUID(),
        incident_id: $incident_id,
        action: $action,
        actor: $actor,
        metadata: $metadata,
        created_at: datetime()
      })
      WITH a
      MATCH (s:SOSEvent {incident_id: $incident_id})
      CREATE (a)-[:AUDITS]->(s)`,
      {
        incident_id,
        action,
        actor,
        metadata
      }
    );
  } catch (err) {
    console.error('Neo4j logAuditEvent error:', err);
  } finally {
    await session.close();
  }
}

async function getActiveSOS() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent)
       WHERE s.status IN ['open', 'assigned', 'escalated']
       OPTIONAL MATCH (p:Person)-[:SENT_SOS]->(s)
       OPTIONAL MATCH (t:Team)-[:ASSIGNED_TO]->(s)
       RETURN s, p, t
       ORDER BY s.created_at DESC`
    );
    return result.records.map((record) => ({
      sos: record.get('s').properties,
      person: record.get('p')?.properties || null,
      team: record.get('t')?.properties || null,
    }));
  } catch (err) {
    console.error('Neo4j getActiveSOS error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getSOSById(incident_id) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {incident_id: $incident_id})
       OPTIONAL MATCH (p:Person)-[:SENT_SOS]->(s)
       OPTIONAL MATCH (t:Team)-[:ASSIGNED_TO]->(s)
       RETURN s, p, t`,
      { incident_id }
    );
    if (result.records.length === 0) return null;
    const record = result.records[0];
    return {
      sos: record.get('s').properties,
      person: record.get('p')?.properties || null,
      team: record.get('t')?.properties || null,
    };
  } catch (err) {
    console.error('Neo4j getSOSById error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function markResolved(incident_id, actor = 'System') {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {incident_id: $incident_id})
       SET s.status = 'resolved', s.resolved_at = datetime()
       WITH s
       OPTIONAL MATCH (t:Team)-[:ASSIGNED_TO]->(s)
       SET t.status = 'available'
       RETURN s`,
      { incident_id }
    );
    if (result.records.length === 0) return null;
    
    const sos = result.records[0].get('s').properties;
    await logAuditEvent(incident_id, 'resolved', actor, { status: 'resolved' });
    
    // Log incident data for ML training
    try {
      const { logIncidentData } = require('./incidentData');
      const createdDate = new Date(sos.created_at);
      const resolvedDate = new Date();
      const resolutionTimeSeconds = Math.floor((resolvedDate - createdDate) / 1000);
      
      await logIncidentData({
        incident_id,
        severity: sos.severity,
        disaster_type: sos.disaster_type,
        condition_text: sos.condition_text,
        photo_url: sos.photo_url,
        lat: sos.lat,
        lng: sos.lng,
        channel: sos.channel,
        outcome: 'resolved',
        resolution_time_seconds: resolutionTimeSeconds,
      });
    } catch (logErr) {
      console.error('Error logging incident data:', logErr);
    }
    
    return sos;
  } catch (err) {
    console.error('Neo4j markResolved error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function assignTeam(incident_id, team_id, actor = 'System') {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {incident_id: $incident_id})
       MATCH (t:Team {id: $team_id})
       WHERE t.status = 'available'
       MERGE (t)-[r:ASSIGNED_TO]->(s)
       ON CREATE SET r.assigned_at = datetime()
       SET s.status = 'assigned', t.status = 'busy'
       RETURN s, t`,
      { incident_id, team_id }
    );
    if (result.records.length === 0) return null;
    await logAuditEvent(incident_id, 'assigned', actor, { status: 'assigned', team_id });
    return {
      sos: result.records[0].get('s').properties,
      team: result.records[0].get('t').properties,
    };
  } catch (err) {
    console.error('Neo4j assignTeam error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function findNearestAvailableTeam(lat, lng) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Team {status: 'available'})
       WITH t,
         point({latitude: $lat, longitude: $lng}) AS sosPoint,
         point({latitude: t.lat, longitude: t.lng}) AS teamPoint
       WITH t, point.distance(sosPoint, teamPoint) AS dist
       ORDER BY dist ASC
       LIMIT 1
       RETURN t, dist`,
      { lat: parseFloat(lat), lng: parseFloat(lng) }
    );
    if (result.records.length === 0) return null;
    const record = result.records[0];
    return {
      team: record.get('t').properties,
      distance_m: neo4j.isInt(record.get('dist'))
        ? record.get('dist').toNumber()
        : record.get('dist'),
    };
  } catch (err) {
    console.error('Neo4j findNearestAvailableTeam error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function detectSOSClusters() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {status: 'open'})
       WHERE s.created_at > datetime() - duration('PT30M')
       WITH s, point({latitude: s.lat, longitude: s.lng}) AS center
       MATCH (s2:SOSEvent {status: 'open'})
       WHERE s2.created_at > datetime() - duration('PT30M')
       WITH s, center, s2,
         point({latitude: s2.lat, longitude: s2.lng}) AS p2
       WHERE point.distance(center, p2) < 500
       WITH s.lat AS lat, s.lng AS lng, count(DISTINCT s2) AS cluster_size,
         collect(DISTINCT s2.incident_id) AS incident_ids
       WHERE cluster_size >= 3
       RETURN lat, lng, cluster_size, incident_ids`
    );
    return result.records.map((record) => ({
      lat: record.get('lat'),
      lng: record.get('lng'),
      cluster_size: neo4j.isInt(record.get('cluster_size'))
        ? record.get('cluster_size').toNumber()
        : record.get('cluster_size'),
      incident_ids: record.get('incident_ids'),
    }));
  } catch (err) {
    console.error('Neo4j detectSOSClusters error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getHistoricalClusters(daysBack = 30) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent)
       WHERE s.created_at > datetime() - duration('P${daysBack}D')
       WITH s, point({latitude: s.lat, longitude: s.lng}) AS center
       MATCH (s2:SOSEvent)
       WHERE s2.created_at > datetime() - duration('P${daysBack}D')
       WITH s, center, s2,
         point({latitude: s2.lat, longitude: s2.lng}) AS p2
       WHERE point.distance(center, p2) < 1000
       WITH s.lat AS lat, s.lng AS lng, count(DISTINCT s2) AS total_incidents,
         collect(DISTINCT s2.disaster_type) AS disaster_types,
         collect(DISTINCT s2.incident_id) AS incident_ids
       WHERE total_incidents >= 5
       RETURN lat, lng, total_incidents, disaster_types, incident_ids
       ORDER BY total_incidents DESC`
    );
    return result.records.map((record) => ({
      lat: record.get('lat'),
      lng: record.get('lng'),
      total_incidents: neo4j.isInt(record.get('total_incidents'))
        ? record.get('total_incidents').toNumber()
        : record.get('total_incidents'),
      disaster_types: record.get('disaster_types'),
      incident_ids: record.get('incident_ids'),
    }));
  } catch (err) {
    console.error('Neo4j getHistoricalClusters error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function detectResourceShortages() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (r:Resource)
       WHERE r.quantity < r.minimum_threshold
       RETURN r`
    );
    return result.records.map((record) => record.get('r').properties);
  } catch (err) {
    console.error('Neo4j detectResourceShortages error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function escalationCheck() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent)
       WHERE s.status IN ['open', 'assigned']
         AND s.created_at < datetime() - duration('PT15M')
         AND s.severity >= 4
         AND s.status <> 'escalated'
       OPTIONAL MATCH (p:Person)-[:SENT_SOS]->(s)
       RETURN s, p`
    );
    return result.records.map((record) => ({
      sos: record.get('s').properties,
      person: record.get('p')?.properties || null,
    }));
  } catch (err) {
    console.error('Neo4j escalationCheck error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function setEscalated(incident_id, actor = 'System') {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {incident_id: $incident_id})
       SET s.status = 'escalated', s.escalated_at = datetime()
       RETURN s`,
      { incident_id }
    );
    if (result.records.length === 0) return null;
    await logAuditEvent(incident_id, 'escalated', actor, { status: 'escalated' });
    return result.records[0].get('s').properties;
  } catch (err) {
    console.error('Neo4j setEscalated error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function updateTeamLocation(team_id, lat, lng) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Team {id: $team_id})
       SET t.lat = $lat, t.lng = $lng, t.last_location_at = datetime()
       RETURN t`,
      { team_id, lat: parseFloat(lat), lng: parseFloat(lng) }
    );
    if (result.records.length === 0) return null;
    return result.records[0].get('t').properties;
  } catch (err) {
    console.error('Neo4j updateTeamLocation error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function updateTeamStatus(team_id, status, incident_id = null) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Team {id: $team_id})
       SET t.status = $status, t.status_updated_at = datetime(), t.current_incident_id = $incident_id
       RETURN t`,
      { team_id, status, incident_id }
    );
    if (result.records.length === 0) return null;
    return result.records[0].get('t').properties;
  } catch (err) {
    console.error('Neo4j updateTeamStatus error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function registerTeamPushToken(team_id, token) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Team {id: $team_id})
       SET t.push_token = $token, t.token_updated_at = datetime()
       RETURN t`,
      { team_id, token }
    );
    if (result.records.length === 0) return null;
    return result.records[0].get('t').properties;
  } catch (err) {
    console.error('Neo4j registerTeamPushToken error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getAllTeams() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Team)
       OPTIONAL MATCH (t)-[:ASSIGNED_TO]->(s:SOSEvent)
       WHERE s.status IN ['assigned', 'escalated']
       RETURN t, collect(s) AS active_sos`
    );
    return result.records.map((record) => ({
      team: record.get('t').properties,
      active_sos: (record.get('active_sos') || [])
        .filter(Boolean)
        .map((s) => s.properties),
    }));
  } catch (err) {
    console.error('Neo4j getAllTeams error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getAdminStatusMetrics() {
  const session = driver.session();
  try {
    const result = await session.run(
      `OPTIONAL MATCH (s:SOSEvent)
       WITH count(s) AS totalCases,
            count(CASE WHEN s.status = 'open' THEN 1 END) AS openCases,
            count(CASE WHEN s.status = 'assigned' THEN 1 END) AS assignedCases,
            count(CASE WHEN s.status = 'resolved' THEN 1 END) AS resolvedCases,
            count(CASE WHEN s.status = 'escalated' THEN 1 END) AS escalatedCases,
            count(CASE WHEN s.channel = 'app' THEN 1 END) AS appCases,
            count(CASE WHEN s.channel = 'sms' THEN 1 END) AS smsCases,
            count(CASE WHEN s.channel = 'ble' THEN 1 END) AS bleCases,
            count(CASE WHEN s.channel = 'offline' THEN 1 END) AS offlineCases
       OPTIONAL MATCH (t:Team)
       WITH totalCases, openCases, assignedCases, resolvedCases, escalatedCases,
            appCases, smsCases, bleCases, offlineCases,
            count(t) AS totalRescuers,
            count(CASE WHEN t.status = 'available' THEN 1 END) AS availableRescuers
       RETURN totalCases, openCases, assignedCases, resolvedCases, escalatedCases,
              appCases, smsCases, bleCases, offlineCases,
              totalRescuers, availableRescuers`
    );
    const record = result.records[0];
    const getVal = (key) => {
      const val = record.get(key);
      return val && typeof val === 'object' && val.low !== undefined ? val.low : (val || 0);
    };

    return {
      channelStats: {
        app: getVal('appCases'),
        sms: getVal('smsCases'),
        ble: getVal('bleCases'),
        offline: getVal('offlineCases'),
      },
      metrics: {
        totalCases: getVal('totalCases'),
        openCases: getVal('openCases'),
        assignedCases: getVal('assignedCases'),
        resolvedCases: getVal('resolvedCases'),
        escalatedCases: getVal('escalatedCases'),
        activeRescuers: getVal('totalRescuers'),
        availableRescuers: getVal('availableRescuers'),
      }
    };
  } catch (err) {
    console.error('Neo4j getAdminStatusMetrics error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getAllIncidents() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent)
       OPTIONAL MATCH (p:Person)-[:SENT_SOS]->(s)
       OPTIONAL MATCH (t:Team)-[:ASSIGNED_TO]->(s)
       RETURN s, p, t
       ORDER BY s.created_at DESC
       LIMIT 100`
    );
    return result.records.map((record) => ({
      sos: record.get('s').properties,
      person: record.get('p')?.properties || null,
      team: record.get('t')?.properties || null,
    }));
  } catch (err) {
    console.error('Neo4j getAllIncidents error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function updateSOSWithAIAnalysis(incidentId, analysisData) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {incident_id: $incidentId})
       SET s.ai_cause = $cause,
           s.ai_evacuator_instructions = $evacuator_instructions,
           s.ai_victim_instructions = $victim_instructions,
           s.ai_audio_script = $audio_script
       RETURN s`,
      {
        incidentId,
        cause: analysisData.cause || '',
        evacuator_instructions: analysisData.evacuator_instructions || '',
        victim_instructions: analysisData.victim_instructions || '',
        audio_script: analysisData.audio_script || '',
      }
    );
    return result.records.length > 0 ? result.records[0].get('s').properties : null;
  } catch (err) {
    console.error('Neo4j updateSOSWithAIAnalysis error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function createUser(username, passwordHash, role, tenantId = 'default', nextOfKinName = '', nextOfKinPhone = '') {
  const session = driver.session();
  try {
    const specialId = generateSpecialId();
    const result = await session.run(
      `CREATE (u:User {
        id: randomUUID(),
        username: $username,
        password_hash: $passwordHash,
        role: $role,
        tenant_id: $tenantId,
        special_id: $specialId,
        onboarding_completed: false,
        next_of_kin_name: $nextOfKinName,
        next_of_kin_phone: $nextOfKinPhone,
        created_at: datetime()
      })
      RETURN u`,
      { username, passwordHash, role, tenantId, specialId, nextOfKinName, nextOfKinPhone }
    );
    if (result.records.length === 0) return null;
    const user = result.records[0].get('u').properties;
    delete user.password_hash;
    return user;
  } catch (err) {
    console.error('Neo4j createUser error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

function generateSpecialId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 6);
  return `RAK-${timestamp}-${random}`.toUpperCase();
}

async function updateUserOnboarding(userId, details, completed = true) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId})
       SET u += $details, u.onboarding_completed = $completed
       RETURN u`,
      { userId, details, completed }
    );
    if (result.records.length === 0) return null;
    const user = result.records[0].get('u').properties;
    delete user.password_hash;
    return user;
  } catch (err) {
    console.error('Neo4j updateUserOnboarding error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getUserByUsername(username) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (u:User {username: $username}) RETURN u`,
      { username }
    );
    if (result.records.length === 0) return null;
    return result.records[0].get('u').properties;
  } catch (err) {
    console.error('Neo4j getUserByUsername error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function closeDriver() {
  try {
    await driver.close();
  } catch (err) {
    console.error('Neo4j driver close error:', err);
  }
}

module.exports = {
  driver,
  createSOSEvent,
  getActiveSOS,
  getSOSById,
  markResolved,
  assignTeam,
  findNearestAvailableTeam,
  detectSOSClusters,
  detectResourceShortages,
  escalationCheck,
  setEscalated,
  updateTeamLocation,
  updateTeamStatus,
  registerTeamPushToken,
  getAllTeams,
  getAdminStatusMetrics,
  getAllIncidents,
  updateSOSWithAIAnalysis,
  logAuditEvent,
  createUser,
  getUserByUsername,
  updateUserOnboarding,
  verifySOS,
  getHistoricalClusters,
  closeDriver,
};
