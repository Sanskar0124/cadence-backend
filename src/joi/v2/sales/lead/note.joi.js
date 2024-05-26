// Packages
const Joi = require('joi');

const createNoteSchema = Joi.object({
  note: Joi.string().required(),
  title: Joi.string().optional(),
  lead_id: Joi.number().required(),
});

const noteSchema = {
  createNoteSchema,
};

module.exports = noteSchema;
