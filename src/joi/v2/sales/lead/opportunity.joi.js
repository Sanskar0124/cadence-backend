// Packages
const Joi = require('joi');

const createOpportunitySchema = Joi.object({
  name: Joi.string().required(),
  account_id: Joi.string().required(),
  amount: Joi.number().required(),
});

const opportunitySchema = {
  createOpportunitySchema,
};

module.exports = opportunitySchema;
