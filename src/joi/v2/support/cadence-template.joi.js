// Utils
const {
  USER_LANGUAGES,
  TAG_NAME,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const Joi = require('joi');

// * Create cadence template JOI
const createCadenceTemplate = Joi.object({
  name: Joi.string().required().label('Name'),
  type: Joi.string()
    .required()
    .allow(...Object.values(TAG_NAME))
    .label('Type'),
  language: Joi.string()
    .required()
    .allow(...Object.values(USER_LANGUAGES))
    .label('Language'),
  nodes: Joi.array().min(1).label('Steps'),
});

// * Fetch cadence template JOI
const fetchCadenceTemplate = Joi.object({
  type: Joi.string()
    .optional()
    .allow(...Object.values(TAG_NAME))
    .label('Type'),
  language: Joi.string()
    .optional()
    .allow(...Object.values(USER_LANGUAGES))
    .label('Language'),
  created_at: Joi.string().optional().label('Created at'),
});

const cadenceTemplateSchema = {
  createCadenceTemplate,
  fetchCadenceTemplate,
};

module.exports = cadenceTemplateSchema;
