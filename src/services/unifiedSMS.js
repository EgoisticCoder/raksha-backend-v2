const twilioService = require('./twilio');

async function sendSMS(phone, message) {
  console.log(`📱 Attempting to send SMS to ${phone}...`);
  
  // First attempt with Twilio
  let result = await twilioService.sendSMS(phone, message);
  
  if (result.success) {
    console.log('✅ SMS sent successfully via Twilio');
    return result;
  }
  
  console.error('❌ Twilio failed, logging as fallback:', result);
  
  // Free fallback: ensure we always return a structured response
  return {
    success: false,
    reason: 'All SMS providers failed, fallback to logs only',
    originalError: result,
    loggedAt: new Date().toISOString(),
  };
}

async function sendSimpleSMS(phone, message) {
  return sendSMS(phone, message);
}

module.exports = {
  sendSMS,
  sendSimpleSMS,
  parseInboundWebhook: twilioService.parseInboundWebhook,
  buildEscalationMessage: twilioService.buildEscalationMessage,
};
