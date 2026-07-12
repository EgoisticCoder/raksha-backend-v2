const { sendSMS } = require('./unifiedSMS');

const NOTIFICATION_TYPES = {
  SOS_CREATED: 'sos_created',
  SOS_ASSIGNED: 'sos_assigned',
  SOS_RESOLVED: 'sos_resolved',
  SOS_ESCALATED: 'sos_escalated',
};

function buildNotificationMessage(type, sos, person = {}) {
  const incidentId = sos.incident_id;
  switch (type) {
    case NOTIFICATION_TYPES.SOS_CREATED:
      return `RAKSHA: An SOS (${incidentId}) has been raised for ${person.name || 'someone you know'} at ${sos.lat}, ${sos.lng}. Help is on the way.`;
    case NOTIFICATION_TYPES.SOS_ASSIGNED:
      return `RAKSHA: SOS (${incidentId}) has been assigned to a response team.`;
    case NOTIFICATION_TYPES.SOS_RESOLVED:
      return `RAKSHA: SOS (${incidentId}) has been marked as resolved.`;
    case NOTIFICATION_TYPES.SOS_ESCALATED:
      return `RAKSHA: SOS (${incidentId}) has been escalated to higher authorities.`;
    default:
      return `RAKSHA: Update for incident ${incidentId}`;
  }
}

async function sendNotification(phone, type, sos, person = {}) {
  if (!phone) return { success: false, reason: 'no_phone' };
  const message = buildNotificationMessage(type, sos, person);

  return sendSMS(phone, message);
}

module.exports = {
  NOTIFICATION_TYPES,
  sendNotification,
};
