const Joi = require('joi');

const createSOSSchema = Joi.object({
  name: Joi.string().max(100).default('Unknown'),
  age: Joi.number().integer().min(0).max(150).default(0),
  language: Joi.string().max(10).default('en'),
  phone: Joi.string().max(20).allow('').default(''),
  lat: Joi.number().required(),
  lng: Joi.number().required(),
  accuracy_m: Joi.number().min(0).default(0),
  condition_text: Joi.string().max(500).allow('').default(''),
  disaster_type: Joi.string().max(50).default('unknown'),
  severity: Joi.number().integer().min(1).max(5),
  photo_url: Joi.string().uri().allow(null, ''),
  channel: Joi.string().valid('app', 'sms', 'ble', 'offline').default('app'),
});

const assignTeamSchema = Joi.object({
  incident_id: Joi.string().required(),
  team_id: Joi.string().required(),
});

const teamLocationSchema = Joi.object({
  team_id: Joi.string().required(),
  lat: Joi.number().required(),
  lng: Joi.number().required(),
});

const registerTokenSchema = Joi.object({
  team_id: Joi.string().required(),
  push_token: Joi.string().required(),
});

const sttSchema = Joi.object({
  audio: Joi.string().required(),
  language_code: Joi.string().default('hi-IN'),
});

const ttsSchema = Joi.object({
  text: Joi.string().max(2500).required(),
  language_code: Joi.string().default('hi-IN'),
});

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    req.validated = value;
    return next();
  };
}

module.exports = {
  validate,
  createSOSSchema,
  assignTeamSchema,
  teamLocationSchema,
  registerTokenSchema,
  sttSchema,
  ttsSchema,
};
