function generateIncidentId() {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `SOS-${Date.now()}${random}`;
}

function generatePersonId() {
  return `P-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

module.exports = { generateIncidentId, generatePersonId };
