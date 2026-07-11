const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SARVAM_BASE = 'https://api.sarvam.ai';
const TTS_CACHE_DIR = path.join(__dirname, '../../cache/tts');
const TRANSLATION_CACHE_DIR = path.join(__dirname, '../../cache/translation');

const SPEAKER_MAP = {
  'hi-IN': 'shubh',
  'bn-IN': 'shubh',
  'ta-IN': 'shubh',
  'te-IN': 'shubh',
  'mr-IN': 'shubh',
  'gu-IN': 'shubh',
  'kn-IN': 'shubh',
  'en-IN': 'shubh',
};

function ensureCacheDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getCacheKey(text, language) {
  return crypto.createHash('md5').update(`${text}${language}`).digest('hex');
}

function getTranslationCacheKey(text, sourceLang, targetLang) {
  return crypto.createHash('md5').update(`${text}${sourceLang}${targetLang}`).digest('hex');
}

function getCachedTTS(text, language) {
  ensureCacheDir(TTS_CACHE_DIR);
  const key = getCacheKey(text, language);
  const cachePath = path.join(TTS_CACHE_DIR, `${key}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return cached;
    } catch (err) {
      console.error('TTS cache read error:', err);
    }
  }
  return null;
}

function setCachedTTS(text, language, audioData) {
  ensureCacheDir(TTS_CACHE_DIR);
  const key = getCacheKey(text, language);
  const cachePath = path.join(TTS_CACHE_DIR, `${key}.json`);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(audioData));
  } catch (err) {
    console.error('TTS cache write error:', err);
  }
}

function getCachedTranslation(text, sourceLang, targetLang) {
  ensureCacheDir(TRANSLATION_CACHE_DIR);
  const key = getTranslationCacheKey(text, sourceLang, targetLang);
  const cachePath = path.join(TRANSLATION_CACHE_DIR, `${key}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return cached;
    } catch (err) {
      console.error('Translation cache read error:', err);
    }
  }
  return null;
}

function setCachedTranslation(text, sourceLang, targetLang, translationData) {
  ensureCacheDir(TRANSLATION_CACHE_DIR);
  const key = getTranslationCacheKey(text, sourceLang, targetLang);
  const cachePath = path.join(TRANSLATION_CACHE_DIR, `${key}.json`);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(translationData));
  } catch (err) {
    console.error('Translation cache write error:', err);
  }
}

function getAuthHeaders() {
  return {
    'api-subscription-key': process.env.SARVAM_API_KEY,
    'Content-Type': 'application/json',
  };
}

async function speechToText(audioBase64, languageCode = 'hi-IN') {
  if (!process.env.SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not configured');
  }

  try {
    const response = await fetch(`${SARVAM_BASE}/speech-to-text`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        model: 'saaras:v3',
        mode: 'transcribe',
        language_code: languageCode,
        input: audioBase64,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam STT error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return {
      transcript: data.transcript || data.text || data.output || '',
      language: data.language_code || languageCode,
    };
  } catch (err) {
    console.error('Sarvam speechToText error:', err);
    throw err;
  }
}

async function textToSpeech(text, languageCode = 'hi-IN') {
  if (!process.env.SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not configured');
  }

  const cached = getCachedTTS(text, languageCode);
  if (cached) {
    return { ...cached, cached: true };
  }

  try {
    const response = await fetch(`${SARVAM_BASE}/text-to-speech`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        text,
        target_language_code: languageCode,
        model: 'bulbul:v3',
        speaker: SPEAKER_MAP[languageCode] || 'shubh',
        speech_sample_rate: '24000',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam TTS error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const result = {
      audios: data.audios || [],
      audio: data.audios?.[0] || data.audio || null,
      request_id: data.request_id,
      cached: false,
    };

    setCachedTTS(text, languageCode, result);
    return result;
  } catch (err) {
    console.error('Sarvam textToSpeech error:', err);
    throw err;
  }
}

async function translateText(text, sourceLang = 'en-IN', targetLang = 'hi-IN') {
  if (!process.env.SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not configured');
  }

  const cached = getCachedTranslation(text, sourceLang, targetLang);
  if (cached) {
    return { ...cached, cached: true };
  }

  try {
    const response = await fetch(`${SARVAM_BASE}/translate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: text,
        source_language_code: sourceLang,
        target_language_code: targetLang,
        model: 'saaras:v3',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam translation error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const result = {
      translatedText: data.translated_text || data.output || data.translation || text,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      request_id: data.request_id,
      cached: false,
    };

    setCachedTranslation(text, sourceLang, targetLang, result);
    return result;
  } catch (err) {
    console.error('Sarvam translateText error:', err);
    return {
      translatedText: text,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      cached: false,
      error: err.message,
    };
  }
}

module.exports = { speechToText, textToSpeech, translateText, getCachedTTS };
