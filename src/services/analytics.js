
const { driver } = require('./neo4j');

async function getIncidentStats(days = 30) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent)
       WHERE s.created_at > datetime() - duration('P${days}D')
       WITH 
         count(s) AS total_incidents,
         count(CASE WHEN s.status = 'open' THEN 1 END) AS open_incidents,
         count(CASE WHEN s.status = 'assigned' THEN 1 END) AS assigned_incidents,
         count(CASE WHEN s.status = 'resolved' THEN 1 END) AS resolved_incidents,
         count(CASE WHEN s.status = 'escalated' THEN 1 END) AS escalated_incidents,
         avg(CASE WHEN s.status = 'resolved' 
                  THEN duration.between(s.created_at, s.resolved_at).seconds 
                  ELSE null END) AS avg_resolution_time_seconds
       RETURN 
         total_incidents, 
         open_incidents, 
         assigned_incidents, 
         resolved_incidents, 
         escalated_incidents, 
         avg_resolution_time_seconds`,
      { days }
    );
    const record = result.records[0];
    return {
      total_incidents: record.get('total_incidents').low || 0,
      open_incidents: record.get('open_incidents').low || 0,
      assigned_incidents: record.get('assigned_incidents').low || 0,
      resolved_incidents: record.get('resolved_incidents').low || 0,
      escalated_incidents: record.get('escalated_incidents').low || 0,
      avg_resolution_time_seconds: record.get('avg_resolution_time_seconds') || 0,
    };
  } catch (err) {
    console.error('Error getting incident stats:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getDisasterTypeBreakdown(days = 30) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (s:SOSEvent)
       WHERE s.created_at > datetime() - duration('P${days}D')
       WITH s.disaster_type AS type, count(s) AS count
       RETURN type, count
       ORDER BY count DESC`,
      { days }
    );
    return result.records.map(record => ({
      type: record.get('type'),
      count: record.get('count').low || 0,
    }));
  } catch (err) {
    console.error('Error getting disaster type breakdown:', err);
    throw err;
  } finally {
    await session.close();
  }
}

async function getTeamPerformance(days = 30) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Team)-[r:ASSIGNED_TO]->(s:SOSEvent)
       WHERE r.assigned_at > datetime() - duration('P${days}D')
       WITH t, count(s) AS assignments,
            avg(CASE WHEN s.status = 'resolved' 
                     THEN duration.between(r.assigned_at, s.resolved_at).seconds 
                     ELSE null END) AS avg_response_time_seconds
       RETURN t.id AS team_id, t.name AS team_name, assignments, avg_response_time_seconds
       ORDER BY assignments DESC`,
      { days }
    );
    return result.records.map(record => ({
      team_id: record.get('team_id'),
      team_name: record.get('team_name'),
      assignments: record.get('assignments').low || 0,
      avg_response_time_seconds: record.get('avg_response_time_seconds') || 0,
    }));
  } catch (err) {
    console.error('Error getting team performance:', err);
    throw err;
  } finally {
    await session.close();
  }
}

module.exports = {
  getIncidentStats,
  getDisasterTypeBreakdown,
  getTeamPerformance,
};
