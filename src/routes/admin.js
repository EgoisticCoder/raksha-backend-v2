const express = require('express');
const router = express.Router();
const { getAdminStatusMetrics, getSOSById, updateSOSWithAIAnalysis, getHistoricalClusters, getAllIncidents } = require('../services/neo4j');
const { analyzeIncidentWithLLaMA } = require('../services/groq');
const { textToSpeech } = require('../services/sarvam');
const { getIncidentStats, getDisasterTypeBreakdown, getTeamPerformance } = require('../services/analytics');
const { getIncidentDataForTraining } = require('../services/incidentData');
const { getNeo4jUsage, getCloudinaryUsage } = require('../services/infraMonitoring');
const { generateCAPAlert } = require('../services/capExport');

router.get('/status', async (req, res) => {
  try {
    const stats = await getAdminStatusMetrics();
    return res.json({
      ...stats,
      agents: global.cronTracker || {}
    });
  } catch (err) {
    console.error('GET /admin/status error:', err);
    return res.status(500).json({ error: 'Failed to fetch admin status' });
  }
});

router.get('/incidents', async (req, res) => {
  try {
    const incidents = await getAllIncidents();
    return res.json(incidents);
  } catch (err) {
    console.error('GET /admin/incidents error:', err);
    return res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

router.get('/historical-clusters', async (req, res) => {
  try {
    const daysBack = parseInt(req.query.days_back, 10) || 30;
    const clusters = await getHistoricalClusters(daysBack);
    return res.json(clusters);
  } catch (err) {
    console.error('GET /admin/historical-clusters error:', err);
    return res.status(500).json({ error: 'Failed to fetch historical clusters' });
  }
});

router.get('/analytics/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const stats = await getIncidentStats(days);
    return res.json(stats);
  } catch (err) {
    console.error('GET /admin/analytics/stats error:', err);
    return res.status(500).json({ error: 'Failed to fetch analytics stats' });
  }
});

router.get('/analytics/disaster-types', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const breakdown = await getDisasterTypeBreakdown(days);
    return res.json(breakdown);
  } catch (err) {
    console.error('GET /admin/analytics/disaster-types error:', err);
    return res.status(500).json({ error: 'Failed to fetch disaster type breakdown' });
  }
});

router.get('/analytics/teams', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const performance = await getTeamPerformance(days);
    return res.json(performance);
  } catch (err) {
    console.error('GET /admin/analytics/teams error:', err);
    return res.status(500).json({ error: 'Failed to fetch team performance' });
  }
});

router.get('/training-data', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 1000;
    const data = await getIncidentDataForTraining(limit);
    return res.json(data);
  } catch (err) {
    console.error('GET /admin/training-data error:', err);
    return res.status(500).json({ error: 'Failed to fetch training data' });
  }
});

router.post('/analyze-sos', async (req, res) => {
  const { incidentId } = req.body;
  if (!incidentId) {
    return res.status(400).json({ error: 'incidentId is required' });
  }

  try {
    const incident = await getSOSById(incidentId);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const { condition_text, photo_url, language } = incident.sos;
    const langCode = language || 'en';

    // 1. Run LLaMA AI vision/text analysis
    const analysis = await analyzeIncidentWithLLaMA(condition_text, photo_url, langCode);

    // 2. Save analysis fields to Neo4j Event node
    await updateSOSWithAIAnalysis(incidentId, analysis);

    // 3. Pre-generate Sarvam TTS audio block for the calming instructions script
    let audioBase64 = null;
    try {
      const ttsResult = await textToSpeech(analysis.audio_script, langCode === 'hi' ? 'hi-IN' : 'en-IN');
      audioBase64 = ttsResult.audio || null;
    } catch (ttsErr) {
      console.warn('Sarvam TTS pre-generation error:', ttsErr.message);
    }

    return res.json({
      success: true,
      analysis,
      audio: audioBase64
    });
  } catch (err) {
    console.error('POST /admin/analyze-sos error:', err);
    return res.status(500).json({ error: 'Failed to analyze incident with LLaMA AI' });
  }
});

router.post('/tts', async (req, res) => {
  const { text, language } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const langCode = language === 'hi' ? 'hi-IN' : 'en-IN';
    const ttsResult = await textToSpeech(text, langCode);
    return res.json({
      success: true,
      audio: ttsResult.audio || null
    });
  } catch (err) {
    console.error('POST /admin/tts error:', err);
    return res.status(500).json({ error: 'TTS audio synthesis failed' });
  }
});

router.get('/infra/neo4j', async (req, res) => {
  try {
    const usage = await getNeo4jUsage();
    return res.json(usage);
  } catch (err) {
    console.error('GET /admin/infra/neo4j error:', err);
    return res.status(500).json({ error: 'Failed to fetch Neo4j usage' });
  }
});

router.get('/infra/cloudinary', async (req, res) => {
  try {
    const usage = await getCloudinaryUsage();
    return res.json(usage);
  } catch (err) {
    console.error('GET /admin/infra/cloudinary error:', err);
    return res.status(500).json({ error: 'Failed to fetch Cloudinary usage' });
  }
});

router.get('/cap/:incidentId', async (req, res) => {
  try {
    const { incidentId } = req.params;
    const incident = await getSOSById(incidentId);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    const capAlert = generateCAPAlert({
      ...incident.sos,
      incident_id: incidentId,
    });
    return res.json(capAlert);
  } catch (err) {
    console.error('GET /admin/cap/:incidentId error:', err);
    return res.status(500).json({ error: 'Failed to generate CAP alert' });
  }
});

module.exports = router;
