function apiKeyAuth(req, res, next) {
  const publicPaths = ['/health', '/sms'];
  const isPublic = publicPaths.some(
    (p) => req.path === p || req.path.startsWith('/sms/')
  );

  if (isPublic) {
    return next();
  }

  const webhookPaths = ['/sos/webhook/routing'];
  if (webhookPaths.some((p) => req.path.startsWith(p))) {
    const secret = req.headers['x-webhook-secret'] || req.query.secret;
    if (secret && secret === process.env.ROUTING_WEBHOOK_SECRET) {
      return next();
    }
  }

  const apiKey = req.headers['x-api-key'];
  if (!process.env.RAKSHA_API_KEY) {
    console.warn('RAKSHA_API_KEY not set; allowing request in dev mode');
    return next();
  }

  if (apiKey !== process.env.RAKSHA_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  return next();
}

module.exports = { apiKeyAuth };
