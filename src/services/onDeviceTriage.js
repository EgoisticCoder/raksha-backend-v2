
/**
 * On-device triage classifier fallback.
 * Uses lightweight heuristics until the offline model runtime is integrated.
 */

function runOnDeviceTriage(incidentData) {
  console.log('[Triage] Running on-device fallback triage for:', incidentData);
  // Simple heuristic fallback for now
  let severity = 3;
  const casualtyKeywords = ['trapped', 'injured', 'hurt', 'bleeding', 'unconscious', 'death', 'casualty'];
  const structuralKeywords = ['collapsed', 'building', 'house', 'wall', 'bridge', 'damaged', 'destroyed'];
  
  if (incidentData.condition_text) {
    const lowerText = incidentData.condition_text.toLowerCase();
    const hasCasualty = casualtyKeywords.some(k => lowerText.includes(k));
    const hasStructural = structuralKeywords.some(k => lowerText.includes(k));
    if (hasCasualty) severity = 5;
    else if (hasStructural) severity = 4;
  }
  
  return {
    severity,
    disaster_type: incidentData.disaster_type || 'unknown',
    on_device: true
  };
}

module.exports = {
  runOnDeviceTriage,
};
