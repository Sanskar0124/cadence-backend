// Packages
const Joi = require('joi');

const getPreviousNodesSchema = Joi.object({
  node_id: Joi.string().required(),
  cadence_id: Joi.string().required(),
});

const replySchema = {
  getPreviousNodesSchema,
};

module.exports = replySchema;
