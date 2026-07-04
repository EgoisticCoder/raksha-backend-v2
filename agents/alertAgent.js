require('dotenv').config();
const { detectSOSClusters } = require('../src/services/neo4j');
const { emitEvent } = require('../src/utils/socket');
const { sendExpoPush } = require('../src/services/push');

async function runAlertAgent() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Alert agent running...`);

  try {
    const clusters = await detectSOSClusters();

    if (clusters.length === 0) {
      console.log(`[${timestamp}] No SOS clusters detected`);
      return { clusters: [] };
    }

    for (const cluster of clusters) {
      const payload = {
        lat: cluster.lat,
        lng: cluster.lng,
        cluster_size: cluster.cluster_size,
        incident_ids: cluster.incident_ids,
        timestamp,
      };

      emitEvent('cluster_alert', payload);
      console.log(`[${timestamp}] Cluster alert: ${cluster.cluster_size} SOS at ${cluster.lat},${cluster.lng}`);

      if (process.env.EXPO_ACCESS_TOKEN) {
        await sendExpoPush(
          process.env.SUPERVISOR_PUSH_TOKEN,
          'SOS Cluster Detected',
          `${cluster.cluster_size} emergencies within 500m`,
          payload
        );
      }
    }

    return { clusters };
  } catch (err) {
    console.error(`[${timestamp}] Alert agent error:`, err);
    throw err;
  }
}

if (require.main === module) {
  runAlertAgent()
    .then((result) => {
      console.log('Alert agent completed:', JSON.stringify(result));
      process.exit(0);
    })
    .catch(() => process.exit(1));
}

module.exports = { runAlertAgent };
