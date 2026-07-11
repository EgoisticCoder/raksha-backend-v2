
const Joi = require('joi');

function getTenantId(req) {
  // Get tenant ID from user, header, or default
  if (req.user && req.user.tenant_id) {
    return req.user.tenant_id;
  }
  const tenantHeader = req.headers['x-tenant-id'];
  if (tenantHeader) {
    return tenantHeader;
  }
  return 'default';
}

function tenantIsolation(req, res, next) {
  req.tenantId = getTenantId(req);
  next();
}

module.exports = {
  tenantIsolation,
  getTenantId,
};
