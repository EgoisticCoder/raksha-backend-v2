const jwt = require('jsonwebtoken');

const ROLES = {
  CITIZEN: 'citizen',
  VERIFIED_RESPONDER: 'verified_responder',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin'
};

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET || 'default-secret', (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    if (!roles.includes(req.user.role)) {
      return res.sendStatus(403);
    }
    next();
  };
}

module.exports = {
  authenticateJWT,
  authorizeRoles,
  ROLES
};
