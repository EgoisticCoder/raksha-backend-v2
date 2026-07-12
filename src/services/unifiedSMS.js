const twilioService = require('./twilio');

async function sendSMS(phone, message) {
  console.log('📱 [UnifiedSMS] sendSMS called:', { phone, messageLength: message.length });
  
  // First attempt with Twilio
  console.log('📡 [UnifiedSMS] Trying Twilio first...');
  let result = await twilioService.sendSMS(phone, message);
  console.log('📊 [UnifiedSMS] Twilio result:', result);
  
  if (result.success) {
    console.log('✅ [UnifiedSMS] SMS sent successfully via Twilio');
    return result;
  }
  
  console.error('❌ [UnifiedSMS] Twilio failed, logging as fallback:', result);
  
  // Free fallback: ensure we always return a structured response
  return {
    success: false,
    reason: 'All SMS providers failed, fallback to logs only',
    originalError: result,
    loggedAt: new Date().toISOString(),
  };
}

async function sendSimpleSMS(phone, message) {
  console.log('📱 [UnifiedSMS] sendSimpleSMS called');
  return sendSMS(phone, message);
}

module.exports = {
  sendSMS,
  sendSimpleSMS,
  parseInboundWebhook: twilioService.parseInboundWebhook,
  buildEscalationMessage: twilioService.buildEscalationMessage,
};
