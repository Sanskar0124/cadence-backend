// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  unauthorizedResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
} = require('../../../../../utils/response');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../../../Cadence-Brain/src/utils/constants');
const {
  SALESFORCE_LEAD_IMPORT_STATUS,
  ZOHO_DATA_IMPORT_TYPES,
  LEAD_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  USER_INTEGRATION_TYPES,
  CADENCE_TYPES,
  CADENCE_LEAD_STATUS,
  CADENCE_STATUS,
  ZOHO_MODULE,
  LEAD_STATUS,
  IMPORT_ERROR_TYPE,
  ACCOUNT_INTEGRATION_TYPES,
  ZOHO_CSV_IMPORT_FIELDS,
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
const LeadRepository = require('../../../../../../../Cadence-Brain/src/repository/lead.repository');
const CadenceRepository = require('../../../../../../../Cadence-Brain/src/repository/cadence.repository');
const LeadToCadenceRepository = require('../../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const NodeRepository = require('../../../../../../../Cadence-Brain/src/repository/node.repository');
const TaskRepository = require('../../../../../../../Cadence-Brain/src/repository/task.repository');
const Repository = require('../../../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const TaskHelper = require('../../../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const zohoService = require('../../../../../../../Cadence-Brain/src/services/Zoho');
const SocketHelper = require('../../../../../../../Cadence-Brain/src/helper/socket');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const ImportHelper = require('../../../../../../../Cadence-Brain/src/helper/imports');
const LeadsToCadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ExcelHelper = require('../../../../../../../Cadence-Brain/src/helper/excel');
const GoogleSheets = require('../../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');

// Joi validation
const zohoImportSchema = require('../../../../../joi/v2/sales/department/cadence-imports/zoho-imports.joi');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../../../Cadence-Brain/src/utils/modelEnums');
const ZohoService = require('../../../../../../../Cadence-Brain/src/services/Zoho');

//GRPC
const v2GrpcClients = require('../../../../../../../Cadence-Brain/src/grpc/v2');

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
    const body = zohoImportSchema.fetchSheetsColumnsSchema.validate(req.body);
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

// * Import contacts
const previewZohoContactsData = async (req, res) => {
  try {
    const body = zohoImportSchema.previewZohoContactData.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Zoho contacts',
        error: `Error while importing Zoho contacts: ${body.error.message}`,
      });
    // * Destructure request
    const { contactIds, custom_view_id, loaderId } = body.value;
    let [zohoMap, errForZohoMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForZohoMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import contacts from zoho',
        error: `Error while fetching field map: ${errForZohoMap}`,
      });
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.ZOHO,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import contacts from zoho',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });

    let zohoContactMap = zohoMap?.contact_map;
    let zohoAccountMap = zohoMap?.account_map;
    if (zohoContactMap === null || zohoAccountMap === null)
      return notFoundResponseWithDevMsg({ res, msg: 'Please set zoho fields' });

    let first_name = zohoContactMap.first_name
      ? `${zohoContactMap.first_name},`
      : '';
    let last_name = zohoContactMap.last_name
      ? `${zohoContactMap.last_name},`
      : '';
    let linkedin_url = zohoContactMap.linkedin_url
      ? `${zohoContactMap.linkedin_url},`
      : '';
    let source_site = zohoContactMap.source_site
      ? `${zohoContactMap.source_site},`
      : '';
    let job_position = zohoContactMap.job_position
      ? `${zohoContactMap.job_position},`
      : '';

    let phone_number_query = '';
    zohoContactMap?.phone_numbers.forEach((phone_type) => {
      if (phone_number_query) phone_number_query += `${phone_type},`;
      else phone_number_query = `${phone_type},`;
    });
    let email_query = '';
    zohoContactMap?.emails.forEach((email_type) => {
      if (email_query) email_query += `${email_type},`;
      else email_query = `${email_type},`;
    });
    let account_name = zohoAccountMap.name
      ? `Account_Name.${zohoAccountMap.name},`
      : '';
    let account_url = zohoAccountMap.url
      ? `Account_Name.${zohoAccountMap.url},`
      : '';
    let account_size = CompanyFieldMapHelper.getCompanySize({
      size: zohoAccountMap?.size,
    })[0]
      ? `Account_Name.${
          CompanyFieldMapHelper.getCompanySize({
            size: zohoAccountMap?.size,
          })[0]
        },`
      : '';
    let account_country = zohoAccountMap.country
      ? `Account_Name.${zohoAccountMap.country},`
      : '';
    let zip_code = zohoAccountMap.zip_code
      ? `Account_Name.${zohoAccountMap.zip_code},`
      : '';
    let account_linkedin_url = zohoAccountMap.linkedin_url
      ? `Account_Name.${zohoAccountMap.linkedin_url},`
      : '';
    let account_phone_number = zohoAccountMap.phone_number
      ? `Account_Name.${zohoAccountMap.phone_number},`
      : '';
    let account_integration_status = zohoAccountMap.integration_status?.name
      ? `Account_Name.${zohoAccountMap.integration_status?.name},`
      : '';
    let offset = 0;
    let contacts = [];
    let decodedContacts = [];
    let AccountMap = {};

    if (custom_view_id) {
      let allContacts = [];
      let errForContacts;
      const fields = `Owner,${first_name}${linkedin_url}${source_site}${job_position}${last_name}${phone_number_query}${email_query}${account_name}Account_Name`;
      while (offset < 1000) {
        [contacts, errForContacts] = await ZohoService.fetchModuleByViewId({
          access_token,
          instance_url,
          viewId: custom_view_id,
          moduleName: ZOHO_MODULE.CONTACT,
          offset,
          fields,
        });
        if (errForContacts)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import contacts from zoho',
            error: `Error for contacts: ${errForContacts}`,
          });
        allContacts = allContacts.concat(contacts);
        if (!contacts || contacts.length < 200) break;
        offset = offset + 200;
      }
      contacts = allContacts;
      let AccountIds = [];
      contacts.map((contact) => {
        if (contact?.Account_Name?.id)
          AccountIds.push(contact?.Account_Name?.id);
      });
      AccountIds = [...new Set(AccountIds)];
      let account_properties_query = '';
      for (const [key, value] of Object.entries(zohoAccountMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'size') {
          let account_size = CompanyFieldMapHelper.getCompanySize({
            size: zohoAccountMap?.size,
          })[0]
            ? `${
                CompanyFieldMapHelper.getCompanySize({
                  size: zohoAccountMap?.size,
                })[0]
              },`
            : '';
          account_properties_query + `,${account_size}`;
          continue;
        }
        if (key === 'integration_status') {
          account_properties_query + `,${value?.name}`;
          continue;
        }
        if (key === 'variables') continue;

        if (typeof value === 'string')
          account_properties_query = account_properties_query + `,${value}`;
        else if (typeof value === 'object') {
          for (let v of value)
            lead_properties_query = lead_properties_query + `,${v}`;
        }
      }
      offset = 0;
      let account_query = `SELECT id${account_properties_query} Owner FROM Accounts where id in ${AccountIds} LIMIT ${offset}, 200`;
      let accounts = [];
      if (AccountIds) {
        while (true) {
          let [results, errResult] = await zohoService.query(
            (query = account_query),
            access_token,
            instance_url
          );
          if (errResult)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to import contacts from zoho',
              error: `Error while running COQL query in zoho: ${errResult}`,
            });
          accounts = results.data;
          for (let account of accounts) {
            let decodedAccount = {
              Id: account.id,
              url: account[zohoAccountMap?.url],
              size: account[
                `${
                  CompanyFieldMapHelper.getCompanySize({
                    size: zohoAccountMap.size,
                  })[0]
                }`
              ],
              country: account[zohoAccountMap?.country],
              name: account[zohoAccountMap?.name],
              zipcode: account[zohoAccountMap?.zip_code],
              phone_number: account[zohoAccountMap?.phone_number],
            };
            AccountMap[account.id] = decodedAccount;
          }
          if (accounts.length < 200) break;
          offset = offset + 200;
          account_query = `SELECT id${account_properties_query} Owner FROM Accounts where id in ${AccountIds} LIMIT ${offset}, 200`;
        }
      }
    } else {
      let condition = `id in ${contactIds}`;
      const query = `SELECT Owner.first_name,Owner.last_name,${first_name}${linkedin_url}${source_site}${job_position}${last_name}${phone_number_query}${email_query}${account_name}Account_Name,${account_url}${account_size}${account_country}${zip_code}${account_linkedin_url}${account_phone_number}${account_integration_status} Owner FROM Contacts where ${condition} LIMIT 0, 50`;
      let [results, errResult] = await zohoService.query(
        query,
        access_token,
        instance_url
      );
      if (errResult)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import contacts from zoho',
          error: `Error while running COQL query in zoho: ${errResult}`,
        });
      contacts = results.data;
    }

    if (!contacts || contacts.length == 0)
      return successResponse(
        res,
        'Contacts have been processed.',
        decodedContacts
      );
    successResponse(
      res,
      'Started processing contacts, please check back after some time'
    );
    let i = 0;
    let userMap = {};
    for (let contact of contacts) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: contacts.length,
        },
        socketId: loaderId,
      });
      let isUserPresentInDB = false;
      let first_name = contact[zohoContactMap.first_name];
      let last_name = contact[zohoContactMap.last_name];
      let linkedin_url = contact[zohoContactMap.linkedin_url];
      let job_position = contact[zohoContactMap.job_position];
      let emails = [];
      let phone_numbers = [];
      let Id = contact.id;
      let Owner = {
        OwnerId: contact?.Owner?.id,
        Name: `${contact['Owner.first_name']} ${contact['Owner.last_name']}`,
      };
      if (custom_view_id) Owner.Name = contact.Owner.name;
      // * Lead emails
      zohoContactMap.emails.forEach((email_type) => {
        emails.push({
          email_id: contact[email_type],
          type: email_type,
        });
      });
      // * Phone numbers
      zohoContactMap.phone_numbers.forEach((phone_type) => {
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
      if (contact?.Account_Name?.id) {
        let url = contact[`Account_Name.${zohoAccountMap.url} `];
        let size =
          contact[
            `Account_Name.${
              CompanyFieldMapHelper.getCompanySize({
                size: zohoAccountMap.size,
              })[0]
            }`
          ];
        let country = contact[`Account_Name.${zohoAccountMap.country}`];
        let name = contact[`Account_Name.${zohoAccountMap.name}`];
        let zipcode = contact[`Account_Name.${zohoAccountMap.zip_code}`];
        let phone_number =
          contact[`Account_Name.${zohoAccountMap.phone_number}`];
        let Id = contact.Account_Name.id;
        let decodedAccount = {
          Id,
          url,
          size,
          country,
          name,
          zipcode,
          phone_number,
        };
        if (custom_view_id)
          decodedAccount = AccountMap[contact.Account_Name.id];
        decodedContact.Account = decodedAccount;
      }
      let missingFields = [];

      if (!decodedContact?.first_name) {
        logger.info(`first name not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!decodedContact?.last_name) {
        logger.info(`last name not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!decodedContact?.Owner?.OwnerId) {
        logger.info(`Owner not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.ZOHO_OWNER_ID);
      }
      if (decodedContact?.Account && !decodedContact?.Account?.name) {
        logger.info(`company name not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }

      if (missingFields?.length) {
        decodedContact.status = missingFields
          .join(', ')
          .concat(' should be present');
        decodedContact.is_success = false;
      }
      if (!(contact?.Owner?.id in userMap)) {
        let [user, errFetchingUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: contact?.Owner?.id,
            company_id: req.user.company_id,
          },
        });
        if (errFetchingUser) continue;
        if (!user) {
          userMap[contact.Owner] = false;
          isUserPresentInDB = false;
        } else {
          userMap[contact.Owner] = true;
          isUserPresentInDB = true;
        }
      } else isUserPresentInDB = userMap[contact.Owner];

      if (!isUserPresentInDB) {
        decodedContact.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        decodedContact.is_success = false;
        decodedContact.sr_no = i;
        decodedContacts.push(decodedContact);
        continue;
      }
      let [leadFromDB, errFetchingLeadFromDB] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: {
          integration_id: contact.id,
          integration_type: LEAD_INTEGRATION_TYPES.ZOHO_CONTACT,
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
        logger.error(
          `An error occured while fetching leads from database ${errFetchingLeadFromDB}`
        );
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
      } else if (!decodedContact.status)
        decodedContact.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

      decodedContact.sr_no = i;
      decodedContacts.push(decodedContact);
    }
    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: decodedContacts, error: null },
      socketId: loaderId,
    });
  } catch (err) {
    logger.error('An error ocurred while importing zoho contacts: ', {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing leads from zoho: ${err.message}`,
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

// * Import leads
const previewZohoLeadsData = async (req, res) => {
  try {
    const body = zohoImportSchema.previewZohoLeadData.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Zoho leads',
        error: `Error while importing Zoho leads: ${body.error.message}`,
      });
    // * Destructure request
    const { leadIds, custom_view_id, loaderId } = body.value;
    let [zohoMap, errForZohoMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForZohoMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import leads data from Zoho',
        error: `Error for Zoho map: ${errForZohoMap}`,
      });
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.ZOHO,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import leads data from Zoho',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });
    let zohoLeadMap = zohoMap?.lead_map;

    if (zohoLeadMap === null)
      return notFoundResponseWithDevMsg({ res, msg: 'Please set zoho fields' });

    // * Construct query for lead
    let first_name = zohoLeadMap.first_name ? `${zohoLeadMap.first_name},` : '';
    let last_name = zohoLeadMap.last_name ? `${zohoLeadMap.last_name},` : '';
    let linkedin_url = zohoLeadMap.linkedin_url
      ? `${zohoLeadMap.linkedin_url},`
      : '';
    let source_site = zohoLeadMap.source_site
      ? `${zohoLeadMap.source_site},`
      : '';
    let job_position = zohoLeadMap.job_position
      ? `${zohoLeadMap.job_position},`
      : '';

    let company = zohoLeadMap.company ? `${zohoLeadMap.company},` : '';

    let size = CompanyFieldMapHelper.getCompanySize({
      size: zohoLeadMap?.size,
    })[0]
      ? `${
          CompanyFieldMapHelper.getCompanySize({
            size: zohoLeadMap?.size,
          })[0]
        },`
      : '';

    let zip_code = zohoLeadMap.zip_code ? `${zohoLeadMap.zip_code},` : '';

    let country = zohoLeadMap.country ? `${zohoLeadMap.country},` : '';

    let url = zohoLeadMap.url ? `${zohoLeadMap.url},` : '';

    let phone_number_query = '';
    zohoLeadMap?.phone_numbers.forEach((phone_type) => {
      if (phone_number_query) phone_number_query += `${phone_type},`;
      else phone_number_query = `${phone_type},`;
    });
    let email_query = '';
    zohoLeadMap?.emails.forEach((email_type) => {
      if (email_query) email_query += `${email_type},`;
      else email_query = `${email_type},`;
    });
    let leads;
    let decodedLeads = [];
    let offset = 0;

    if (custom_view_id) {
      let errForLeads;
      let allLeads = [];
      const fields = `${first_name}${company}${linkedin_url}${phone_number_query}${email_query}${size}${zip_code}${country}${url}${source_site}${job_position}${last_name}Owner,Owner.first_name,Owner.last_name`;
      while (offset < 1000) {
        [leads, errForLeads] = await ZohoService.fetchModuleByViewId({
          access_token,
          instance_url,
          viewId: custom_view_id,
          moduleName: ZOHO_MODULE.LEAD,
          offset,
          fields,
        });
        if (errForLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import leads data from Zoho',
            error: `Error for leads: ${errForLeads}`,
          });
        allLeads = allLeads.concat(leads);
        if (!leads || leads.length < 200) break;
        offset = offset + 200;
      }
      leads = allLeads;
    } else {
      const condition = `id in ${leadIds}`;
      const query = `SELECT ${first_name}${company}${linkedin_url}${phone_number_query}${email_query}${size}${zip_code}${country}${url}${source_site}${job_position}${last_name}Owner,Owner.first_name,Owner.last_name FROM Leads where ${condition} LIMIT ${offset}, 200`;
      let [results, errResult] = await zohoService.query(
        query,
        access_token,
        instance_url
      );
      if (errResult) {
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import leads data from Zoho',
          error: `Error while running COQL query in zoho: ${errResult}`,
        });
      }
      leads = results.data;
    }

    if (!leads || leads.length == 0)
      return successResponse(res, 'Leads have been processed.', decodedLeads);

    successResponse(
      res,
      'Started processing leads, please check back after some time'
    );
    let i = 0;
    let userMap = {};
    for (let lead of leads) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });
      let isUserPresentInDB = false;
      let decodedLead = {
        first_name: lead?.[zohoLeadMap.first_name],
        last_name: lead?.[zohoLeadMap.last_name],
        linkedin_url: lead?.[zohoLeadMap.linkedin_url],
        source_site: lead?.[zohoLeadMap.source_site],
        job_position: lead?.[zohoLeadMap.job_position],
        Id: lead.id,
        phone_numbers: [],
        emails: [],

        Owner: {
          Name: `${lead['Owner.first_name']} ${lead['Owner.last_name']}`,
          OwnerId: lead.Owner.id,
        },
        Account: {
          name: lead?.[zohoLeadMap?.company],
          size:
            lead?.[
              CompanyFieldMapHelper.getCompanySize({
                size: zohoLeadMap?.size,
              })[0]
            ] ?? null,
          url: lead?.[zohoLeadMap?.url] ?? null,
          country: lead?.[zohoLeadMap?.country] ?? null,
          zipcode: lead?.[zohoLeadMap?.zip_code] ?? null,
        },
      };
      if (custom_view_id) decodedLead.Owner.Name = lead.Owner.name;
      zohoLeadMap?.phone_numbers.forEach((phone_type) => {
        decodedLead.phone_numbers.push({
          type: phone_type,
          phone_number: lead[phone_type],
        });
      });

      zohoLeadMap?.emails.forEach((email_type) => {
        decodedLead.emails.push({
          type: email_type,
          email_id: lead[email_type],
        });
      });
      let missingFields = [];

      if (!decodedLead?.first_name) {
        logger.info(`first name not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!decodedLead?.last_name) {
        logger.info(`last name not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!decodedLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.ZOHO_OWNER_ID);
      }
      if (!decodedLead?.Account?.name) {
        logger.info(`company name not present in zoho.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }

      if (missingFields?.length) {
        decodedLead.status = missingFields
          .join(', ')
          .concat(' should be present');
        decodedLead.is_success = false;
      }
      if (!(lead?.Owner?.id in userMap)) {
        let [user, errFetchingUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: lead?.Owner?.id,
            company_id: req.user.company_id,
          },
        });
        if (errFetchingUser) continue;
        if (!user) {
          userMap[lead?.Owner?.id] = false;
          isUserPresentInDB = false;
        } else {
          userMap[lead?.Owner?.id] = true;
          isUserPresentInDB = true;
        }
      } else isUserPresentInDB = userMap[lead.Owner.id];

      if (!isUserPresentInDB) {
        decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        decodedLead.is_success = false;
        decodedLead.sr_no = i;
        decodedLeads.push(decodedLead);
        continue;
      }
      let [leadFromDB, errFetchingLeadFromDB] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: {
          integration_id: lead.id,
          integration_type: LEAD_INTEGRATION_TYPES.ZOHO_LEAD,
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
        logger.error(
          `An error occured while fetching leads from database ${errFetchingLeadFromDB}`
        );

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
      } else if (!decodedLead.status)
        decodedLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      decodedLead.sr_no = i;

      decodedLeads.push(decodedLead);
    }
    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: decodedLeads, error: null },
      socketId: loaderId,
    });
  } catch (err) {
    logger.error('An error ocurred while importing zoho leads: ', {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing leads from zoho: ${err.message}`,
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
const importZohoContacts = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoImportSchema.importZohoContactSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Zoho contacts',
        error: `Error while importing Zoho contacts: ${body.error.message}`,
      });
    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Zoho contacts',
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
      integration_type: CRM_INTEGRATIONS.ZOHO,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import zoho contacts, please try again or contact support',
        error: errFetchingPreImportData,
      });

    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );
    for (let lead of leads) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch + 1,
          size: leads.length,
        },
        socketId: loaderId,
      });
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
      leadCadenceOrderBatch++;
      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead: ${lead.Id}`);

      // * Validate lead integration_id
      if (!lead.Id) {
        logger.info('Zoho contact id not present');
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Zoho contact id not present',
        });
        response.total_error++;
        i++;
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

        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createContactFromZoho({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
        })
      );
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
      `An error ocurred while trying to create contacts in tool from zoho: `,
      err
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing Zoho contacts: ${err.message}`,
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

// * Import leads
const importZohoLeads = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoImportSchema.importZohoLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Zoho leads',
        error: `Error while importing Zoho leads: ${body.error.message}`,
      });

    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Zoho leads',
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
      integration_type: CRM_INTEGRATIONS.ZOHO,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import zoho leads, please try again or contact support',
        error: errFetchingPreImportData,
      });

    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );
    for (let lead of leads) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch + 1,
          size: leads.length,
        },
        socketId: loaderId,
      });
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
      leadCadenceOrderBatch++;
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
          msg: 'Zoho lead id not present',
        });
        response.total_error++;
        continue;
      }

      //* Account name check
      if (!lead?.Account?.name) {
        logger.info('Zoho account name is not present');
        i++;
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Zoho account name not present',
        });
        response.total_error++;
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

        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createLeadFromZoho({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
        })
      );
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
      `An error ocurred while trying to create leads in tool from zoho: `,
      err
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing Zoho Leads: ${err.message}`,
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

const importZohoTempLeads = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoImportSchema.importZohoLeadSchema.validate(req.body);
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Zoho',
        error: `Error while creating lead in tool: ${body.error.message}`,
      });

    // * Destructure request
    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Zoho',
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
        integration_type: CRM_INTEGRATIONS.ZOHO,
      });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create leads in tool for integration Zoho',
        error: errFetchingPreImportData,
      });

    // * Send success response indicating processing has been started
    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );

    for (let lead of leads) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch + 1,
          size: leads.length,
        },
        socketId: loaderId,
      });
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
      leadCadenceOrderBatch++;
      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.preview_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead with preview id: ${lead.id}`);

      //* Company name check
      if (!lead?.Account?.name) {
        logger.info('Zoho company name is not present');
        i++;
        response.element_error.push({
          lead_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Zoho company name not present',
        });
        response.total_error++;
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
      `An error ocurred while trying to create leads in tool for integration Zoho: `,
      { err, user_id: req.user.user_id }
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating lead in tool for integration Zoho: ${err.message}`,
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

const linkContactsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoImportSchema.importZohoContactSchema.validate(req.body);
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
      integration_type: CRM_INTEGRATIONS.ZOHO,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not link zoho contacts, please try again or contact support',
        error: errFetchingPreImportData,
      });
    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started linking contacts, please check back after some time'
      );
    for (let lead of leads) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch + 1,
          size: leads.length,
        },
        socketId: loaderId,
      });
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
      }

      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.integration_id}`);

      promiseArray.push(
        LeadHelper.linkZohoLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );
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
        'Leads has been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking contacts to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking contacts to cadence: ${err.message}`,
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

// * Link existing lead with cadence
const linkLeadsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoImportSchema.importZohoLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to link leads with cadence',
        error: `Error while linking leads with cadence: ${body.error.message}`,
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
      integration_type: CRM_INTEGRATIONS.ZOHO,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import zoho contacts, please try again or contact support',
        error: errFetchingPreImportData,
      });
    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started linking leads, please check back after some time'
      );
    for (let lead of leads) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch + 1,
          size: leads.length,
        },
        socketId: loaderId,
      });
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
        LeadHelper.linkZohoLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );
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
        'Leads has been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking leads to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking leads to cadence: ${err.message}`,
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
const getZohoUsers = async (req, res) => {
  try {
    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        company_id: req?.user?.company_id,
        integration_type: USER_INTEGRATION_TYPES.ZOHO_USER,
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Zoho users',
        error: `Error while fetching users: ${errForUsers}`,
      });
    return successResponse(res, 'Successfully fetched users data', users);
  } catch (err) {
    logger.error(`Error ocurred while fetching users of zoho: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching Zoho users: ${err.message}`,
    });
  }
};

const getZohoCustomViews = async (req, res) => {
  try {
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.ZOHO,
        user_id: req.user.user_id,
      });

    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Zoho',
      });

    const [data, errorFetchingViews] = await ZohoService.fetchCustomViews({
      access_token,
      instance_url,
      moduleName: req.query.module_name,
    });
    if (errorFetchingViews)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch custom views',
        error: `Error while fetching custom views: ${errorFetchingViews}`,
      });

    return successResponse(res, 'Fetched view successfully', data.custom_views);
    // const result = [];
    // const BATCH_SIZE = 4;
    // for (let i = 0; i < views.length; i += BATCH_SIZE) {
    //   const viewPromises = [];
    //   for (let j = i; j < i + BATCH_SIZE && j < views.length; j++) {
    //     const view = views[j];
    //     viewPromises.push(
    //       ZohoService.fetchCustomViewById({
    //         access_token,
    //         instance_url,
    //         viewId: view.id,
    //         moduleName: req.params.module_name,
    //       })
    //     );
    //   }
    //   const customViewsPromises = await Promise.allSettled(viewPromises);
    //   for (let customViewsPromise of customViewsPromises) {
    //     if (customViewsPromise.status == 'fulfilled') {
    //       const [customView, errForView] = customViewsPromise.value;
    //       if (customView) result.push(customView['custom_views'][0]);
    //       else logger.error('Error fetching custom view:', errForView);
    //     } else
    //       logger.error(
    //         'Error fetching custom view:',
    //         customViewsPromise.reason
    //       );
    //   }
    // }

    //return successResponse(res, 'Fetched view successfully', result);
  } catch (err) {
    logger.error('Error while fetching custom views:', err);
    return [null, err.message];
  }
};

const previewLeadsForCSVImport = async (req, res) => {
  try {
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    // * JOI Validation
    let body = zohoImportSchema.leadsPreviewSchemaForCSV.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map: zohoFieldMap } = body;

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

    const ownerIdRegex = /^\d+$/;

    successResponse(
      res,
      'Started processing leads, please check back after some time'
    );
    let i = 0;
    let leadsToPreview = [];

    // To store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUserMap = {};
    while (i < leads.length) {
      let leadData = leads[i];

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });

      let createdLead = {
        first_name: leadData[zohoFieldMap?.first_name]?.trim() || null,
        last_name: leadData[zohoFieldMap?.last_name]?.trim() || null,
        linkedin_url: leadData[zohoFieldMap?.linkedin_url]?.trim() || null,
        job_position: leadData[zohoFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: leadData[zohoFieldMap?.owner_full_name]?.trim(),
          OwnerId: leadData[zohoFieldMap?.zoho_owner_id]?.trim(),
        },
        Account: {
          name: leadData[zohoFieldMap?.company_name]?.trim() || null,
          phone_number:
            leadData[zohoFieldMap?.company_phone_number]?.trim() || null,
          size: leadData[zohoFieldMap?.size]?.trim() || null,
          url: leadData[zohoFieldMap?.url]?.trim() || null,
          country: leadData[zohoFieldMap?.country]?.trim() || null,
          zipcode: leadData[zohoFieldMap?.zip_code]?.trim() || null,
        },
      };

      // Checking for empty row
      let isEmptyRow = Object.keys(createdLead).every((key) => {
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
      zohoFieldMap?.phone_numbers?.forEach((phone_number) => {
        let phoneNumber = leadData[phone_number.column_name]?.trim() || null;
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
      zohoFieldMap?.emails?.forEach((email) => {
        let emailId = leadData[email.column_name]?.trim() || null;
        if (emailId) {
          isEmptyRow = false;
          if (!EMAIL_REGEX.test(emailId)) emailErrMsg.push(email.column_name);

          createdLead.emails.push({
            email_id: emailId,
            type: email.type,
          });
        }
      });
      if (isEmptyRow) continue;

      // assign integration to created lead
      createdLead.integration_type = LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.ZOHO_CSV_ACCOUNT;
      createdLead.Id = `lead_${i}`;
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.ZOHO_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }

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
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Owner?.OwnerId &&
        !ownerIdRegex.test(createdLead.Owner.OwnerId)
      ) {
        logger.error(`Owner id is invalid`);
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.ZOHO_OWNER_ID} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
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

      // Checking the values of required fields for lead
      if (createdLead?.Owner?.OwnerId) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: createdLead?.Owner?.OwnerId,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        } else {
          createdLead.Owner.Name = user.first_name + ' ' + user.last_name;
          createdLead.user_id = user.user_id;
        }
      }

      if (!createdLead.status)
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      createdLead.sr_no = i;
      leadsToPreview.push(createdLead);
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

const previewLeadsForSheetsImport = async (req, res) => {
  try {
    //cadence id from body
    let body = zohoImportSchema.leadsPreviewSchemaForSheets.validate(req.body);
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId } = body;
    const [_, spreadsheetId, sheetId] = req.body.url.match(GOOGLE_SHEETS_REGEX);

    const ownerIdRegex = /^\d+$/;

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
    let leadsToPreview = [];

    // To store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUserMap = {};

    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );
    let zohoFieldMap = body.field_map;

    while (i < leads.length) {
      let leadData = leads[i];
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });

      if (
        leadData?._rawData.includes(
          'Make a copy (File > Make a Copy) of this Google Sheet for your reference'
        )
      )
        continue;

      let createdLead = {
        first_name: leadData[zohoFieldMap?.first_name]?.trim() || null,
        last_name: leadData[zohoFieldMap?.last_name]?.trim() || null,
        linkedin_url: leadData[zohoFieldMap?.linkedin_url]?.trim() || null,
        job_position: leadData[zohoFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: leadData[zohoFieldMap?.owner_name]?.trim(),
          OwnerId: leadData[zohoFieldMap?.zoho_owner_id]?.trim(),
        },
        Account: {
          name: leadData[zohoFieldMap?.company_name]?.trim() || null,
          phone_number:
            leadData[zohoFieldMap?.company_phone_number]?.trim() || null,
          size: leadData[zohoFieldMap?.size]?.trim() || null,
          url: leadData[zohoFieldMap?.url]?.trim() || null,
          country: leadData[zohoFieldMap?.country]?.trim() || null,
          zipcode: leadData[zohoFieldMap?.zip_code]?.trim() || null,
        },
      };

      // Checking for empty row
      let isEmptyRow = Object.keys(createdLead).every((key) => {
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
      zohoFieldMap?.phone_numbers?.forEach((phone_number) => {
        let phoneNumber = leadData[phone_number.column_name]?.trim() || null;
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
      zohoFieldMap?.emails?.forEach((email) => {
        let emailId = leadData[email.column_name]?.trim() || null;
        if (emailId) {
          isEmptyRow = false;
          if (!EMAIL_REGEX.test(emailId)) emailErrMsg.push(email.column_name);

          createdLead.emails.push({
            email_id: emailId,
            type: email.type,
          });
        }
      });
      if (isEmptyRow) continue;

      // assign integration to created lead
      createdLead.integration_type =
        LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_ACCOUNT;
      createdLead.Id = `lead_${i}`;
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.ZOHO_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(ZOHO_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }

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
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead.Account.phone_number &&
        !PHONE_REGEX.test(createdLead.Account.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Owner?.OwnerId &&
        !ownerIdRegex.test(createdLead.Owner.OwnerId)
      ) {
        logger.error(`Owner id is invalid`);
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.ZOHO_OWNER_ID} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${ZOHO_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
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
          user_integration_id: createdLead?.Owner?.OwnerId,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        } else {
          createdLead.Owner.Name = user.first_name + ' ' + user.last_name;
          createdLead.user_id = user.user_id;
        }
      }

      if (!createdLead.status)
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

      createdLead.sr_no = i;
      leadsToPreview.push(createdLead);
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

const CadenceImportController = {
  getCSVColumns,
  getSheetsColumns,
  previewZohoContactsData,
  previewZohoLeadsData,
  importZohoContacts,
  importZohoLeads,
  importZohoTempLeads,
  linkContactsWithCadence,
  linkLeadsWithCadence,
  getZohoUsers,
  getZohoCustomViews,
  previewLeadsForCSVImport,
  previewLeadsForSheetsImport,
};

module.exports = CadenceImportController;
