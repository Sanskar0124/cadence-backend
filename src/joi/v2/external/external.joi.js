// Utils
const { LEAD_STATUS } = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const stopCadenceExternalSchema = Joi.object({
  //salesforce_lead_id: Joi.string().optional(),
  //salesforce_contact_id: Joi.string().optional(),
  integration_id: Joi.string().optional(),
  status: Joi.string()
    .required()
    .allow(LEAD_STATUS.CONVERTED, LEAD_STATUS.TRASH),
  reason: Joi.string().optional(),
}).or('salesforce_lead_id', 'salesforce_contact_id');

const updateCompanyInfoSchema = Joi.object({
  number_of_licences: Joi.number().optional(),
  is_subscription_active: Joi.bool().optional(),
  is_trial_active: Joi.bool()
    .when('is_subscription_active', {
      is: true,
      then: Joi.disallow(true),
    })
    .optional(),
  trial_valid_until: Joi.date()
    .when('is_trial_active', {
      is: true,
      then: Joi.required(),
    })
    .optional()
    .allow(null, ''),
});
const externalSchema = {
  stopCadenceExternalSchema,
  updateCompanyInfoSchema,
};

module.exports = externalSchema;
