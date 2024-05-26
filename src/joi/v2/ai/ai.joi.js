// Packages
const Joi = require('joi');

const generateEmailSchema = Joi.object({
  prompt: Joi.string().label('Prompt').required(),
  key_benefits: Joi.string().label('Key Benefits').allow('').optional(),
  problem_statement: Joi.string()
    .label('Problem Statement')
    .allow('')
    .optional(),
});

const aiSchema = { generateEmailSchema };

module.exports = aiSchema;
