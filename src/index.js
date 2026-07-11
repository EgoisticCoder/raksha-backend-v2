require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { Server } = require('socket.io');
const { setIO } = require('./utils/socket');
const { closeDriver } = require('./services/neo4j');
const { apiKeyAuth } = require('./middleware/auth');
const { globalLimiter } = require('./middleware/rateLimiter');
const { authenticateJWT, authorizeRoles, ROLES } = require('./middleware/jwt');
const { setupScheduledJobs, closeQueuesAndWorkers } = require('./queues');

const authRoutes = require('./routes/auth');
const sosRoutes = require('./routes/sos');
const teamsRoutes = require('./routes/teams');
const sarvamRoutes = require('./routes/sarvam');
const smsRoutes = require('./routes/sms');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 5000,
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

app.use('/auth', authRoutes);

app.use(apiKeyAuth);

app.use('/sos', sosRoutes);
app.use('/teams', teamsRoutes);
app.use('/sarvam', sarvamRoutes);
app.use('/sms', smsRoutes);
app.use('/admin', authenticateJWT, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), adminRoutes);

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

setupScheduledJobs();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`RAKSHA backend running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  server.close();
  await closeQueuesAndWorkers();
  await closeDriver();
  process.exit(0);
});

module.exports = { app, server, io };
