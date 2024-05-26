// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
} = require('../../../../../utils/response');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../../../Cadence-Brain/src/utils/constants');
const {
  SALESFORCE_LEAD_IMPORT_STATUS,
  BULLHORN_DATA_IMPORT_TYPES,
  LEAD_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  HIRING_INTEGRATIONS,
  USER_INTEGRATION_TYPES,
  CADENCE_LEAD_STATUS,
  BULLHORN_ENDPOINTS,
  ACCOUNT_INTEGRATION_TYPES,
  BULLHORN_IMPORT_SOURCE,
  BULLHORN_CSV_IMPORT_FIELDS,
  IMPORT_ERROR_TYPE,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');
const {
  EMAIL_REGEX,
  PHONE_REGEX,
  LINKEDIN_REGEX,
  WEBSITE_URL_REGEX,
  GOOGLE_SHEETS_REGEX,
} = require('../../../../../../../Cadence-Brain/src/utils/constants');

// Packages
const { Op } = require('sequelize');
const {
  sequelize,
} = require('../../../../../../../Cadence-Brain/src/db/models');
const csv = require('fast-csv');
const xlsx = require('xlsx');

// Repositories
const UserRepository = require('../../../../../../../Cadence-Brain/src/repository/user-repository');
const LeadRepository = require('../../../../../../../Cadence-Brain/src/repository/lead.repository');
const CadenceRepository = require('../../../../../../../Cadence-Brain/src/repository/cadence.repository');
const LeadToCadenceRepository = require('../../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const NodeRepository = require('../../../../../../../Cadence-Brain/src/repository/node.repository');
const TaskRepository = require('../../../../../../../Cadence-Brain/src/repository/task.repository');
const Repository = require('../../../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const {
  linkBullhornLeadWithCadence,
  createCandidateFromBullhorn,
  createContactFromBullhorn,
  createLeadFromBullhorn,
} = require('../../../../../../../Cadence-Brain/src/helper/lead');
const BullhornHelper = require('../../../../../../../Cadence-Brain/src/helper/bullhorn');
const bullhornService = require('../../../../../../../Cadence-Brain/src/services/Bullhorn');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const TaskHelper = require('../../../../../../../Cadence-Brain/src/helper/task');
const CadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/cadence');
const SocketHelper = require('../../../../../../../Cadence-Brain/src/helper/socket');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const ImportHelper = require('../../../../../../../Cadence-Brain/src/helper/imports');
const LeadsToCadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const ExcelHelper = require('../../../../../../../Cadence-Brain/src/helper/excel');
const GoogleSheets = require('../../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');

// Joi validation
const bullhornImportSchema = require('../../../../../joi/v2/sales/department/cadence-imports/bullhorn-imports.joi');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../../../Cadence-Brain/src/utils/modelEnums');

// * gRPC
const v2GrpcClients = require('../../../../../../../Cadence-Brain/src/grpc/v2');
const BullhornService = require('../../../../../../../Cadence-Brain/src/services/Bullhorn');

// * Import contacts
const importBullhornContactsData = async (req, res) => {
  try {
    let { filters, start } = req.body;
    let [bullhornMap, errForBullhornMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForBullhornMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errForBullhornMap,
      });
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errFetchingAccessToken,
      });

    let bullhornContactMap = bullhornMap?.contact_map;
    let bullhornAccountMap = bullhornMap?.account_map;
    if (bullhornContactMap === null || bullhornAccountMap === null)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set bullhorn fields',
      });

    let first_name = bullhornContactMap.first_name
      ? `${bullhornContactMap.first_name},`
      : '';
    let last_name = bullhornContactMap.last_name
      ? `${bullhornContactMap.last_name},`
      : '';
    let linkedin_url = bullhornContactMap.linkedin_url
      ? `${bullhornContactMap.linkedin_url},`
      : '';
    let source_site = bullhornContactMap.source_site
      ? `${bullhornContactMap.source_site},`
      : '';
    let job_position = bullhornContactMap.job_position
      ? `${bullhornContactMap.job_position},`
      : '';

    let phone_number_query = '';
    bullhornContactMap?.phone_numbers.forEach((phone_type) => {
      if (phone_number_query) phone_number_query += `${phone_type},`;
      else phone_number_query = `${phone_type},`;
    });
    let email_query = '';
    bullhornContactMap?.emails.forEach((email_type) => {
      if (email_query) email_query += `${email_type},`;
      else email_query = `${email_type},`;
    });
    let account_name = bullhornAccountMap.name
      ? `${bullhornAccountMap.name},`
      : '';
    let account_url = bullhornAccountMap.url
      ? `${bullhornAccountMap.url},`
      : '';
    let account_size = CompanyFieldMapHelper.getCompanySize({
      size: bullhornAccountMap?.size,
    })[0]
      ? `${
          CompanyFieldMapHelper.getCompanySize({
            size: bullhornAccountMap?.size,
          })[0]
        },`
      : '';
    let account_country = bullhornAccountMap.country
      ? `${bullhornAccountMap.country},`
      : '';
    let zip_code = bullhornAccountMap.zip_code
      ? `${bullhornAccountMap.zip_code},`
      : '';
    let account_linkedin_url = bullhornAccountMap.linkedin_url
      ? `${bullhornAccountMap.linkedin_url},`
      : '';
    let account_phone_number = bullhornAccountMap.phone_number
      ? `${bullhornAccountMap.phone_number},`
      : '';
    let account_integration_status = bullhornAccountMap.integration_status?.name
      ? `${bullhornAccountMap.integration_status?.name},`
      : '';
    let condition = '';
    let contacts = [];
    let decodedContacts = [];

    if (!filters || filters.length == 0) {
      condition = `owner IS NOT NULL`;
    } else {
      for (let filter of filters) {
        condition = `${condition}`;
        let values = '';
        switch (filter.operator) {
          case '=':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '<>':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '>=':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '>':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '<=':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '<':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case 'IN':
            if (filter.type === 'Timestamp') {
              values = '(';
              for (let value of filter.value) {
                values += `${new Date(value).valueOf()},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            ) {
              values = '(';
              for (let value of filter.value) {
                values += `${value},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else {
              values = '(';
              for (let value of filter.value) {
                values += `'${value}',`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            }
            break;
          case 'NOT IN':
            if (filter.type === 'Timestamp') {
              values = '(';
              for (let value of filter.value) {
                values += `${new Date(value).valueOf()},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            ) {
              values = '(';
              for (let value of filter.value) {
                values += `${value},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else {
              values = '(';
              for (let value of filter.value) {
                values += `'${value}',`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            }
            break;
          case 'IS NULL':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
          case 'IS NOT NULL':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
          case 'IS EMPTY':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
          case 'IS NOT EMPTY':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
        }
      }
      condition = condition.substring(0, condition.lastIndexOf('a'));
    }
    const query = condition;
    const fields = `id,${first_name}${linkedin_url}${source_site}${job_position}${last_name}${phone_number_query}${email_query}owner,clientCorporation`;
    let [results, errResult] = await bullhornService.query(
      fields,
      start,
      (object = BULLHORN_ENDPOINTS.CONTACT),
      query,
      access_token,
      instance_url
    );
    if (errResult)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        errResult,
      });
    contacts = results.data;
    if (!contacts || contacts.length == 0)
      return successResponse(
        res,
        'Contacts have been processed.',
        decodedContacts
      );
    let userMap = {};
    let AccountMap = {};
    for (let contact of contacts) {
      let isUserPresentInDB = false;
      let first_name = contact[bullhornContactMap.first_name];
      let last_name = contact[bullhornContactMap.last_name];
      let linkedin_url = contact[bullhornContactMap.linkedin_url];
      let job_position = contact[bullhornContactMap.job_position];
      let emails = [];
      let phone_numbers = [];
      let Id = contact.id;
      let Owner = {
        OwnerId: contact?.owner?.id,
        Name: `${contact.owner.firstName} ${contact.owner.lastName}`,
      };
      // * Lead emails
      bullhornContactMap.emails.forEach((email_type) => {
        if (contact[email_type])
          emails.push({
            email_id: contact[email_type],
            type: email_type,
          });
      });
      // * Phone numbers
      bullhornContactMap.phone_numbers.forEach((phone_type) => {
        if (contact[phone_type])
          phone_numbers.push({
            phone_number: contact[phone_type],
            type: phone_type,
          });
      });

      let decodedContact = {
        Id,
        first_name,
        last_name,
        linkedin_url,
        job_position,
        emails,
        phone_numbers,
        Owner,
      };
      if (contact?.clientCorporation?.id) {
        if (!(contact?.clientCorporation?.id in AccountMap)) {
          const query = `id = ${contact?.clientCorporation?.id}`;
          const fields = `${account_name}${account_url}${account_size}${account_country}${zip_code}${account_linkedin_url}${account_phone_number}${account_integration_status}id`;
          let [results, errResult] = await bullhornService.query(
            fields,
            (start = 0),
            (object = BULLHORN_ENDPOINTS.CORPORATION),
            query,
            access_token,
            instance_url
          );
          const corporation = results.data[0];

          let url = corporation[bullhornAccountMap.url];
          let size =
            corporation[
              `${
                CompanyFieldMapHelper.getCompanySize({
                  size: bullhornAccountMap.size,
                })[0]
              }`
            ];
          let country = corporation[`${bullhornAccountMap.country}`];
          let name = corporation[`${bullhornAccountMap.name}`];
          let zipcode = corporation[`${bullhornAccountMap.zip_code}`];
          let phone_number = corporation[`${bullhornAccountMap.phone_number}`];
          let Id = corporation.id;
          let decodedAccount = {
            Id,
            url,
            size,
            country,
            name,
            zipcode,
            phone_number,
          };
          decodedContact.Account = decodedAccount;
          AccountMap[contact?.clientCorporation?.id] = decodedAccount;
        } else
          decodedContact.Account = AccountMap[contact?.clientCorporation?.id];
      }

      if (!(contact?.owner?.id in userMap)) {
        let [user, errFetchingUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: contact?.owner?.id,
            company_id: req.user.company_id,
          },
        });
        if (errFetchingUser) continue;
        if (!user) {
          userMap[contact.owner.id] = false;
          isUserPresentInDB = false;
        } else {
          userMap[contact.owner.id] = true;
          isUserPresentInDB = true;
        }
      } else isUserPresentInDB = userMap[contact.owner.id];

      if (!isUserPresentInDB) {
        decodedContact.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        decodedContacts.push(decodedContact);
        continue;
      }
      let [leadFromDB, errFetchingLeadFromDB] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: {
          integration_id: contact.id,
          integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT,
        },
        include: {
          [DB_TABLES.USER]: {
            [DB_TABLES.COMPANY]: {
              where: { company_id: req.user.company_id },
              required: true,
            },
            required: true,
          },
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['cadence_id', 'name'],
            },
          },
        },
      });
      if (errFetchingLeadFromDB)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to complete your request right now',
          error: `Unable to query leads: ${errFetchingLeadFromDB}`,
        });
      decodedContact.Cadences = leadFromDB?.LeadToCadences || [];
      if (leadFromDB) {
        decodedContact.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        decodedContact.lead_id = leadFromDB.lead_id;
        if (decodedContact.Cadences.length === 0)
          decodedContact.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;
        else {
          let activeCadence = false;
          for (let leadToCadence of decodedContact.Cadences) {
            if (
              ![
                CADENCE_LEAD_STATUS.COMPLETED,
                CADENCE_LEAD_STATUS.STOPPED,
              ].includes(leadToCadence.status)
            ) {
              activeCadence = true;
              break;
            }
          }
          if (!activeCadence)
            decodedContact.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;
        }
      } else
        decodedContact.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

      decodedContacts.push(decodedContact);
    }
    return successResponse(
      res,
      'Contacts have been processed.',
      decodedContacts
    );
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create contacts in tool from bullhorn: `,
      err
    );
    return successResponse(res, 'Unable to import contacts');
  }
};

// * Import leads
const importBullhornLeadsData = async (req, res) => {
  try {
    let { filters, start } = req.body;
    let [bullhornMap, errForbullhornMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForbullhornMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errForbullhornMap,
      });
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errFetchingAccessToken,
      });
    let bullhornLeadMap = bullhornMap?.lead_map;
    let bullhornAccountMap = bullhornMap?.account_map;

    if (bullhornLeadMap === null || bullhornAccountMap === null)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Bullhorn fields',
      });

    // * Construct query for lead
    let first_name = bullhornLeadMap.first_name
      ? `${bullhornLeadMap.first_name},`
      : '';
    let last_name = bullhornLeadMap.last_name
      ? `${bullhornLeadMap.last_name},`
      : '';
    let linkedin_url = bullhornLeadMap.linkedin_url
      ? `${bullhornLeadMap.linkedin_url},`
      : '';
    let source_site = bullhornLeadMap.source_site
      ? `${bullhornLeadMap.source_site},`
      : '';
    let job_position = bullhornLeadMap.job_position
      ? `${bullhornLeadMap.job_position},`
      : '';

    let phone_number_query = '';
    bullhornLeadMap?.phone_numbers.forEach((phone_type) => {
      if (phone_number_query) phone_number_query += `${phone_type},`;
      else phone_number_query = `${phone_type},`;
    });
    let email_query = '';
    bullhornLeadMap?.emails.forEach((email_type) => {
      if (email_query) email_query += `${email_type},`;
      else email_query = `${email_type},`;
    });
    let account_name = bullhornAccountMap.name
      ? `${bullhornAccountMap.name},`
      : '';
    let account_url = bullhornAccountMap.url
      ? `${bullhornAccountMap.url},`
      : '';
    let account_size = CompanyFieldMapHelper.getCompanySize({
      size: bullhornAccountMap?.size,
    })[0]
      ? `${
          CompanyFieldMapHelper.getCompanySize({
            size: bullhornAccountMap?.size,
          })[0]
        },`
      : '';
    let account_country = bullhornAccountMap.country
      ? `${bullhornAccountMap.country},`
      : '';
    let zip_code = bullhornAccountMap.zip_code
      ? `${bullhornAccountMap.zip_code},`
      : '';
    let account_linkedin_url = bullhornAccountMap.linkedin_url
      ? `${bullhornAccountMap.linkedin_url},`
      : '';
    let account_phone_number = bullhornAccountMap.phone_number
      ? `${bullhornAccountMap.phone_number},`
      : '';
    let account_integration_status = bullhornAccountMap.integration_status?.name
      ? `${bullhornAccountMap.integration_status?.name},`
      : '';
    let leads;
    let decodedLeads = [];
    let condition = '';
    if (!filters || filters.length == 0) {
      condition = `owner IS NOT NULL`;
    } else {
      for (let filter of filters) {
        condition = `${condition}`;
        let values = '';
        switch (filter.operator) {
          case '=':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '<>':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '>=':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '>':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '<=':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case '<':
            if (filter.type === 'Timestamp') {
              values = new Date(filter.value).valueOf();
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            )
              condition += `${filter.bullhorn_field} ${filter.operator} ${filter.value} and `;
            else
              condition += `${filter.bullhorn_field} ${filter.operator} '${filter.value}' and `;
            break;
          case 'IN':
            if (filter.type === 'Timestamp') {
              values = '(';
              for (let value of filter.value) {
                values += `${new Date(value).valueOf()},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            ) {
              values = '(';
              for (let value of filter.value) {
                values += `${value},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else {
              values = '(';
              for (let value of filter.value) {
                values += `'${value}',`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            }
            break;
          case 'NOT IN':
            if (filter.type === 'Timestamp') {
              values = '(';
              for (let value of filter.value) {
                values += `${new Date(value).valueOf()},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else if (
              ['Double', 'Integer', 'Boolean', 'BigDecimal'].includes(
                filter.type
              )
            ) {
              values = '(';
              for (let value of filter.value) {
                values += `${value},`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            } else {
              values = '(';
              for (let value of filter.value) {
                values += `'${value}',`;
              }
              values = values.replace(/.$/, ')');
              condition += `${filter.bullhorn_field} ${filter.operator} ${values} and `;
            }
            break;
          case 'IS NULL':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
          case 'IS NOT NULL':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
          case 'IS EMPTY':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
          case 'IS NOT EMPTY':
            condition += `${filter.bullhorn_field} ${filter.operator} and `;
            break;
        }
      }
      condition = condition.substring(0, condition.lastIndexOf('a'));
    }
    const query = condition;
    const fields = `id,${first_name}${linkedin_url}${phone_number_query}${email_query}${source_site}${job_position}${last_name}owner,clientCorporation`;
    let [results, errResult] = await bullhornService.query(
      fields,
      start,
      (object = BULLHORN_ENDPOINTS.LEAD),
      query,
      access_token,
      instance_url,
      res
    );
    if (errResult) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errResult,
      });
    }
    leads = results.data;

    if (!leads || leads.length == 0)
      return successResponse(res, 'Leads have been processed.', decodedLeads);

    let userMap = {};
    let AccountMap = {};

    for (let lead of leads) {
      let isUserPresentInDB = false;

      let decodedLead = {
        first_name: lead?.[bullhornLeadMap.first_name],
        last_name: lead?.[bullhornLeadMap.last_name],
        linkedin_url: lead?.[bullhornLeadMap.linkedin_url],
        source_site: lead?.[bullhornLeadMap.source_site],
        job_position: lead?.[bullhornLeadMap.job_position],
        Id: lead.id,
        phone_numbers: [],
        emails: [],

        Owner: {
          Name: `${lead.owner.firstName} ${lead.owner.lastName}`,
          OwnerId: lead.owner.id,
        },
      };
      bullhornLeadMap?.phone_numbers.forEach((phone_type) => {
        decodedLead.phone_numbers.push({
          type: phone_type,
          phone_number: lead[phone_type],
        });
      });

      bullhornLeadMap?.emails.forEach((email_type) => {
        decodedLead.emails.push({
          type: email_type,
          email_id: lead[email_type],
        });
      });
      if (lead?.clientCorporation?.id) {
        if (!(lead?.clientCorporation?.id in AccountMap)) {
          const query = `id = ${lead?.clientCorporation?.id}`;
          const fields = `${account_name}${account_url}${account_size}${account_country}${zip_code}${account_linkedin_url}${account_phone_number}${account_integration_status}id`;
          let [results, errResult] = await bullhornService.query(
            fields,
            (start = 0),
            (object = BULLHORN_ENDPOINTS.CORPORATION),
            query,
            access_token,
            instance_url
          );
          const corporation = results.data[0];

          let url = corporation[bullhornAccountMap.url];
          let size =
            corporation[
              `${
                CompanyFieldMapHelper.getCompanySize({
                  size: bullhornAccountMap.size,
                })[0]
              }`
            ];
          let country = corporation[`${bullhornAccountMap.country}`];
          let name = corporation[`${bullhornAccountMap.name}`];
          let zipcode = corporation[`${bullhornAccountMap.zip_code}`];
          let phone_number = corporation[`${bullhornAccountMap.phone_number}`];
          let Id = corporation.id;
          let decodedAccount = {
            Id,
            url,
            size,
            country,
            name,
            zipcode,
            phone_number,
          };
          decodedLead.Account = decodedAccount;
          AccountMap[lead?.clientCorporation?.id] = decodedAccount;
        } else decodedLead.Account = AccountMap[lead?.clientCorporation?.id];
      }

      if (!(lead?.owner?.id in userMap)) {
        let [user, errFetchingUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: lead?.owner?.id,
            company_id: req.user.company_id,
          },
        });
        if (errFetchingUser) continue;
        if (!user) {
          userMap[lead?.owner?.id] = false;
          isUserPresentInDB = false;
        } else {
          userMap[lead?.owner?.id] = true;
          isUserPresentInDB = true;
        }
      } else isUserPresentInDB = userMap[lead.owner.id];

      if (!isUserPresentInDB) {
        decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        decodedLeads.push(decodedLead);
        continue;
      }
      let [leadFromDB, errFetchingLeadFromDB] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: {
          integration_id: lead.id,
          integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_LEAD,
        },
        include: {
          [DB_TABLES.USER]: {
            [DB_TABLES.COMPANY]: {
              where: { company_id: req.user.company_id },
              required: true,
            },
            required: true,
          },
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['cadence_id', 'name'],
            },
          },
        },
      });
      if (errFetchingLeadFromDB)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to complete your request right now',
          error: `Unable to query leads: ${errFetchingLeadFromDB}`,
        });

      if (leadFromDB) {
        decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        decodedLead.lead_id = leadFromDB.lead_id;
        decodedLead.Cadences = leadFromDB.LeadToCadences || [];
        if (decodedLead.Cadences.length === 0)
          decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;

        let activeCadence = false;
        for (let leadToCadence of decodedLead.Cadences) {
          if (
            ![
              CADENCE_LEAD_STATUS.COMPLETED,
              CADENCE_LEAD_STATUS.STOPPED,
            ].includes(leadToCadence.status)
          ) {
            activeCadence = true;
            break;
          }
        }
        if (!activeCadence)
          decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;
      } else
        decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      decodedLeads.push(decodedLead);
    }
    return successResponse(res, 'Leads have been processed.', decodedLeads);
  } catch (err) {
    logger.error(`An error ocurred while importing bullhorn leads: `, err);
    return successResponse(res, 'Unable to import leads');
  }
};

const importBullhornCandidatesData = async (req, res) => {
  try {
    const { filters, start } = req.body;
    let [bullhornMap, errForbullhornMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForbullhornMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errForbullhornMap,
      });
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errFetchingAccessToken,
      });
    let bullhornCandidatedMap = bullhornMap?.candidate_map;

    if (bullhornCandidatedMap === null)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set bullhorn fields',
      });

    // * Construct query for lead
    let first_name = bullhornCandidatedMap.first_name
      ? `${bullhornCandidatedMap.first_name},`
      : '';
    let last_name = bullhornCandidatedMap.last_name
      ? `${bullhornCandidatedMap.last_name},`
      : '';
    let linkedin_url = bullhornCandidatedMap.linkedin_url
      ? `${bullhornCandidatedMap.linkedin_url},`
      : '';
    let source_site = bullhornCandidatedMap.source_site
      ? `${bullhornCandidatedMap.source_site},`
      : '';
    let job_position = bullhornCandidatedMap.job_position
      ? `${bullhornCandidatedMap.job_position},`
      : '';

    let company = bullhornCandidatedMap.company
      ? `${bullhornCandidatedMap.company},`
      : '';

    let size = CompanyFieldMapHelper.getCompanySize({
      size: bullhornCandidatedMap?.size,
    })[0]
      ? `${
          CompanyFieldMapHelper.getCompanySize({
            size: bullhornCandidatedMap?.size,
          })[0]
        },`
      : '';

    let zip_code = bullhornCandidatedMap.zip_code
      ? `${bullhornCandidatedMap.zip_code},`
      : '';

    let country = bullhornCandidatedMap.country
      ? `${bullhornCandidatedMap.country},`
      : '';

    let url = bullhornCandidatedMap.url ? `${bullhornCandidatedMap.url},` : '';

    let phone_number_query = '';
    bullhornCandidatedMap?.phone_numbers.forEach((phone_type) => {
      if (phone_number_query) phone_number_query += `${phone_type},`;
      else phone_number_query = `${phone_type},`;
    });
    let email_query = '';
    bullhornCandidatedMap?.emails.forEach((email_type) => {
      if (email_query) email_query += `${email_type},`;
      else email_query = `${email_type},`;
    });
    let candidates;
    let decodedCandidates = [];
    let condition = '';
    for (let filter of filters) {
      condition = `${condition} ${filter.bullhorn_field}: ${filter.value} AND`;
    }
    condition = condition.substring(0, condition.lastIndexOf('A'));
    const query = condition;
    const fields = `id,${first_name}${company}${linkedin_url}${phone_number_query}${email_query}${size}${zip_code}${country}${url}${source_site}${job_position}${last_name}owner`;
    let [results, errResult] = await bullhornService.search({
      fields,
      start,
      count: 10,
      object: BULLHORN_ENDPOINTS.CANDIDATE,
      query,
      access_token,
      instance_url,
    });
    if (errResult) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errResult,
      });
    }
    candidates = results.data;

    if (!candidates || candidates.length == 0)
      return successResponse(
        res,
        'Candidates have been processed.',
        decodedCandidates
      );
    let userMap = {};
    for (let candidate of candidates) {
      let isUserPresentInDB = false;

      let decodedCandidate = {
        first_name: candidate?.[bullhornCandidatedMap.first_name],
        last_name: candidate?.[bullhornCandidatedMap.last_name],
        linkedin_url: candidate?.[bullhornCandidatedMap.linkedin_url],
        source_site: candidate?.[bullhornCandidatedMap.source_site],
        job_position: candidate?.[bullhornCandidatedMap.job_position],
        Id: candidate.id,
        phone_numbers: [],
        emails: [],

        Owner: {
          Name: `${candidate.owner.firstName} ${candidate.owner.lastName}`,
          OwnerId: candidate.owner.id,
        },
        Account: {
          name: candidate?.[bullhornCandidatedMap?.company],
          size:
            candidate?.[
              CompanyFieldMapHelper.getCompanySize({
                size: bullhornCandidatedMap?.size,
              })[0]
            ] ?? null,
          url: candidate?.[bullhornCandidatedMap?.url] ?? null,
          country: candidate?.[bullhornCandidatedMap?.country] ?? null,
          zipcode: candidate?.[bullhornCandidatedMap?.zip_code] ?? null,
        },
      };
      bullhornCandidatedMap?.phone_numbers.forEach((phone_type) => {
        decodedCandidate.phone_numbers.push({
          type: phone_type,
          phone_number: candidate[phone_type],
        });
      });

      bullhornCandidatedMap?.emails.forEach((email_type) => {
        decodedCandidate.emails.push({
          type: email_type,
          email_id: candidate[email_type],
        });
      });

      if (!(candidate?.owner?.id in userMap)) {
        let [user, errFetchingUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: candidate?.owner?.id,
            company_id: req.user.company_id,
          },
        });
        if (errFetchingUser) continue;
        if (!user) {
          userMap[candidate?.owner?.id] = false;
          isUserPresentInDB = false;
        } else {
          userMap[candidate?.owner?.id] = true;
          isUserPresentInDB = true;
        }
      } else isUserPresentInDB = userMap[candidate.owner.id];

      if (!isUserPresentInDB) {
        decodedCandidate.status =
          SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        decodedCandidates.push(decodedCandidate);
        continue;
      }
      let [leadFromDB, errFetchingLeadFromDB] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: {
          integration_id: candidate.id,
          integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE,
        },
        include: {
          [DB_TABLES.USER]: {
            [DB_TABLES.COMPANY]: {
              where: { company_id: req.user.company_id },
              required: true,
            },
            required: true,
          },
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['cadence_id', 'name'],
            },
          },
        },
      });
      if (errFetchingLeadFromDB)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to complete your request right now',
          error: `Unable to query leads: ${errFetchingLeadFromDB}`,
        });

      if (leadFromDB) {
        decodedCandidate.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        decodedCandidate.lead_id = leadFromDB.lead_id;
        decodedCandidate.Cadences = leadFromDB.LeadToCadences || [];
        if (decodedCandidate.Cadences.length === 0)
          decodedCandidate.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;

        let activeCadence = false;
        for (let leadToCadence of decodedCandidate.Cadences) {
          if (
            ![
              CADENCE_LEAD_STATUS.COMPLETED,
              CADENCE_LEAD_STATUS.STOPPED,
            ].includes(leadToCadence.status)
          ) {
            activeCadence = true;
            break;
          }
        }
        if (!activeCadence)
          decodedCandidate.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;
      } else
        decodedCandidate.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      decodedCandidates.push(decodedCandidate);
    }
    return successResponse(
      res,
      'Candidates have been processed.',
      decodedCandidates
    );
  } catch (err) {
    logger.error(`An error ocurred while importing bullhorn candidates: `, err);
    return successResponse(res, 'Unable to import candidates');
  }
};
const importBullhornContacts = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornImportSchema.importBullhornContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Bullhorn contacts',
        error: `Error while importing Bullhorn contacts: ${body.error.message}`,
      });
    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Bullhorn contacts',
        error: 'Contacts array is empty',
      });

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0;
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    let fetchedUserMap = {};
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import bullhorn contacts, please try again or contact support',
        error: errFetchingPreImportData,
      });

    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg;
            if (r[1].error.includes('must be unique'))
              msg = 'Contact present in cadence tool';
            else msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            SocketHelper.sendCadenceImportLoaderEvent({
              loaderData: {
                index: i,
                size: leads.length,
              },
              socketId: loaderId,
            });
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead: ${lead.Id}`);

      // * Validate lead integration_id
      if (!lead.Id) {
        logger.info('Bullhorn contact id not present');
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Bullhorn contact id not present',
        });
        response.total_error++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Validate Account Information
      if (!lead.Account) {
        logger.info('Account information not included');
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: 'Account information not present.',
        });
        response.total_error++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Add user_id to lead
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        createContactFromBullhorn({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
          companyFieldMap,
        })
      );

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg;
        if (r[1].error.includes('must be unique'))
          msg = 'Lead present in cadence tool';
        else msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create contacts in tool from bullhorn: `,
      err
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing Bullhorn contacts: ${err.message}`,
      });
  }
};

// * Import leads
const importBullhornLeads = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornImportSchema.importBullhornLeadSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Bullhorn leads',
        error: `Error while importing Bullhorn leads: ${body.error.message}`,
      });
    // * Destructure request
    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Bullhorn contacts',
        error: 'leads array is empty',
      });

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0;
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    let fetchedUserMap = {};
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import bullhorn leads, please try again or contact support',
        error: errFetchingPreImportData,
      });

    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg;
            if (r[1].error.includes('must be unique'))
              msg = 'Lead present in cadence tool';
            else msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead: ${lead.Id}`);

      // * Validate lead integration_id
      if (!lead.Id) {
        logger.info('Bullhorn lead id not present');
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Bullhorn lead id not present',
        });
        response.total_error++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Add user_id to lead
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        createLeadFromBullhorn({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
          companyFieldMap,
        })
      );

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg;
        if (r[1].error.includes('must be unique'))
          msg = 'Lead present in cadence tool';
        else msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create leads in tool from bullhorn: `,
      err
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing Bullhorn leads: ${err.message}`,
      });
  }
};

const importBullhornCandidates = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornImportSchema.importBullhornCandidateSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Bullhorn leads',
        error: `Error while importing Bullhorn leads: ${body.error.message}`,
      });

    const { candidates: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Bullhorn leads',
        error: 'Leads array in empty',
      });

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0; // * Index declaration for loop
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    let fetchedUserMap = {};
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import bullhorn candidates, please try again or contact support',
        error: errFetchingPreImportData,
      });

    successResponse(
      res,
      'Started importing candidates, please check back after some time'
    );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg;
            if (r[1].error.includes('must be unique'))
              msg = 'Lead present in cadence tool';
            else msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead id: ${lead.Id}`);

      // * If not lead.integration_id
      if (!lead.Id) {
        logger.info('Lead Id not present');
        i++;
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Bullhorn candidate id not present',
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      // * Add user_id to lead
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        createCandidateFromBullhorn({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
          companyFieldMap,
        })
      );

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg;
        if (r[1].error.includes('must be unique'))
          msg = 'Lead present in cadence tool';
        else msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create candidates in tool from bullhorn: `,
      err
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing Bullhorn candidates: ${err.message}`,
      });
  }
};

const importBullhornTempLeads = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornImportSchema.importBullhornLeadSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Bullhorn',
        error: `Error while creating lead in tool: ${body.error.message}`,
      });

    // * Destructure request
    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Bullhorn',
        error: 'Leads array is empty',
      });

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0;
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    let fetchedUserMap = {};
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [{ cadence, node }, errFetchingPreImportData] =
      await ImportHelper.preImportData({
        user_id: req.user.user_id,
        cadence_id,
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
      });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Bullhorn',
        error: errFetchingPreImportData,
      });

    // * Send success response indicating processing has been started
    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );

    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              lead_preview_id: r[1].preview_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              lead_preview_id: r[0].preview_id,
              cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.preview_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead with preview id: ${lead.id}`);

      //* Company name check
      if (!lead?.Account?.name) {
        logger.info('Bullhorn company name is not present');
        i++;
        response.element_error.push({
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Bullhorn company name not present',
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // Check if user with given bullhorn owner id is found
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        logger.info('Owner not present in cadence tool.');
        response.element_error.push({
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Owner id not present in cadence tool',
        });
        response.total_error++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Deletes bullhorn owner id from the lead object and add user id
      delete lead.bullhorn_owner_id;
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createTempLead({
          lead,
          cadence,
          node,
          company_id: user.company_id,
        })
      );

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          lead_preview_id: r[1].preview_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      } else {
        response.element_success.push({
          lead_preview_id: r[0].preview_id,
          cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    // * Send success response with socket
    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create leads in tool for integration Bullhorn: `,
      { err, user_id: req.user.user_id }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating lead in tool for integration Bullhorn: ${err.message}`,
    });
  }
};

const linkContactsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornImportSchema.importBullhornContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to link contacts with cadence',
        error: `Error while linking contacts with cadence: ${body.error.message}`,
      });

    // * Destructure request
    const {
      contacts: leads,
      cadence_id,
      loaderId,
      stopPreviousCadences,
      websocket = true,
    } = body.value;

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0; // * Index declaration for loop
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not link bullhorn contacts, please try again or contact support',
        error: errFetchingPreImportData,
      });
    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started linking bullhorn, please check back after some time'
      );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.integration_id}`);

      promiseArray.push(
        linkBullhornLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );
      if (websocket)
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        if (websocket)
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: leadCadenceOrderBatch,
              size: leads.length,
            },
            socketId: loaderId,
          });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else
      return successResponse(
        res,
        'Leads have been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking contacts to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking contacts to cadence: ${err.message}`,
      });
  }
};

// * Link existing lead with cadence
const linkLeadsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornImportSchema.importBullhornLeadSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to link leads with cadence',
        error: `Error while linking contacts with cadence: ${body.error.message}`,
      });

    // * Destructure request
    const {
      leads,
      cadence_id,
      loaderId,
      stopPreviousCadences,
      websocket = true,
    } = body.value;

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0; // * Index declaration for loop
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not link bullhorn leads, please try again or contact support',
        error: errFetchingPreImportData,
      });
    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started linking bullhorn leads, please check back after some time'
      );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.integration_id}`);

      promiseArray.push(
        linkBullhornLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );
      if (websocket)
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        if (websocket)
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: leadCadenceOrderBatch,
              size: leads.length,
            },
            socketId: loaderId,
          });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else
      return successResponse(
        res,
        'Leads have been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking leads to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking leads to cadence: ${err.message}`,
      });
  }
};
const linkCandidatesWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornImportSchema.importBullhornCandidateSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to link candidates with cadence',
        error: `Error while linking candidates with cadence: ${body.error.message}`,
      });

    // * Destructure request
    const {
      candidates: leads,
      cadence_id,
      loaderId,
      stopPreviousCadences,
      websocket = true,
    } = body.value;

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0; // * Index declaration for loop
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not link bullhorn candidates, please try again or contact support',
        error: errFetchingPreImportData,
      });
    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started adding candidates to cadence, please check back after some time'
      );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.integration_id}`);

      promiseArray.push(
        linkBullhornLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );
      if (websocket)
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        if (websocket)
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: leadCadenceOrderBatch,
              size: leads.length,
            },
            socketId: loaderId,
          });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else
      return successResponse(
        res,
        'Leads have been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking candidates to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking candidates to cadence: ${err.message}`,
      });
  }
};
const getBullhornUsers = async (req, res) => {
  try {
    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        company_id: req?.user?.company_id,
        integration_type: USER_INTEGRATION_TYPES.BULLHORN_USER,
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: `Unable to fetch users: ${errForUsers}`,
      });
    return successResponse(res, 'Successfully fetched users data', users);
  } catch (err) {
    logger.error(`Error ocurred while fetching users of bullhorn: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Unable to complete your request right now',
      err: err.message,
    });
  }
};

// * Fetch CSV Columns
const getCSVColumns = async (req, res) => {
  try {
    // File validation
    const supportedExtensions = ['xlsx', 'xls', 'csv'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );

    if (supportedExtensions.includes(fileExtension.toLowerCase())) {
      const workbook = xlsx.readFile(req.file.path, { sheetRows: 1 });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const options = {
        header: 1,
        raw: false,
        rawNumbers: false,
      };

      let workbook_response = xlsx.utils.sheet_to_json(worksheet, options);
      if (!workbook_response?.length || !workbook_response[0]?.length)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Header values required. Add headers to the first row.',
        });

      const headers = workbook_response[0]?.filter((item) => item !== '');

      const seenHeaders = new Set();
      const duplicateColumnsArray = [];
      for (let header of headers) {
        if (seenHeaders.has(header)) {
          duplicateColumnsArray.push(header);
        } else {
          seenHeaders.add(header);
        }
      }
      if (duplicateColumnsArray.length > 0) {
        const duplicateColumnsSet = new Set(duplicateColumnsArray);
        const array = Array.from(duplicateColumnsSet);
        let columnsStr = array.join(', ');
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Duplicate columns found : ${columnsStr}`,
        });
      }

      return successResponse(
        res,
        'Successfully fetched excel Columns',
        headers
      );
    } else {
      // File extension is not supported
      return serverErrorResponseWithDevMsg({
        res,
        msg: `File type: ${fileExtension} is not supported`,
      });
    }
  } catch (err) {
    logger.error('An error occurred while fetching CSV Columns : ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching CSV columns: ${err.message}`,
    });
  }
};

// * Fetch Google Sheets Columns
const getSheetsColumns = async (req, res) => {
  try {
    const body = bullhornImportSchema.fetchSheetsColumnsSchema.validate(
      req.body
    );
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: body.error.details[0].message,
      });

    const [_, spreadsheetId, sheetId] = req.body.url.match(GOOGLE_SHEETS_REGEX);

    const [doc, errForDoc] = await GoogleSheets.loadDocument(spreadsheetId);
    if (errForDoc && errForDoc?.includes('403'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please provide read access to "Anyone with the link" to the google sheet',
      });
    if (errForDoc && errForDoc?.includes('404'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please Provide Valid Google Sheets Url',
      });
    if (errForDoc)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: errForDoc,
      });

    // Fetch sheet no. 0
    const sheet = doc.sheetsByIndex[0];

    // Load header row, loaded value will be found in sheet.headerValues
    await sheet.loadHeaderRow();

    return successResponse(
      res,
      'Successfully fetched google sheets columns',
      sheet?.headerValues || []
    );
  } catch (err) {
    logger.error('An error occurred while fetching google sheets columns : ', {
      err,
      user_id: req.user.user_id,
    });

    if (
      err.message?.toLowerCase()?.includes('duplicate header detected') ||
      err.message?.includes('No values in the header row')
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: err.message,
      });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching google sheets columns: ${err.message}`,
    });
  }
};

const previewLeadsForCSVImport = async (req, res) => {
  try {
    // * Parsing field map
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }

    // * JOI validation
    let body = bullhornImportSchema.leadsPreviewSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map } = body;

    let bullhornFieldMap = field_map;
    let [bullhornMap, errForBullhornMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForBullhornMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errForBullhornMap,
      });
    let bullhornAccountMap = bullhornMap.account_map;

    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (
        errForAccessToken.toLowerCase().includes('kindly sign in') ||
        errForAccessToken.toLowerCase().includes('kindly log in')
      ) {
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with bullhorn`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    let leads = [];
    // let invalid = true;
    csv
      .parseFile(req.file.path, { headers: true })
      .on('error', (error) => {
        logger.error(error?.message);
        if (error?.message?.includes('Duplicate headers'))
          return badRequestResponseWithDevMsg({
            res,
            msg: `Improper CSV format. ${error?.message?.replace(
              'headers',
              'fields'
            )}`,
          });
      })
      .on('data', (data) => {
        if (res.headersSent) return;

        let lead = {};
        let emails = [];
        let phone_numbers = [];
        let emptyRow = true;

        Object.keys(bullhornFieldMap)?.forEach((key) => {
          if (key !== 'emails' && key !== 'phone_numbers') {
            lead[key] = data[bullhornFieldMap[key]]?.trim();
            if (lead[key]) emptyRow = false;
          }
        });
        bullhornFieldMap?.phone_numbers?.forEach((phone_number) => {
          if (data[phone_number.column_name]) {
            phone_numbers.push({
              phone_number: data[phone_number.column_name]?.trim(),
              type: phone_number.type,
            });
            emptyRow = false;
          }
        });
        bullhornFieldMap?.emails?.forEach((email) => {
          if (data[email.column_name]) {
            emails.push({
              email_id: data[email.column_name]?.trim(),
              type: email.type,
            });
            emptyRow = false;
          }
        });
        lead.phone_numbers = phone_numbers;
        lead.emails = emails;
        if (!emptyRow) leads.push(lead);
      })
      .on('end', async () => {
        if (res.headersSent) return;
        if (leads.length > 500)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'More than 500 leads cannot be imported together',
          });
        let i = 1;
        let leadsToPreview = [];
        let userObj = {};
        let AccountMap = {};
        let leadIds = [];
        leads.map((lead) => {
          leadIds.push(lead.id);
        });

        let [dbLeads, errFetchingLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            [Op.or]: {
              integration_id: leadIds,
            },
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_LEAD,
            company_id: req.user.company_id,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['name', 'cadence_id'],
              },
            },
            [DB_TABLES.ACCOUNT]: {
              attributes: [
                'name',
                'phone_number',
                'size',
                'url',
                'integration_id',
              ],
            },
          },
        });
        if (errFetchingLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to preview leads from CSV',
            error: `Error while fetching leads: ${errFetchingLeads}`,
          });
        let accountFields = '';
        delete bullhornAccountMap.zip_code;
        delete bullhornAccountMap.country;
        for (const [key, value] of Object.entries(bullhornAccountMap)) {
          if (key === 'disqualification_reason') continue;
          if (key === 'integration_status') {
            accountFields = accountFields + `${value?.name},`;
            continue;
          }
          if (key === 'variables') continue;

          if (typeof value === 'string')
            accountFields = accountFields + `${value},`;
        }

        successResponse(
          res,
          'Started importing, please check back after some time'
        );

        const emailRegex = /^(.{1,320})@[^\s@]{1,255}\.[^\s@]{2,}$/;
        const phoneRegex =
          /^(?:\+\d{1,3}\s?)?(?:\(\d{1,4}\)\s?)?(?:\d{1,4}[\s-])?\d{7,14}$/;
        const linkedinRegex =
          /^(https?:\/\/)?(www\.)?linkedin\.com\/(in\/[a-zA-Z0-9_-]{1,100}|company\/[0-9]+)\/?$/;
        const websiteUrlRegex =
          /^(https?:\/\/)?([\w.-]{1,100})\.([a-z]{2,})(:\d{2,5})?(\/\S*)?$/i;

        while (i < leads.length) {
          let createdLead = {};
          let lead = leads[i];
          logger.info(`For lead ${i + 1}`);

          createdLead = {
            Id: lead.id,
            first_name: lead.first_name,
            last_name: lead.last_name,
            linkedin_url: lead.linkedin_url,
            job_position: lead.job_position,
            emails: lead.emails,
            phone_numbers: lead.phone_numbers,
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_LEAD,
            integration_status: lead.integration_status,
          };

          // * Checking for empty row
          const isEmptyRow = Object.keys(createdLead).every((key) => {
            const value = createdLead[key];

            if (Array.isArray(value)) {
              return value.length === 0; // Check for an empty array
            } else if (typeof value === 'object' && value !== null) {
              return Object.values(value).join('').length === 0; // Check for an empty object
            } else {
              return value === null || value === ''; // Check for null or empty string
            }
          });
          if (isEmptyRow) {
            i++;
            continue;
          }

          if (!lead.owner || lead.owner === '') {
            logger.info('Lead owner not present in CSV.');
            createdLead.Owner = null;
            createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            createdLead.account = null;
            leadsToPreview.push(createdLead);
            SocketHelper.sendCadenceImportLoaderEvent({
              loaderData: {
                index: i,
                size: leads.length,
              },
              socketId: loaderId,
            });
            i++;
            continue;
          }

          let isPresent = dbLeads.filter(function (value) {
            return value.integration_id == createdLead.Id;
          });

          if (isPresent.length > 0) {
            createdLead.status =
              SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
            createdLead.lead_id = isPresent[0].lead_id;
            createdLead.Cadences = isPresent[0]?.LeadToCadences;
            createdLead.Account = isPresent[0]?.Account;
          } else {
            if (!lead.account_name) createdLead.Account = null;
            else {
              if (!(lead.account_name in AccountMap)) {
                const query = `name = '${lead.account_name}'`;
                const fields = `${accountFields}id,address`;
                let [results, errResult] = await bullhornService.query(
                  fields,
                  (start = 0),
                  (object = BULLHORN_ENDPOINTS.CORPORATION),
                  query,
                  access_token,
                  instance_url
                );
                if (results.data[0]) {
                  const corporation = results.data[0];

                  let url = corporation[bullhornAccountMap.url];
                  let size =
                    corporation[
                      `${
                        CompanyFieldMapHelper.getCompanySize({
                          size: bullhornAccountMap.size,
                        })[0]
                      }`
                    ];
                  let country = corporation?.address?.countryName;
                  let name = corporation[`${bullhornAccountMap.name}`];
                  let zip_code = corporation?.address?.zip;
                  let phone_number =
                    corporation[`${bullhornAccountMap.phone_number}`];
                  let Id = corporation.id;
                  let integration_status =
                    corporation[
                      `${bullhornAccountMap?.integration_status?.name}`
                    ];
                  let decodedAccount = {
                    Id,
                    url,
                    size,
                    country,
                    name,
                    zip_code,
                    phone_number,
                    integration_status,
                  };
                  createdLead.Account = decodedAccount;
                  AccountMap[lead.account_name] = decodedAccount;
                } else {
                  createdLead.Account = null;
                  AccountMap[lead.account_name] = null;
                }
              } else createdLead.Account = AccountMap[lead.account_name];
            }

            createdLead.status =
              SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
          }

          let user, userErr;
          // Check if user with given bullhorn owner id is found
          if (!(lead.owner in userObj)) {
            [user, userErr] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                [Op.and]: [
                  sequelize.where(
                    sequelize.fn(
                      'lower',
                      sequelize.fn(
                        'concat',
                        sequelize.col('first_name'),
                        ' ',
                        sequelize.col('last_name')
                      )
                    ),
                    lead?.owner?.toLowerCase()?.trim() ?? ''
                  ),
                ],
                company_id: req.user.company_id,
              },
            });

            if (userErr || user === null) {
              logger.info('Owner not present in our tool.');
              userObj[lead?.owner] = null; // cache not present case so that we do not try to process this user again
              createdLead.Owner = {
                OwnerId: null,
                Name: lead.owner,
              };
              createdLead.status =
                SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            } else {
              userObj[lead?.owner] = user; // cache present case so that we do not try to process this user again
              createdLead.Owner = {
                OwnerId: user.integration_id,
                Name: lead.owner,
              };
              createdLead.user_id = user.user_id;
            }
          } else {
            /*
             * user is cached in this case
             * Here we can have 2 cases
             * Case 1: cache tells that user is present in our tool, the cache will contain the actual user
             * Case 2: cache tells that user is not present in our tool, the cache will contain null
             * */
            if (!userObj[lead?.owner]) {
              // case 2, if no valid value is present
              logger.info('Owner not present in our tool.');
              createdLead.Owner = {
                OwnerId: null,
                Name: lead.owner,
              };
              createdLead.status =
                SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
              userObj[lead?.owner] = null; // cache not present case so that we do not try to process this user again
            } else {
              // case 1,  user is found
              user = userObj[lead.owner];
              createdLead.Owner = {
                OwnerId: user.integration_id,
                Name: lead.owner,
              };
              createdLead.user_id = user?.user_id;
            }
          }

          // * Checking data of required fields
          if (!createdLead?.first_name) {
            logger.info(`First name not present in CSV.`);
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} is missing`;
          } else if (!createdLead?.last_name) {
            logger.info(`Last name not present in CSV.`);
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} is missing`;
          }

          // * Field format validation
          else if (
            createdLead?.linkedin_url &&
            !linkedinRegex.test(createdLead.linkedin_url)
          ) {
            logger.error(`Linkedin url should be valid`);
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.LINKEDIN_URL} should be valid`;
          } else if (
            createdLead?.Account?.url &&
            !websiteUrlRegex.test(createdLead?.Account?.url)
          ) {
            logger.error(`Company website url is invalid`);
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.URL} is invalid`;
          } else if (
            createdLead?.Account?.phone_number &&
            !phoneRegex.test(createdLead?.Account?.phone_number)
          ) {
            logger.error(`Company phone number is invalid`);
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
          }
          // fields length limit validations
          else if (createdLead?.first_name?.length > 50) {
            logger.error("First name can't be more than 50 characters");
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
          } else if (createdLead?.last_name?.length > 75) {
            logger.error("Last name can't be more than 75 characters");
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
          } else if (createdLead?.job_position?.length > 100) {
            logger.error("Job Position can't be more than 100 characters");
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
          } else if (createdLead?.Account?.name?.length > 200) {
            logger.error("Company name can't be more than 200 characters");
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
          } else if (createdLead?.Account?.country?.length > 100) {
            logger.error("Country name can't be more than 100 characters");
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
          } else if (createdLead?.Account?.zipcode?.length > 10) {
            logger.error("Zipcode can't be more than 10 characters");
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
          } else if (createdLead?.Account?.size?.length > 25) {
            logger.error("Company size can't be more than 25 characters");
            createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
          }

          let errMsg = '';
          let isPhoneErr = false;
          createdLead?.phone_numbers?.forEach((phone) => {
            let phoneNumber = phone.phone_number;
            if (phoneNumber && !phoneRegex.test(phoneNumber)) {
              errMsg = `${phone.type} is invalid`;
              isPhoneErr = true;
            }
          });
          if (isPhoneErr && !createdLead?.status?.length)
            createdLead.status = errMsg;

          let emailErr = false;
          createdLead?.emails?.forEach((email) => {
            let emailId = email.email_id;
            if (emailId && !emailRegex.test(emailId)) {
              logger.error(`${email.type} is invalid`);
              emailErr = true;
            }
          });
          if (emailErr && !createdLead?.status?.length)
            createdLead.status = errMsg;

          leadsToPreview.push(createdLead);
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: i,
              size: leads.length,
            },
            socketId: loaderId,
          });
          i++;
        }

        SocketHelper.sendCadenceImportResponseEvent({
          response_data: { leads: leadsToPreview, error: null },
          socketId: loaderId,
        });
      });
  } catch (err) {
    logger.error('Error while previewing leads from csv for bullhorn: ', {
      user_id: req.user.user_id,
      err,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing leads from csv for bullhorn: ${err.message}`,
      });
    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        leads: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: req.body.loaderId,
    });
  }
};

const previewContactsForCSVImport = async (req, res) => {
  try {
    // * Parsing field map
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }

    // * JOI validation
    let body = bullhornImportSchema.contactsPreviewSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map } = body;

    let bullhornFieldMap = field_map;
    let [bullhornMap, errForBullhornMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForBullhornMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to complete your request right now',
        error: errForBullhornMap,
      });
    let bullhornAccountMap = bullhornMap.account_map;

    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (
        errForAccessToken.toLowerCase().includes('kindly sign in') ||
        errForAccessToken.toLowerCase().includes('kindly log in')
      ) {
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with bullhorn`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    let leads = [];
    // let invalid = true;
    csv
      .parseFile(req.file.path, { headers: true })
      .on('error', (error) => {
        logger.error(error?.message);
        if (error?.message?.includes('Duplicate headers'))
          return badRequestResponseWithDevMsg({
            res,
            msg: `Improper CSV format. ${error?.message?.replace(
              'headers',
              'fields'
            )}`,
          });
      })
      .on('data', (data) => {
        if (res.headersSent) return;

        let lead = {};
        let emails = [];
        let phone_numbers = [];
        let emptyRow = true;

        Object.keys(bullhornFieldMap)?.forEach((key) => {
          if (key !== 'emails' && key !== 'phone_numbers') {
            lead[key] = data[bullhornFieldMap[key]]?.trim();
            if (lead[key]) emptyRow = false;
          }
        });
        bullhornFieldMap?.phone_numbers?.forEach((phone_number) => {
          if (data[phone_number.column_name]) {
            phone_numbers.push({
              phone_number: data[phone_number.column_name]?.trim(),
              type: phone_number.type,
            });
            emptyRow = false;
          }
        });
        bullhornFieldMap?.emails?.forEach((email) => {
          if (data[email.column_name]) {
            emails.push({
              email_id: data[email.column_name]?.trim(),
              type: email.type,
            });
            emptyRow = false;
          }
        });
        lead.phone_numbers = phone_numbers;
        lead.emails = emails;
        if (!emptyRow) leads.push(lead);
      })
      .on('end', async () => {
        if (res.headersSent) return;
        if (leads.length > 500)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'More than 500 leads cannot be imported together',
          });
        let i = 1;
        let contactsToPreview = [];
        let userObj = {};
        let AccountMap = {};
        let contactIds = [];
        leads.map((lead) => {
          contactIds.push(lead.id);
        });

        let [dbLeads, errFetchingLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            [Op.or]: {
              integration_id: contactIds,
            },
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT,
            company_id: req.user.company_id,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['name', 'cadence_id'],
              },
            },
            [DB_TABLES.ACCOUNT]: {
              attributes: [
                'name',
                'phone_number',
                'size',
                'url',
                'integration_id',
              ],
            },
          },
        });
        if (errFetchingLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to preview contacts from CSV',
            error: `Error while fetching dbContacts: ${errFetchingLeads}`,
          });
        let accountFields = '';
        delete bullhornAccountMap.zip_code;
        delete bullhornAccountMap.country;
        for (const [key, value] of Object.entries(bullhornAccountMap)) {
          if (key === 'disqualification_reason') continue;
          if (key === 'integration_status') {
            accountFields = accountFields + `${value?.name},`;
            continue;
          }
          if (key === 'variables') continue;

          if (typeof value === 'string')
            accountFields = accountFields + `${value},`;
        }

        successResponse(
          res,
          'Started importing, please check back after some time'
        );

        const emailRegex = /^(.{1,320})@[^\s@]{1,255}\.[^\s@]{2,}$/;
        const phoneRegex =
          /^(?:\+\d{1,3}\s?)?(?:\(\d{1,4}\)\s?)?(?:\d{1,4}[\s-])?\d{7,14}$/;
        const linkedinRegex =
          /^(https?:\/\/)?(www\.)?linkedin\.com\/(in\/[a-zA-Z0-9_-]{1,100}|company\/[0-9]+)\/?$/;
        const websiteUrlRegex =
          /^(https?:\/\/)?([\w.-]{1,100})\.([a-z]{2,})(:\d{2,5})?(\/\S*)?$/i;

        while (i < leads.length) {
          let createdContact = {};
          let lead = leads[i];
          logger.info(`For lead ${i + 1}`);

          createdContact = {
            Id: lead.id,
            first_name: lead.first_name,
            last_name: lead.last_name,
            linkedin_url: lead.linkedin_url,
            job_position: lead.job_position,
            emails: lead.emails,
            phone_numbers: lead.phone_numbers,
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT,
            integration_status: lead.integration_status,
          };
          if (!lead.owner || lead.owner === '') {
            logger.info('Contact owner not present in CSV.');
            createdContact.Owner = null;
            createdContact.status =
              SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            createdContact.account = null;
            contactsToPreview.push(createdContact);
            SocketHelper.sendCadenceImportLoaderEvent({
              loaderData: {
                index: i,
                size: leads.length,
              },
              socketId: loaderId,
            });
            i++;
            continue;
          }

          // * Checking for empty row
          const isEmptyRow = Object.keys(createdContact).every((key) => {
            const value = createdContact[key];

            if (Array.isArray(value)) {
              return value.length === 0; // Check for an empty array
            } else if (typeof value === 'object' && value !== null) {
              return Object.values(value).join('').length === 0; // Check for an empty object
            } else {
              return value === null || value === ''; // Check for null or empty string
            }
          });
          if (isEmptyRow) {
            i++;
            continue;
          }

          let isPresent = dbLeads.filter(function (value) {
            return value.integration_id == createdContact.Id;
          });

          if (isPresent.length > 0) {
            createdContact.status =
              SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
            createdContact.lead_id = isPresent[0].lead_id;
            createdContact.Cadences = isPresent[0]?.LeadToCadences;
            createdContact.Account = isPresent[0]?.Account;
          } else {
            if (!lead.account_name) createdContact.Account = null;
            else {
              if (!(lead.account_name in AccountMap)) {
                const query = `name = '${lead.account_name}'`;
                const fields = `${accountFields}id,address`;
                let [results, errResult] = await bullhornService.query(
                  fields,
                  (start = 0),
                  (object = BULLHORN_ENDPOINTS.CORPORATION),
                  query,
                  access_token,
                  instance_url
                );
                if (results.data[0]) {
                  const corporation = results?.data[0];

                  let url = corporation[bullhornAccountMap.url];
                  let size =
                    corporation[
                      `${
                        CompanyFieldMapHelper.getCompanySize({
                          size: bullhornAccountMap.size,
                        })[0]
                      }`
                    ];
                  let country = corporation?.address?.countryName;
                  let name = corporation[`${bullhornAccountMap.name}`];
                  let zip_code = corporation?.address?.zip;
                  let phone_number =
                    corporation[`${bullhornAccountMap.phone_number}`];
                  let Id = corporation.id;
                  let integration_status =
                    corporation[
                      `${bullhornAccountMap?.integration_status?.name}`
                    ];
                  let decodedAccount = {
                    Id,
                    url,
                    size,
                    country,
                    name,
                    zip_code,
                    phone_number,
                    integration_status,
                  };
                  createdContact.Account = decodedAccount;
                  AccountMap[lead.account_name] = decodedAccount;
                } else {
                  createdContact.Account = null;
                  AccountMap[lead.account_name] = null;
                }
              } else createdContact.Account = AccountMap[lead.account_name];
            }

            createdContact.status =
              SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
          }

          let user, userErr;
          // Check if user with given bullhorn owner id is found
          if (!(lead.owner in userObj)) {
            [user, userErr] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                [Op.and]: [
                  sequelize.where(
                    sequelize.fn(
                      'lower',
                      sequelize.fn(
                        'concat',
                        sequelize.col('first_name'),
                        ' ',
                        sequelize.col('last_name')
                      )
                    ),
                    lead?.owner?.toLowerCase()?.trim() ?? ''
                  ),
                ],
                company_id: req.user.company_id,
              },
            });

            if (userErr || user === null) {
              logger.info('Owner not present in our tool.');
              userObj[lead?.owner] = null; // cache not present case so that we do not try to process this user again
              createdContact.Owner = {
                OwnerId: null,
                Name: lead.owner,
              };
              createdContact.status =
                SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            } else {
              userObj[lead?.owner] = user; // cache present case so that we do not try to process this user again
              createdContact.Owner = {
                OwnerId: user.integration_id,
                Name: lead.owner,
              };
              createdContact.user_id = user.user_id;
            }
          } else {
            /*
             * user is cached in this case
             * Here we can have 2 cases
             * Case 1: cache tells that user is present in our tool, the cache will contain the actual user
             * Case 2: cache tells that user is not present in our tool, the cache will contain null
             * */
            if (!userObj[lead?.owner]) {
              // case 2, if no valid value is present
              logger.info('Owner not present in our tool.');
              createdContact.Owner = {
                OwnerId: null,
                Name: lead.owner,
              };
              createdContact.status =
                SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
              userObj[lead?.owner] = null; // cache not present case so that we do not try to process this user again
            } else {
              // case 1,  user is found
              user = userObj[lead.owner];
              createdContact.Owner = {
                OwnerId: user.integration_id,
                Name: lead.owner,
              };
              createdContact.user_id = user?.user_id;
            }
          }

          // * Checking data of required fields
          if (!createdContact?.first_name) {
            logger.info(`First name not present in CSV.`);
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} is missing`;
          } else if (!createdContact?.last_name) {
            logger.info(`Last name not present in CSV.`);
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} is missing`;
          }

          // * Field format validation
          else if (
            createdContact?.linkedin_url &&
            !linkedinRegex.test(createdContact.linkedin_url)
          ) {
            logger.error(`Linkedin url should be valid`);
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.LINKEDIN_URL} should be valid`;
          } else if (
            createdContact?.Account?.url &&
            !websiteUrlRegex.test(createdContact?.Account?.url)
          ) {
            logger.error(`Company website url is invalid`);
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.URL} is invalid`;
          } else if (
            createdContact?.Account?.phone_number &&
            !phoneRegex.test(createdContact?.Account?.phone_number)
          ) {
            logger.error(`Company phone number is invalid`);
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
          }
          // fields length limit validations
          else if (createdContact?.first_name?.length > 50) {
            logger.error("First name can't be more than 50 characters");
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
          } else if (createdContact?.last_name?.length > 75) {
            logger.error("Last name can't be more than 75 characters");
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
          } else if (createdContact?.job_position?.length > 100) {
            logger.error("Job Position can't be more than 50 characters");
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
          } else if (createdContact?.Account?.name?.length > 200) {
            logger.error("Company name can't be more than 200 characters");
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
          } else if (createdContact?.Account?.country?.length > 100) {
            logger.error("Country name can't be more than 100 characters");
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
          } else if (createdContact?.Account?.zipcode?.length > 10) {
            logger.error("Zipcode can't be more than 10 characters");
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
          } else if (createdContact?.Account?.size?.length > 25) {
            logger.error("Company size can't be more than 25 characters");
            createdContact.status = `${BULLHORN_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
          }

          let errMsg = '';
          let isPhoneErr = false;
          createdContact?.phone_numbers?.forEach((phone) => {
            let phoneNumber = phone.phone_number;
            if (phoneNumber && !phoneRegex.test(phoneNumber)) {
              errMsg = `${phone.type} is invalid`;
              isPhoneErr = true;
            }
          });
          if (isPhoneErr && !createdContact?.status?.length)
            createdContact.status = errMsg;

          let emailErr = false;
          createdContact?.emails?.forEach((email) => {
            let emailId = email.email_id;
            if (emailId && !emailRegex.test(emailId)) {
              logger.error(`${email.type} is invalid`);
              emailErr = true;
            }
          });
          if (emailErr && !createdContact?.status?.length)
            createdContact.status = errMsg;

          contactsToPreview.push(createdContact);
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: i,
              size: leads.length,
            },
            socketId: loaderId,
          });
          i++;
        }

        SocketHelper.sendCadenceImportResponseEvent({
          response_data: { contacts: contactsToPreview, error: null },
          socketId: loaderId,
        });
      });
  } catch (err) {
    logger.error('Error while previewing contacts from csv for bullhorn: ', {
      user_id: req.user.user_id,
      err,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing contacts from csv for bullhorn: ${err.message}`,
      });
    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        contacts: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: req.body.loaderId,
    });
  }
};

const previewCandidatesForCSVImport = async (req, res) => {
  try {
    // * Parsing field map
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }

    // * JOI validation
    let body = bullhornImportSchema.candidatesPreviewSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview candidates',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map } = body;

    let bullhornFieldMap = field_map;
    let leads = [];
    // let invalid = true;
    csv
      .parseFile(req.file.path, { headers: true })
      .on('error', (error) => {
        logger.error(error?.message);
        if (error?.message?.includes('Duplicate headers'))
          return badRequestResponseWithDevMsg({
            res,
            msg: `Improper CSV format. ${error?.message?.replace(
              'headers',
              'fields'
            )}`,
          });
      })
      .on('data', (data) => {
        if (res.headersSent) return;

        let lead = {};
        let emails = [];
        let phone_numbers = [];
        let emptyRow = true;

        Object.keys(bullhornFieldMap)?.forEach((key) => {
          if (key !== 'emails' && key !== 'phone_numbers') {
            lead[key] = data[bullhornFieldMap[key]]?.trim();
            if (lead[key]) emptyRow = false;
          }
        });
        bullhornFieldMap?.phone_numbers?.forEach((phone_number) => {
          if (data[phone_number.column_name]) {
            phone_numbers.push({
              phone_number: data[phone_number.column_name]?.trim(),
              type: phone_number.type,
            });
            emptyRow = false;
          }
        });
        bullhornFieldMap?.emails?.forEach((email) => {
          if (data[email.column_name]) {
            emails.push({
              email_id: data[email.column_name]?.trim(),
              type: email.type,
            });
            emptyRow = false;
          }
        });
        lead.phone_numbers = phone_numbers;
        lead.emails = emails;
        if (!emptyRow) leads.push(lead);
      })
      .on('end', async () => {
        if (res.headersSent) return;
        if (leads.length > 500)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'More than 500 leads cannot be imported together',
          });

        let i = 1;
        let candidatesToPreview = [];
        let userObj = {};
        let leadIds = [];
        leads.map((lead) => {
          leadIds.push(lead.id);
        });

        let [dbLeads, errFetchingLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            [Op.or]: {
              integration_id: leadIds,
            },
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE,
            company_id: req.user.company_id,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['name', 'cadence_id'],
              },
            },
            [DB_TABLES.ACCOUNT]: {
              attributes: ['name', 'phone_number', 'size', 'url'],
            },
          },
        });
        if (errFetchingLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to preview contacts from CSV',
            error: `Error while fetching candidates: ${errFetchingLeads}`,
          });

        successResponse(
          res,
          'Started importing, please check back after some time'
        );

        const emailRegex = /^(.{1,320})@[^\s@]{1,255}\.[^\s@]{2,}$/;
        const phoneRegex =
          /^(?:\+\d{1,3}\s?)?(?:\(\d{1,4}\)\s?)?(?:\d{1,4}[\s-])?\d{7,14}$/;
        const linkedinRegex =
          /^(https?:\/\/)?(www\.)?linkedin\.com\/(in\/[a-zA-Z0-9_-]{1,100}|company\/[0-9]+)\/?$/;
        const websiteUrlRegex =
          /^(https?:\/\/)?([\w.-]{1,100})\.([a-z]{2,})(:\d{2,5})?(\/\S*)?$/i;

        while (i < leads.length) {
          let lead = leads[i];

          let createdCandidate = {
            Id: lead.id,
            first_name: lead.first_name,
            last_name: lead.last_name,
            linkedin_url: lead.linkedin_url,
            job_position: lead.job_position,
            emails: lead.emails,
            phone_numbers: lead.phone_numbers,
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE,
            integration_status: lead.integration_status,

            Account: {
              name: lead.company,
              phone_number: lead.company_phone_number,
              size: lead.size,
              url: lead.url,
              country: lead.country,
              zip_code: lead.zip_code,
            },
          };

          // * Checking for empty row
          const isEmptyRow = Object.keys(createdCandidate).every((key) => {
            const value = createdCandidate[key];

            if (Array.isArray(value)) {
              return value.length === 0; // Check for an empty array
            } else if (typeof value === 'object' && value !== null) {
              return Object.values(value).join('').length === 0; // Check for an empty object
            } else {
              return value === null || value === ''; // Check for null or empty string
            }
          });
          if (isEmptyRow) {
            i++;
            continue;
          }

          if (!lead.owner || lead.owner === '') {
            logger.info('Lead owner not present in bullhorn.');
            createdCandidate.Owner = null;
            createdCandidate.status =
              SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            createdCandidate.Account = null;
            candidatesToPreview.push(createdCandidate);
            SocketHelper.sendCadenceImportLoaderEvent({
              loaderData: {
                index: i,
                size: leads.length,
              },
              socketId: loaderId,
            });
            i++;
            continue;
          }

          let isPresent = dbLeads.filter(function (value) {
            return value.integration_id == lead.id;
          });
          if (isPresent.length > 0) {
            createdCandidate.status =
              SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
            createdCandidate.lead_id = isPresent[0].lead_id;
            createdCandidate.Cadences = isPresent[0]?.LeadToCadences;
            createdCandidate.Account = isPresent[0]?.Account;
          } else
            createdCandidate.status =
              SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

          let user, userErr;
          // Check if user with given bullhorn owner id is found
          if (!(lead.owner in userObj)) {
            [user, userErr] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                [Op.and]: [
                  sequelize.where(
                    sequelize.fn(
                      'lower',
                      sequelize.fn(
                        'concat',
                        sequelize.col('first_name'),
                        ' ',
                        sequelize.col('last_name')
                      )
                    ),
                    lead?.owner?.toLowerCase()?.trim() ?? ''
                  ),
                ],
                company_id: req.user.company_id,
              },
            });

            if (userErr || user === null) {
              logger.info('Owner not present in our tool.');
              userObj[lead?.owner] = null; // cache not present case so that we do not try to process this user again
              createdCandidate.Owner = {
                OwnerId: null,
                Name: lead.owner,
              };
              createdCandidate.status =
                SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            } else {
              userObj[lead?.owner] = user; // cache present case so that we do not try to process this user again
              createdCandidate.Owner = {
                OwnerId: user.integration_id,
                Name: lead.owner,
              };
              createdCandidate.user_id = user.user_id;
            }
          } else {
            /*
             * user is cached in this case
             * Here we can have 2 cases
             * Case 1: cache tells that user is present in our tool, the cache will contain the actual user
             * Case 2: cache tells that user is not present in our tool, the cache will contain null
             * */
            if (!userObj[lead?.owner]) {
              // case 2, if no valid value is present
              logger.info('Owner not present in our tool.');
              createdCandidate.Owner = {
                OwnerId: null,
                Name: lead.owner,
              };
              createdCandidate.status =
                SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
              userObj[lead?.owner] = null; // cache not present case so that we do not try to process this user again
            } else {
              // case 1,  user is found
              user = userObj[lead.owner];
              createdCandidate.Owner = {
                OwnerId: user.integration_id,
                Name: lead.owner,
              };
              createdCandidate.user_id = user?.user_id;
            }
          }

          // * Checking data of required fields
          if (!createdCandidate?.first_name) {
            logger.info(`First name not present in CSV.`);
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} is missing`;
          } else if (!createdCandidate?.last_name) {
            logger.info(`Last name not present in CSV.`);
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} is missing`;
          }

          // * Field format validation
          else if (
            createdCandidate?.linkedin_url &&
            !linkedinRegex.test(createdCandidate.linkedin_url)
          ) {
            logger.error(`Linkedin url should be valid`);
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.LINKEDIN_URL} should be valid`;
          } else if (
            createdCandidate?.Account?.url &&
            !websiteUrlRegex.test(createdCandidate?.Account?.url)
          ) {
            logger.error(`Company website url is invalid`);
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.URL} is invalid`;
          } else if (
            createdCandidate?.Account?.phone_number &&
            !phoneRegex.test(createdCandidate?.Account?.phone_number)
          ) {
            logger.error(`Company phone number is invalid`);
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
          }
          // fields length limit validations
          else if (createdCandidate?.first_name?.length > 50) {
            logger.error("First name can't be more than 50 characters");
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
          } else if (createdCandidate?.last_name?.length > 75) {
            logger.error("Last name can't be more than 75 characters");
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
          } else if (createdCandidate?.job_position?.length > 100) {
            logger.error("Job Position can't be more than 100 characters");
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
          } else if (createdCandidate?.Account?.name?.length > 200) {
            logger.error("Company name can't be more than 200 characters");
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
          } else if (createdCandidate?.Account?.country?.length > 100) {
            logger.error("Country name can't be more than 100 characters");
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
          } else if (createdCandidate?.Account?.zipcode?.length > 10) {
            logger.error("Zipcode can't be more than 10 characters");
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
          } else if (createdCandidate?.Account?.size?.length > 25) {
            logger.error("Company size can't be more than 25 characters");
            createdCandidate.status = `${BULLHORN_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
          }

          let errMsg = '';
          let isPhoneErr = false;
          createdCandidate?.phone_numbers?.forEach((phone) => {
            let phoneNumber = phone.phone_number;
            if (phoneNumber && !phoneRegex.test(phoneNumber)) {
              errMsg = `${phone.type} is invalid`;
              isPhoneErr = true;
            }
          });
          if (isPhoneErr && !createdCandidate?.status?.length)
            createdCandidate.status = errMsg;

          let emailErr = false;
          createdCandidate?.emails?.forEach((email) => {
            let emailId = email.email_id;
            if (emailId && !emailRegex.test(emailId)) {
              logger.error(`${email.type} is invalid`);
              emailErr = true;
            }
          });
          if (emailErr && !createdCandidate?.status?.length)
            createdCandidate.status = errMsg;

          candidatesToPreview.push(createdCandidate);
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: i,
              size: leads.length,
            },
            socketId: loaderId,
          });
          i++;
        }
        SocketHelper.sendCadenceImportResponseEvent({
          response_data: { candidates: candidatesToPreview, error: null },
          socketId: loaderId,
        });
      });
  } catch (err) {
    logger.error('Error while previewing candidates from csv for bullhorn: ', {
      user_id: req.user.user_id,
      err,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing candidates: ${err.message}`,
      });
    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        candidates: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: req.body.loaderId,
    });
  }
};

const previewBullhornDataFromExtension = async (req, res) => {
  try {
    let request = {
      ...req.query,
    };

    // * JOI Validation
    const params =
      bullhornImportSchema.previewBullhornDataFromExtension.validate(request);
    if (params.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from bullhorn',
        error: `Error while importing data from bullhorn: ${params.error.message}`,
      });

    let { type, id, query } = params.value;

    let [{ instance_url, access_token }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken) {
      if (errFetchingAccessToken === 'Kindly log in with Bullhorn')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Kindly log in with Bullhorn',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from bullhorn',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });
    }

    // * Fetch bullhorn field map
    let [bullhornFieldMap, errFetchingBullhornFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errFetchingBullhornFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Bullhorn data to cadence',
        error: errFetchingBullhornFieldMap,
      });

    let bullhornAccountMap = bullhornFieldMap.account_map;
    let bullhornContactMap = bullhornFieldMap.contact_map;
    let bullhornLeadMap = bullhornFieldMap.lead_map;
    let bullhornCandidateMap = bullhornFieldMap.candidate_map;
    delete bullhornAccountMap.zip_code;
    delete bullhornAccountMap.country;
    delete bullhornAccountMap.variables;
    delete bullhornCandidateMap.zip_code;
    delete bullhornCandidateMap.country;
    delete bullhornCandidateMap.variables;

    if (type === BULLHORN_IMPORT_SOURCE.CONTACT && query) {
      let contact_properties_query = '';
      for (const [key, value] of Object.entries(bullhornContactMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'integration_status') {
          contact_properties_query =
            contact_properties_query + `,${value?.name}`;
          continue;
        }
        if (key === 'variables') continue;

        if (typeof value === 'string')
          contact_properties_query = contact_properties_query + `,${value}`;
        else if (typeof value === 'object') {
          for (let v of value)
            contact_properties_query = contact_properties_query + `,${v}`;
        }
      }
      contact_properties_query =
        contact_properties_query + ',id,owner,clientCorporation';
      contact_properties_query = contact_properties_query.slice(1);

      let formattedContacts = [];
      let bullhornContactsInList = []; // * Store all contacts
      let contactIntegrationIds = []; // * Store all bullhorn contact Ids
      let uniqueAccountIds = []; // * Store all bullhorn company ids
      let uniqueBullhornOwnerIds = [];
      let has_more = true; // * Go through pagination
      let start = 0;
      while (has_more) {
        // * If number of contacts exceed 1000, then return.
        if (bullhornContactsInList.length > 1000) {
          logger.error('List is too large too import', {
            user_id: req.user.user_id,
          });
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Maximum 1000 contacts can be imported at a time.',
          });
        }
        let [results, errResult] = await bullhornService.search({
          fields: contact_properties_query,
          start,
          count: 100,
          object: BULLHORN_ENDPOINTS.CONTACT,
          query,
          access_token,
          instance_url,
        });
        if (errResult) {
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Unable to complete your request right now',
            error: errResult,
          });
        }
        searchedContacts = results?.data;

        if (!searchedContacts || searchedContacts.length < 100)
          has_more = false;

        formattedContacts.push(
          BullhornHelper.formatContactsForPreview({
            bullhornContacts: searchedContacts,
            bullhornContactMap,
            contactIntegrationIds,
            uniqueAccountIds,
            uniqueBullhornOwnerIds,
            bullhornContactsInList,
          })
        );

        start += 100;
      }

      for (let formattedContact of formattedContacts)
        if (formattedContact[1])
          return serverErrorResponseWithDevMsg({
            res,
            error: formattedContact[1],
          });

      contactIntegrationIds = [...new Set(contactIntegrationIds)];
      uniqueAccountIds = [...new Set(uniqueAccountIds)];
      uniqueBullhornOwnerIds = [...new Set(uniqueBullhornOwnerIds)];

      // * Fetch all contacts
      const leadPromise = Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: contactIntegrationIds,
          },
          integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT,
        },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['name'],
            },
          },
        },
        extras: {
          attributes: ['lead_id', 'integration_id'],
        },
      });

      // * Fetch all owners
      const userPromise = Repository.fetchAll({
        tableName: DB_TABLES.USER,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: uniqueBullhornOwnerIds,
          },
        },
        extras: {
          attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
        },
      });

      // * Fetch all companies
      const accountPromise = Repository.fetchAll({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: uniqueAccountIds,
          },
          integration_type: ACCOUNT_INTEGRATION_TYPES.BULLHORN_ACCOUNT,
        },
        extras: {
          attributes: ['account_id', 'integration_id', 'name'],
        },
      });

      let values = await Promise.all([
        leadPromise,
        userPromise,
        accountPromise,
      ]);

      const [contacts, errFetchingContacts] = values[0];
      if (errFetchingContacts)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch contacts from bullhorn',
          error: errFetchingContacts,
        });
      const [users, errFetchingUsers] = values[1];
      if (errFetchingUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch contacts from bullhorn',
          error: errFetchingUsers,
        });
      let [accounts, errFetchingAccounts] = values[2];
      if (errFetchingAccounts)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch contacts from bullhorn',
          error: errFetchingAccounts,
        });

      // * Get missing company Ids
      const accountIntegrationIds = accounts.map(
        (account) => account.integration_id
      );
      const missingAccountIds = uniqueAccountIds.filter(
        (accountId) => !accountIntegrationIds.includes(accountId)
      );

      // * Fetch all accounts that don't exit in the database
      let accountsNotInDatabase = [];
      if (missingAccountIds.length) {
        let accountFields = '';
        for (const [key, value] of Object.entries(bullhornAccountMap)) {
          if (key === 'disqualification_reason') continue;
          if (key === 'integration_status') {
            accountFields = accountFields + `${value?.name},`;
            continue;
          }
          if (key === 'variables') continue;

          if (typeof value === 'string')
            accountFields = accountFields + `${value},`;
        }
        accountFields = `${accountFields}id,address`;

        let has_more = true;
        let start = 0;
        let account_query = `id: ${missingAccountIds.join(' ')}`;

        while (has_more) {
          let [results, errResult] = await bullhornService.search({
            fields: accountFields,
            start,
            count: 100,
            object: BULLHORN_ENDPOINTS.CORPORATION,
            query: account_query,
            access_token,
            instance_url,
          });
          if (errResult) {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Unable to complete your request right now',
              error: errResult,
            });
          }
          searchedAccounts = results?.data;

          if (!searchedAccounts || searchedAccounts.length < 100)
            has_more = false;

          for (let bullhornAccount of searchedAccounts) {
            // * Format accounts
            let formattedAccount = {
              name: bullhornAccount?.[bullhornAccountMap.name],
              size: bullhornAccount?.[
                `${
                  CompanyFieldMapHelper.getCompanySize({
                    size: bullhornAccountMap.size,
                  })[0]
                }`
              ],
              phone_number: bullhornAccount?.[bullhornAccountMap.phone_number],
              linkedin_url: bullhornAccount?.[bullhornAccountMap.linkedin_url],
              url: bullhornAccount?.[bullhornAccountMap.url],
              country: bullhornAccount?.address?.countryName,
              integration_id: bullhornAccount.id,
              zipcode: bullhornAccount?.address?.zip,
              integration_status:
                bullhornAccount?.[bullhornAccountMap?.integration_status?.name],
            };
            accountsNotInDatabase.push(formattedAccount);
          }
          start += 100;
        }
      }
      accounts = [...accounts, ...accountsNotInDatabase];

      return successResponse(res, 'Successfully fetched list from bullhorn', {
        bullhornContactsInList,
        contacts,
        users,
        accounts,
      });
    } else if (type === BULLHORN_IMPORT_SOURCE.CONTACT && id) {
      let contact_properties_query = '';
      for (const [key, value] of Object.entries(bullhornContactMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'integration_status') {
          contact_properties_query =
            contact_properties_query + `,${value?.name}`;
          continue;
        }
        if (key === 'variables') continue;

        if (typeof value === 'string')
          contact_properties_query = contact_properties_query + `,${value}`;
        else if (typeof value === 'object') {
          for (let v of value)
            contact_properties_query = contact_properties_query + `,${v}`;
        }
      }
      contact_properties_query =
        contact_properties_query + ',id,owner,clientCorporation';
      contact_properties_query = contact_properties_query.slice(1);

      // * Fetch bullhorn contact
      const [contactData, errFetchingContactFromBullhorn] =
        await v2GrpcClients.hiringIntegration.getContact({
          integration_type: HIRING_INTEGRATIONS.BULLHORN,
          integration_data: {
            access_token,
            instance_url,
            contact_id: id,
            properties: contact_properties_query,
          },
        });
      if (errFetchingContactFromBullhorn)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingContactFromBullhorn,
        });

      let formattedContact = {
        first_name: contactData[bullhornContactMap.first_name],
        last_name: contactData[bullhornContactMap.last_name],
        linkedin_url: contactData[bullhornContactMap.linkedin_url],
        source_site: contactData[bullhornContactMap.source_site],
        job_position: contactData[bullhornContactMap.job_position],
        Id: contactData.id,
        phone_numbers: [],
        emails: [],
        associatedaccountid: contactData?.clientCorporation?.id,
        bullhorn_owner_id: contactData?.owner?.id,
        integration_status:
          contactData?.[bullhornContactMap?.integration_status?.name],
      };

      // * Process phone
      bullhornContactMap?.phone_numbers.forEach((phone_type) => {
        formattedContact.phone_numbers.push({
          type: phone_type,
          phone_number: contactData[phone_type] || '',
        });
      });

      // * Process email
      bullhornContactMap?.emails.forEach((email_type) => {
        formattedContact.emails.push({
          type: email_type,
          email_id: contactData[email_type] || '',
        });
      });

      let promiseArray = [];

      // * Check if the contact is present in db
      promiseArray.push(
        Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: contactData.id,
            company_id: req.user.company_id,
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['name'],
              },
            },
          },
          extras: {
            attributes: ['lead_id', 'integration_id'],
          },
        })
      );
      // * Fetch user
      promiseArray.push(
        Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: contactData?.owner?.id,
            company_id: req.user.company_id,
            integration_type: USER_INTEGRATION_TYPES.BULLHORN_USER,
          },
          extras: {
            attributes: [
              'user_id',
              'first_name',
              'last_name',
              'integration_id',
            ],
          },
        })
      );

      // * Fetch account from bullhorn
      if (contactData?.clientCorporation?.id) {
        let accountFields = Object.values(bullhornAccountMap).flat().join(',');
        accountFields = `${accountFields},id,address`;
        promiseArray.push(
          v2GrpcClients.hiringIntegration.getAccount({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              instance_url,
              corporation_id: contactData?.clientCorporation?.id,
              properties: accountFields,
            },
          })
        );
      }

      let values = await Promise.all(promiseArray);

      const [contact, errFetchingContact] = values[0];
      if (errFetchingContact)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingContact,
        });
      if (contact) {
        formattedContact.lead_id = contact.lead_id;
        formattedContact.LeadToCadences = contact.LeadToCadences;
      }

      const [user, errFetchingUser] = values[1];
      if (errFetchingUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingUser,
        });
      if (user) formattedContact.Owner = user;
      else {
        formattedContact.Owner = {
          integration_id: contactData?.owner?.id,
          first_name: contactData?.owner?.firstName,
          last_name: contactData?.owner?.lastName,
        };
      }

      let [accountFromBullhorn, errFetchingAccountFromBullhorn] = [null, null];
      if (contactData?.clientCorporation?.id)
        [accountFromBullhorn, errFetchingAccountFromBullhorn] = values[2];
      if (errFetchingAccountFromBullhorn)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingAccountFromBullhorn,
        });
      if (accountFromBullhorn)
        formattedContact.Account = {
          name: accountFromBullhorn?.[bullhornAccountMap.name],
          size: accountFromBullhorn?.[
            `${
              CompanyFieldMapHelper.getCompanySize({
                size: bullhornAccountMap.size,
              })[0]
            }`
          ],
          phone_number: accountFromBullhorn?.[bullhornAccountMap.phone_number],
          linkedin_url: accountFromBullhorn?.[bullhornAccountMap.linkedin_url],
          integration_status:
            accountFromBullhorn?.[bullhornAccountMap?.integration_status?.name],
          url: accountFromBullhorn?.[bullhornAccountMap.url],
          country: accountFromBullhorn?.address?.countryName,
          integration_id: accountFromBullhorn.id,
          zipcode: accountFromBullhorn?.address?.zip,
        };

      return successResponse(
        res,
        'Successfully fetched contact from bullhorn',
        {
          contact: formattedContact,
        }
      );
    } else if (type === BULLHORN_IMPORT_SOURCE.LEAD && query) {
      let lead_properties_query = '';
      for (const [key, value] of Object.entries(bullhornLeadMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'integration_status') {
          lead_properties_query = lead_properties_query + `,${value?.name}`;
          continue;
        }
        if (key === 'variables') continue;

        if (typeof value === 'string')
          lead_properties_query = lead_properties_query + `,${value}`;
        else if (typeof value === 'object') {
          for (let v of value)
            lead_properties_query = lead_properties_query + `,${v}`;
        }
      }
      lead_properties_query =
        lead_properties_query + ',id,owner,clientCorporation';
      lead_properties_query = lead_properties_query.slice(1);

      let formattedLeads = [];
      let bullhornLeadsInList = []; // * Store all leads
      let leadIntegrationIds = []; // * Store all bullhorn lead Ids
      let uniqueAccountIds = []; // * Store all bullhorn company ids
      let uniqueBullhornOwnerIds = [];
      let has_more = true; // * Go through pagination
      let start = 0;
      while (has_more) {
        // * If number of leads exceed 1000, then return.
        if (bullhornLeadsInList.length > 1000) {
          logger.error('List is too large too import', {
            user_id: req.user.user_id,
          });
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Maximum 1000 leads can be imported at a time.',
          });
        }
        let [results, errResult] = await bullhornService.search({
          fields: lead_properties_query,
          start,
          count: 100,
          object: BULLHORN_ENDPOINTS.LEAD,
          query,
          access_token,
          instance_url,
        });
        if (errResult) {
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Unable to complete your request right now',
            error: errResult,
          });
        }
        searchedLeads = results?.data;

        if (!searchedLeads || searchedLeads.length < 100) has_more = false;

        formattedLeads.push(
          BullhornHelper.formatLeadsForPreview({
            bullhornLeads: searchedLeads,
            bullhornLeadMap,
            leadIntegrationIds,
            uniqueAccountIds,
            uniqueBullhornOwnerIds,
            bullhornLeadsInList,
          })
        );

        start += 100;
      }

      for (let formattedLead of formattedLeads)
        if (formattedLead[1])
          return serverErrorResponseWithDevMsg({
            res,
            error: formattedLead[1],
          });

      leadIntegrationIds = [...new Set(leadIntegrationIds)];
      uniqueAccountIds = [...new Set(uniqueAccountIds)];
      uniqueBullhornOwnerIds = [...new Set(uniqueBullhornOwnerIds)];

      // * Fetch all leads
      const leadPromise = Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: leadIntegrationIds,
          },
          integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_LEAD,
        },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['name'],
            },
          },
        },
        extras: {
          attributes: ['lead_id', 'integration_id'],
        },
      });

      // * Fetch all owners
      const userPromise = Repository.fetchAll({
        tableName: DB_TABLES.USER,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: uniqueBullhornOwnerIds,
          },
        },
        extras: {
          attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
        },
      });

      // * Fetch all companies
      const accountPromise = Repository.fetchAll({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: uniqueAccountIds,
          },
          integration_type: ACCOUNT_INTEGRATION_TYPES.BULLHORN_ACCOUNT,
        },
        extras: {
          attributes: ['account_id', 'integration_id', 'name'],
        },
      });

      let values = await Promise.all([
        leadPromise,
        userPromise,
        accountPromise,
      ]);

      const [leads, errFetchingLeads] = values[0];
      if (errFetchingLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch leads from bullhorn',
          error: errFetchingLeads,
        });
      const [users, errFetchingUsers] = values[1];
      if (errFetchingUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch leads from bullhorn',
          error: errFetchingUsers,
        });
      let [accounts, errFetchingAccounts] = values[2];
      if (errFetchingAccounts)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch leads from bullhorn',
          error: errFetchingAccounts,
        });

      // * Get missing company Ids
      const accountIntegrationIds = accounts.map(
        (account) => account.integration_id
      );
      const missingAccountIds = uniqueAccountIds.filter(
        (accountId) => !accountIntegrationIds.includes(accountId)
      );

      // * Fetch all accounts that don't exit in the database
      let accountsNotInDatabase = [];
      if (missingAccountIds.length) {
        let accountFields = '';
        for (const [key, value] of Object.entries(bullhornAccountMap)) {
          if (key === 'disqualification_reason') continue;
          if (key === 'integration_status') {
            accountFields = accountFields + `${value?.name},`;
            continue;
          }
          if (key === 'variables') continue;

          if (typeof value === 'string')
            accountFields = accountFields + `${value},`;
        }
        accountFields = `${accountFields}id,address`;

        let has_more = true;
        let start = 0;
        let account_query = `id: ${missingAccountIds.join(' ')}`;

        while (has_more) {
          let [results, errResult] = await bullhornService.search({
            fields: accountFields,
            start,
            count: 100,
            object: BULLHORN_ENDPOINTS.CORPORATION,
            query: account_query,
            access_token,
            instance_url,
          });
          if (errResult) {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Unable to complete your request right now',
              error: errResult,
            });
          }
          searchedAccounts = results?.data;

          if (!searchedAccounts || searchedAccounts.length < 100)
            has_more = false;

          for (let bullhornAccount of searchedAccounts) {
            // * Format accounts
            let formattedAccount = {
              name: bullhornAccount?.[bullhornAccountMap.name],
              size: bullhornAccount?.[
                `${
                  CompanyFieldMapHelper.getCompanySize({
                    size: bullhornAccountMap.size,
                  })[0]
                }`
              ],
              phone_number: bullhornAccount?.[bullhornAccountMap.phone_number],
              linkedin_url: bullhornAccount?.[bullhornAccountMap.linkedin_url],
              url: bullhornAccount?.[bullhornAccountMap.url],
              country: bullhornAccount?.address?.countryName,
              integration_id: bullhornAccount.id,
              zipcode: bullhornAccount?.address?.zip,
              integration_status:
                bullhornAccount?.[bullhornAccountMap?.integration_status?.name],
            };
            accountsNotInDatabase.push(formattedAccount);
          }
          start += 100;
        }
      }
      accounts = [...accounts, ...accountsNotInDatabase];

      return successResponse(res, 'Successfully fetched list from bullhorn', {
        bullhornLeadsInList,
        leads,
        users,
        accounts,
      });
    } else if (type === BULLHORN_IMPORT_SOURCE.LEAD && id) {
      let lead_properties_query = '';
      for (const [key, value] of Object.entries(bullhornLeadMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'integration_status') {
          lead_properties_query = lead_properties_query + `,${value?.name}`;
          continue;
        }
        if (key === 'variables') continue;

        if (typeof value === 'string')
          lead_properties_query = lead_properties_query + `,${value}`;
        else if (typeof value === 'object') {
          for (let v of value)
            lead_properties_query = lead_properties_query + `,${v}`;
        }
      }
      lead_properties_query =
        lead_properties_query + ',id,owner,clientCorporation';
      lead_properties_query = lead_properties_query.slice(1);

      // * Fetch bullhorn lead
      const [leadData, errFetchingLeadFromBullhorn] =
        await v2GrpcClients.hiringIntegration.getLead({
          integration_type: HIRING_INTEGRATIONS.BULLHORN,
          integration_data: {
            access_token,
            instance_url,
            lead_id: id,
            properties: lead_properties_query,
          },
        });
      if (errFetchingLeadFromBullhorn)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingLeadFromBullhorn,
        });

      let formattedLead = {
        first_name: leadData[bullhornLeadMap.first_name],
        last_name: leadData[bullhornLeadMap.last_name],
        linkedin_url: leadData[bullhornLeadMap.linkedin_url],
        source_site: leadData[bullhornLeadMap.source_site],
        job_position: leadData[bullhornLeadMap.job_position],
        Id: leadData.id,
        phone_numbers: [],
        emails: [],
        associatedaccountid: leadData?.clientCorporation?.id,
        bullhorn_owner_id: leadData?.owner?.id,
        integration_status:
          leadData?.[bullhornLeadMap?.integration_status?.name],
      };

      // * Process phone
      bullhornLeadMap?.phone_numbers.forEach((phone_type) => {
        formattedLead.phone_numbers.push({
          type: phone_type,
          phone_number: leadData[phone_type] || '',
        });
      });

      // * Process email
      bullhornLeadMap?.emails.forEach((email_type) => {
        formattedLead.emails.push({
          type: email_type,
          email_id: leadData[email_type] || '',
        });
      });

      let promiseArray = [];

      // * Check if the lead is present in db
      promiseArray.push(
        Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: leadData.id,
            company_id: req.user.company_id,
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_LEAD,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['name'],
              },
            },
          },
          extras: {
            attributes: ['lead_id', 'integration_id'],
          },
        })
      );
      // * Fetch user
      promiseArray.push(
        Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: leadData?.owner?.id,
            company_id: req.user.company_id,
            integration_type: USER_INTEGRATION_TYPES.BULLHORN_USER,
          },
          extras: {
            attributes: [
              'user_id',
              'first_name',
              'last_name',
              'integration_id',
            ],
          },
        })
      );

      // * Fetch account from bullhorn
      if (leadData?.clientCorporation?.id) {
        let accountFields = '';
        for (const [key, value] of Object.entries(bullhornAccountMap)) {
          if (key === 'disqualification_reason') continue;
          if (key === 'integration_status') {
            accountFields = accountFields + `${value?.name},`;
            continue;
          }
          if (key === 'variables') continue;

          if (typeof value === 'string')
            accountFields = accountFields + `${value},`;
        }
        accountFields = `${accountFields}id,address`;
        promiseArray.push(
          v2GrpcClients.hiringIntegration.getAccount({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              instance_url,
              corporation_id: leadData?.clientCorporation?.id,
              properties: accountFields,
            },
          })
        );
      }

      let values = await Promise.all(promiseArray);

      const [lead, errFetchingLead] = values[0];
      if (errFetchingLead)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingLead,
        });
      if (lead) {
        formattedLead.lead_id = lead.lead_id;
        formattedLead.LeadToCadences = lead.LeadToCadences;
      }

      const [user, errFetchingUser] = values[1];
      if (errFetchingUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingUser,
        });
      if (user) formattedLead.Owner = user;
      else {
        formattedLead.Owner = {
          integration_id: leadData?.owner?.id,
          first_name: leadData?.owner?.firstName,
          last_name: leadData?.owner?.lastName,
        };
      }

      let [accountFromBullhorn, errFetchingAccountFromBullhorn] = [null, null];
      if (leadData?.clientCorporation?.id)
        [accountFromBullhorn, errFetchingAccountFromBullhorn] = values[2];
      if (errFetchingAccountFromBullhorn)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingAccountFromBullhorn,
        });
      if (accountFromBullhorn)
        formattedLead.Account = {
          name: accountFromBullhorn?.[bullhornAccountMap.name],
          size: accountFromBullhorn?.[
            `${
              CompanyFieldMapHelper.getCompanySize({
                size: bullhornAccountMap.size,
              })[0]
            }`
          ],
          phone_number: accountFromBullhorn?.[bullhornAccountMap.phone_number],
          linkedin_url: accountFromBullhorn?.[bullhornAccountMap.linkedin_url],
          url: accountFromBullhorn?.[bullhornAccountMap.url],
          integration_status:
            accountFromBullhorn?.[bullhornAccountMap?.integration_status?.name],
          country: accountFromBullhorn?.address?.countryName,
          integration_id: accountFromBullhorn.id,
          zipcode: accountFromBullhorn?.address?.zip,
        };

      return successResponse(res, 'Successfully fetched lead from bullhorn', {
        lead: formattedLead,
      });
    } else if (type === BULLHORN_IMPORT_SOURCE.CANDIDATE && query) {
      let candidate_properties_query = '';
      for (const [key, value] of Object.entries(bullhornCandidateMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'integration_status') {
          candidate_properties_query =
            candidate_properties_query + `,${value?.name}`;
          continue;
        }
        if (key === 'variables') continue;

        if (typeof value === 'string')
          candidate_properties_query = candidate_properties_query + `,${value}`;
        else if (typeof value === 'object') {
          for (let v of value)
            candidate_properties_query = candidate_properties_query + `,${v}`;
        }
      }
      candidate_properties_query =
        candidate_properties_query + ',id,owner,address';
      candidate_properties_query = candidate_properties_query.slice(1);

      let formattedCandidates = [];
      let bullhornCandidatesInList = []; // * Store all candidates
      let candidateIntegrationIds = []; // * Store all bullhorn candidate Ids
      let uniqueBullhornOwnerIds = [];
      let has_more = true; // * Go through pagination
      let start = 0;
      while (has_more) {
        // * If number of candidates exceed 1000, then return.
        if (bullhornCandidatesInList.length > 1000) {
          logger.error('List is too large too import', {
            user_id: req.user.user_id,
          });
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Maximum 1000 candidates can be imported at a time.',
          });
        }
        let [results, errResult] = await bullhornService.search({
          fields: candidate_properties_query,
          start,
          count: 100,
          object: BULLHORN_ENDPOINTS.CANDIDATE,
          query,
          access_token,
          instance_url,
        });
        if (errResult) {
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Unable to complete your request right now',
            error: errResult,
          });
        }
        searchedCandidates = results?.data;

        if (!searchedCandidates || searchedCandidates.length < 100)
          has_more = false;

        formattedCandidates.push(
          BullhornHelper.formatCandidatesForPreview({
            bullhornCandidates: searchedCandidates,
            bullhornCandidateMap,
            candidateIntegrationIds,
            uniqueBullhornOwnerIds,
            bullhornCandidatesInList,
          })
        );

        start += 100;
      }

      for (let formattedCandidate of formattedCandidates)
        if (formattedCandidate[1])
          return serverErrorResponseWithDevMsg({
            res,
            error: formattedCandidate[1],
          });

      candidateIntegrationIds = [...new Set(candidateIntegrationIds)];
      uniqueBullhornOwnerIds = [...new Set(uniqueBullhornOwnerIds)];

      // * Fetch all candidates
      const leadPromise = Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: candidateIntegrationIds,
          },
          integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE,
        },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['name'],
            },
          },
        },
        extras: {
          attributes: ['lead_id', 'integration_id'],
        },
      });

      // * Fetch all owners
      const userPromise = Repository.fetchAll({
        tableName: DB_TABLES.USER,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: uniqueBullhornOwnerIds,
          },
        },
        extras: {
          attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
        },
      });

      let values = await Promise.all([leadPromise, userPromise]);

      const [candidates, errFetchingCandidates] = values[0];
      if (errFetchingCandidates)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch candidates from bullhorn',
          error: errFetchingCandidates,
        });
      const [users, errFetchingUsers] = values[1];
      if (errFetchingUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch candidates from bullhorn',
          error: errFetchingUsers,
        });

      return successResponse(res, 'Successfully fetched list from bullhorn', {
        bullhornCandidatesInList,
        candidates,
        users,
      });
    } else if (type === BULLHORN_IMPORT_SOURCE.CANDIDATE && id) {
      let candidate_properties_query = '';
      for (const [key, value] of Object.entries(bullhornCandidateMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'integration_status') {
          candidate_properties_query =
            candidate_properties_query + `,${value?.name}`;
          continue;
        }
        if (key === 'variables') continue;

        if (typeof value === 'string')
          candidate_properties_query = candidate_properties_query + `,${value}`;
        else if (typeof value === 'object') {
          for (let v of value)
            candidate_properties_query = candidate_properties_query + `,${v}`;
        }
      }
      candidate_properties_query =
        candidate_properties_query + ',id,owner,address';
      candidate_properties_query = candidate_properties_query.slice(1);

      // * Fetch bullhorn candidate
      const [candidateData, errFetchingCandidateFromBullhorn] =
        await v2GrpcClients.hiringIntegration.getCandidate({
          integration_type: HIRING_INTEGRATIONS.BULLHORN,
          integration_data: {
            access_token,
            instance_url,
            candidate_id: id,
            properties: candidate_properties_query,
          },
        });
      if (errFetchingCandidateFromBullhorn)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingCandidateFromBullhorn,
        });

      let formattedCandidate = {
        first_name: candidateData[bullhornCandidateMap.first_name],
        last_name: candidateData[bullhornCandidateMap.last_name],
        linkedin_url: candidateData[bullhornCandidateMap.linkedin_url],
        source_site: candidateData[bullhornCandidateMap.source_site],
        job_position: candidateData[bullhornCandidateMap.job_position],
        Id: candidateData.id,
        phone_numbers: [],
        emails: [],
        bullhorn_owner_id: candidateData?.owner?.id,
        integration_status:
          candidateData?.[bullhornCandidateMap?.integration_status?.name],
      };

      // * Process phone
      bullhornCandidateMap?.phone_numbers.forEach((phone_type) => {
        formattedCandidate.phone_numbers.push({
          type: phone_type,
          phone_number: candidateData[phone_type] || '',
        });
      });

      // * Process email
      bullhornCandidateMap?.emails.forEach((email_type) => {
        formattedCandidate.emails.push({
          type: email_type,
          email_id: candidateData[email_type] || '',
        });
      });

      let promiseArray = [];

      // * Check if the candidate is present in db
      promiseArray.push(
        Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: candidateData.id,
            company_id: req.user.company_id,
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['name'],
              },
            },
          },
          extras: {
            attributes: ['lead_id', 'integration_id'],
          },
        })
      );
      // * Fetch user
      promiseArray.push(
        Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: candidateData?.owner?.id,
            company_id: req.user.company_id,
            integration_type: USER_INTEGRATION_TYPES.BULLHORN_USER,
          },
          extras: {
            attributes: [
              'user_id',
              'first_name',
              'last_name',
              'integration_id',
            ],
          },
        })
      );

      let values = await Promise.all(promiseArray);

      const [candidate, errFetchingCandidate] = values[0];
      if (errFetchingCandidate)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingCandidate,
        });
      if (candidate) {
        formattedCandidate.lead_id = candidate.lead_id;
        formattedCandidate.LeadToCadences = candidate.LeadToCadences;
      }

      const [user, errFetchingUser] = values[1];
      if (errFetchingUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Bullhorn data to cadence',
          error: errFetchingUser,
        });
      if (user) formattedCandidate.Owner = user;
      else {
        formattedCandidate.Owner = {
          integration_id: candidateData?.owner?.id,
          first_name: candidateData?.owner?.firstName,
          last_name: candidateData?.owner?.lastName,
        };
      }

      if (candidateData?.[bullhornCandidateMap?.company])
        formattedCandidate.Account = {
          name: candidateData?.[bullhornCandidateMap.company],
          size: candidate?.[
            `${
              CompanyFieldMapHelper.getCompanySize({
                size: bullhornCandidateMap.size,
              })[0]
            }`
          ],
          url: candidateData?.[bullhornCandidateMap.url],
          country: candidateData?.address?.countryName,
          zipcode: candidateData?.address?.zip,
        };

      return successResponse(
        res,
        'Successfully fetched candidate from bullhorn',
        {
          candidate: formattedCandidate,
        }
      );
    }

    return badRequestResponseWithDevMsg({
      res,
      msg: 'Requested import is not allowed',
    });
  } catch (err) {
    logger.error(`Error ocurred while fetching import data from bullhorn: `, {
      user_id: req.user.user_id,
      err,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching import data from bullhorn: ${err.message}`,
    });
  }
};

const previewLeadsViaCSV = async (req, res) => {
  try {
    // * Parsing field map
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }

    // * JOI Validation
    let body = bullhornImportSchema.previewLeadsViaCSVSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    // * Destructure request
    body = body.value;
    const { loaderId, field_map: bullhornFieldMap } = body;

    // * File validation
    const supportedExtensions = ['xlsx', 'xls', 'csv'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );
    let leads, errForLeads;
    if (supportedExtensions.includes(fileExtension.toLowerCase())) {
      // Read the file to ensure it is valid
      [leads, errForLeads] = await ExcelHelper.parseXlsx(req.file.path, 501);
      if (errForLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Error while parsing csv file',
        });
    } else {
      // File extension is not supported
      return serverErrorResponseWithDevMsg({
        res,
        msg: `File type: ${fileExtension} is not supported`,
      });
    }

    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
    };
    let leadsToPreview = [];

    // To store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUserMap = {};

    successResponse(
      res,
      'Started importing, please check back after some time'
    );

    while (i < leads.length) {
      let lead = {};
      let emails = [];
      let phone_numbers = [];
      let emptyRow = true;
      let data = leads[i];

      Object.keys(bullhornFieldMap)?.forEach((key) => {
        if (key !== 'emails' && key !== 'phone_numbers') {
          lead[key] = data[bullhornFieldMap[key]]?.trim();
          if (lead[key]) emptyRow = false;
        }
      });
      bullhornFieldMap?.phone_numbers?.forEach((phone_number) => {
        if (data[phone_number.column_name]) {
          phone_numbers.push({
            phone_number: data[phone_number.column_name]?.trim(),
            type: phone_number.type,
          });
          emptyRow = false;
        }
      });
      bullhornFieldMap?.emails?.forEach((email) => {
        if (data[email.column_name]) {
          emails.push({
            email_id: data[email.column_name]?.trim(),
            type: email.type,
          });
          emptyRow = false;
        }
      });
      lead.phone_numbers = phone_numbers;
      lead.emails = emails;
      if (emptyRow) {
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        i++;
        continue;
      }

      logger.info(`For lead ${i}`);

      let createdLead = {
        Id: `lead_${i + 1}`,
        first_name: lead.first_name,
        last_name: lead.last_name,
        linkedin_url: lead.linkedin_url,
        job_position: lead.job_position,
        emails: lead.emails,
        phone_numbers: lead.phone_numbers,
        integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD,
        Owner: {
          Name: lead.owner_full_name,
          OwnerId: lead.bullhorn_owner_id,
        },
        Account: {
          name: lead.company_name,
          phone_number: lead.company_phone_number,
          size: lead.size,
          url: lead.url,
          country: lead.country,
          zipcode: lead.zip_code,
          integration_type: ACCOUNT_INTEGRATION_TYPES.BULLHORN_CSV_ACCOUNT,
        },
      };

      // createdLead?.is_success = true;
      let missingFields = [];

      // * Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`First name not present in CSV.`);
        missingFields.push(BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`Last name not present in CSV.`);
        missingFields.push(BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`Company name not present in CSV.`);
        missingFields.push(BULLHORN_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in CSV.`);
        missingFields.push(BULLHORN_CSV_IMPORT_FIELDS.BULLHORN_OWNER_ID);
      }

      if (missingFields?.length) {
        // createdLead?.is_success = false;
        createdLead.status = missingFields
          .join(', ')
          .concat(' should be present');
      }
      // * Field format validation
      else if (
        createdLead?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdLead.linkedin_url)
      ) {
        logger.error(`Linkedin url is invalid`);
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.URL} is invalid`;
      } else if (
        createdLead?.Account?.phone_number &&
        !PHONE_REGEX.test(createdLead?.Account?.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
      }

      if (!createdLead.status) {
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
        response.total_success++;
      }

      let phoneErrMsg = [];
      createdLead?.phone_numbers?.forEach((phone) => {
        let phoneNumber = phone.phone_number;
        if (phoneNumber && !PHONE_REGEX.test(phoneNumber))
          phoneErrMsg.push(phone.column_name);
      });
      if (phoneErrMsg?.length && !createdLead?.status?.length)
        createdLead.status = phoneErrMsg.join(', ').concat(' should be valid');

      let emailErrMsg = [];
      createdLead?.emails?.forEach((email) => {
        let emailId = email.email_id;
        if (emailId && !EMAIL_REGEX.test(emailId))
          emailErrMsg.push(email.column_name);
      });
      if (emailErrMsg?.length && !createdLead?.status?.length)
        createdLead.status = emailErrMsg.join(', ').concat(' should be valid');

      // Checking the values of required fields for lead
      if (createdLead.Owner?.OwnerId) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: createdLead.Owner?.OwnerId,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          response.total_error++;
        } else {
          createdLead.Owner.Name = user.first_name + ' ' + user.last_name;
          createdLead.user_id = user.user_id;
        }
      }

      createdLead.sr_no = i + 1;
      leadsToPreview.push(createdLead);
      i++;
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: i,
          size: leads.length,
        },
        socketId: loaderId,
      });
    }

    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: leadsToPreview, error: null },
      socketId: loaderId,
    });
  } catch (err) {
    logger.error('Error while previewing leads from csv: ', {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing leads from csv: ${err.message}`,
      });
    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        leads: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: req.body.loaderId,
    });
  }
};

const previewLeadsViaSheets = async (req, res) => {
  try {
    //cadence id from body
    let body = bullhornImportSchema.previewLeadsViaSheetsSchema.validate(
      req.body
    );
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId } = body;

    const [_, spreadsheetId, sheetId] = req.body.url.match(GOOGLE_SHEETS_REGEX);

    let [leads, errForLeads] = await GoogleSheets.getSheet(spreadsheetId);
    if (errForLeads && errForLeads?.includes('403'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please provide read access to "Anyone with the link" to the google sheet',
      });
    if (errForLeads && errForLeads?.includes('404'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please Provide Valid Google Sheets Url',
      });
    if (errForLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: errForLeads,
      });

    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
    };
    let leadsToPreview = [];

    // To store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUserMap = {};

    // Required Fields
    let reqFields = [
      'first_name',
      'last_name',
      'company_name',
      'bullhorn_owner_id',
    ];

    let bullhornFieldMap = body.field_map;

    successResponse(
      res,
      'Started importing, please check back after some time'
    );

    while (i < leads.length) {
      let leadData = leads[i];
      logger.info(`For lead ${i + 1}`);

      // Creating lead object
      let lead = {};
      let emails = [];
      let phone_numbers = [];
      let emptyRow = true;

      Object.keys(bullhornFieldMap)?.forEach((key) => {
        if (key !== 'emails' && key !== 'phone_numbers') {
          lead[key] = leadData[bullhornFieldMap[key]]?.trim();
          if (lead[key]) {
            if (
              !lead[key]
                ?.toLowerCase()
                ?.includes(
                  'make a copy (file > make a copy) of this google sheet for your reference'
                )
            )
              emptyRow = false;
          }
        }
      });
      bullhornFieldMap?.phone_numbers?.forEach((phone_number) => {
        if (leadData[phone_number.column_name]) {
          phone_numbers.push({
            phone_number: leadData[phone_number.column_name]?.trim(),
            type: phone_number.type,
          });
          if (
            !leadData[phone_number.column_name]
              ?.trim()
              ?.toLowerCase()
              ?.includes(
                'make a copy (file > make a copy) of this google sheet for your reference'
              )
          )
            emptyRow = false;
        }
      });
      bullhornFieldMap?.emails?.forEach((email) => {
        if (leadData[email.column_name]) {
          emails.push({
            email_id: leadData[email.column_name]?.trim(),
            type: email.type,
          });
          if (
            !leadData[email.column_name]
              ?.trim()
              ?.toLowerCase()
              ?.includes(
                'make a copy (file > make a copy) of this google sheet for your reference'
              )
          )
            emptyRow = false;
        }
      });
      lead.emails = emails;
      lead.phone_numbers = phone_numbers;
      if (emptyRow) {
        i++;
        continue;
      }

      let createdLead = {
        Id: `lead_${i + 1}`,
        first_name: lead.first_name,
        last_name: lead.last_name,
        linkedin_url: lead.linkedin_url,
        job_position: lead.job_position,
        emails: lead.emails,
        phone_numbers: lead.phone_numbers,
        integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD,
        Owner: {
          Name: lead.owner_full_name,
          OwnerId: lead.bullhorn_owner_id,
        },
        Account: {
          name: lead.company_name,
          phone_number: lead.company_phone_number,
          linkedin_url: lead.company_linkedin_url,
          size: lead.size,
          url: lead.url,
          country: lead.country,
          zipcode: lead.zip_code,
          integration_type:
            ACCOUNT_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_ACCOUNT,
        },
      };

      let missingValues = [];

      // * Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`First name not present in CSV.`);
        missingValues.push(BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`Last name not present in CSV.`);
        missingValues.push(BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`Company name not present in CSV.`);
        missingValues.push(BULLHORN_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in CSV.`);
        missingValues.push(BULLHORN_CSV_IMPORT_FIELDS.BULLHORN_OWNER_ID);
      }

      if (missingValues?.length) {
        createdLead.status = missingValues
          .join(', ')
          .concat(' should be present');
      }

      // * Field format validation
      else if (
        createdLead?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdLead.linkedin_url)
      ) {
        logger.error(`Linkedin url should be valid`);
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.LINKEDIN_URL} should be valid`;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.URL} is invalid`;
      } else if (
        createdLead?.Account?.phone_number &&
        !PHONE_REGEX.test(createdLead?.Account?.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${BULLHORN_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
      }

      let phoneErrMsg = [];
      createdLead?.phone_numbers?.forEach((phone) => {
        let phoneNumber = phone.phone_number;
        if (phoneNumber && !PHONE_REGEX.test(phoneNumber))
          phoneErrMsg.push(phone.column_name);
      });
      if (phoneErrMsg?.length && !createdLead?.status?.length)
        createdLead.status = phoneErrMsg.join(', ').concat(' should be valid');

      let emailErrMsg = [];
      createdLead?.emails?.forEach((email) => {
        let emailId = email.email_id;
        if (emailId && !EMAIL_REGEX.test(emailId))
          emailErrMsg.push(email.column_name);
      });
      if (emailErrMsg?.length && !createdLead?.status?.length)
        createdLead.status = emailErrMsg.join(', ').concat(' should be valid');

      if (createdLead?.Owner?.OwnerId) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: lead.bullhorn_owner_id,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          response.total_error++;
        } else {
          createdLead.Owner.Name = user.first_name + ' ' + user.last_name;
          lead.user_id = user.user_id;
        }
      }

      if (!createdLead.status) {
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
        response.total_success++;
      }

      createdLead.sr_no = i + 1;
      leadsToPreview.push(createdLead);
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: i,
          size: leads.length,
        },
        socketId: loaderId,
      });
      i++;
    }

    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: leadsToPreview, error: null },
      socketId: loaderId,
    });
  } catch (err) {
    logger.error('Error while previewing leads from google sheets: ', {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing leads from google sheets: ${err.message}`,
      });
    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        leads: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: req.body.loaderId,
    });
  }
};

const getSavedSearch = async (req, res) => {
  try {
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Bullhorn',
      });

    const [data, errorFetchingViews] = await BullhornService.fetchSavedSearch({
      access_token,
      instance_url,
      offset: 0,
      moduleName: req.query.module_name,
    });
    if (errorFetchingViews)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch saved search',
        error: `Error while fetching saved search: ${errorFetchingViews}`,
      });
    let list = data?.data ? data?.data : [];
    let size = list.length;
    let offset = 50;
    while (size == 50) {
      let [paginatedList, errForFetchingPaginatedList] =
        await BullhornService.fetchSavedSearch({
          access_token,
          instance_url,
          offset,
          moduleName: req.query.module_name,
        });
      if (errForFetchingPaginatedList)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch custom views',
          error: `Error while fetching custom views: ${err.message}`,
        });

      list.push(...paginatedList?.data);
      size = paginatedList.data.length;
      offset += 50;
    }

    return successResponse(res, 'Fetched view successfully', list);
  } catch (err) {
    logger.error('Error while fetching saved search:', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Failed to fetch saved search',
      error: `Error while fetching saved search: ${err.message}`,
    });
  }
};

const CadenceImportController = {
  importBullhornContactsData,
  importBullhornLeadsData,
  importBullhornCandidatesData,
  importBullhornContacts,
  importBullhornLeads,
  importBullhornCandidates,
  importBullhornTempLeads,
  linkContactsWithCadence,
  linkLeadsWithCadence,
  linkCandidatesWithCadence,
  getBullhornUsers,
  getCSVColumns,
  getSheetsColumns,
  previewLeadsForCSVImport,
  previewContactsForCSVImport,
  previewCandidatesForCSVImport,
  previewBullhornDataFromExtension,
  previewLeadsViaCSV,
  previewLeadsViaSheets,
  getSavedSearch,
};

module.exports = CadenceImportController;
