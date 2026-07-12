const { translateText } = require('./sarvam');

async function classifySeverity(photoUrl) {
  return { 
    severity: 3, 
    disaster_type: 'unknown', 
    condition_text: 'Emergency situation reported' 
  };
}

async function analyzeIncidentWithLLaMA(incidentText, photoUrl, language = 'en') {
  const defaultAnalysis = {
    cause: 'General Emergency',
    evacuator_instructions: 'Proceed with caution. Assess the situation on arrival.',
    victim_instructions: 'Stay where you are if safe. Help is coming.',
    audio_script: 'Help is on the way. Please stay safe.',
  };

  try {
    if (language === 'hi' || language === 'hi-IN') {
      const translated = await translateText(defaultAnalysis.audio_script, 'en-IN', 'hi-IN');
      defaultAnalysis.audio_script = translated.translatedText;
    }
  } catch (e) {
    console.warn('Translation for audio script failed:', e);
  }

  return defaultAnalysis;
}

module.exports = { classifySeverity, analyzeIncidentWithLLaMA };
