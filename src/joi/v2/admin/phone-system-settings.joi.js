// Utils
const {
  PHONE_SYSTEM_TYPE,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const schema = Joi.object({
  phone_system: Joi.string().valid(...Object.values(PHONE_SYSTEM_TYPE)),
  //company_id: Joi.string().guid().required(),
});

module.exports = schema;
