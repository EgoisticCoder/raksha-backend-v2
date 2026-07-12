require('dotenv').config();
const { escalationCheck, setEscalated, getSOSById } = require('../src/services/neo4j');
const { sendSimpleSMS, buildEscalationMessage } = require('../src/services/unifiedSMS');
const { emitEvent } = require('../src/utils/socket');

async function runEscalationAgent() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Escalation agent running...`);

  try {
    const candidates = await escalationCheck();
    const escalated = [];

    for (const { sos, person } of candidates) {
      const updated = await setEscalated(sos.incident_id);
      if (!updated) continue;

      const payload = await getSOSById(sos.incident_id);
      emitEvent('escalation', payload);

      const message = buildEscalationMessage(sos, person);
      const supervisorPhone = process.env.SUPERVISOR_PHONE;

      if (supervisorPhone) {
        await sendSimpleSMS(supervisorPhone, message);
      }

      console.log(`[${timestamp}] Escalated ${sos.incident_id} severity ${sos.severity}`);
      escalated.push(sos.incident_id);
    }

    if (escalated.length === 0) {
      console.log(`[${timestamp}] No escalations needed`);
    }

    return { escalated };
  } catch (err) {
    console.error(`[${timestamp}] Escalation agent error:`, err);
    throw err;
  }
}

if (require.main === module) {
  runEscalationAgent()
    .then((result) => {
      console.log('Escalation agent completed:', JSON.stringify(result));
      process.exit(0);
    })
    .catch(() => process.exit(1));
}

module.exports = { runEscalationAgent };
