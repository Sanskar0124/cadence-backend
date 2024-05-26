const Joi = require('joi');
const {
  BULK_OPTIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

const leadIdsSchema = Joi.array().items(Joi.number().required()).required();
const optionSchema = Joi.string()
  .valid(...Object.values(BULK_OPTIONS))
  .default(BULK_OPTIONS.SELECTED);

const schema = Joi.object({
  cadence_to_stop: Joi.number().required(),
  cadence_to_start: Joi.number()
    .required()
    .invalid(Joi.ref('cadence_to_stop'))
    .error(
      new Error('cadence_to_start must be different from cadence_to_stop')
    ),
  lead_ids: Joi.when('option', {
    is: BULK_OPTIONS.SELECTED,
    then: leadIdsSchema,
  }),
  option: optionSchema,
});

module.exports = schema;
