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
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_INTEGRATION_TYPES,
  LEAD_IMPORT_SOURCE,
  TRACKING_ACTIVITIES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helper
const LeadToCadenceHelper = require('../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../Cadence-Brain/src/helper/email');

// Joi
const ExtensionJoi = require('../../../joi/v2/extension');

const createLeads = async (req, res) => {
  try {
    let body = ExtensionJoi.createLeads.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.COMPANY]: {},
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching user: ${errForUser}`,
        msg: 'Failed to find user',
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to create leads',
        error: 'User not found',
      });

    const [fieldMap, errForFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: user.user_id,
      });

    // * Response object
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };

    const leads = body;

    let i = 0;
    while (i < leads.length) {
      const lead = { ...leads[i] };
      // fetch or create account
      let account, errForAccount;
      if (!lead.account_id) {
        [account, errForAccount] = await Repository.create({
          tableName: DB_TABLES.ACCOUNT,
          createObject: {
            ...lead.account,
            zipcode: lead.account?.zip_code,
            user_id: req.user.user_id,
            company_id: user?.company_id,
            size: null,
          },
        });
        if (errForAccount) {
          response.element_error.push({
            type: 'account',
            msg: errForAccount,
            integration_id: lead.account.integration_id,
          });
          response.total_error++;
          i++;
          continue;
        }
      } else {
        [account, errForAccount] = await Repository.fetchOne({
          tableName: DB_TABLES.ACCOUNT,
          query: {
            account_id: lead.account_id,
          },
        });
        if (errForAccount) {
          response.element_error.push({
            type: 'account',
            msg: errForAccount,
            account_id: lead.account_id,
          });
          response.total_error++;
          i++;
          continue;
        }
        if (!account) {
          response.element_error.push({
            type: 'account',
            msg: 'No account found with the given account_id.',
            account_id: lead.account_id,
          });
          response.total_error++;
          i++;
          continue;
        }
      }

      if (lead.integration_type === LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD)
        lead['salesforce_lead_id'] = lead.integration_id;
      else if (
        lead.integration_type === LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT
      )
        lead['salesforce_contact_id'] = lead.integration_id;

      if (lead.integration_type === LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD) {
        var gs_owner_integration_id = lead.user_integration_id;
        lead.integration_id = null;
      }

      let leadObj = {
        company_id: req.user.company_id,
        ...lead,
        account_id: account.account_id,
        user_id: req.user.user_id,
        metadata: { source: LEAD_IMPORT_SOURCE.LINKEDIN_EXTENSION },
      };

      delete leadObj.account;
      delete leadObj.phone_numbers;
      delete leadObj.emails;
      delete leadObj.user_integration_id;

      // create lead
      const [createdLead, errForCreatedLead] = await Repository.create({
        tableName: DB_TABLES.LEAD,
        createObject: leadObj,
      });
      if (errForCreatedLead) {
        response.element_error.push({
          type: 'lead',
          msg: errForCreatedLead,
          integration_id: lead.integration_id,
        });
        response.total_error++;
        i++;
        continue;
      }

      //Google Sheets Case Update Integration ID
      if (
        createdLead &&
        createdLead.integration_type ===
          LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD
      ) {
        const lead_id = createdLead.lead_id;
        const [updateLead, errForUpdateLead] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id },
          updateObject: {
            integration_id: gs_owner_integration_id + lead_id,
          },
        });
        if (errForUpdateLead) {
          response.element_error.push({
            type: 'lead',
            msg: errForUpdateLead,
            integration_id: lead_id,
          });
          response.total_error++;
          i++;
          continue;
        }
        if (updateLead[0] === 1)
          createdLead.integration_id = gs_owner_integration_id + lead_id;
      }

      let leadFieldMap = null;

      switch (createdLead.integration_type) {
        case LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD:
          const { lead_map } = fieldMap;
          leadFieldMap = lead_map;
          break;

        case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT:
          const { contact_map } = fieldMap;
          leadFieldMap = contact_map;
          break;

        case LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON:
          const { person_map } = fieldMap;
          leadFieldMap = person_map;
          break;

        case LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT:
          // const { contact_map } = fieldMap;
          leadFieldMap = fieldMap.contact_map;
          break;

        case LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD:
          // const { contact_map } = fieldMap;
          leadFieldMap = fieldMap.lead_map;
          break;
        case LEAD_INTEGRATION_TYPES.SELLSY_CONTACT:
          // const { contact_map } = fieldMap;
          leadFieldMap = fieldMap.contact_map;
          break;

        case LEAD_INTEGRATION_TYPES.ZOHO_LEAD:
          leadFieldMap = fieldMap.lead_map;
          break;

        case LEAD_INTEGRATION_TYPES.ZOHO_CONTACT:
          leadFieldMap = fieldMap.contact_map;
          break;

        case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD:
          leadFieldMap = fieldMap.lead_map;
          break;

        case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT:
          leadFieldMap = fieldMap.contact_map;
          break;

        case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE:
          leadFieldMap = fieldMap.candidate_map;
          break;

        case LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD:
          leadFieldMap = fieldMap.lead_map;
          break;

        case LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT:
          leadFieldMap = fieldMap.contact_map;
          break;

        default:
          break;
      }

      // * Phone validation
      if (typeof leadFieldMap.phone_numbers === 'string')
        leadFieldMap.phone_numbers = [leadFieldMap.phone_numbers];

      let phone_numbers = [];

      leadFieldMap?.phone_numbers.forEach((phone_type) => {
        phone_numbers.push({
          phone_number: lead.phone_numbers?.[phone_type] ?? '',
          type: phone_type,
        });
      });
      lead.phone_numbers = phone_numbers;

      const [numberArray, errForArray] =
        await PhoneNumberHelper.formatForCreate(
          lead.phone_numbers,
          createdLead.lead_id
        );

      const [, errForNumbers] = await Repository.bulkCreate({
        tableName: DB_TABLES.LEAD_PHONE_NUMBER,
        createObject: numberArray,
      });

      // * Email validation
      if (typeof leadFieldMap.emails === 'string')
        leadFieldMap.emails = [leadFieldMap.emails];

      let emails = [];

      leadFieldMap?.emails.forEach((email_field) => {
        emails.push({
          email_id: lead.emails?.[email_field] ?? '',
          type: email_field,
        });
      });
      lead.emails = emails;

      const [emailsArray, errForEmailArray] =
        await LeadEmailHelper.formatForCreate(lead.emails, createdLead.lead_id);

      const [, errForEmails] = await Repository.bulkCreate({
        tableName: DB_TABLES.LEAD_EMAIL,
        createObject: emailsArray,
      });

      response.element_success.push({
        ...createdLead,
        account,
      });
      response.total_success++;
      i++;
    }

    return successResponse(res, 'Successfully created new leads', response);
  } catch (err) {
    logger.error('Error while creating leads extension: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating leads: ${err.message}`,
    });
  }
};

const addLeadToCadence = async (req, res) => {
  try {
    let body = ExtensionJoi.addLeadToCadence.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['first_name', 'last_name'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to find user`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to add lead to cadence',
        error: `No user found`,
      });
    body.launchingUser = user;

    const [link, errForLink] = await LeadToCadenceHelper.addLeadToCadence(body);
    if (errForLink)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking lead to cadence: ${errForLink}`,
        msg: 'Failed to add lead to cadence',
      });

    return successResponse(res, 'Successfully added lead to cadence.', link);
  } catch (err) {
    logger.error('Error while adding lead to cadence in extension: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding lead to cadence: ${err.message}`,
    });
  }
};

const updateExtensionVersion = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { version } = req.body;
    if (!version) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Version is required',
      });
    }

    const user_id = req.user.user_id;

    await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id },
      updateObject: { extension_version: version },
      t,
    });

    await Repository.create({
      tableName: DB_TABLES.TRACKING,
      createObject: {
        user_id,
        activity: TRACKING_ACTIVITIES.EXTENSION_SIGN_IN,
      },
      t,
    });

    t.commit();
    return successResponse(res, 'Successfully updated extension version');
  } catch (err) {
    t.rollback();
    logger.error('Error while updating extension version: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating extension version: ${err.message}`,
    });
  }
};

const ExtensionController = {
  createLeads,
  addLeadToCadence,
  updateExtensionVersion,
};

module.exports = ExtensionController;
