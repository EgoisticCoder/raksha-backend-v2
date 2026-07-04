require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cron = require('node-cron');
const { Server } = require('socket.io');
const { setIO } = require('./utils/socket');
const { closeDriver } = require('./services/neo4j');
const { apiKeyAuth } = require('./middleware/auth');
const { globalLimiter } = require('./middleware/rateLimiter');

const sosRoutes = require('./routes/sos');
const teamsRoutes = require('./routes/teams');
const sarvamRoutes = require('./routes/sarvam');
const smsRoutes = require('./routes/sms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

setIO(io);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(globalLimiter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(apiKeyAuth);

app.use('/sos', sosRoutes);
app.use('/teams', teamsRoutes);
app.use('/sarvam', sarvamRoutes);
app.use('/sms', smsRoutes);

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on('join', (room) => {
    if (room) socket.join(room);
  });
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (process.env.ENABLE_IN_PROCESS_CRONS !== 'false') {
  cron.schedule('*/1 * * * *', async () => {
    try {
      const { runAlertAgent } = require('../agents/alertAgent');
      await runAlertAgent();
    } catch (err) {
      console.error('Alert agent cron error:', err);
    }
  });

  cron.schedule('*/5 * * * *', async () => {
    try {
      const { runResourceAgent } = require('../agents/resourceAgent');
      await runResourceAgent();
    } catch (err) {
      console.error('Resource agent cron error:', err);
    }
  });

  cron.schedule('*/2 * * * *', async () => {
    try {
      const { runEscalationAgent } = require('../agents/escalationAgent');
      await runEscalationAgent();
    } catch (err) {
      console.error('Escalation agent cron error:', err);
    }
  });

  console.log('Background agents scheduled: alert(1m), resource(5m), escalation(2m)');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`RAKSHA backend running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  server.close();
  await closeDriver();
  process.exit(0);
});

module.exports = { app, server, io };
