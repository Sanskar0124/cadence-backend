// Utils
const {
  SALESFORCE_DATA_IMPORT_TYPES,
  CADENCE_OPTIONS,
  BULK_OPTIONS,
  MODEL_TYPES,
  LEAD_INTEGRATION_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const leadUpdateSchema = Joi.object({
  lead: Joi.object({
    lead_id: Joi.number().required().label('Lead Id'),
    first_name: Joi.string().required().label('First name'),
    last_name: Joi.string().optional().allow('').label('Last name'),
    linkedin_url: Joi.string().required().allow(null).label('LinkedIn url'),
    job_position: Joi.string().required().allow(null).label('Job position'),
    account_id: Joi.number().optional().label('Account Id'),
    variables: Joi.object().allow(null).optional().label('Variables'),
    account: Joi.object({
      name: Joi.string().required().label('Name'),
      url: Joi.string().optional().allow('', null).label('Url'),
      linkedin_url: Joi.string()
        .optional()
        .allow('', null)
        .label('LinkedIn url'),
      size: Joi.string().optional().allow('', null).label('Size'),
      phone_number: Joi.string().allow('', null).label('Phone number'),
      zipcode: Joi.string().allow('', null).label('Zip code'),
      country: Joi.string().allow('', null).label('Country'),
      countryId: Joi.number().allow('', null).optional().label('CountryId'),
      variables: Joi.object().allow(null).optional().label('Variables'),
    })
      .when('account_id', {
        is: true,
        then: Joi.required(),
      })
      .allow(null),
  }),
  phone_numbers: Joi.array().items(
    Joi.object({
      lpn_id: Joi.number().optional(),
      phone_number: Joi.string().required().allow('').label('Phone number'),
      type: Joi.string().required().label('Phone number type'),
      is_primary: Joi.bool().optional(),
    })
  ),
  emails: Joi.array().items(
    Joi.object({
      lem_id: Joi.number().optional(),
      email_id: Joi.string().email().allow('').required().label('Email'),
      type: Joi.string().required().label('Email type'),
      is_primary: Joi.bool().optional(),
    })
  ),
});

const getRelatedLeadSchema = Joi.object()
  .keys({
    id: Joi.string().trim(),
    account_name: Joi.string().trim(),
  })
  .xor('id', 'account_name');

const disqualifyConvertLeadSchema = Joi.object({
  integration_id: Joi.string().required(),
  status: Joi.string().required(),
  disqualification_reason: Joi.string().optional(),
  model_type: Joi.string()
    .valid(...Object.values(MODEL_TYPES))
    .required()
    .label('Model Type'),
});

const reassignSchema = Joi.object().keys({
  contact_reassignment_rule: Joi.string(),
  reassignTo: Joi.array().required().items({
    user_id: Joi.string().required(),
    count: Joi.number().required(),
  }),
  leads: Joi.array().required(),
  type: Joi.string()
    .required()
    .allow(...Object.values(SALESFORCE_DATA_IMPORT_TYPES)),
});

const deleteLeadsSchema = Joi.object().keys({
  lead_ids: Joi.when('option', {
    is: BULK_OPTIONS.SELECTED,
    then: Joi.array().required(),
  }),
  cadence_id: Joi.when('cadence_option', {
    is: CADENCE_OPTIONS.SELECTED,
    then: Joi.number().required(),
    otherwise: Joi.number().allow(null),
  }).when('option', {
    is: BULK_OPTIONS.ALL,
    then: Joi.number().required(),
    otherwise: Joi.number().allow(null),
  }),
  cadence_option: Joi.string()
    .valid(...Object.values(CADENCE_OPTIONS))
    .default(CADENCE_OPTIONS.ALL),
  option: Joi.string()
    .valid(...Object.values(BULK_OPTIONS))
    .default(BULK_OPTIONS.SELECTED),
});

// * Update integration status
const updateIntegrationStatus = Joi.object().keys({
  status: Joi.string().required().label('Status'),
});

// * Execute webhook
const executeWebhookLeadSchema = Joi.object({
  lead_id: Joi.string().required().label('Lead Id'),
  model_type: Joi.string()
    .valid(...Object.values(MODEL_TYPES))
    .required()
    .label('Model Type'), // lead, contact, account
  integration_status: Joi.object({
    label: Joi.string().required().label('Label'),
    value: Joi.string().required().label('Value'),
  })
    .required()
    .label('Integration status'),
  reason: Joi.string().optional().label('Reason'),
});

const getLeadResume = Joi.object({
  id: Joi.string().required().label('Lead Id'),
  type: Joi.string()
    .valid(LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE)
    .required()
    .label('Type'), // bullhorn_candidate
});

const parseResume = Joi.object({
  id: Joi.string().required().label('Lead Id'),
  type: Joi.string()
    .valid(LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE)
    .required()
    .label('Type'), // bullhorn_candidate
  resume_id: Joi.string().required().label('Resume Id'),
});

const leadSchema = {
  leadUpdateSchema,
  getRelatedLeadSchema,
  disqualifyConvertLeadSchema,
  reassignSchema,
  deleteLeadsSchema,
  updateIntegrationStatus,
  executeWebhookLeadSchema,
  getLeadResume,
  parseResume,
};

module.exports = leadSchema;
