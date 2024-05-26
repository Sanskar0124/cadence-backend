// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Services and Helpers
const CadenceHelper = require('../../../../../Cadence-Brain/src/helper/cadence');

// Joi
const externalSchema = require('../../../joi/v2/external/external.joi');

const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

const stopCadenceExternal = async (req, res) => {
  try {
    const params = externalSchema.stopCadenceExternalSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    // Fetching lead
    let query = {};
    //if (req.body.salesforce_lead_id)
    //query.salesforce_lead_id = req.body.salesforce_lead_id;
    //else query.salesforce_contact_id = req.body.salesforce_contact_id;
    query.integration_id = req.body.integration_id;

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query,
      include: {
        [DB_TABLES.USER]: {
          [DB_TABLES.COMPANY]: {
            where: { company_id: req.company_id },
            attributes: ['company_id'],
            required: true,
          },
          attributes: ['user_id'],
          required: true,
        },
      },
      extras: {
        attributes: ['lead_id'],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to stop cadence external',
        error: `Error while fetching lead: ${errForLead}`,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to stop cadence external',
        error: 'Lead not found',
      });

    const [stopCadence, errForStopCadence] =
      await CadenceHelper.stopCadenceForLead(
        lead.lead_id,
        req.body.status,
        req.body.reason,
        [],
        req.user,
        (inSalesforce = false)
      );
    if (errForStopCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to stop cadence external',
        error: `Error while stoping cadence for lead: ${errForStopCadence}`,
      });

    return successResponse(res, 'Cadences stopped successfully.');
  } catch (err) {
    logger.error('Error while stopping cadence externally: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while stopping cadence external: ${err.message}`,
    });
  }
};

const updateCompanyInfo = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = externalSchema.updateCompanyInfoSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    if (req.params.company_id == null || req.params.company_id === '') {
      t.rollback();
      return badRequestResponse(res, 'Company id cannot be empty');
    }

    const [company, errForCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.params.company_id },
      t,
    });
    if (errForCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: `Error while fetching company: ${errForCompany}`,
      });
    }
    if (!company) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: 'Company does not exist',
      });
    }

    const [updatedCompany, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.params.company_id },
      updateObject: req.body,
      t,
    });
    if (errForUpdate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: `Error while updating company: ${errForUpdate}`,
      });
    }

    t.commit();
    return successResponse(res, 'Company updated successfully.');
  } catch (err) {
    t.rollback();
    logger.error('Error while updating company: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company: ${err.message}`,
    });
  }
};
const ExternalControllers = {
  updateCompanyInfo,
  stopCadenceExternal,
};

module.exports = ExternalControllers;
