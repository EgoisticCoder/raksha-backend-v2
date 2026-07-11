const fetch = require('node-fetch');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'llama-3.2-11b-vision-preview';

const SEVERITY_PROMPT = `Analyze this disaster/emergency photo and respond with ONLY valid JSON:
{
  "severity": <integer 1-5 where 1=stable, 2=minor, 3=moderate, 4=urgent, 5=critical>,
  "disaster_type": "<flood|earthquake|fire|landslide|cyclone|medical|other>",
  "condition_text": "<brief description of visible conditions>"
}`;

async function classifySeverity(photoUrl) {
  if (!photoUrl || !process.env.GROQ_API_KEY) {
    return { severity: 3, disaster_type: 'unknown', condition_text: 'No photo analysis available' };
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: SEVERITY_PROMPT },
              { type: 'image_url', image_url: { url: photoUrl } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 256,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq Vision API error:', response.status, errText);
      return { severity: 3, disaster_type: 'unknown', condition_text: 'Vision analysis failed' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { severity: 3, disaster_type: 'unknown', condition_text: 'Empty vision response' };
    }

    const parsed = JSON.parse(content);
    const severity = Math.min(5, Math.max(1, parseInt(parsed.severity, 10) || 3));
    return {
      severity,
      disaster_type: parsed.disaster_type || 'unknown',
      condition_text: parsed.condition_text || '',
    };
  } catch (err) {
    console.error('Groq classifySeverity error:', err);
    return { severity: 3, disaster_type: 'unknown', condition_text: 'Vision analysis error' };
  }
}

const ANALYSIS_PROMPT = `Analyze this emergency situation. Return ONLY valid JSON containing:
{
  "cause": "Underlying cause (e.g. Flash flooding, landslide, electrical short circuit due to inundation, etc.)",
  "evacuator_instructions": "Specific safety instructions, recommended rescue tools, and precautions for the evacuator team.",
  "victim_instructions": "Calming, critical step-by-step safety/survival actions for the victim before help arrives.",
  "audio_script": "A 1-2 sentence extremely concise safety alert for the victim. Keep it short and calming, suitable for voice broadcast. Translate to Hindi if requested."
}`;

async function analyzeIncidentWithLLaMA(incidentText, photoUrl, language = 'en') {
  if (!process.env.GROQ_API_KEY) {
    return {
      cause: 'Unknown Emergency',
      evacuator_instructions: 'Deploy standard dispatch protocols. Verify local hazards.',
      victim_instructions: 'Remain calm. Assistance has been dispatched to your location.',
      audio_script: 'Assistance is on the way. Please stay safe.',
    };
  }

  const promptContent = `Victim emergency text: "${incidentText || 'No text description'}"
Preferred Language: "${language}"

${ANALYSIS_PROMPT}`;

  try {
    const messages = [
      {
        role: 'user',
        content: photoUrl
          ? [
              { type: 'text', text: promptContent },
              { type: 'image_url', image_url: { url: photoUrl } },
            ]
          : [
              { type: 'text', text: promptContent }
            ],
      },
    ];

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq LLaMA analysis error status:', response.status, errText);
      throw new Error(`Groq LLaMA error ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty AI response');
    }

    return JSON.parse(content);
  } catch (err) {
    console.error('analyzeIncidentWithLLaMA error:', err);
    return {
      cause: 'General Hazard',
      evacuator_instructions: 'Proceed with caution. Analyze situation on arrival.',
      victim_instructions: 'Stay where you are if safe, or move to high ground. Help is coming.',
      audio_script: 'Help is on the way. Stay calm.',
    };
  }
}

module.exports = { classifySeverity, analyzeIncidentWithLLaMA };
