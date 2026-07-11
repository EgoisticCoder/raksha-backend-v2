const SEVERITY_WEIGHTS = {
  casualtyKeywords: 2.0,
  structuralKeywords: 1.5,
  populationDensity: 1.0,
  historicalIncidentDensity: 0.8,
  disasterType: 1.2,
};

const CASUALTY_KEYWORDS = ['trapped', 'injured', 'hurt', 'bleeding', 'unconscious', 'death', 'casualty', 'stuck', 'crushed'];
const STRUCTURAL_KEYWORDS = ['collapsed', 'building', 'house', 'wall', 'bridge', 'damaged', 'destroyed', 'cracked', 'fallen'];
const DISASTER_TYPE_SEVERITY = {
  'earthquake': 5,
  'fire': 5,
  'flood': 4,
  'cyclone': 4,
  'landslide': 4,
  'medical': 4,
  'other': 3,
  'unknown': 3,
};

function calculateHeuristicScore(sosData) {
  let score = 3; // Default moderate

  // Check casualty keywords in condition_text
  if (sosData.condition_text) {
    const lowerText = sosData.condition_text.toLowerCase();
    const hasCasualty = CASUALTY_KEYWORDS.some(keyword => lowerText.includes(keyword));
    if (hasCasualty) score += SEVERITY_WEIGHTS.casualtyKeywords;

    const hasStructural = STRUCTURAL_KEYWORDS.some(keyword => lowerText.includes(keyword));
    if (hasStructural) score += SEVERITY_WEIGHTS.structuralKeywords;
  }

  // Disaster type severity
  if (sosData.disaster_type && DISASTER_TYPE_SEVERITY[sosData.disaster_type]) {
    score += (DISASTER_TYPE_SEVERITY[sosData.disaster_type] - 3) * 0.5;
  }

  // Clamp score between 1 and 5
  return Math.min(5, Math.max(1, Math.round(score)));
}

module.exports = { calculateHeuristicScore };
