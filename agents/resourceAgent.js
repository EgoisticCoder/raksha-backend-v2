require('dotenv').config();
const { detectResourceShortages } = require('../src/services/neo4j');
const { emitEvent } = require('../src/utils/socket');

async function runResourceAgent() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Resource agent running...`);

  try {
    const shortages = await detectResourceShortages();

    if (shortages.length === 0) {
      console.log(`[${timestamp}] No resource shortages detected`);
      return { shortages: [] };
    }

    const payload = { shortages, timestamp };
    emitEvent('resource_alert', payload);

    for (const resource of shortages) {
      console.log(
        `[${timestamp}] Shortage: ${resource.name} - ${resource.quantity}/${resource.minimum_threshold} ${resource.unit}`
      );
    }

    return { shortages };
  } catch (err) {
    console.error(`[${timestamp}] Resource agent error:`, err);
    throw err;
  }
}

if (require.main === module) {
  runResourceAgent()
    .then((result) => {
      console.log('Resource agent completed:', JSON.stringify(result));
      process.exit(0);
    })
    .catch(() => process.exit(1));
}

module.exports = { runResourceAgent };
