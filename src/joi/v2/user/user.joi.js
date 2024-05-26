// Utils
const {
  USER_DELETE_OPTIONS,
  COMPANY_CONTACT_REASSIGNMENT_OPTIONS,
  PRODUCT_TOUR_STATUSES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const deleteUserBodySchema = Joi.object({
  user_id: Joi.any().allow(Joi.string(), Joi.number()).required(),
  option: Joi.string()
    .valid(...Object.values(USER_DELETE_OPTIONS))
    .required(),
  contact_reassignment_rule: Joi.string()
    .valid(...Object.values(COMPANY_CONTACT_REASSIGNMENT_OPTIONS))
    .when('option', {
      is: USER_DELETE_OPTIONS.REASSIGN,
      then: Joi.string().required(),
      otherwise: Joi.optional().allow(),
    }),
  reassignTasksForLeads: Joi.boolean(),
  reassignTasksForContacts: Joi.boolean(),
  reassignToForLeads: Joi.array().items(
    Joi.object({
      user_id: Joi.string().required(),
      count: Joi.number().required(),
    })
  ),
  reassignToForContacts: Joi.array().items(
    Joi.object({
      user_id: Joi.string().required(),
      count: Joi.number().required(),
    })
  ),
});

const createDummyLeadsForProductTourSchema = Joi.object({
  cadence_id: Joi.number().required().label('Cadence Id'),
});

module.exports = {
  deleteUserBodySchema,
  createDummyLeadsForProductTourSchema,
};
