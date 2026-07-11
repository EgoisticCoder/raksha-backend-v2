const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createUser, getUserByUsername, updateUserOnboarding } = require('../services/neo4j');
const { authenticateJWT, ROLES } = require('../middleware/jwt');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const existing = await getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser(username, passwordHash, role);
    return res.status(201).json(user);
  } catch (err) {
    console.error('POST /auth/register error:', err);
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '24h' }
    );
    const userData = { ...user };
    delete userData.password_hash;
    return res.json({ token, user: userData });
  } catch (err) {
    console.error('POST /auth/login error:', err);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

router.post('/onboarding', authenticateJWT, async (req, res) => {
  try {
    const { details, skip } = req.body;
    const user = await updateUserOnboarding(req.user.id, details || {}, !skip);
    return res.json(user);
  } catch (err) {
    console.error('POST /auth/onboarding error:', err);
    return res.status(500).json({ error: 'Failed to update onboarding' });
  }
});

module.exports = router;
