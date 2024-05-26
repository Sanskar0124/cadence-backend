// Packages
const Joi = require('joi');

const outgoingCallSchema = Joi.object({
  call_id: Joi.string().required(),
  lead_id: Joi.number().required(),
  cadence_id: Joi.number().allow(null),
  node_id: Joi.number().allow(null),
});

const incomingCallSchema = Joi.object({
  call_id: Joi.string().required(),
});

const callSchema = { outgoingCallSchema, incomingCallSchema };

module.exports = callSchema;
