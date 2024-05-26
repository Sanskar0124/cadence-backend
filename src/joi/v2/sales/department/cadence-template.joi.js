// Utils
const {
  USER_LANGUAGES,
  TAG_NAME,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const Joi = require('joi');

// * Fetch cadence template JOI
const fetchCadenceTemplate = Joi.object({
  search: Joi.string().optional().label('Search'),
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

// * Use cadence with template
const useCadenceTemplate = Joi.object({
  cadence_id: Joi.string().required().label('Cadence'),
  cadence_template_id: Joi.string().required().label('Cadence Template'),
});

const cadenceTemplateSchema = {
  fetchCadenceTemplate,
  useCadenceTemplate,
};

module.exports = cadenceTemplateSchema;
