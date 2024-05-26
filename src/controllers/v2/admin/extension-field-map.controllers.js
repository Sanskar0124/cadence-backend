// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  SALESFORCE_SOBJECTS,
  CRM_INTEGRATIONS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Joi
const companyFieldSchema = require('../../../joi/v2/admin/company-field-map.joi');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Helper and Services
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const SalesforceHelper = require('../../../../../Cadence-Brain/src/helper/salesforce');
const ExtensionFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/extension-field-map');
const CompanyHelper = require('../../../../../Cadence-Brain/src/helper/company');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');

// GRPC
const v2GrpcClients = require('../../../../../Cadence-Brain/src/grpc/v2');

const createExtensionFieldMap = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // * Fetch company integration type
    let [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      extras: {
        attributes: ['first_name'],
      },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['name', 'integration_type'],
        },
      },
      t,
    });
    if (errFetchingUser) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create extension fieldmap',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create extension fieldmap',
        error: `User not found`,
      });
    }

    let crm_integration = user?.Company.integration_type;
    if (!Object.values(CRM_INTEGRATIONS).includes(crm_integration)) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Invalid CRM Integration. Please contact support',
      });
    }

    // * Use relevant validation scheme
    let body = {};
    switch (crm_integration) {
      case CRM_INTEGRATIONS.SALESFORCE:
        body = companyFieldSchema.salesforceCreateFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body = companyFieldSchema.pipedriveCreateFieldMapSchema.validate(
          req.body
        );
        break;
      default:
        t.rollback();
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to create extension field map',
          error: 'Invalid CRM Integration',
        });
    }
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    // * Use helper to create relevant field map
    let [_, errCreatingCompanyFieldMap] =
      await ExtensionFieldMapHelper.createExtensionFieldMap(
        { data: body.value, crm_integration, user_id: req.user.user_id },
        t
      );
    if (errCreatingCompanyFieldMap) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create extension fieldmap',
        error: `Error while creating extension fieldmap: ${errCreatingCompanyFieldMap}`,
      });
    }

    t.commit();
    return successResponse(res, 'Successfully created extension field map');
  } catch (err) {
    t.rollback();
    logger.error(
      `An error occurred while trying to update salesforce field map: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating extension fieldmap: ${err.message}`,
    });
  }
};

const fetchExtensionFieldMap = async (req, res) => {
  try {
    // * Helper function to fetch relevant field map
    let [fieldMap, errFieldMap] =
      await ExtensionFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch extension field map',
        error: `Error while fetching fieldmap for company from user: ${errFieldMap}`,
      });

    return successResponse(res, `Successfully fetched field map`, fieldMap);
  } catch (err) {
    logger.error('Error while fetching extension-field-map:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching extension-field-map: ${err.message}`,
    });
  }
};

const updateAllExtensionFieldMap = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // *  Fetch company integration
    let [crmIntegration, errFetchingCrmIntegration] =
      await CompanyHelper.getCrmIntegrationType(req.user.user_id, t);
    if (errFetchingCrmIntegration) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update extension fieldmaps',
        error: `Error while fetching crm integration type: ${errFetchingCrmIntegration}`,
      });
    }

    // * Use relevant validation scheme
    let body = {};
    switch (crmIntegration) {
      case CRM_INTEGRATIONS.SALESFORCE:
        body = companyFieldSchema.salesforceAllExtensionFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body = companyFieldSchema.pipedriveAllCreateFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        body = companyFieldSchema.hubspotAllFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.ZOHO:
        body = companyFieldSchema.zohoAllFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.SELLSY:
        body = companyFieldSchema.sellsyAllFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.BULLHORN:
        body = companyFieldSchema.bullhornAllExtensionFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        body = companyFieldSchema.dynamicsAllFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        body = companyFieldSchema.dynamicsAllFieldMapSchema.validate(req.body);
        break;
      default:
        t.rollback();
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to create extension field map',
          error: 'Invalid CRM Integration',
        });
    }
    if (body.error) {
      t.rollback();

      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    // * Use helper to create all field maps
    let [_, errUpdatingAllExtensionFieldMap] =
      await ExtensionFieldMapHelper.updateAllExtensionFieldMap(
        {
          data: body.value,
          crm_integration: crmIntegration,
          user_id: req.user.user_id,
        },
        t
      );
    if (errUpdatingAllExtensionFieldMap) {
      t.rollback();

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update extension fieldmaps',
        error: `Error while updating extension fieldmap: ${errUpdatingAllExtensionFieldMap}`,
      });
    }

    t.commit();
    return successResponse(
      res,
      'Successfully updated all extension field maps'
    );
  } catch (err) {
    t.rollback();

    logger.error(`Error while updating all extension field maps: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating all extension fieldmaps: ${err.message}`,
    });
  }
};

/**
 *
 * @param {*} req
 * @param {*} res
 *
 * The autoFieldMapping is integration-agnostic
 * We fetch the field map set in account config
 * Then we map it for linkedin
 */
const autoMapExtensionFieldMap = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // *  Fetch company integration
    let [crmIntegration, errFetchingCrmIntegration] =
      await CompanyHelper.getCrmIntegrationType(req.user.user_id, t);

    // Fetch Field Map by User
    let [fieldMap, errFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });

    if (errFieldMap) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: errFieldMap,
        msg: `Error while auto mapping all extension fieldmaps`,
      });
    }

    // * Use helper to update all field maps
    let [_, errUpdatingAllExtensionFieldMap] =
      await ExtensionFieldMapHelper.updateAllExtensionFieldMap(
        {
          data: fieldMap,
          crm_integration: crmIntegration,
          user_id: req.user.user_id,
        },
        t
      );
    if (errUpdatingAllExtensionFieldMap) {
      t.rollback();

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to automap extension fieldmaps',
        error: errUpdatingAllExtensionFieldMap,
      });
    }

    t.commit();

    return successResponse(
      res,
      'Successfully auto mapped all extension field maps'
    );
  } catch (err) {
    t.rollback();
    logger.error(`Error while automapping all extension field maps: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
      msg: `Error while automapping extension field maps`,
    });
  }
};

const ExtensionFieldMapControllers = {
  createExtensionFieldMap,
  fetchExtensionFieldMap,
  updateAllExtensionFieldMap,
  autoMapExtensionFieldMap,
};

module.exports = ExtensionFieldMapControllers;
