// Packages
const Joi = require('joi');

const sendMessageSchema = Joi.object({
  from_phone_number: Joi.string().required(),
  to_phone_number: Joi.string().required(),
  content: Joi.string().required(),
  lead_id: Joi.number().required(),
  cadence_id: Joi.number().allow(null),
  node_id: Joi.number().allow(null),
});

const messageSchema = {
  sendMessageSchema,
};

module.exports = messageSchema;
