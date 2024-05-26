// Packages
const Joi = require('joi');
const {
  ZOHO_DATA_CENTERS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

const selectDataCenterSchema = Joi.object({
  dataCenter: Joi.string()
    .label('Data centre')
    .valid(...Object.values(ZOHO_DATA_CENTERS))
    .required(),
});

const zohoSchema = { selectDataCenterSchema };

module.exports = zohoSchema;
