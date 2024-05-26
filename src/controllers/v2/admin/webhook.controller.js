// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  SALESFORCE_SOBJECTS,
  CRM_INTEGRATIONS,
  WEBHOOK_TYPE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Joi
const webhookSchema = require('../../../joi/v2/admin/webhook.joi');

// * Packages
const { Op } = require('sequelize');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// * Create webhook subscription
const createWebhook = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // * Validate request
    let body = webhookSchema.createWebhookSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    body = body.value;

    // * Check if the company already has the same webhook type set
    let [company, errFetchingCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.WEBHOOK]: {
            where: {
              webhook_type: body.webhook_type,
              object_type: body.object_type ?? null,
              integration_status: body.integration_status ?? null,
            },
            required: false,
          },
        },
      },
      extras: {
        attributes: ['company_id', 'name'],
      },
      t,
    });
    if (errFetchingCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create webhook',
        error: `Error while fetching company: ${errFetchingCompany}`,
      });
    }
    // * If webhook already exists
    if (company.Company_Setting.Webhooks.length) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Webhook with the same type already exists',
      });
    }

    body.company_settings_id = company.Company_Setting.company_settings_id;

    // * Create webhook
    let [_, errCreatingWebhook] = await Repository.create({
      tableName: DB_TABLES.WEBHOOK,
      createObject: body,
      t,
    });
    if (errCreatingWebhook) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create webhook',
        error: `Error while creating webhook: ${errCreatingWebhook}`,
      });
    }

    t.commit();
    return successResponse(res, 'Successfully created webhook');
  } catch (err) {
    t.rollback();
    logger.error(
      `An error occurred while trying to create webhook for company: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating webhook: ${err.message}`,
    });
  }
};

// * Create webhook subscription
const fetchCompanyWebhooks = async (req, res) => {
  try {
    // * Fetch webhooks
    let [company, errFetchingWebhooks] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.WEBHOOK]: {
            required: false,
          },
        },
      },
      extras: {
        attributes: ['company_id', 'name'],
      },
    });
    if (errFetchingWebhooks)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company webhooks',
        error: `Error while fetching webhooks: ${errFetchingWebhooks}`,
      });

    let webhooks = company.Company_Setting.Webhooks;

    return successResponse(res, 'Successfully fetched webhooks', webhooks);
  } catch (err) {
    logger.error(
      `An error occurred while trying to fetch webhooks for company: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching webhooks for company: ${err.message}`,
    });
  }
};

// * Update existing webhook
const updateWebhook = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // * Validate request
    let body = webhookSchema.updateWebhookSchema.validate({
      ...req.body,
      webhook_id: req.params.webhook_id,
    });
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    body = body.value;

    // * Check if webhook exists
    let [company, errFetchingCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.WEBHOOK]: {
            where: { webhook_id: body.webhook_id },
            required: false,
          },
        },
      },
      extras: {
        attributes: ['company_id', 'name'],
      },
      t,
    });
    if (errFetchingCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company webhooks',
        error: `Error while fetching company: ${errFetchingCompany}`,
      });
    }
    if (!company.Company_Setting.Webhooks.length) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Webhook does not exist',
      });
    }

    // * Check if the company already has the same webhook set or not
    if (body.webhook_type === WEBHOOK_TYPE.CUSTOM) {
      let [webhook, errFetchingWebhook] = await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY,
        query: {
          company_id: req.user.company_id,
        },
        include: {
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['company_settings_id'],
            [DB_TABLES.WEBHOOK]: {
              where: {
                webhook_id: {
                  [Op.notIn]: [body.webhook_id],
                },
                webhook_type: body.webhook_type,
                object_type: body.object_type ?? null,
                integration_status: body.integration_status ?? null,
              },
              required: false,
            },
          },
        },
        extras: {
          attributes: ['company_id', 'name'],
        },
        t,
      });
      if (errFetchingWebhook) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update webhook',
          error: errFetchingWebhook,
        });
      }
      // * If webhook already exists
      if (webhook.Company_Setting.Webhooks.length) {
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Webhook with the same type already exists',
        });
      }
    }

    // * Update webhook
    let [_, errUpdatingWebhook] = await Repository.update({
      tableName: DB_TABLES.WEBHOOK,
      query: {
        webhook_id: body.webhook_id,
      },
      updateObject: {
        integration_status: body.integration_status ?? null,
        object_type: body.object_type ?? null,
        http_method: body.http_method,
        url: body.url,
        auth_token: body.auth_token,
      },
      t,
    });
    if (errUpdatingWebhook) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company webhooks',
        error: `Error while updating webhooks: ${errUpdatingWebhook}`,
      });
    }

    t.commit();
    return successResponse(res, 'Successfully updated webhook');
  } catch (err) {
    t.rollback();
    logger.error(
      `An error occurred while trying to update webhook for company: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating webhook: ${err.message}`,
    });
  }
};

// * Delete existing webhook
const deleteWebhook = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // * Check if webhook exists
    let [company, errFetchingCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.WEBHOOK]: {
            where: { webhook_id: req.params.webhook_id },
            required: false,
          },
        },
      },
      extras: {
        attributes: ['company_id', 'name'],
      },
      t,
    });
    if (errFetchingCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete webhook',
        error: `Error while fetching company: ${errFetchingCompany}`,
      });
    }
    if (!company.Company_Setting.Webhooks.length) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Webhook does not exist',
      });
    }

    // * Delete webhook
    let [_, errDeletingWebhook] = await Repository.destroy({
      tableName: DB_TABLES.WEBHOOK,
      query: {
        webhook_id: req.params.webhook_id,
      },
      t,
    });
    if (errDeletingWebhook) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete webhook',
        error: `Error while deleting webhook: ${errDeletingWebhook}`,
      });
    }

    t.commit();
    return successResponse(res, 'Successfully deleted webhook');
  } catch (err) {
    t.rollback();
    logger.error(
      `An error occurred while trying to delete webhook for company: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting webhook: ${err.message}`,
    });
  }
};

module.exports = {
  createWebhook,
  fetchCompanyWebhooks,
  updateWebhook,
  deleteWebhook,
};
