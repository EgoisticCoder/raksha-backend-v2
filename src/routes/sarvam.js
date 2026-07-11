const express = require('express');
const { speechToText, textToSpeech, translateText } = require('../services/sarvam');
const { sttLimiter, ttsLimiter, translateLimiter } = require('../middleware/rateLimiter');
const { validate, sttSchema, ttsSchema, translateSchema } = require('../middleware/validator');

const router = express.Router();

router.post('/stt', sttLimiter, validate(sttSchema), async (req, res) => {
  try {
    const result = await speechToText(req.validated.audio, req.validated.language_code);
    return res.json(result);
  } catch (err) {
    console.error('POST /sarvam/stt error:', err);
    return res.status(502).json({ error: 'Speech-to-text failed', message: err.message });
  }
});

router.post('/tts', ttsLimiter, validate(ttsSchema), async (req, res) => {
  try {
    const result = await textToSpeech(req.validated.text, req.validated.language_code);
    return res.json(result);
  } catch (err) {
    console.error('POST /sarvam/tts error:', err);
    return res.status(502).json({ error: 'Text-to-speech failed', message: err.message });
  }
});

router.post('/translate', translateLimiter, validate(translateSchema), async (req, res) => {
  try {
    const result = await translateText(
      req.validated.text,
      req.validated.source_language_code,
      req.validated.target_language_code
    );
    return res.json(result);
  } catch (err) {
    console.error('POST /sarvam/translate error:', err);
    return res.status(502).json({ error: 'Translation failed', message: err.message });
  }
});

module.exports = router;
