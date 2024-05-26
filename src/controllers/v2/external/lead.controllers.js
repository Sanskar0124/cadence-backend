// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  LEAD_INTEGRATION_TYPES_DROPDOWN,
  CADENCE_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  CADENCE_STATUS,
  LEAD_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Models
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const LeadHelper = require('../../../../../Cadence-Brain/src/helper/lead');
const IntegrationsHelper = require('../../../../../Cadence-Brain/src/helper/integrations');
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const CadenceHelper = require('../../../../../Cadence-Brain/src/helper/cadence');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const LeadToCadenceHelper = require('../../../../../Cadence-Brain/src/helper/lead-to-cadence');

// Joi
const leadSchema = require('../../../joi/v2/external/lead.joi');

const createLead = async (req, res) => {
  try {
    const params = leadSchema.createLeadSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };

    let { leads, integration_type, cadence_id } = params.value;

    // Step : Initial checks and fetch queries
    const [{ allowedLeadIntegrationTypes }, errForDBTables] =
      IntegrationsHelper.getDBTablesForIntegrations(req.integration_type);
    if (!allowedLeadIntegrationTypes?.includes(integration_type)) {
      logger.error(
        `Invalid lead integration_type: ${integration_type} for company with integration_type: ${req.integration_type}`
      );
      return badRequestResponseWithDevMsg({
        res,
        msg: `Invalid lead integration_type: ${integration_type} for company with integration_type: ${req.integration_type}`,
      });
    }

    // Fetch cadence
    const cadencePromise = Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: {
          where: { company_id: req.company_id },
        },
      },
    });
    // To fetch cadence administrator
    const companyPromise = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.company_id },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
    });
    const [[cadence, errForCadence], [company, errForCompany]] =
      await Promise.all([cadencePromise, companyPromise]);
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create lead',
        error: `Error while fetching cadence: ${errForCadence}.`,
      });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create lead',
        error: `No cadence found with given id for your company`,
      });
    if (!company?.Company_Setting?.user_id) {
      logger.info(`Cadence administrator not set.`);
      return badRequestResponseWithDevMsg({
        res,
        msg: `Please set the cadence administrator`,
      });
    }

    // Step : Fetch tokens for cadence administrator
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: req.integration_type,
        user_id: company?.Company_Setting?.user_id,
      });
    if (!access_token)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Please ask your cadence administrator to connect to ${req.integration_type}`,
      });

    // Step : Defining all variables to use for core logic
    /**
     * will contain user for given owner_id
     * */
    let users = {};

    /**
     * will contain whether first node was fetched previously for given cadence_id
     * { 'cadence_id_1': true,'cadence_id_2': false }
     * */
    let fetchedNodes = {};

    let i = 0;
    while (i < leads.length) {
      let lead = leads[i];
      let owner_id = lead.owner_id;
      i++;
      let user = {},
        errForUser = null;

      // Step : Fetch user from users or DB
      // if user with given owner_id is not fetched yet, then fetch from db and save it in users
      if (!users[owner_id]) {
        [user, errForUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: owner_id,
            company_id: req.company_id,
          },
        });
        if (errForUser) {
          logger.info(`Could not fetch user with owner_id: ${lead.owner_id}.`);
          response.element_error.push({
            integration_id: lead.integration_id,
            owner_id,
            msg: `Could not fetch user with owner_id: ${lead.owner_id}.`,
          });
          response.total_error++;
          continue;
        }
        if (!user) {
          logger.info(`No user found with owner_id: ${lead.owner_id}.`);
          response.element_error.push({
            integration_id: lead.integration_id,
            owner_id,
            msg: `No user found with owner_id: ${lead.owner_id}.`,
          });
          response.total_error++;
          continue;
        }
        users[lead.owner_id] = user;
      }

      // Step : Check cadence access
      if (
        (cadence.type === CADENCE_TYPES.PERSONAL &&
          cadence.user_id !== user.user_id) ||
        // (cadence.type === CADENCE_TYPES.TEAM && cadence.sd_id !== user.sd_id) ||
        (cadence.type === CADENCE_TYPES.COMPANY &&
          cadence.company_id !== user.company_id)
      ) {
        logger.info('User not part of the cadence.');
        response.element_error.push({
          integration_id: lead.integration_id,
          owner_id,
          msg: 'This user does not have access to this cadence.',
        });
        response.total_error++;
        continue;
      }

      // Step: Check for duplicate
      if (req.integration_type === CRM_INTEGRATIONS.SALESFORCE) {
        const [duplicate, errForDuplicate] =
          await SalesforceService.checkDuplicates(
            lead.salesforce_lead_id,
            access_token,
            instance_url
          );
        if (duplicate) lead.duplicate = true;
      }

      // Step : Add necessary field to lead
      lead.user_id = user.user_id;
      lead.cadenceStatus = cadence.status;
      lead.leadCadenceOrder = i; // will be adjusted outside while loop in the end
      lead.cadence_id = cadence_id;
      lead.integration_type = integration_type;

      // to determine account integration_type
      switch (integration_type) {
        case LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.SALESFORCE_LEAD_ACCOUNT;
          break;
        case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT;
          break;
        case LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.PIPEDRIVE_ORGANIZATION;
          break;
        case LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.HUBSPOT_COMPANY;
          break;
        case LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.GOOGLE_SHEETS_ACCOUNT;
          break;
        case LEAD_INTEGRATION_TYPES.EXCEL_LEAD:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.EXCEL_ACCOUNT;
          break;
        case LEAD_INTEGRATION_TYPES.ZOHO_LEAD:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.ZOHO_LEAD_ACCOUNT;
          break;
        case LEAD_INTEGRATION_TYPES.ZOHO_CONTACT:
          lead.company_integration_type =
            ACCOUNT_INTEGRATION_TYPES.ZOHO_ACCOUNT;
          break;
        default:
          logger.info(
            `Invalid lead integration_type: ${integration_type} while checking for account type.`
          );
          response.element_error.push({
            integration_id: lead.integration_id,
            owner_id,
            msg: `Invalid lead integration_type: ${integration_type}.`,
          });
          response.total_error++;
          continue;
      }

      // Step : create lead
      const t = await sequelize.transaction();
      let [createdLead, err] = await LeadHelper.createLeadFromExternal(
        {
          lead,
          company_id: req.company_id,
        },
        t
      );
      if (err) {
        let msg = err;
        if (err.includes('must be unique'))
          msg = 'Lead present in cadence tool';
        t.rollback();
        response.element_error.push({
          integration_id: lead.integration_id,
          owner_id,
          msg,
        });
        response.total_error++;
        continue;
      }

      createdLead = createdLead.createdLead;
      t.commit();

      // if cadence is in progress, create task
      if (cadence?.status === CADENCE_STATUS.IN_PROGRESS) {
        // see if node is already fetched
        if (fetchedNodes[cadence_id]) node = fetchedNodes[cadence_id];
        else {
          [node, errForNode] = await Repository.fetchOne({
            tableName: DB_TABLES.NODE,
            query: {
              cadence_id,
              is_first: 1,
            },
          });
          fetchedNodes[cadence_id] = node;
        }
        if (!errForNode && node) {
          const [taskCreated, errForTaskCreated] =
            await CadenceHelper.launchCadenceForLead(
              createdLead,
              cadence_id,
              node,
              lead.user_id,
              true
            );
          /*
           * recalculating after each task created,
           * since it is possible that we get many leads at once in this route
           * In that case tasks wont show up if we calculate after every lead is created
           * */
          if (taskCreated)
            TaskHelper.recalculateDailyTasksForUsers([createdLead.user_id]);
        }
      }

      response.element_success.push({
        integration_id: lead.integration_id,
        owner_id,
        lead_id: createdLead.lead_id,
      });
      response.total_success++;
    }

    // adjust lead cadence order for all added leads
    LeadToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);

    return successResponse(res, `Created leads`, response);
  } catch (err) {
    logger.error(`Error while creating lead for external: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating lead: ${err.message}.`,
    });
  }
};

const getLeadIntegrationTypes = async (req, res) => {
  try {
    const [company, errForCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.company_id },
      extras: {
        attributes: ['integration_type'],
      },
    });
    if (errForCompany)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead integration types',
        error: `Error while fetching company: ${errForCompany}`,
      });

    if (!LEAD_INTEGRATION_TYPES_DROPDOWN[company?.integration_type]) {
      logger.error(
        `Cannot find lead integration types for integration: ${company?.integration_type}`
      );
      return badRequestResponseWithDevMsg({
        res,
        msg: `This integration is not supported for external use.`,
      });
    }

    return successResponse(res, `Fetched integration types for lead.`, {
      integration_types:
        LEAD_INTEGRATION_TYPES_DROPDOWN[company?.integration_type],
    });
  } catch (err) {
    logger.error(`Error while fetching lead intgration types: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead integration types: ${err.message}.`,
    });
  }
};

const LeadController = {
  createLead,
  getLeadIntegrationTypes,
};

module.exports = LeadController;
