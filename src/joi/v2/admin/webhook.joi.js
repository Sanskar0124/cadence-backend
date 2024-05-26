// * Utils
const {
  WEBHOOK_TYPE,
  HTTP_METHOD,
  MODEL_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const Joi = require('joi');

// * Create webhook schema
const createWebhookSchema = Joi.object({
  webhook_type: Joi.string()
    .valid(...Object.values(WEBHOOK_TYPE))
    .required()
    .label('Webhook type'),
  http_method: Joi.string()
    .valid(...Object.values(HTTP_METHOD))
    .required()
    .label('HTTP method'),
  object_type: Joi.when('webhook_type', {
    is: WEBHOOK_TYPE.CUSTOM,
    then: Joi.string()
      .valid(...Object.values(MODEL_TYPES)) // lead, contact, account
      .required(),
    otherwise: null,
  }).label('Object type'),
  integration_status: Joi.when('webhook_type', {
    is: WEBHOOK_TYPE.CUSTOM,
    then: Joi.object({
      label: Joi.string().required(),
      value: Joi.string().required(),
    }).required(),
    otherwise: null,
  }).label('Integration status'),
  url: Joi.string().required().label('URL'),
  auth_token: Joi.string().optional().label('Auth token'),
});

// * Update Webhook schema
const updateWebhookSchema = Joi.object({
  webhook_id: Joi.string().required().label('Webhook Id'),
  http_method: Joi.string()
    .valid(...Object.values(HTTP_METHOD))
    .required()
    .label('HTTP method'),
  url: Joi.string().required().label('URL'),
  webhook_type: Joi.string()
    .valid(...Object.values(WEBHOOK_TYPE))
    .required()
    .label('Webhook type'),
  object_type: Joi.when('webhook_type', {
    is: WEBHOOK_TYPE.CUSTOM,
    then: Joi.string()
      .valid(...Object.values(MODEL_TYPES)) // lead, contact, account
      .required(),
    otherwise: null,
  }).label('Object type'),
  integration_status: Joi.when('webhook_type', {
    is: WEBHOOK_TYPE.CUSTOM,
    then: Joi.object({
      label: Joi.string().required(),
      value: Joi.string().required(),
    }).required(),
    otherwise: null,
  }).label('Integration status'),
  auth_token: Joi.string().optional().label('Auth token'),
});

module.exports = { createWebhookSchema, updateWebhookSchema };
