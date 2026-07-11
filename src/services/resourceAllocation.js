
const { getAllTeams, getActiveSOS } = require('./neo4j');

/**
 * Weighted Greedy Resource Allocation
 * Assigns available teams to active SOS incidents
 * 
 * Weights:
 * - Proximity (closer = higher priority)
 * - Incident Severity (higher = higher priority)
 */

function calculateScore(team, sos) {
  let score = 0;
  
  // Distance score (closer is better)
  if (team.lat && team.lng) {
    const distance = haversineDistance(
      team.lat, team.lng,
      sos.lat, sos.lng
    );
    // Normalize distance to 0-100 (max 10km = 0 score)
    const maxDistance = 10000; // meters
    score += Math.max(0, 100 - (distance / maxDistance) * 100);
  }
  
  // Severity score (higher severity = higher priority)
  score += (sos.severity || 3) * 20; // each severity level adds 20 points
  
  return score;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; // Distance in meters
}

async function runGreedyAllocation() {
  const teams = await getAllTeams();
  const activeSOS = await getActiveSOS();
  
  // Filter available teams
  const availableTeams = teams.filter(t => t.team.status === 'available');
  // Filter open SOS
  const openIncidents = activeSOS.filter(s => s.sos.status === 'open');
  
  const assignments = [];
  
  for (const incident of openIncidents) {
    if (availableTeams.length === 0) break;
    
    // Score all available teams for this incident
    const scoredTeams = availableTeams.map(team => ({
      team,
      score: calculateScore(team.team, incident.sos)
    }));
    
    // Sort by score descending
    scoredTeams.sort((a, b) => b.score - a.score);
    
    // Pick the best team
    if (scoredTeams.length > 0) {
      assignments.push({
        incident_id: incident.sos.incident_id,
        team_id: scoredTeams[0].team.team.id,
        score: scoredTeams[0].score
      });
      
      // Remove the team from available
      const index = availableTeams.findIndex(t => t.team.id === scoredTeams[0].team.team.id);
      if (index > -1) availableTeams.splice(index, 1);
    }
  }
  
  return {
    assignments,
    remaining_incidents: openIncidents.length - assignments.length,
    remaining_teams: availableTeams.length
  };
}

module.exports = {
  runGreedyAllocation,
  calculateScore,
};
