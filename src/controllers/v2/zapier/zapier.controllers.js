// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_INTEGRATION_TYPES,
  LEAD_STATUS,
  CRM_INTEGRATIONS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helper
const LeadToCadenceHelper = require('../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../Cadence-Brain/src/helper/email');
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const SalesforceFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/salesforce-field-map');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');

const zapierCreateLead = async (req, res) => {
  try {
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
        msg: 'Failed to create zapier lead',
        error: 'User not found',
      });

    const [fieldMap, errForFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: user.user_id,
      });

    let { lead, cadence_id } = req.body;
    lead.status = LEAD_STATUS.NEW_LEAD;
    if (
      !lead.account.name &&
      user.Company?.integration_type === CRM_INTEGRATIONS.SALESFORCE
    ) {
      const [{ access_token, instance_url }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          user_id: req.user.user_id,
          integration_type: user.Company?.integration_type,
        });
      const [accountObj, errForAccountObj] =
        await SalesforceService.getAccountFromSalesforce(
          lead.account.integration_id,
          access_token,
          instance_url
        );
      if (errForAccountObj)
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while fetching salesforce account: ${errForAccountObj}`,
          msg: 'Failed to fetch account',
        });

      const accountMap = fieldMap.account_map;

      const url = accountObj[accountMap.url];
      const size =
        accountObj[
          CompanyFieldMapHelper.getCompanySize({
            size: accountMap.size,
          })[0]
        ];
      const country = accountObj[accountMap.country];
      const name = accountObj[accountMap.name];
      const zipcode = accountObj[accountMap.zip_code];
      const phone_number = accountObj[accountMap.phone_number];
      const integration_status =
        accountObj[accountMap.integration_status?.name];
      lead.account = {
        url,
        size,
        country,
        name,
        zipcode,
        phone_number,
        integration_status,
        integration_id: lead.account.integration_id,
        integration_type: lead.account.integration_type,
      };
    }
    // fetch or create account
    let account, errForAccount;
    if (!lead.account_id) {
      const [accounts, errForAccounts] = await Repository.fetchAll({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          name: lead.account.name,
          integration_type: lead.account.integration_type,
          [Op.not]: {
            integration_id: null,
          },
        },
        include: {
          [DB_TABLES.LEAD]: {
            [DB_TABLES.USER]: {
              where: { company_id: user.company_id },
              required: true,
            },
          },
        },
      });
      account = accounts[0];

      if (!account) {
        [account, errForAccount] = await Repository.create({
          tableName: DB_TABLES.ACCOUNT,
          createObject: {
            ...lead.account,
            user_id: req.user.user_id,
          },
        });
        if (errForAccount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while creating account: ${errForAccount}`,
            msg: 'Failed to create account',
          });
      }
    } else {
      [account, errForAccount] = await Repository.fetchOne({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          account_id: lead.account_id,
        },
      });
      if (errForAccount)
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while fetching account: ${errForAccount}`,
          msg: 'Failed to find account',
        });
      if (!account)
        return serverErrorResponseWithDevMsg({ res, msg: 'No account found' });
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
    if (errForCreatedLead)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating lead: ${errForCreatedLead}`,
        msg: 'Failed to create lead',
      });

    //Google Sheets Case Update Integration ID
    if (
      createdLead &&
      createdLead.integration_type === LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD
    ) {
      const lead_id = createdLead.lead_id;
      const [updateLead, errForUpdateLead] = await Repository.update({
        tableName: DB_TABLES.LEAD,
        query: { lead_id },
        updateObject: {
          integration_id: gs_owner_integration_id + lead_id,
        },
      });
      if (errForUpdateLead)
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating lead: ${errForUpdateLead}`,
          msg: 'Failed to update lead',
        });
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

    const [numberArray, errForArray] = await PhoneNumberHelper.formatForCreate(
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
    const response = {
      ...createdLead,
      account: lead.account,
    };
    return successResponse(res, 'Successfully created new leads', response);
  } catch (err) {
    logger.error('Error while creating leads extension: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating leads extension: ${err.message}`,
    });
  }
};

const zapierControllers = {
  zapierCreateLead,
};

module.exports = zapierControllers;
