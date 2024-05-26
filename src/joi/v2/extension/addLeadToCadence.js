// Packages
const Joi = require('joi');

const addLeadToCadenceSchema = Joi.object({
  lead_id: Joi.number().required(),
  cadence_id: Joi.number().required(),
});

module.exports = addLeadToCadenceSchema;
