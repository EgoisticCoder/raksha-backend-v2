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
        id: $person_id, name: $name, age: $age,
        language: $language, phone: $phone
      })
      CREATE (s:SOSEvent {
        incident_id: $incident_id, lat: $lat, lng: $lng,
        severity: $severity, disaster_type: $disaster_type,
        condition_text: $condition_text, photo_url: $photo_url,
        accuracy_m: $accuracy_m, status: 'open',
        channel: $channel, created_at: datetime()
      })
      CREATE (p)-[:SENT_SOS]->(s)
      RETURN s.incident_id AS incident_id, s AS sos`,
      {
        person_id: data.person_id,
        name: data.name || 'Unknown',
        age: neo4j.int(data.age || 0),
        language: data.language || 'en',
        phone: data.phone || '',
        incident_id: data.incident_id,
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lng),
        severity: neo4j.int(data.severity || 3),
        disaster_type: data.disaster_type || 'unknown',
        condition_text: data.condition_text || '',
        photo_url: data.photo_url || null,
        accuracy_m: parseFloat(data.accuracy_m || 0),
        channel: data.channel || 'app',
      }
    );
    const row = recordToObject(result.records[0]);
    return { incident_id: row.incident_id, sos: row.sos };
  } catch (err) {
    console.error('Neo4j createSOSEvent error:', err);
    throw err;
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

async function markResolved(incident_id) {
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
    return result.records[0].get('s').properties;
  } catch (err) {
    console.error('Neo4j markResolved error:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function assignTeam(incident_id, team_id) {
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

async function setEscalated(incident_id) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent {incident_id: $incident_id})
       SET s.status = 'escalated', s.escalated_at = datetime()
       RETURN s`,
      { incident_id }
    );
    if (result.records.length === 0) return null;
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
  registerTeamPushToken,
  getAllTeams,
  closeDriver,
};
