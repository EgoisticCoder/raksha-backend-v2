const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { runAlertAgent } = require('../agents/alertAgent');
const { runResourceAgent } = require('../agents/resourceAgent');
const { runEscalationAgent } = require('../agents/escalationAgent');
const { runRouting } = require('../agents/routingAgent');
const { sendNotification } = require('./services/notification');

let connection;

try {
  connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
  });
  console.log('Redis connection initialized successfully');
  connection.on('error', (err) => {
    console.error('Redis connection error:', err);
  });
  connection.on('connect', () => {
    console.log('Redis connected');
  });
} catch (err) {
  console.error('Failed to initialize Redis connection:', err);
  connection = null;
}

const queues = connection ? {
  alert: new Queue('alert', { connection }),
  resource: new Queue('resource', { connection }),
  escalation: new Queue('escalation', { connection }),
  routing: new Queue('routing', { connection }),
  notification: new Queue('notification', { connection }),
} : {};

const workers = connection ? {
  alert: new Worker('alert', async (job) => {
    return await runAlertAgent();
  }, { connection }),
  resource: new Worker('resource', async (job) => {
    return await runResourceAgent();
  }, { connection }),
  escalation: new Worker('escalation', async (job) => {
    return await runEscalationAgent();
  }, { connection }),
  routing: new Worker('routing', async (job) => {
    return await runRouting(job.data.incident_id);
  }, { connection }),
  notification: new Worker('notification', async (job) => {
    return await sendNotification(job.data.phone, job.data.type, job.data.sos, job.data.person);
  }, { connection }),
} : {};

async function setupScheduledJobs() {
  if (!connection) {
    console.log('Redis not connected - skipping scheduled jobs');
    return;
  }
  try {
    await queues.alert.add('scheduled-alert', {}, {
      repeat: {
        every: 60000
      }
    });

    await queues.resource.add('scheduled-resource', {}, {
      repeat: {
        every: 300000
      }
    });

    await queues.escalation.add('scheduled-escalation', {}, {
      repeat: {
        every: 120000
      }
    });

    console.log('Scheduled jobs set up with BullMQ');
  } catch (err) {
    console.error('Failed to set up scheduled jobs:', err);
  }
}

async function closeQueuesAndWorkers() {
  for (const queue of Object.values(queues)) {
    await queue.close();
  }
  for (const worker of Object.values(workers)) {
    await worker.close();
  }
  await connection.quit();
}

module.exports = {
  queues,
  workers,
  setupScheduledJobs,
  closeQueuesAndWorkers
};
