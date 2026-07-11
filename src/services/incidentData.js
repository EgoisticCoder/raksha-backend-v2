
const { driver } = require('./neo4j');

/**
 * Incident Data Capture for Future ML Model
 * Stores structured incident data for later training
 */

async function logIncidentData(incidentData) {
  const session = driver.session();
  try {
    await session.run(
      `CREATE (d:IncidentData {
        id: randomUUID(),
        incident_id: $incident_id,
        severity: $severity,
        disaster_type: $disaster_type,
        condition_text: $condition_text,
        photo_url: $photo_url,
        lat: $lat,
        lng: $lng,
        channel: $channel,
        created_at: datetime(),
        outcome: $outcome,
        resolution_time_seconds: $resolution_time_seconds
      })`,
      incidentData
    );
  } catch (err) {
    console.error('Error logging incident data:', err);
  } finally {
    await session.close();
  }
}

async function getIncidentDataForTraining(limit = 1000) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (d:IncidentData)
       RETURN d
       ORDER BY d.created_at DESC
       LIMIT $limit`,
      { limit }
    );
    return result.records.map(record => record.get('d').properties);
  } catch (err) {
    console.error('Error fetching training data:', err);
    return [];
  } finally {
    await session.close();
  }
}

module.exports = {
  logIncidentData,
  getIncidentDataForTraining,
};
