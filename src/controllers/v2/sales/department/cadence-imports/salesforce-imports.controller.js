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
  SALESFORCE_DATA_IMPORT_TYPES,
  SALESFORCE_LEAD_IMPORT_STATUS,
  CADENCE_LEAD_STATUS,
  CADENCE_STATUS,
  CADENCE_TYPES,
  LEAD_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  SALESFORCE_CSV_IMPORT_FIELDS,
  ACCOUNT_INTEGRATION_TYPES,
  LEAD_TYPE,
  IMPORT_ERROR_TYPE,
  LEAD_IMPORT_SOURCE,
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
const xlsx = require('xlsx');

// Repositories
const UserRepository = require('../../../../../../../Cadence-Brain/src/repository/user-repository');
const CadenceRepository = require('../../../../../../../Cadence-Brain/src/repository/cadence.repository');
const LeadToCadenceRepository = require('../../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const NodeRepository = require('../../../../../../../Cadence-Brain/src/repository/node.repository');
const Repository = require('../../../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const SalesforceHelper = require('../../../../../../../Cadence-Brain/src/helper/salesforce');
const GoogleSheets = require('../../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');
const TaskHelper = require('../../../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const CadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/cadence');
const SalesforceService = require('../../../../../../../Cadence-Brain/src/services/Salesforce');
const SocketHelper = require('../../../../../../../Cadence-Brain/src/helper/socket');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const LeadsToCadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ImportHelper = require('../../../../../../../Cadence-Brain/src/helper/imports');
const ExcelHelper = require('../../../../../../../Cadence-Brain/src/helper/excel');

// Joi validation
const salesforceImportSchema = require('../../../../../joi/v2/sales/department/cadence-imports/salesforce-imports.joi');
const {
  DB_TABLES,
} = require('../../../../../../../Cadence-Brain/src/utils/modelEnums');

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
    const body = salesforceImportSchema.fetchSheetsColumnsSchema.validate(
      req.body
    );
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch columns from google sheet',
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
        msg: 'Failed to fetch columns from google sheet',
        error: errForLeads,
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

// * Import list/lead/contact from salesforce
const importSalesforceDataToCadence = async (req, res) => {
  try {
    // * JOI Validation
    let request = {
      ...req.params,
      ...req.query,
    };
    const params =
      salesforceImportSchema.importDataToCadenceSchema.validate(request);
    if (params.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from salesforce',
        error: `Error while importing data from salesforce: ${params.error.message}`,
      });

    // * Destructuring
    let { type, id } = params.value;
    let selections = [];
    if (params.value.selections)
      selections = params.value.selections.split(',');

    // * Fetch salesforce field map
    let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
      await SalesforceHelper.getFieldMapForCompanyFromUser(req.user.user_id);
    if (errFetchingSalesforceFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Salesforce data to cadence',
        error: errFetchingSalesforceFieldMap,
      });

    let salesforceAccountMap = salesforceFieldMap.account_map;
    let salesforceContactMap = salesforceFieldMap.contact_map;
    let salesforceLeadMap = salesforceFieldMap.lead_map;

    // * If type = contact
    if (type === SALESFORCE_DATA_IMPORT_TYPES.CONTACT) {
      /*
       * 1. Promise.all(
       *    Fetch contact from salesforce.
       *    Check if lead_exits,
       *    Fetch account data
       *    )
       * 2. If owner is not present in tool, send response 404, owner is not present
       */

      let [{ access_token, instance_url }, errFetchingAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          user_id: req.user.user_id,
        });
      if (errFetchingAccessToken) {
        if (errFetchingAccessToken === 'Kindly log in with salesforce.')
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly log in with salesforce',
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching access token: ${errFetchingAccessToken}`,
        });
      }
      if (salesforceContactMap === null || salesforceAccountMap === null)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Please set salesforce fields',
        });

      // * Construct query for contact
      let first_name = salesforceContactMap.first_name
        ? `c.${salesforceContactMap.first_name},`
        : '';
      let last_name = salesforceContactMap.last_name
        ? `c.${salesforceContactMap.last_name},`
        : '';
      let linkedin_url = salesforceContactMap.linkedin_url
        ? `c.${salesforceContactMap.linkedin_url},`
        : '';
      let source_site = salesforceContactMap.source_site
        ? `c.${salesforceContactMap.source_site},`
        : '';
      let job_position = salesforceContactMap.job_position
        ? `c.${salesforceContactMap.job_position},`
        : '';
      let contact_integration_status = salesforceContactMap.integration_status
        ?.name
        ? `c.${salesforceContactMap.integration_status?.name},`
        : '';

      let phone_number_query = '';
      salesforceContactMap?.phone_numbers.forEach((phone_type) => {
        if (phone_number_query) phone_number_query += `c.${phone_type},`;
        else phone_number_query = `c.${phone_type},`;
      });
      let email_query = '';
      salesforceContactMap?.emails.forEach((email_type) => {
        if (email_query) email_query += `c.${email_type},`;
        else email_query = `c.${email_type},`;
      });

      // * Construct query for account
      let account_name = salesforceAccountMap.name
        ? `c.Account.${salesforceAccountMap.name},`
        : '';
      let account_url = salesforceAccountMap.url
        ? `c.Account.${salesforceAccountMap.url},`
        : '';
      let account_size = CompanyFieldMapHelper.getCompanySize({
        size: salesforceAccountMap?.size,
      })[0]
        ? `c.Account.${
            CompanyFieldMapHelper.getCompanySize({
              size: salesforceAccountMap?.size,
            })[0]
          },`
        : '';
      let account_country = salesforceAccountMap.country
        ? `c.Account.${salesforceAccountMap.country},`
        : '';
      let zip_code = salesforceAccountMap.zip_code
        ? `c.Account.${salesforceAccountMap.zip_code},`
        : '';
      let account_linkedin_url = salesforceAccountMap.linkedin_url
        ? `c.Account.${salesforceAccountMap.linkedin_url},`
        : '';
      let account_phone_number = salesforceAccountMap.phone_number
        ? `c.Account.${salesforceAccountMap.phone_number},`
        : '';

      let account_integration_status = salesforceAccountMap.integration_status
        ?.name
        ? `c.Account.${salesforceAccountMap.integration_status?.name},`
        : '';

      // * SOQL Contact query and search db using salesforce_contact_id
      let results = await Promise.all([
        SalesforceService.query(
          `SELECT+id,${first_name}${linkedin_url}${source_site}${job_position}${last_name}${contact_integration_status}${phone_number_query}${email_query}${account_name}c.Account.Id,${account_url}${account_size}${account_country}${zip_code}${account_linkedin_url}${account_phone_number}${account_integration_status} ownerId,+c.Owner.Name+FROM+Contact+c+where+id+IN+('${id}')`,
          access_token,
          instance_url
        ),
        Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: id,
            integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['cadence_id', 'name'],
              },
            },
          },
        }),
      ]);

      let status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;

      console.log('Results ====> ');
      console.log(results);

      // * Destructure data from salesforce
      let [contactFromSalesforce, errFetchingContactFromSalesforce] =
        results[0];

      console.log('contactFromSalesforce ====> ');
      console.log(contactFromSalesforce);

      if (errFetchingContactFromSalesforce)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching contact from salesforce: ${errFetchingContactFromSalesforce}`,
        });
      if (!contactFromSalesforce.totalSize)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to import Salesforce data',
          error: 'Contact not found',
        });

      contactFromSalesforce = contactFromSalesforce.records[0];

      // * Destructure lead data
      let [leadFromQuery, errFetchingLeadFromDB] = results[1];
      if (errFetchingLeadFromDB)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching lead from query: ${errFetchingLeadFromDB}`,
        });
      if (!leadFromQuery) {
        status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

        // * Check if user is present in DB
        const [user, errFetchingUser] = await UserRepository.findUserByQuery({
          salesforce_owner_id: contactFromSalesforce.OwnerId,
        });
        if (errFetchingUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from salesforce',
            error: `Error while fetching user by query: ${errFetchingUser}`,
          });
        if (!user) status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
      } else {
        contactFromSalesforce.lead_id = leadFromQuery?.lead_id;
        contactFromSalesforce.Cadences = leadFromQuery.LeadToCadences;
      }

      contactFromSalesforce.status = status;

      let decodedContact = {
        first_name: contactFromSalesforce[salesforceContactMap.first_name],
        last_name: contactFromSalesforce[salesforceContactMap.last_name],
        lead_id: contactFromSalesforce.lead_id,
        linkedin_url: contactFromSalesforce[salesforceContactMap.linkedin_url],
        source_site: contactFromSalesforce[salesforceContactMap.source_site],
        job_position: contactFromSalesforce[salesforceContactMap.job_position],
        integration_status:
          contactFromSalesforce[salesforceContactMap?.integration_status?.name],
        Id: contactFromSalesforce.Id,
        metadata: {
          source: LEAD_IMPORT_SOURCE.IMPORT_BUTTON,
        },
        phone_numbers: [],
        emails: [],
        status,
        Owner: {
          Name: contactFromSalesforce.Owner.Name,
          OwnerId: contactFromSalesforce.OwnerId,
        },
        Account: {
          Id: contactFromSalesforce?.Account.Id,
          name: contactFromSalesforce?.Account?.[salesforceAccountMap.name],
          url: contactFromSalesforce?.Account?.[salesforceAccountMap.url],
          size: contactFromSalesforce?.Account?.[
            CompanyFieldMapHelper.getCompanySize({
              size: salesforceAccountMap?.size,
            })[0]
          ],
          country:
            contactFromSalesforce?.Account?.[salesforceAccountMap.country],
          zipcode:
            contactFromSalesforce?.Account?.[salesforceAccountMap.zip_code],

          linkedin_url:
            contactFromSalesforce?.Account?.[salesforceAccountMap.linkedin_url],

          phone_number:
            contactFromSalesforce?.Account?.[salesforceAccountMap.phone_number],

          integration_status:
            contactFromSalesforce?.Account?.[
              salesforceAccountMap.integration_status?.name
            ],
        },
        Cadences: contactFromSalesforce.Cadences || [],
      };
      if (leadFromQuery) {
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
      }

      salesforceContactMap?.phone_numbers.forEach((phone_type) => {
        decodedContact.phone_numbers.push({
          type: phone_type,
          phone_number: contactFromSalesforce[phone_type],
        });
      });

      salesforceContactMap?.emails.forEach((email_type) => {
        decodedContact.emails.push({
          type: email_type,
          email_id: contactFromSalesforce[email_type],
        });
      });

      return successResponse(res, 'Successfully fetched contact information', {
        contact: decodedContact,
        instance_url,
      });
    } else if (type === SALESFORCE_DATA_IMPORT_TYPES.LEAD) {
      /*
       * 1. Promise.all(
       *    Fetch lead from salesforce.
       *    Check if lead_exits,
       *    )
       * 2. If owner is not present in tool, send response 404, owner is not present
       */

      let [{ access_token, instance_url }, errFetchingAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          user_id: req.user.user_id,
        });
      if (errFetchingAccessToken) {
        if (errFetchingAccessToken === 'Kindly log in with salesforce.')
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly log in with salesforce',
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching access token: ${errFetchingAccessToken}`,
        });
      }
      if (salesforceLeadMap === null)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Please set Salesforce fields',
        });

      // * Construct query for lead
      let first_name = salesforceLeadMap.first_name
        ? `c.${salesforceLeadMap.first_name},`
        : '';
      let last_name = salesforceLeadMap.last_name
        ? `c.${salesforceLeadMap.last_name},`
        : '';
      let linkedin_url = salesforceLeadMap.linkedin_url
        ? `c.${salesforceLeadMap.linkedin_url},`
        : '';
      let source_site = salesforceLeadMap.source_site
        ? `c.${salesforceLeadMap.source_site},`
        : '';
      let job_position = salesforceLeadMap.job_position
        ? `c.${salesforceLeadMap.job_position},`
        : '';

      let company = salesforceLeadMap.company
        ? `c.${salesforceLeadMap.company},`
        : '';
      let company_phone_number = salesforceLeadMap.company_phone_number
        ? `c.${salesforceLeadMap.company_phone_number},`
        : '';

      let size = CompanyFieldMapHelper.getCompanySize({
        size: salesforceLeadMap?.size,
      })[0]
        ? `c.${
            CompanyFieldMapHelper.getCompanySize({
              size: salesforceLeadMap?.size,
            })[0]
          },`
        : '';

      let zip_code = salesforceLeadMap.zip_code
        ? `c.${salesforceLeadMap.zip_code},`
        : '';

      let country = salesforceLeadMap.country
        ? `c.${salesforceLeadMap.country},`
        : '';

      let integration_status = salesforceLeadMap.integration_status?.name
        ? `c.${salesforceLeadMap.integration_status?.name},`
        : '';

      let url = salesforceLeadMap.url ? `c.${salesforceLeadMap.url},` : '';

      let phone_number_query = '';
      salesforceLeadMap?.phone_numbers.forEach((phone_type) => {
        if (phone_number_query) phone_number_query += `c.${phone_type},`;
        else phone_number_query = `c.${phone_type},`;
      });
      let email_query = '';
      salesforceLeadMap?.emails.forEach((email_type) => {
        if (email_query) email_query += `c.${email_type},`;
        else email_query = `c.${email_type},`;
      });

      // * SOQL lead query and search db using salesforce_lead_id
      let results = await Promise.all([
        SalesforceService.query(
          `SELECT+id,${first_name}${company}${company_phone_number}${linkedin_url}${phone_number_query}${email_query}${size}${zip_code}${country}${url}${source_site}${job_position}${last_name}${integration_status}ownerId,+c.Owner.Name+FROM+Lead+c+where+id+IN+('${id}')`,
          access_token,
          instance_url
        ),
        Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: id,
            integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
          },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['lead_cadence_id', 'status'],
              [DB_TABLES.CADENCE]: {
                attributes: ['cadence_id', 'name'],
              },
            },
          },
        }),
      ]);

      let status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;

      // * Destructure data from salesforce
      let [leadFromSalesforce, errFetchingLeadFromSalesforce] = results[0];
      if (errFetchingLeadFromSalesforce)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching lead from salesforce: ${errFetchingLeadFromSalesforce}`,
        });
      if (!leadFromSalesforce.totalSize)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: 'Lead not found',
        });

      leadFromSalesforce = leadFromSalesforce.records[0];

      // * Destructure lead data
      let [leadFromQuery, errFetchingLeadFromDB] = results[1];
      if (errFetchingLeadFromDB)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching lead from query: ${errFetchingLeadFromDB}`,
        });
      if (!leadFromQuery) {
        status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

        // * Check if user is present in DB
        const [user, errFetchingUser] = await UserRepository.findUserByQuery({
          salesforce_owner_id: leadFromSalesforce.OwnerId,
        });
        if (errFetchingUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from salesforce',
            error: `Error while fetching user: ${errFetchingUser}`,
          });
        if (!user) status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
      } else {
        leadFromSalesforce.lead_id = leadFromQuery?.lead_id;
        leadFromSalesforce.Cadences = leadFromQuery.LeadToCadences;
      }
      leadFromSalesforce.status = status;

      let decodedLead = {
        first_name: leadFromSalesforce?.[salesforceLeadMap.first_name],
        last_name: leadFromSalesforce?.[salesforceLeadMap.last_name],
        lead_id: leadFromSalesforce.lead_id,
        linkedin_url: leadFromSalesforce?.[salesforceLeadMap.linkedin_url],
        source_site: leadFromSalesforce?.[salesforceLeadMap.source_site],
        job_position: leadFromSalesforce?.[salesforceLeadMap.job_position],
        Id: leadFromSalesforce.Id,
        metadata: {
          source: LEAD_IMPORT_SOURCE.IMPORT_BUTTON,
        },
        integration_status:
          leadFromSalesforce?.[salesforceLeadMap?.integration_status?.name] ??
          null,
        phone_numbers: [],
        emails: [],
        status,
        Owner: {
          Name: leadFromSalesforce.Owner.Name,
          OwnerId: leadFromSalesforce.OwnerId,
        },
        Account: {
          name: leadFromSalesforce?.[salesforceLeadMap?.company],
          size:
            leadFromSalesforce?.[
              CompanyFieldMapHelper.getCompanySize({
                size: salesforceLeadMap?.size,
              })[0]
            ] ?? null,
          url: leadFromSalesforce?.[salesforceLeadMap?.url] ?? null,
          country: leadFromSalesforce?.[salesforceLeadMap?.country] ?? null,
          zipcode: leadFromSalesforce?.[salesforceLeadMap?.zip_code] ?? null,
          phone_number:
            leadFromSalesforce?.[salesforceLeadMap.company_phone_number],
        },
        Cadences: leadFromSalesforce.Cadences || [],
      };
      if (leadFromQuery) {
        if (decodedLead.Cadences.length === 0)
          decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;
        else {
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
        }
      }

      salesforceLeadMap?.phone_numbers.forEach((phone_type) => {
        decodedLead.phone_numbers.push({
          type: phone_type,
          phone_number: leadFromSalesforce[phone_type],
        });
      });

      salesforceLeadMap?.emails.forEach((email_type) => {
        decodedLead.emails.push({
          type: email_type,
          email_id: leadFromSalesforce[email_type],
        });
      });

      return successResponse(res, 'Successfully fetched lead information', {
        lead: decodedLead,
        instance_url,
      });
    } else if (type === SALESFORCE_DATA_IMPORT_TYPES.CONTACT_LIST) {
      /*
       * 1. Fetch the list of contacts, inclusive of accounts
       * 2. Bulk query the leads
       * 3. Query the ownerIds and store them in userMap to avoid any future queries
       * 4. From step 2, use status to mark the contact with needed enum
       */

      let contactIdList = null;
      let contacts = null;
      let instance_url = null;
      let errFetchingContactsFromList = null;

      if (selections.length > 0)
        [
          { contactIdList, contacts, instance_url },
          errFetchingContactsFromList,
        ] = await SalesforceHelper.getContactDataFromSelections({
          user_id: req.user.user_id,
          selected_ids: selections,
          salesforceContactMap,
          salesforceAccountMap,
        });
      else
        [
          { contactIdList, contacts, instance_url },
          errFetchingContactsFromList,
        ] = await SalesforceHelper.getContactDataFromList({
          user_id: req.user.user_id,
          list_id: id,
          salesforceContactMap,
          salesforceAccountMap,
        });
      if (errFetchingContactsFromList) {
        logger.info('backend/errFetchingContactsFromList ====> ');
        logger.info(JSON.stringify(errFetchingContactsFromList));

        if (errFetchingContactsFromList === 'Kindly log in with salesforce.')
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly log in with salesforce',
          });
        if (errFetchingContactsFromList === 'List view not found.')
          return badRequestResponseWithDevMsg({
            res,
            msg: 'User does not have access to list',
            error: errFetchingContactsFromList,
          });

        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: errFetchingContactsFromList,
        });
      }
      // * Query database to find existing links from salesforce_contact_id
      let [leads, errFetchingLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          [Op.or]: {
            integration_id: contactIdList, // * contactIdList = [{integration_id: "1234"} , {integration_id: "876"}]
          },
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
        },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['cadence_id', 'name'],
            },
          },
        },
      });
      if (errFetchingLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching leads: ${errFetchingLeads}`,
        });

      let userMap = {};
      let decodedContacts = [];

      // * Loop through resultant contacts
      for (let contact of contacts) {
        let isUserPresentInDB = false;
        // console.log(contact);
        // console.log('Account id ===> ' + contact.Account.Id);

        let decodedContact = {
          first_name: contact[salesforceContactMap.first_name],
          last_name: contact[salesforceContactMap.last_name],
          linkedin_url: contact[salesforceContactMap.linkedin_url],
          source_site: contact[salesforceContactMap.source_site],
          job_position: contact[salesforceContactMap.job_position],
          Id: contact.Id,
          metadata: {
            source: LEAD_IMPORT_SOURCE.IMPORT_BUTTON,
          },
          phone_numbers: [],
          emails: [],
          integration_status:
            contact[salesforceContactMap?.integration_status?.name],
          Owner: {
            Name: contact.Owner.Name,
            OwnerId: contact.OwnerId,
          },
          Account: {
            name: contact?.Account?.[salesforceAccountMap.name],
            url: contact?.Account?.[salesforceAccountMap.url],
            size: contact?.Account?.[
              CompanyFieldMapHelper.getCompanySize({
                size: salesforceAccountMap?.size,
              })[0]
            ],
            country: contact?.Account?.[salesforceAccountMap.country],
            zipcode: contact?.Account?.[salesforceAccountMap.zip_code],
            Id: contact?.Account?.Id,
            linkedin_url: contact?.Account?.[salesforceAccountMap.linkedin_url],
            phone_number: contact?.Account?.[salesforceAccountMap.phone_number],
            integration_status:
              contact?.Account?.[salesforceAccountMap.integration_status?.name],
          },
        };

        salesforceContactMap?.phone_numbers.forEach((phone_type) => {
          decodedContact.phone_numbers.push({
            type: phone_type,
            phone_number: contact[phone_type],
          });
        });

        salesforceContactMap?.emails.forEach((email_type) => {
          decodedContact.emails.push({
            type: email_type,
            email_id: contact[email_type],
          });
        });

        if (!(contact.OwnerId in userMap)) {
          let [user, errFetchingUser] = await UserRepository.findUserByQuery({
            salesforce_owner_id: contact.OwnerId,
          });
          if (errFetchingUser) continue;
          if (!user) {
            userMap[contact.OwnerId] = false;
            isUserPresentInDB = false;
          } else {
            userMap[contact.OwnerId] = true;
            isUserPresentInDB = true;
          }
        } else isUserPresentInDB = userMap[contact.OwnerId];

        if (!isUserPresentInDB) {
          decodedContact.status =
            SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          decodedContacts.push(decodedContact);

          continue;
        }
        var isPresent = leads.filter(function (value) {
          return value.salesforce_contact_id == contact.Id;
        });

        if (isPresent.length > 0) {
          decodedContact.status =
            SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
          decodedContact.lead_id = isPresent[0].lead_id;
          decodedContact.Cadences = isPresent[0].LeadToCadences || [];
          if (decodedContact.Cadences.length === 0)
            decodedContact.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_INACTIVE;

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
        } else
          decodedContact.status =
            SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

        decodedContacts.push(decodedContact);
      }

      return successResponse(res, 'Successfully fetched list data', {
        contacts: decodedContacts,
        instance_url,
      });
    } else if (type === SALESFORCE_DATA_IMPORT_TYPES.LEAD_LIST) {
      /*
       * 1. Fetch the list of leads
       * 2. Bulk query the leads
       * 3. Query the ownerIds and store them in userMap to avoid any future queries
       * 4. From step 2, use status to mark the contact with needed enum
       */

      let leadIdList = null;
      let leads = null;
      let instance_url = null;
      let errFetchingLeadsFromList = null;

      if (selections.length > 0)
        [{ leadIdList, leads, instance_url }, errFetchingLeadsFromList] =
          await SalesforceHelper.getLeadDataFromSelections({
            user_id: req.user.user_id,
            selected_ids: selections,
            salesforceLeadMap,
          });
      else
        [{ leadIdList, leads, instance_url }, errFetchingLeadsFromList] =
          await SalesforceHelper.getLeadDataFromList({
            user_id: req.user.user_id,
            list_id: id,
            salesforceLeadMap,
          });
      if (errFetchingLeadsFromList) {
        if (errFetchingLeadsFromList === 'Kindly log in with salesforce.')
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Kindly log in with salesforce',
          });
        if (errFetchingLeadsFromList === 'List view not found.')
          return badRequestResponseWithDevMsg({
            res,
            msg: 'User does not have access to list',
            error: errFetchingLeadsFromList,
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: errFetchingLeadsFromList,
        });
      }
      // * Query database to find existing links from integration_id
      let [leadsFromQuery, errFetchingLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          [Op.or]: {
            integration_id: leadIdList, // * leadIdList = [{integration_id: "1234"} , {integration_id: "876"}]
          },
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
        },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: ['lead_cadence_id', 'status'],
            [DB_TABLES.CADENCE]: {
              attributes: ['cadence_id', 'name'],
            },
          },
        },
      });
      if (errFetchingLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import data from salesforce',
          error: `Error while fetching leads: ${errFetchingLeads}`,
        });

      let userMap = {};
      let decodedLeads = [];

      // * Loop through resultant contacts
      for (let lead of leads) {
        let isUserPresentInDB = false;

        let decodedLead = {
          first_name: lead?.[salesforceLeadMap.first_name],
          last_name: lead?.[salesforceLeadMap.last_name],
          linkedin_url: lead?.[salesforceLeadMap.linkedin_url],
          source_site: lead?.[salesforceLeadMap.source_site],
          job_position: lead?.[salesforceLeadMap.job_position],
          Id: lead.Id,
          metadata: {
            source: LEAD_IMPORT_SOURCE.IMPORT_BUTTON,
          },
          integration_status:
            lead?.[salesforceLeadMap?.integration_status?.name] ?? null,
          phone_numbers: [],
          emails: [],

          Owner: {
            Name: lead.Owner.Name,
            OwnerId: lead.OwnerId,
          },
          Account: {
            name: lead?.[salesforceLeadMap?.company],
            size:
              lead?.[
                CompanyFieldMapHelper.getCompanySize({
                  size: salesforceLeadMap?.size,
                })[0]
              ] ?? null,
            url: lead?.[salesforceLeadMap?.url] ?? null,
            country: lead?.[salesforceLeadMap?.country] ?? null,
            zipcode: lead?.[salesforceLeadMap?.zip_code] ?? null,
            phone_number:
              lead?.[salesforceLeadMap?.company_phone_number] ?? null,
          },
        };

        salesforceLeadMap?.phone_numbers.forEach((phone_type) => {
          decodedLead.phone_numbers.push({
            type: phone_type,
            phone_number: lead[phone_type],
          });
        });

        salesforceContactMap?.emails.forEach((email_type) => {
          decodedLead.emails.push({
            type: email_type,
            email_id: lead[email_type],
          });
        });

        if (!(lead.OwnerId in userMap)) {
          let [user, errFetchingUser] = await UserRepository.findUserByQuery({
            salesforce_owner_id: lead.OwnerId,
          });
          if (errFetchingUser) continue;
          if (!user) {
            userMap[lead.OwnerId] = false;
            isUserPresentInDB = false;
          } else {
            userMap[lead.OwnerId] = true;
            isUserPresentInDB = true;
          }
        } else isUserPresentInDB = userMap[lead.OwnerId];

        if (!isUserPresentInDB) {
          decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          decodedLeads.push(decodedLead);

          continue;
        }
        var isPresent = leadsFromQuery.filter(function (value) {
          return value.salesforce_lead_id == lead.Id;
        });

        if (isPresent.length > 0) {
          decodedLead.status =
            SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
          decodedLead.lead_id = isPresent[0].lead_id;
          decodedLead.Cadences = isPresent[0].LeadToCadences || [];
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
          decodedLead.status =
            SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
        decodedLeads.push(decodedLead);
      }

      return successResponse(res, 'Successfully fetched list data', {
        leads: decodedLeads,
        instance_url,
      });
    } else
      serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from salesforce',
      });
  } catch (err) {
    logger.error(
      `Error ocurred while fetching import data from salesforce: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching import data from salesforce: ${err.message}`,
    });
  }
};

// * Import contacts
const importSalesforceContacts = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceImportSchema.importSalesforceContactSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import Salesforce contacts',
        error: `Error while importing Salesforce contacts: ${body.error.message}`,
      });

    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Salesforce contacts',
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
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
    });
    if (errFetchingPreImportData)
      return badRequestResponse(res, errFetchingPreImportData);

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
            let msg;
            if (r[1].error.includes('must be unique'))
              msg = 'Contact present in cadence tool';
            else msg = r[1].error;
            response.element_error.push({
              salesforce_contact_id: r[1].integration_id,
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
              salesforce_contact_id: r[0].integration_id,
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
        logger.info('Salesforce contact id not present');
        response.element_error.push({
          salesforce_contact_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Salesforce contact id not present',
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
          salesforce_contact_id: lead.salesforce_contact_id,
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
          salesforce_contact_id: lead.salesforce_contact_id,
          cadence_id,
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
          salesforce_contact_id: lead.salesforce_contact_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
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
        LeadHelper.createContactFromSalesforce({
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
          salesforce_contact_id: r[1].integration_id,
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
          salesforce_contact_id: r[0].integration_id,
          cadence_id: cadence_id,
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
      `An error ocurred while trying to create contacts in tool from salesforce: `,
      err
    );
    if (!res.headersSent)
      return successResponse(res, 'Unable to import contacts');
  }
};

// * Import leads
const importSalesforceLeads = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceImportSchema.importSalesforceLeadSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import Salesforce leads',
        error: `Error while fetching Salesforce leads ${body.error.message}`,
      });

    // * Destructure request
    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Salesforce leads',
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
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
    });
    if (errFetchingPreImportData)
      return badRequestResponse(res, errFetchingPreImportData);

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
            let msg;
            if (r[1].error.includes('must be unique'))
              msg = 'Lead present in cadence tool';
            else msg = r[1].error;
            response.element_error.push({
              salesforce_lead_id: r[1].integration_id,
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
              salesforce_lead_id: r[0].integration_id,
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

      // * If not lead.salesforce_lead_id
      if (!lead.Id) {
        logger.info('Lead Id not present');
        i++;
        response.element_error.push({
          salesforce_lead_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Salesforce lead id not present',
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

      //* Account name check
      if (!lead?.Account?.name) {
        logger.info('Salesforce company name is not present');
        i++;
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Salesforce company name not present',
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
          salesforce_lead_id: lead.integration_id,
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
          salesforce_lead_id: lead.integration_id,
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
        LeadHelper.createLeadFromSalesforce({
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
          salesforce_lead_id: r[1].integration_id,
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
          salesforce_lead_id: r[0].integration_id,
          cadence_id: cadence_id,
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
    logger.error(`An error ocurred while importing salesforce leads: `, err);
    if (!res.headersSent) return successResponse(res, 'Unable to import leads');
  }
};

// * Import Temp leads
const importSalesforceTempLeads = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceImportSchema.importSalesforceLeadSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: `Error while importing leads in Salesforce  ${body.error.message}`,
      });

    // Destructure request
    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: 'Leads array is empty',
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
    let [{ cadence, node }, errFetchingPreImportData] =
      await ImportHelper.preImportData({
        user_id: req.user.user_id,
        cadence_id,
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
      });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: errFetchingPreImportData,
      });

    // * Store cadence in Recent cadences
    Repository.upsert({
      tableName: DB_TABLES.RECENT_ACTION,
      upsertObject: {
        user_id: req.user.user_id,
        cadence_id: cadence.cadence_id,
      },
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
            // SocketHelper.sendCadenceImportLoaderEvent({
            //   loaderData: {
            //     index: leadCadenceOrderBatch,
            //     size: leads.length,
            //   },
            //   socketId: loaderId,
            // });
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

      logger.info(`For lead with preview id: ${lead.Id}`);

      //* Account name check
      if (!lead?.Account?.name) {
        logger.info('Salesforce company name is not present');
        i++;
        response.element_error.push({
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Salesforce company name not present',
        });
        response.total_error++;
        leadCadenceOrderBatch++;
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
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        leadCadenceOrderBatch++;

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
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        leadCadenceOrderBatch++;
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

      leadCadenceOrderBatch++;

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });
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
        // SocketHelper.sendCadenceImportLoaderEvent({
        //   loaderData: {
        //     index: leadCadenceOrderBatch,
        //     size: leads.length,
        //   },
        //   socketId: loaderId,
        // });
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
    logger.error(`An error ocurred while importing leads in salesforce: `, {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent) return successResponse(res, 'Unable to import leads');
  }
};

const linkTempLeadsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceImportSchema.importSalesforceLeadSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: `Error while importing leads in Salesforce  ${body.error.message}`,
      });

    // Destructure request
    const { leads, cadence_id } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: 'Leads array is empty',
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
    let [{ cadence, node }, errFetchingPreImportData] =
      await ImportHelper.preImportData({
        user_id: req.user.user_id,
        cadence_id,
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
      });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: errFetchingPreImportData,
      });

    // * Store cadence in Recent cadences
    Repository.upsert({
      tableName: DB_TABLES.RECENT_ACTION,
      upsertObject: {
        user_id: req.user.user_id,
        cadence_id: cadence.cadence_id,
      },
    });

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

      logger.info(`For lead with preview id: ${lead.Id}`);

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
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
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        i++;
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.linkTempLead({
          lead,
          cadence,
          node,
        })
      );
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
        i++;
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

    return successResponse(
      res,
      'Leads have been processed successfully',
      response
    );
  } catch (err) {
    logger.error(`An error ocurred while importing leads in salesforce: `, {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent) return successResponse(res, 'Unable to import leads');
  }
};

// * Link existing contact to cadence
const linkContactsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceImportSchema.importSalesforceContactSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
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
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
    });
    if (errFetchingPreImportData)
      return badRequestResponse(res, errFetchingPreImportData);

    // * Send success response indicating processing has been started
    if (websocket)
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
              salesforce_contact_id: r[1].integration_id,
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
              salesforce_contact_id: r[0].integration_id,
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
        LeadHelper.linkSalesforceLeadWithCadence({
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
          salesforce_contact_id: r[1].integration_id,
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
          salesforce_contact_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    // * Send success response with socket
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else return successResponse(res, 'Leads have been processed', response);
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
    const body = salesforceImportSchema.importSalesforceLeadSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to link leads with cadence',
        error: `${body.error.message}`,
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
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
    });
    if (errFetchingPreImportData)
      return badRequestResponse(res, errFetchingPreImportData);

    // * Send success response indicating processing has been started if websocket is true
    if (websocket)
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
              salesforce_lead_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            // SocketHelper.sendCadenceImportLoaderEvent({
            //   loaderData: {
            //     index: leadCadenceOrderBatch,
            //     size: leads.length,
            //   },
            //   socketId: loaderId,
            // });
            continue;
          } else {
            response.element_success.push({
              salesforce_lead_id: r[0].integration_id,
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
        LeadHelper.linkSalesforceLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );

      leadCadenceOrderBatch++;
      if (websocket)
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          salesforce_lead_id: r[1].integration_id,
          cadence_id,
          msg,
          type: r[1].type,
        });
        response.total_error++;
        // SocketHelper.sendCadenceImportLoaderEvent({
        //   loaderData: {
        //     index: leadCadenceOrderBatch,
        //     size: leads.length,
        //   },
        //   socketId: loaderId,
        // });
        continue;
      } else {
        response.element_success.push({
          salesforce_lead_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    // * Send success response with socket
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else return successResponse(res, 'Leads have been processed!', response);
  } catch (err) {
    logger.error(`Error while linking leads to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking leads to cadence: ${err.message}`,
      });
  }
};

const previewLeadsForCSVImport = async (req, res) => {
  const { loaderId } = req.body;
  if (!loaderId)
    return badRequestResponseWithDevMsg({
      res,
      error: ` loaderId is missing`,
    });
  try {
    // loaderId from body
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    let body = salesforceImportSchema.leadsPreviewSchemaForCSV.validate(
      req.body
    );
    if (body.error) {
      logger.error(`Encountered JOI error : ${body.error.details[0].message}`, {
        user_id: req.user.user_id,
      });
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });
    }

    body = body.value;
    const { loaderId, field_map: salesforceFieldMap } = body;

    // File validation
    const supportedExtensions = ['xlsx', 'xls', 'csv'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );
    let leads, errForLeads;
    if (supportedExtensions.includes(fileExtension.toLowerCase())) {
      // Read the file to ensure it is valid
      [leads, errForLeads] = await ExcelHelper.parseXlsx(req.file.path);
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

    successResponse(
      res,
      'Started importing, please check back after some time'
    );

    let i = 0;

    let leadsToPreview = [];

    // To store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUserMap = {};

    while (i < leads.length) {
      let data = leads[i];

      logger.info(`For lead ${i}`);

      let createdLead = {
        Id: `lead_${i + 1}`,
        first_name: data[salesforceFieldMap?.first_name]?.trim() || null,
        last_name: data[salesforceFieldMap?.last_name]?.trim() || null,
        linkedin_url: data[salesforceFieldMap?.linkedin_url]?.trim() || null,
        job_position: data[salesforceFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: '',
          OwnerId: data[salesforceFieldMap?.salesforce_owner_id],
        },
        Account: {
          name: data[salesforceFieldMap?.company]?.trim() || null,
          phone_number:
            data[salesforceFieldMap?.company_phone_number]?.trim() || null,
          size: data[salesforceFieldMap?.size]?.trim() || null,
          url: data[salesforceFieldMap?.url]?.trim() || null,
          country: data[salesforceFieldMap?.country]?.trim() || null,
          zipcode: data[salesforceFieldMap?.zip_code]?.trim() || null,
        },
      };

      // Check empty row
      let isEmptyRow = Object.keys(createdLead).every((key) => {
        if (key === 'Id') return true;
        const value = createdLead[key];

        if (Array.isArray(value)) {
          return value.length === 0; // Check for an empty array
        } else if (typeof value === 'object' && value !== null) {
          return Object.values(value).join('').length === 0; // Check for an empty object
        } else {
          return value === null || value === ''; // Check for null or empty string
        }
      });

      let phoneErrMsg = [];
      salesforceFieldMap?.phone_numbers?.forEach((phone_number) => {
        let phoneNumber = data[phone_number.column_name]?.trim() || null;
        if (phoneNumber) {
          isEmptyRow = false;
          if (!PHONE_REGEX.test(phoneNumber))
            phoneErrMsg.push(phone_number.column_name);

          createdLead.phone_numbers.push({
            phone_number: phoneNumber,
            type: phone_number.type,
          });
        }
      });

      let emailErrMsg = [];
      salesforceFieldMap?.emails?.forEach((email) => {
        let emailId = data[email.column_name]?.trim() || null;
        if (emailId) {
          isEmptyRow = false;
          if (!EMAIL_REGEX.test(emailId)) emailErrMsg.push(email.column_name);

          createdLead.emails.push({
            email_id: emailId,
            type: email.type,
          });
        }
      });
      if (isEmptyRow) {
        i++;
        continue;
      }

      createdLead.integration_type = LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.SALESFORCE_CSV_ACCOUNT;
      createdLead.metadata = { source: LEAD_IMPORT_SOURCE.CSV_IMPORT };
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // Checking the values of required fields for lead
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.SALESFORCE_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.COMPANY);
      }

      // field format validation
      if (missingFields?.length) {
        createdLead.status = missingFields
          .join(', ')
          .concat(' should be present');
        createdLead.is_success = false;
      }
      // field format validation
      else if (
        createdLead?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdLead.linkedin_url)
      ) {
        logger.error(`Linkedin url is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead.Account.phone_number &&
        !PHONE_REGEX.test(createdLead.Account.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.COMPANY} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
        createdLead.is_success = false;
      }

      if (phoneErrMsg?.length && !createdLead?.status?.length) {
        createdLead.status = phoneErrMsg.join(', ').concat(' should be valid');
        createdLead.is_success = false;
      }

      if (emailErrMsg?.length && !createdLead?.status?.length) {
        createdLead.status = emailErrMsg.join(', ').concat(' should be valid');
        createdLead.is_success = false;
      }

      if (createdLead?.Owner?.OwnerId) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: createdLead.Owner?.OwnerId,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          createdLead.is_success = false;
        } else {
          createdLead.Owner.Name = user.first_name + ' ' + user.last_name;
          createdLead.user_id = user.user_id;
        }
      }

      if (!createdLead.status)
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

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
        error: `Error while previewing leads from csv for salesforce: ${err.message}`,
      });

    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        leads: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: loaderId,
    });
  }
};

const previewLeadsForSheetsImport = async (req, res) => {
  const { loaderId } = req.body;
  if (!loaderId)
    return badRequestResponseWithDevMsg({
      res,
      error: ` loaderId is missing`,
    });
  try {
    //cadence id from body
    let body = salesforceImportSchema.leadsPreviewSchemaForSheets.validate(
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

    const [__, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.CADENCE,
      updateObject: { salesforce_cadence_id: spreadsheetId },
      query: { cadence_id: body.cadence_id },
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: `Error while updating cadence: ${errForUpdate}`,
      });

    successResponse(
      res,
      'Started importing, please check back after some time'
    );

    let i = 0;

    let leadsToPreview = [];

    // To store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUserMap = {};
    let salesforceFieldMap = body.field_map;

    while (i < leads.length) {
      let leadData = leads[i];
      logger.info(`For lead ${i + 1}`);

      if (
        leadData?._rawData.includes(
          'Make a copy (File > Make a Copy) of this Google Sheet for your reference'
        )
      ) {
        i++;
        continue;
      }
      // Creating lead object
      let lead = {};

      let createdLead = {
        Id: `lead_${i + 1}`,
        first_name: leadData[salesforceFieldMap?.first_name]?.trim() || null,
        last_name: leadData[salesforceFieldMap?.last_name]?.trim() || null,
        linkedin_url:
          leadData[salesforceFieldMap?.linkedin_url]?.trim() || null,
        job_position:
          leadData[salesforceFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],

        Owner: {
          Name: '',
          OwnerId: leadData[salesforceFieldMap?.salesforce_owner_id],
        },
        Account: {
          name: leadData[salesforceFieldMap?.company]?.trim() || null,
          phone_number:
            leadData[salesforceFieldMap?.company_phone_number]?.trim() || null,
          size: leadData[salesforceFieldMap?.size]?.trim() || null,
          url: leadData[salesforceFieldMap?.url]?.trim() || null,
          country: leadData[salesforceFieldMap?.country]?.trim() || null,
          zipcode: leadData[salesforceFieldMap?.zip_code]?.trim() || null,
        },
      };

      // Checking for empty row
      let isEmptyRow = Object.keys(createdLead).every((key) => {
        if (key === 'Id') return true;
        const value = createdLead[key];

        if (Array.isArray(value)) {
          return value.length === 0; // Check for an empty array
        } else if (typeof value === 'object' && value !== null) {
          if (
            key === 'Account' &&
            value?.integration_type ===
              ACCOUNT_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_ACCOUNT
          ) {
            return true; // Skip checking "integration_type" within the "Account" object
          }
          return Object.values(value).join('').length === 0; // Check for an empty object
        } else {
          return value === null || value === ''; // Check for null or empty string
        }
      });

      createdLead.is_success = true; // for error handling

      let phoneErrMsg = [];
      salesforceFieldMap?.phone_numbers?.forEach((phone_number) => {
        let phoneNumber = leadData[phone_number.column_name]?.trim() || null;
        if (phoneNumber) {
          isEmptyRow = false;
          if (!PHONE_REGEX.test(phoneNumber)) {
            phoneErrMsg.push(phone_number.column_name);
            createdLead.is_success = false;
          }
          createdLead.phone_numbers.push({
            phone_number: phoneNumber,
            type: phone_number.type,
          });
        }
      });

      let emailErrMsg = [];
      salesforceFieldMap?.emails?.forEach((email) => {
        let emailId = leadData[email.column_name]?.trim() || null;
        if (emailId) {
          isEmptyRow = false;
          if (!EMAIL_REGEX.test(emailId)) {
            emailErrMsg.push(email.column_name);
            createdLead.is_success = false;
          }
          createdLead.emails.push({
            email_id: emailId,
            type: email.type,
          });
        }
      });
      if (isEmptyRow) {
        i++;
        continue;
      }

      createdLead.integration_type =
        LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD;
      createdLead.metadata = { source: LEAD_IMPORT_SOURCE.SHEET_IMPORT };
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_ACCOUNT;

      let missingFields = [];

      // Checking the values of required fields for lead
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.SALESFORCE_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.COMPANY);
      }

      // field format validation
      if (missingFields?.length) {
        createdLead.status = missingFields
          .join(', ')
          .concat(' should be present');
        createdLead.is_success = false;
      }

      // field format validation
      else if (
        createdLead?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdLead.linkedin_url)
      ) {
        logger.error(`Linkedin url is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead.Account.phone_number &&
        !PHONE_REGEX.test(createdLead.Account.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.COMPANY} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
        createdLead.is_success = false;
      }

      if (phoneErrMsg?.length && !createdLead?.status?.length) {
        createdLead.status = phoneErrMsg.join(', ').concat(' should be valid');
        createdLead.is_success = false;
      }

      if (emailErrMsg?.length && !createdLead?.status?.length) {
        createdLead.status = emailErrMsg.join(', ').concat(' should be valid');
        createdLead.is_success = false;
      }

      if (createdLead?.Owner?.OwnerId) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: createdLead.Owner?.OwnerId,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          createdLead.is_success = false;
        } else {
          createdLead.Owner.Name = user.first_name + ' ' + user.last_name;
          lead.user_id = user.user_id;
        }
      }

      if (!createdLead.status)
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

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
      loaderId,
    });
  }
};

const getCustomViews = async (req, res) => {
  try {
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Salesforce',
      });

    const [data, errorFetchingViews] = await SalesforceService.fetchCustomViews(
      {
        access_token,
        instance_url,
        offset: 0,
        moduleName: req.query.module_name,
      }
    );
    if (errorFetchingViews)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch custom views',
        error: `Error while fetching custom views: ${errorFetchingViews}`,
      });
    let list = data?.listviews ? data?.listviews : [];
    let size = list.length;
    let offset = 200;
    while (size == 200) {
      let [paginatedList, errForFetchingPaginatedList] =
        await SalesforceService.fetchCustomViews({
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

      list.push(...paginatedList?.listviews);
      size = paginatedList.listviews.length;
      offset += 200;
    }

    return successResponse(res, 'Fetched view successfully', list);
  } catch (err) {
    logger.error('Error while fetching custom views:', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Failed to fetch custom views',
      error: `Error while fetching custom views: ${err.message}`,
    });
  }
};

const previewExistingLeadsCSV = async (req, res) => {
  const { loaderId } = req.body;
  if (!loaderId)
    return badRequestResponseWithDevMsg({
      res,
      error: `loaderId is missing`,
    });
  try {
    // loaderId from body
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      logger.error(`Error while parsing field map :`, {
        err,
        user_id: req.user.user_id,
      });
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    let body = salesforceImportSchema.existingLeadsPreviewSchemaForCSV.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map: salesforceFieldMap } = body;

    // File validation
    const supportedExtensions = ['csv'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );
    let leads, errForLeads;
    if (supportedExtensions.includes(fileExtension.toLowerCase())) {
      // Read the file to ensure it is valid
      [leads, errForLeads] = await ExcelHelper.parseXlsx(req.file.path);
      if (errForLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Error while parsing csv file',
          error: errForLeads,
        });
    } else {
      // File extension is not supported
      return serverErrorResponseWithDevMsg({
        res,
        msg: `File type: ${fileExtension} is not supported`,
      });
    }

    const [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Salesforce',
      });

    let i = 0;

    let leadsToPreview = [];

    const leadIds = leads.map((lead) => lead[salesforceFieldMap.id]);

    const [dbLeads, errFetchingLeads] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        [Op.or]: {
          integration_id: leadIds,
        },
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['lead_cadence_id', 'cadence_id', 'status'],
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
          },
        },
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name', 'phone_number', 'size', 'url', 'integration_id'],
        },
        [DB_TABLES.USER]: {
          attributes: ['first_name', 'last_name', 'integration_id'],
        },
      },
      extras: {
        attributes: ['lead_id', 'user_id', 'integration_id'],
      },
    });
    if (errFetchingLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from CSV',
        error: errFetchingLeads,
      });

    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { company_id: req.user.company_id },
      extras: {
        attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForUsers,
        msg: `Failed to preview leads for import`,
      });

    successResponse(
      res,
      'Started importing, please check back after some time'
    );

    while (i < leads.length) {
      let data = leads[i];

      logger.info(`For lead ${i}`);

      let createdLead = {
        Id: `lead_${i + 1}`,
        first_name: data[salesforceFieldMap?.first_name]?.trim() || null,
        last_name: data[salesforceFieldMap?.last_name]?.trim() || null,
        linkedin_url: data[salesforceFieldMap?.linkedin_url]?.trim() || null,
        job_position: data[salesforceFieldMap?.job_position]?.trim() || null,
        integration_id: data[salesforceFieldMap?.id]?.trim() || null,
        integration_status: data[salesforceFieldMap?.status]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: '',
          OwnerId: data[salesforceFieldMap?.salesforce_owner_id],
        },
        Account: {
          name: data[salesforceFieldMap?.company]?.trim() || null,
          phone_number:
            data[salesforceFieldMap?.company_phone_number]?.trim() || null,
          size: data[salesforceFieldMap?.size]?.trim() || null,
          url: data[salesforceFieldMap?.url]?.trim() || null,
          country: data[salesforceFieldMap?.country]?.trim() || null,
          zipcode: data[salesforceFieldMap?.zip_code]?.trim() || null,
        },
      };

      // Check empty row
      let isEmptyRow = Object.keys(createdLead).every((key) => {
        if (key === 'Id') return true;
        const value = createdLead[key];

        if (Array.isArray(value)) {
          return value.length === 0; // Check for an empty array
        } else if (typeof value === 'object' && value !== null) {
          return Object.values(value).join('').length === 0; // Check for an empty object
        } else {
          return value === null || value === ''; // Check for null or empty string
        }
      });

      salesforceFieldMap?.phone_numbers?.forEach((phone_number) => {
        let phoneNumber = data[phone_number.column_name]?.trim() || null;
        if (phoneNumber) {
          isEmptyRow = false;
          createdLead.phone_numbers.push({
            phone_number: phoneNumber,
            type: phone_number.type,
          });
        }
      });

      salesforceFieldMap?.emails?.forEach((email) => {
        let emailId = data[email.column_name]?.trim() || null;
        if (emailId) {
          isEmptyRow = false;
          createdLead.emails.push({
            email_id: emailId,
            type: email.type,
          });
        }
      });

      if (isEmptyRow) {
        i++;
        continue;
      }

      createdLead.integration_type = LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.SALESFORCE_LEAD_ACCOUNT;
      createdLead.metadata = { source: LEAD_IMPORT_SOURCE.CSV_IMPORT };
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // Checking the values of required fields for lead
      if (!createdLead?.first_name) {
        logger.info(`first name not present in CSV.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in CSV.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in CSV.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.SALESFORCE_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in CSV.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.COMPANY);
      }
      if (!createdLead?.integration_id) {
        logger.info(`Integration id not present in CSV.`);
        missingFields.push(`Id`);
      }
      if (!createdLead?.integration_status) {
        logger.info(`Integration status not present in CSV.`);
        missingFields.push(`Status`);
      }

      // field format validation
      if (missingFields?.length) {
        createdLead.status = missingFields
          .join(', ')
          .concat(' should be present');
        createdLead.is_success = false;
      }
      // field format validation
      else if (
        createdLead?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdLead.linkedin_url)
      ) {
        logger.error(`Linkedin url is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${SALESFORCE_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      }

      const isPresent = dbLeads.find(
        (dbLead) => dbLead.integration_id === createdLead.integration_id
      );

      if (isPresent) {
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        createdLead.lead_id = isPresent.lead_id;
        createdLead.Cadences = isPresent?.LeadToCadences;
        createdLead.Account = isPresent?.Account;
        createdLead.user_id = isPresent?.user_id;
        createdLead.Owner = {
          Id: isPresent?.User?.integration_id,
          name: `${isPresent?.User?.first_name} ${isPresent?.User?.last_name}`,
        };
      } else {
        let user = users.find(
          (user) =>
            user.integration_id ===
            data[salesforceFieldMap?.salesforce_owner_id]
        );
        if (!user) {
          logger.info('Owner not present in our tool.');
          createdLead.Owner = null;
          createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          createdLead.is_success = false;
        } else {
          createdLead.Owner = {
            OwnerId: user.integration_id,
            Name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
          };
          createdLead.user_id = user.user_id;
        }
      }

      if (!createdLead.status)
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

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
        error: err.message,
      });

    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        leads: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: loaderId,
    });
  }
};

const importExistingLeadsCSV = async (req, res) => {
  const { loaderId } = req.body;
  if (!loaderId)
    return badRequestResponseWithDevMsg({
      res,
      error: `loaderId is missing`,
    });
  try {
    // * JOI Validation
    const body = salesforceImportSchema.importSalesforceLeadSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: body.error.message,
      });

    // Destructure request
    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: 'Leads array is empty',
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
      { cadence, node, access_token, instance_url, companyFieldMap },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: errFetchingPreImportData,
      });

    // * Store cadence in Recent cadences
    Repository.upsert({
      tableName: DB_TABLES.RECENT_ACTION,
      upsertObject: {
        user_id: req.user.user_id,
        cadence_id: cadence.cadence_id,
      },
    });

    // * Send success response indicating processing has been started
    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );

    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (const result of results) {
          if (result[1]) {
            let msg = result[1].error;
            response.element_error.push({
              lead_preview_id: result[1].preview_id,
              cadence_id,
              salesforce_lead_id: result[1].integration_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              cadence_id,
              lead_id: result[0].lead_id,
              salesforce_lead_id: result[0].preview_id,
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

      logger.info(`For lead with preview id: ${lead.Id}`);

      //* Account name check
      if (!lead?.Account?.name) {
        logger.info('Salesforce company name is not present');
        i++;
        response.element_error.push({
          cadence_id: lead.cadence_id,
          salesforce_lead_id: lead.preview_id,
          msg: 'Salesforce company name not present',
        });
        response.total_error++;
        leadCadenceOrderBatch++;
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
          cadence_id: lead.cadence_id,
          salesforce_lead_id: lead.preview_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        leadCadenceOrderBatch++;

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
          cadence_id: lead.cadence_id,
          salesforce_lead_id: lead.preview_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        leadCadenceOrderBatch++;
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
        LeadHelper.createExistingLeadFromSalesforce({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
          companyFieldMap,
        })
      );

      leadCadenceOrderBatch++;

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });
    }

    let results = await Promise.all(promiseArray);
    for (const result of results) {
      if (result[1]) {
        let msg = result[1].error;
        response.element_error.push({
          cadence_id,
          salesforce_lead_id: result[1].preview_id,
          msg,
        });
        response.total_error++;
        continue;
      } else {
        response.element_success.push({
          cadence_id,
          salesforce_lead_id: result[0].preview_id,
          lead_id: result[0].lead_id,
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
    logger.error(`Error while importing existing leads for salesforce: `, {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to import leads',
      });
  }
};

const previewExistingContactsCSV = async (req, res) => {
  const { loaderId } = req.body;
  if (!loaderId)
    return badRequestResponseWithDevMsg({
      res,
      error: `loaderId is missing`,
    });
  try {
    // loaderId from body
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      logger.error(`Error while parsing field map :`, {
        err,
        user_id: req.user.user_id,
      });
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    let body =
      salesforceImportSchema.existingContactsPreviewSchemaForCSV.validate(
        req.body
      );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map: salesforceFieldMap } = body;

    // File validation
    const supportedExtensions = ['csv'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );
    let contacts, errForLeads;
    if (supportedExtensions.includes(fileExtension.toLowerCase())) {
      // Read the file to ensure it is valid
      [contacts, errForLeads] = await ExcelHelper.parseXlsx(req.file.path);
      if (errForLeads)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Error while parsing csv file',
          error: errForLeads,
        });
    } else {
      // File extension is not supported
      return serverErrorResponseWithDevMsg({
        res,
        msg: `File type: ${fileExtension} is not supported`,
      });
    }

    const [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Salesforce',
      });

    let i = 0;

    let contactsToPreview = [];

    const [salesforceFieldMapFromUser, errFetchingSalesforceFieldMap] =
      await SalesforceHelper.getFieldMapForCompanyFromUser(req.user.user_id);
    if (errFetchingSalesforceFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Salesforce data to cadence',
        error: errFetchingSalesforceFieldMap,
      });

    const salesforceAccountMap = salesforceFieldMapFromUser.account_map;

    const accountIds = [];
    const leadIds = [];

    let j = 0;

    contacts.forEach((contact) => {
      accountIds.push(contact[salesforceFieldMap?.account_id]?.trim());
      leadIds.push(contact[salesforceFieldMap.id]);
    });

    const [dbLeads, errFetchingLeads] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        [Op.or]: {
          integration_id: leadIds,
        },
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['lead_cadence_id', 'cadence_id', 'status'],
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
          },
        },
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name', 'phone_number', 'size', 'url', 'integration_id'],
        },
        [DB_TABLES.USER]: {
          attributes: ['first_name', 'last_name', 'integration_id'],
        },
      },
      extras: {
        attributes: ['lead_id', 'user_id', 'integration_id'],
      },
    });
    if (errFetchingLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from CSV',
        error: errFetchingLeads,
      });

    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { company_id: req.user.company_id },
      extras: {
        attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForUsers,
        msg: `Failed to preview contacts for import`,
      });

    // * Construct query for account
    const account_name = salesforceAccountMap.name
      ? `${salesforceAccountMap.name}`
      : '';
    const account_url = salesforceAccountMap.url
      ? `,${salesforceAccountMap.url}`
      : '';
    const account_size = CompanyFieldMapHelper.getCompanySize({
      size: salesforceAccountMap?.size,
    })[0]
      ? `,${
          CompanyFieldMapHelper.getCompanySize({
            size: salesforceAccountMap?.size,
          })[0]
        }`
      : '';
    const account_country = salesforceAccountMap.country
      ? `,${salesforceAccountMap.country}`
      : '';
    const zip_code = salesforceAccountMap.zip_code
      ? `,${salesforceAccountMap.zip_code}`
      : '';
    const account_linkedin_url = salesforceAccountMap.linkedin_url
      ? `,${salesforceAccountMap.linkedin_url}`
      : '';
    const account_phone_number = salesforceAccountMap.phone_number
      ? `,${salesforceAccountMap.phone_number}`
      : '';

    const account_integration_status = salesforceAccountMap.integration_status
      ?.name
      ? `,${salesforceAccountMap.integration_status?.name}`
      : '';

    const account_id_tuple = accountIds
      ? `('${accountIds.join("','")}')`
      : null;

    const [accountSoqlQuery, errForSoql] = await SalesforceService.query(
      `SELECT+Id,${account_name}${account_url}${account_size}${account_country}${zip_code}${account_linkedin_url}${account_phone_number}${account_integration_status}+FROM+Account+where+Id+IN+${account_id_tuple}`,
      access_token,
      instance_url
    );
    if (errForSoql) {
      logger.error(
        `Error while fetching accounts from Salesforce using SOQL Query: `,
        errForSoql
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to preview contacts from CSV`,
        error: `Unable to fetch account details from Salesforce`,
      });
    }

    let accountData = {};

    accountSoqlQuery.records.forEach((account) => {
      accountData[account.Id] = account;
    });

    successResponse(
      res,
      'Started importing, please check back after some time'
    );

    // * Fetch salesforce field map
    while (i < contacts.length) {
      let data = contacts[i];

      logger.info(`For lead ${i}`);

      let createdContact = {};

      createdContact = {
        Id: `lead_${i + 1}`,
        first_name: data[salesforceFieldMap?.first_name]?.trim() || null,
        last_name: data[salesforceFieldMap?.last_name]?.trim() || null,
        linkedin_url: data[salesforceFieldMap?.linkedin_url]?.trim() || null,
        job_position: data[salesforceFieldMap?.job_position]?.trim() || null,
        integration_id: data[salesforceFieldMap?.id]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: '',
          OwnerId: data[salesforceFieldMap?.salesforce_owner_id],
        },
        Account: {
          name:
            accountData?.[data[salesforceFieldMap?.account_id]?.trim()]?.[
              salesforceAccountMap?.name
            ]?.trim() || null,

          phone_number:
            accountData?.[data[salesforceFieldMap?.account_id]?.trim()]?.[
              salesforceAccountMap?.phone_number
            ]?.trim() || null,
          size:
            accountData?.[data[salesforceFieldMap?.account_id]?.trim()]?.[
              salesforceAccountMap?.size
            ]?.trim() || null,
          url:
            accountData?.[data[salesforceFieldMap?.account_id]?.trim()]?.[
              salesforceAccountMap?.url
            ]?.trim() || null,
          country:
            accountData?.[data[salesforceFieldMap?.account_id]?.trim()]?.[
              salesforceAccountMap?.country
            ]?.trim() || null,
          zipcode:
            accountData?.[data[salesforceFieldMap?.account_id]?.trim()]?.[
              salesforceAccountMap?.zip_code
            ]?.trim() || null,

          integration_status:
            accountData?.[data[salesforceFieldMap?.account_id]?.trim()]?.[
              salesforceAccountMap?.integration_status?.name
            ]?.trim() || null,

          integration_id: data[salesforceFieldMap?.account_id]?.trim() || null,
        },
      };

      // Check empty row
      let isEmptyRow = Object.keys(createdContact).every((key) => {
        if (key === 'Id') return true;
        const value = createdContact[key];

        if (Array.isArray(value)) {
          return value.length === 0; // Check for an empty array
        } else if (typeof value === 'object' && value !== null) {
          return Object.values(value).join('').length === 0; // Check for an empty object
        } else {
          return value === null || value === ''; // Check for null or empty string
        }
      });

      salesforceFieldMap?.phone_numbers?.forEach((phone_number) => {
        let phoneNumber = data[phone_number.column_name]?.trim() || null;
        if (phoneNumber) {
          isEmptyRow = false;
          createdContact.phone_numbers.push({
            phone_number: phoneNumber,
            type: phone_number.type,
          });
        }
      });

      salesforceFieldMap?.emails?.forEach((email) => {
        let emailId = data[email.column_name]?.trim() || null;
        if (emailId) {
          isEmptyRow = false;
          createdContact.emails.push({
            email_id: emailId,
            type: email.type,
          });
        }
      });

      if (isEmptyRow) {
        i++;
        continue;
      }

      createdContact.integration_type =
        LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT;
      createdContact.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT;
      createdContact.metadata = { source: LEAD_IMPORT_SOURCE.CSV_IMPORT };
      createdContact.is_success = true; // for error handling

      // Skip if Account not present for Contact in Saleforce
      if (!accountData[data[salesforceFieldMap?.account_id]?.trim()]) {
        logger.info(`Account not present in Salesforce`);
        createdContact.status =
          SALESFORCE_LEAD_IMPORT_STATUS.COMPANY_NOT_PRESENT;
        createdContact.is_success = false;
        accountData[data[salesforceFieldMap?.account_id]?.trim()] = {};
      }

      let missingFields = [];

      // Checking the values of required fields for lead
      if (!createdContact?.first_name) {
        logger.info(`first name not present in CSV.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdContact?.last_name) {
        logger.info(`last name not present in CSV.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdContact?.Owner?.OwnerId) {
        logger.info(`Owner not present in CSV.`);
        missingFields.push(SALESFORCE_CSV_IMPORT_FIELDS.SALESFORCE_OWNER_ID);
      }
      if (!createdContact?.integration_id) {
        logger.info(`Integration id not present in CSV.`);
        missingFields.push(`Id`);
      }

      // field format validation
      if (missingFields?.length) {
        createdContact.status = missingFields
          .join(', ')
          .concat(' should be present');
        createdContact.is_success = false;
      }
      // field format validation
      else if (
        createdContact?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdContact.linkedin_url)
      ) {
        logger.error(`Linkedin url is invalid`);
        createdContact.status = `${SALESFORCE_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdContact.is_success = false;
      } else if (
        createdContact?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdContact?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdContact.status = `${SALESFORCE_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdContact.is_success = false;
      }

      const isPresent = dbLeads.find(
        (dbLead) => dbLead.integration_id === createdContact.integration_id
      );

      if (isPresent) {
        createdContact.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        createdContact.lead_id = isPresent.lead_id;
        createdContact.Cadences = isPresent?.LeadToCadences;
        createdContact.Account = isPresent?.Account;
        createdContact.user_id = isPresent?.user_id;
        createdContact.Owner = {
          Id: isPresent?.User?.integration_id,
          name: `${isPresent?.User?.first_name} ${isPresent?.User?.last_name}`,
        };
      } else {
        let user = users.find(
          (user) =>
            user.integration_id ===
            data[salesforceFieldMap?.salesforce_owner_id]
        );
        if (!user) {
          logger.info('Owner not present in our tool.');
          createdContact.Owner = null;
          createdContact.status =
            SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          createdContact.is_success = false;
        } else {
          createdContact.Owner = {
            OwnerId: user.integration_id,
            Name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
          };
          createdContact.user_id = user.user_id;
        }
      }

      if (!createdContact.status)
        createdContact.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

      createdContact.sr_no = i + 1;
      contactsToPreview.push(createdContact);
      i++;
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: i,
          size: contacts.length,
        },
        socketId: loaderId,
      });
    }

    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { contacts: contactsToPreview, error: null },
      socketId: loaderId,
    });
  } catch (err) {
    logger.error('Error while previewing contacts from csv: ', {
      err,
      user_id: req.user.user_id,
    });

    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: err.message,
      });

    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        contacts: [],
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: loaderId,
    });
  }
};

const importExistingContactsCSV = async (req, res) => {
  const { loaderId } = req.body;
  if (!loaderId)
    return badRequestResponseWithDevMsg({
      res,
      error: `loaderId is missing`,
    });
  try {
    // * JOI Validation
    const body = salesforceImportSchema.importSalesforceContactSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Salesforce',
        error: body.error.message,
      });

    // Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for integration Salesforce',
        error: 'Contacts array is empty',
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
      { cadence, node, access_token, instance_url, companyFieldMap },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for integration Salesforce',
        error: errFetchingPreImportData,
      });

    // * Store cadence in Recent cadences
    Repository.upsert({
      tableName: DB_TABLES.RECENT_ACTION,
      upsertObject: {
        user_id: req.user.user_id,
        cadence_id: cadence.cadence_id,
      },
    });

    // * Send success response indicating processing has been started
    successResponse(
      res,
      'Started importing contacts, please check back after some time'
    );

    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (const result of results) {
          if (result[1]) {
            let msg = result[1].error;
            response.element_error.push({
              cadence_id,
              salesforce_contact_id: result[1].preview_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              cadence_id,
              salesforce_contact_id: result[0].preview_id,
              lead_id: result[0].lead_id,
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

      logger.info(`For lead with preview id: ${lead.Id}`);

      //* Account name check
      if (!lead?.Account?.name) {
        logger.info('Salesforce company name is not present');
        i++;
        response.element_error.push({
          cadence_id: lead.cadence_id,
          salesforce_contact_id: lead.preview_id,
          msg: 'Salesforce company name not present',
        });
        response.total_error++;
        leadCadenceOrderBatch++;
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
          cadence_id: lead.cadence_id,
          salesforce_contact_id: lead.preview_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        leadCadenceOrderBatch++;

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
          cadence_id: lead.cadence_id,
          salesforce_contact_id: lead.preview_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        leadCadenceOrderBatch++;
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
        LeadHelper.createExistingContactFromSalesforce({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
          companyFieldMap,
        })
      );

      leadCadenceOrderBatch++;

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });
    }

    let results = await Promise.all(promiseArray);
    for (const result of results) {
      if (result[1]) {
        let msg = result[1].error;
        response.element_error.push({
          salesforce_contact_id: result[1].preview_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        continue;
      } else {
        response.element_success.push({
          cadence_id,
          salesforce_contact_id: result[0].preview_id,
          lead_id: result[0].lead_id,
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
    logger.error(`Error while importing existing leads for salesforce: `, {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to import leads',
      });
  }
};

const CadenceImportController = {
  getCSVColumns,
  getSheetsColumns,
  importSalesforceDataToCadence,
  importSalesforceContacts,
  importSalesforceLeads,
  importSalesforceTempLeads,
  linkContactsWithCadence,
  linkLeadsWithCadence,
  previewLeadsForCSVImport,
  previewLeadsForSheetsImport,
  getCustomViews,
  linkTempLeadsWithCadence,
  previewExistingLeadsCSV,
  importExistingLeadsCSV,
  previewExistingContactsCSV,
  importExistingContactsCSV,
};

module.exports = CadenceImportController;
