// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
} = require('../../../../../utils/response');

const {
  SELLSY_CONTACT_IMPORT_STATUS,
  CADENCE_STATUS,
  CRM_INTEGRATIONS,
  IMPORT_ERROR_TYPE,
  LEAD_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  SELLSY_CSV_IMPORT_FIELDS,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');
const {
  EMAIL_REGEX,
  PHONE_REGEX,
  LINKEDIN_REGEX,
  WEBSITE_URL_REGEX,
  GOOGLE_SHEETS_REGEX,
} = require('../../../../../../../Cadence-Brain/src/utils/constants');
const {
  DB_TABLES,
} = require('../../../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { Op } = require('sequelize');
const xlsx = require('xlsx');

// Models
const {
  sequelize,
} = require('../../../../../../../Cadence-Brain/src/db/models');

// * Repository Imports
const Repository = require('../../../../../../../Cadence-Brain/src/repository');
// * Helper Imports
const SellsyService = require('../../../../../../../Cadence-Brain/src/services/Sellsy');
const SellsyHelper = require('../../../../../../../Cadence-Brain/src/helper/sellsy');
const SocketHelper = require('../../../../../../../Cadence-Brain/src/helper/socket');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const LeadsToCadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ExcelHelper = require('../../../../../../../Cadence-Brain/src/helper/excel');
const GoogleSheets = require('../../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');

// GRPC
const v2GrpcClients = require('../../../../../../../Cadence-Brain/src/grpc/v2');

// Joi
const sellsyImportSchema = require('../../../../../joi/v2/sales/department/cadence-imports/sellsy-imports.joi');
const ImportHelper = require('../../../../../../../Cadence-Brain/src/helper/imports');

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
    const body = sellsyImportSchema.fetchSheetsColumnsSchema.validate(req.body);
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: body.error.details[0].message,
      });

    const [_, spreadsheetId, sheetId] = req.body.url.match(GOOGLE_SHEETS_REGEX);

    const [doc, errForDoc] = await GoogleSheets.loadDocument(spreadsheetId);
    if (errForDoc) {
      if (errForDoc?.includes('403'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Please provide read access to "Anyone with the link" to the google sheet',
        });
      if (errForDoc?.includes('404'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Please Provide Valid Google Sheets Url',
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: errForLeads,
      });
    }

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
    logger.error('Error while fetching google sheets columns : ', {
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

const previewContactsForCSVImport = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body.field_map)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, field_map is missing`,
    });
  try {
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch {
      return badRequestResponseWithDevMsg({
        res,
        error: `Invalid Field map`,
      });
    }
    // * JOI Validation
    const body = sellsyImportSchema.csvImportSchema.validate({ ...req.body });
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads for CSV import',
        error: body.error.details[0].message,
      });

    let preResults = await Promise.all([
      AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SELLSY,
        user_id: req.user.user_id,
      }),
      SellsyHelper.getFieldMapForCompany(req.user.company_id),
    ]);
    // * Fetch access token token and instance URL
    const [{ access_token }, errForAccessToken] = preResults[0];
    if (errForAccessToken) {
      logger.error('Error while fetching access token: ', errForAccessToken);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please connect with sellsy to import contacts.',
      });
    }

    // * Fetch salesforce field map
    const [sellsyFieldMap, errFetchingSellsyFieldMap] = preResults[1];
    if (errFetchingSellsyFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from CSV',
        error: `Error while fetching sellsy field map: ${errFetchingSellsyFieldMap}`,
      });
    let { field_map } = body.value;

    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );

    let contacts, companyContactRelation, errForContacts;
    if (fileExtension.toLowerCase() === 'csv') {
      // Read the file to ensure it is valid
      [{ contacts, companyContactRelation }, errForContacts] =
        await SellsyHelper.parseCsv({
          file: req.file.path,
          fieldMap: field_map,
          limit: 501,
        });
      if (errForContacts)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Error while parsing csv file',
          error: `Error while parsing csv file: ${errForContacts}`,
        });
    } else {
      // File extension is not supported
      return serverErrorResponseWithDevMsg({
        res,
        msg: `File type: ${fileExtension} is not supported`,
      });
    }

    let i = 0;
    let contactsToPreview = [];
    let userObj = {};
    let companyData = {};
    const sellsyCompanyMap = sellsyFieldMap.company_map;

    let contactIds = contacts.map((contact) => contact.id);

    let [dbContacts, errFetchingLeads] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        [Op.or]: {
          integration_id: contactIds,
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
      },
    });
    if (errFetchingLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from CSV',
        error: `Error while fetching dbContacts: ${errFetchingLeads}`,
      });

    successResponse(
      res,
      'Started processing contacts, please check back after some time'
    );

    let time = new Date().getTime();
    console.time(`sellsy import ${time}`);

    while (i < contacts?.length) {
      let createdLead = contacts[i];

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: contacts.length,
        },
        socketId: loaderId,
      });

      if (!/^\d+$/.test(createdLead?.id)) {
        logger.info('Contact id not present in CSV.');
        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.INVALID_CONTACT_ID;
        createdLead.account = {
          name: createdLead?.account?.name,
        };
        createdLead.owner = {
          owner_id: null,
          owner_name: createdLead?.owner,
        };
        createdLead.sr_no = i;
        contactsToPreview.push(createdLead);
        continue;
      } else if (!createdLead?.first_name) {
        logger.info('Contact first name not present in CSV.');
        createdLead.status =
          SELLSY_CONTACT_IMPORT_STATUS.FIRST_NAME_NOT_PRESENT;
        createdLead.account = {
          name: createdLead?.account?.name,
        };
        createdLead.owner = {
          owner_id: null,
          owner_name: createdLead?.owner,
        };
        createdLead.sr_no = i;
        contactsToPreview.push(createdLead);
        continue;
      } else if (!createdLead?.owner) {
        logger.info('Contact owner not present in CSV.');
        createdLead.owner = null;
        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
        createdLead.account = {
          name: createdLead?.account?.name,
        };
        createdLead.sr_no = i;
        contactsToPreview.push(createdLead);
        continue;
      }

      let isPresent = dbContacts.filter(function (value) {
        return value.integration_id === createdLead.id;
      });

      if (isPresent?.length) {
        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        createdLead.lead_id = isPresent[0].lead_id;
        createdLead.cadences = isPresent[0]?.LeadToCadences;
        createdLead.account = isPresent[0]?.Account;
      } else {
        let accountName = createdLead?.account?.name ?? '';
        let leadId = createdLead?.id;

        if (!accountName?.length) createdLead.account = null;
        else if (
          companyContactRelation[accountName]?.includes(leadId) &&
          companyData.hasOwnProperty(accountName)
        ) {
          createdLead.account = companyData[accountName];
        } else {
          const [sellsyCompany, errFetchingSellsyCompany] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.SELLSY,
              integration_data: {
                access_token,
                contact_id: leadId,
              },
            });
          if (errFetchingSellsyCompany) createdLead.account = null;

          logger.info(`For company: ${sellsyCompany?.id}`);
          if (!sellsyCompany) {
            createdLead.account = null;
            companyData[accountName] = null;
          } else {
            let companySize = null;
            if (sellsyCompanyMap?.size?.includes('.')) {
              let [parentKey, childKey] = sellsyCompanyMap?.size?.split('.');
              companySize = sellsyCompany[parentKey]?.[childKey];
            } else companySize = sellsyCompany[sellsyCompanyMap?.size];

            let decodedAccount = {
              name: sellsyCompany[sellsyCompanyMap?.name]?.trim() || null,
              id: sellsyCompany.id,
              phone_number:
                sellsyCompany[sellsyCompanyMap?.phone_number]?.trim() || null,
              size: companySize,
              url: sellsyCompany[sellsyCompanyMap?.url]?.trim() || null,
            };

            createdLead.account = decodedAccount;
            companyData[accountName] = decodedAccount;
          }
        }

        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      }

      let user, userErr;

      // Check if user with given sellsy owner id is found
      if (!(createdLead.owner in userObj)) {
        [user, userErr] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            [Op.and]: [
              sequelize.literal(
                `LOWER(CONCAT(first_name, ' ', last_name)) = '${
                  createdLead?.owner?.toLowerCase()?.trim() ?? ''
                }'`
              ),
              { company_id: req.user.company_id },
            ],
          },
        });

        if (userErr || user === null) {
          logger.info('Owner not present in our tool.');
          userObj[createdLead?.owner] = null; // cache not present case so that we do not try to process this user again
          createdLead.owner = {
            owner_id: null,
            owner_name: createdLead.owner,
          };
          createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
        } else {
          userObj[createdLead?.owner] = user; // cache present case so that we do not try to process this user again
          createdLead.owner = {
            owner_id: user.integration_id,
            owner_name: createdLead.owner,
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
        if (!userObj[createdLead?.owner]) {
          // case 2, if no valid value is present
          logger.info('Owner not present in our tool.');
          createdLead.owner = {
            owner_id: null,
            owner_name: createdLead.owner,
          };
          createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
          userObj[createdLead?.owner?.owner_name] = null; // cache not present case so that we do not try to process this user again
        } else {
          // case 1,  user is found
          user = userObj[createdLead.owner];
          createdLead.owner = {
            owner_id: user.integration_id,
            owner_name: createdLead.owner,
          };
          createdLead.user_id = user?.user_id;
        }
      }
      createdLead.sr_no = i;
      contactsToPreview.push(createdLead);
    }

    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { contacts: contactsToPreview, error: null },
      socketId: loaderId,
    });
    console.timeEnd(`sellsy import ${time}`);

    // return successResponse(
    //   res,
    //   'Contact have been processed.',
    //   contactsToPreview
    // );
  } catch (err) {
    logger.error(`Error ocurred while processing contacts for sellsy: `, err);

    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while processing sellsy contacts: ${err.message}`,
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

const previewLeadsViaCSV = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body.field_map)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, field_map is missing`,
    });
  try {
    // loaderId from body
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    let body = sellsyImportSchema.previewLeadsViaCSVSchema.validate(req.body);
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

    const { loaderId, field_map: sellsyFieldMap } = body.value;

    // File validation
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
    const ownerIdRegex = /^\d+$/;

    successResponse(
      res,
      'Started processing leads, please check back after some time'
    );

    let i = 0;
    let leadsToPreview = [];
    let fetchedUserMap = {}; // To store fetched users, so that we do not fetch repeatedly for same one's

    while (i < leads?.length) {
      let leadData = leads[i];

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });

      let createdLead = {
        first_name: leadData[sellsyFieldMap?.first_name]?.trim() || null,
        last_name: leadData[sellsyFieldMap?.last_name]?.trim() || null,
        linkedin_url: leadData[sellsyFieldMap?.linkedin_url]?.trim() || null,
        job_position: leadData[sellsyFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          owner_name: '',
          owner_id: leadData[sellsyFieldMap?.sellsy_owner_id]?.trim(),
        },
        Account: {
          name: leadData[sellsyFieldMap?.company_name]?.trim() || null,
          phone_number:
            leadData[sellsyFieldMap?.company_phone_number]?.trim() || null,
          size: leadData[sellsyFieldMap?.size]?.trim() || null,
          url: leadData[sellsyFieldMap?.url]?.trim() || null,
          country: leadData[sellsyFieldMap?.country]?.trim() || null,
          zipcode: leadData[sellsyFieldMap?.zipcode]?.trim() || null,
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
      sellsyFieldMap?.phone_numbers?.forEach((phone_number) => {
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
      sellsyFieldMap?.emails?.forEach((email) => {
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
      createdLead.integration_type = LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.SELLSY_CSV_COMPANY;
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.owner_id) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.SELLSY_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.COMPANY_NAME);
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
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead.Account.phone_number &&
        !PHONE_REGEX.test(createdLead.Account.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Owner?.owner_id &&
        !ownerIdRegex.test(createdLead.Owner.owner_id)
      ) {
        logger.error(`Owner id is invalid`);
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.SELLSY_OWNER_ID} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
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

      if (createdLead?.Owner?.owner_id) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: createdLead.Owner?.owner_id,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
          createdLead.is_success = false;
        } else {
          createdLead.Owner.owner_name = user.first_name + ' ' + user.last_name;
          createdLead.user_id = user.user_id;
        }
      }

      if (!createdLead.status)
        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

      createdLead.sr_no = i;
      leadsToPreview.push(createdLead);
    }

    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: leadsToPreview, error: null },
      socketId: loaderId,
    });

    // return successResponse(res, 'Leads have been processed.', leadsToPreview);
  } catch (err) {
    logger.error('Error while previewing leads from csv: ', {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while processing leads from csv: ${err.message}`,
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

const previewLeadsViaSheets = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body.field_map || !req.body.url)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, field_map or url is missing`,
    });
  try {
    //cadence id from body
    const body = sellsyImportSchema.previewLeadsViaSheetsSchema.validate(
      req.body
    );
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: body.error.details[0].message,
      });

    const { loaderId, url, field_map: sellsyFieldMap } = body.value;

    const [_, spreadsheetId, sheetId] = url.match(GOOGLE_SHEETS_REGEX);
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

    successResponse(
      res,
      'Started processing leads, please check back after some time'
    );

    let i = 0;
    let leadsToPreview = [];
    let fetchedUserMap = {}; // To store fetched users, so that we do not fetch repeatedly for same one's

    while (i < leads?.length) {
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
        first_name: leadData[sellsyFieldMap?.first_name]?.trim() || null,
        last_name: leadData[sellsyFieldMap?.last_name]?.trim() || null,
        linkedin_url: leadData[sellsyFieldMap?.linkedin_url]?.trim() || null,
        job_position: leadData[sellsyFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          owner_name: '',
          owner_id: leadData[sellsyFieldMap?.sellsy_owner_id]?.trim(),
        },
        Account: {
          name: leadData[sellsyFieldMap?.company_name]?.trim() || null,
          phone_number:
            leadData[sellsyFieldMap?.company_phone_number]?.trim() || null,
          size: leadData[sellsyFieldMap?.size]?.trim() || null,
          url: leadData[sellsyFieldMap?.url]?.trim() || null,
          country: leadData[sellsyFieldMap?.country]?.trim() || null,
          zipcode: leadData[sellsyFieldMap?.zipcode]?.trim() || null,
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
      sellsyFieldMap?.phone_numbers?.forEach((phone_number) => {
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
      sellsyFieldMap?.emails?.forEach((email) => {
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
        LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_COMPANY;
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.owner_id) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.SELLSY_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(SELLSY_CSV_IMPORT_FIELDS.COMPANY_NAME);
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
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead.Account.phone_number &&
        !PHONE_REGEX.test(createdLead.Account.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Owner?.owner_id &&
        !ownerIdRegex.test(createdLead.Owner.owner_id)
      ) {
        logger.error(`Owner id is invalid`);
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.SELLSY_OWNER_ID} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${SELLSY_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
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

      if (createdLead?.Owner?.owner_id) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: createdLead.Owner?.owner_id,
          company_id: req.user.company_id,
          fetchedUserMap,
        });
        if (errFetchingUser) {
          logger.info('Owner not present in cadence tool.');
          createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
          createdLead.is_success = false;
        } else {
          createdLead.Owner.owner_name = user.first_name + ' ' + user.last_name;
          createdLead.user_id = user.user_id;
        }
      }

      if (!createdLead.status)
        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

      createdLead.sr_no = i;
      leadsToPreview.push(createdLead);
    }

    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: leadsToPreview, error: null },
      socketId: loaderId,
    });

    // return successResponse(res, 'Preview lead list.', leadsToPreview);
  } catch (err) {
    logger.error('Error while previewing leads from google sheets: ', {
      err,
      user_id: req.user.user_id,
    });
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while processing leads from google sheets: ${err.message}`,
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

const fetchSellsyContactList = async (req, res) => {
  try {
    const body = sellsyImportSchema.contactListSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    let { order, direction, limit, offset, filters } = body.value;

    let preResults = await Promise.all([
      AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SELLSY,
        user_id: req.user.user_id,
      }),
      SellsyHelper.getFieldMapForCompany(req.user.company_id),
    ]);
    // * Fetch access token token and instance URL
    const [{ access_token }, errForAccessToken] = preResults[0];
    if (errForAccessToken) {
      logger.error('Error while fetching access token: ', errForAccessToken);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please connect with sellsy to import contacts.',
      });
    }
    // * Fetch salesforce field map
    const [sellsyFieldMap, errFetchingSellsyFieldMap] = preResults[1];
    if (errFetchingSellsyFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sellsy contact list',
        error: `Error while fetching Sellsy fieldmap: ${errFetchingSellsyFieldMap}`,
      });
    const sellsyContactMap = sellsyFieldMap.contact_map;

    let fields = ['id', 'owner.id'];
    sellsyContactMap.emails.forEach((email_type) => {
      fields.push(email_type);
    });
    sellsyContactMap.phone_numbers.forEach((phone_type) => {
      fields.push(phone_type);
    });
    fields.push(sellsyContactMap?.first_name);
    fields.push(sellsyContactMap?.last_name);
    fields.push(sellsyContactMap?.job_position);
    fields.push(sellsyContactMap?.linkedin_url);

    // * Fetch account from sellsy
    let [contacts, errForContacts] = await SellsyService.searchContacts({
      access_token: access_token,
      order: order,
      direction: direction,
      limit: limit,
      offset: offset,
      filters: filters,
      fields: fields,
    });
    if (errForContacts) {
      logger.error('Error while searching contacts: ', errForContacts);
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while searching contacts: ${errForContacts}`,
      });
    }

    let i = 0;
    let contactsToPreview = [];
    let userObj = {};

    let contactIds = [];
    contacts.map((contact) => {
      contactIds.push(contact.id);
    });

    let [dbContacts, errFetchingLeads] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        [Op.or]: {
          integration_id: contactIds,
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
      },
    });
    if (errFetchingLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy contact list',
        error: `Error while fetching dbContacts: ${errFetchingLeads}`,
      });

    let companyData = {};
    let companyContactRelation = {};

    while (i <= contacts.length) {
      if (i === contacts.length)
        return successResponse(res, 'Preview contact list.', contactsToPreview);

      let contact = contacts[i];

      let [createdLead, errCreatedLead] = SellsyHelper.mapSellsyField(
        contact,
        sellsyContactMap
      );
      if (errCreatedLead)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch Sellsy contact list',
          error: `Error while encoding lead. ${errCreatedLead}`,
        });

      let isPresent = dbContacts.filter(function (value) {
        return value.integration_id == createdLead.id;
      });

      if (isPresent.length > 0) {
        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        createdLead.lead_id = isPresent[0].lead_id;
        createdLead.cadences = isPresent[0]?.LeadToCadences;
        createdLead.account = isPresent[0]?.Account;
      } else {
        let isPresentContactId = false;
        let companyId;

        for (let key in companyContactRelation) {
          if (companyContactRelation[key].includes(createdLead.id)) {
            isPresentContactId = true;
            companyId = key;
            break;
          }
        }

        if (isPresentContactId) createdLead.account = companyData[companyId];
        else {
          let sellsyCompany, errFetchingSellsyCompany;
          [sellsyCompany, errFetchingSellsyCompany] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.SELLSY,
              integration_data: {
                access_token,
                contact_id: createdLead.id,
              },
            });
          if (errFetchingSellsyCompany) {
            sellsyCompany = null;
            createdLead.account = null;
          }

          logger.info(`For company: ${sellsyCompany?.id}`);

          if (sellsyCompany?.id) {
            let [fieldSchema, errForFieldSchema] =
              SellsyHelper.companyFieldSchema(sellsyFieldMap.company_map);
            if (errForFieldSchema)
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch Sellsy contact list',
                error: `Error while fetching company field schema. ${errForFieldSchema}`,
              });

            let [companyField, errForCompanyField] =
              SellsyHelper.mapSellsyField(sellsyCompany, fieldSchema);
            if (errForCompanyField)
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch Sellsy contact list',
                error: `Error while mapping fields: ${errForCompanyField}`,
              });

            delete companyField.owner;
            createdLead.account = companyField;

            const [companyContactsIds, errFetchingCompanyContacts] =
              await v2GrpcClients.crmIntegration.getContact({
                integration_type: CRM_INTEGRATIONS.SELLSY,
                integration_data: {
                  access_token,
                  company_id: sellsyCompany.id,
                },
              });
            if (errFetchingCompanyContacts)
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch Sellsy contact list',
                error: `Error while fetching company contacts: ${errFetchingCompanyContacts}`,
              });
            companyContactRelation[sellsyCompany.id] = companyContactsIds;
            companyData[sellsyCompany.id] = companyField;
          }
        }

        createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      }

      let user, userErr;

      // Check if user with given sellsy owner id is found
      if (userObj[createdLead.owner]) {
        user = userObj[createdLead.owner];
        createdLead.user_id = user?.user_id;
        createdLead.owner = {
          owner_id: createdLead.owner,
          owner_name: user?.first_name + ' ' + user?.last_name,
        };
      } else {
        [user, userErr] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: createdLead.owner,
            company_id: req.user.company_id,
          },
        });
        if (userErr || user === null) {
          logger.info('Owner not present in our tool.');
          createdLead.status = SELLSY_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
          createdLead.owner = {
            owner_id: createdLead.owner,
            owner_name: null,
          };
          createdLead.account = null;
        } else {
          createdLead.user_id = user.user_id;
          createdLead.owner = {
            owner_id: createdLead.owner,
            owner_name: user.first_name + ' ' + user.last_name,
          };
          userObj[user.integration_id] = user;
        }
      }

      contactsToPreview.push(createdLead);
      i++;
      if (i === contacts.length)
        return successResponse(res, 'Preview contact list.', contactsToPreview);
    }
  } catch (err) {
    logger.error('Error while searching contacts via Sellsy: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while searching contacts via Sellsy: ${err.message}`,
    });
  }
};

// * Import contacts
const importSellsyContacts = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body?.contacts || !req.body?.cadence_id)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, contacts or cadenceId is missing`,
    });
  try {
    // * JOI Validation
    const body = sellsyImportSchema.importSellsyContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Sellsy contacts',
        error: `Error while importing Sellsy contacts: ${body.error.message}`,
      });
    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Sellsy contacts',
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

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: {
          where: {
            cadence_id,
            is_first: 1,
          },
          required: false,
        },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['name'],
        },
        [DB_TABLES.USER]: {
          attributes: ['first_name', 'last_name'],
        },
      },
    });
    if (errForCadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import Sellsy contacts, please try again or contact support',
        error: errForCadence,
      });

    // * Store cadence in Recent cadences
    if (cadence?.cadence_id)
      await Repository.upsert({
        tableName: DB_TABLES.RECENT_ACTION,
        upsertObject: {
          user_id: req.user.user_id,
          cadence_id: cadence?.cadence_id,
        },
      });
    else
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import Sellsy contacts, please try again or contact support',
        error: 'Cadence not found',
      });

    const node = cadence.Nodes?.[0];

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
              id: r[1].integration_id,
              sr_no: r[1]?.sr_no,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              id: r[0].integration_id,
              sr_no: r[0]?.sr_no,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
              msg: r[0]?.msg,
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
      lead.integration_id = lead.id?.toString();
      lead.cadence_id = cadence_id;
      if (lead?.account?.id)
        lead.account.integration_id = lead.account.id?.toString();

      logger.info(`For lead: ${lead.id}`);

      // * Validate lead integration_id
      if (!lead.id) {
        logger.info('Sellsy contact id not present');
        response.element_error.push({
          id: null,
          sr_no: lead?.sr_no,
          cadence_id: lead.cadence_id,
          msg: 'Contact id not present',
        });
        response.total_error++;
        i++;
        continue;
      }

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.owner.owner_id,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          id: lead.integration_id,
          sr_no: lead?.sr_no,
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
          id: lead.integration_id,
          sr_no: lead?.sr_no,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createContactFromSellsy({
          lead,
          cadence,
          node,
          company_id: user.company_id,
        })
      );
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg;
        if (r[1].error.includes('must be unique'))
          msg = 'Contact present in cadence tool';
        else msg = r[1].error;
        response.element_error.push({
          id: r[1].integration_id,
          sr_no: r[1]?.sr_no,
          cadence_id,
          msg,
        });
        response.total_error++;

        continue;
      } else {
        response.element_success.push({
          id: r[0].integration_id,
          sr_no: r[0]?.sr_no,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
          msg: r[0]?.msg,
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
      `An error ocurred while trying to create contacts in tool from Sellsy: `,
      { err, user_id: req.user.user_id }
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing contacts for sellsy: ${err.message}`,
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

const linkContactWithCadence = async (req, res) => {
  let loaderId = req.body?.loaderId;
  let websocket = req.body?.websocket || true;
  try {
    // * JOI Validation
    const body = sellsyImportSchema.importSellsyContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to link contact with cadence',
        error: body.error.message,
      });

    // * Destructure request
    const {
      contacts,
      cadence_id,
      stopPreviousCadences,
      loaderId,
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
    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: {
          where: {
            cadence_id,
            is_first: 1,
          },
          required: false,
        },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['name'],
        },
        [DB_TABLES.USER]: {
          attributes: ['first_name', 'last_name'],
        },
      },
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching cadence: ${errForCadence.message}`,
        msg: 'Failed to link contact with cadence',
        include: {
          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: ['name'],
          },
          [DB_TABLES.USER]: {
            attributes: ['first_name', 'last_name'],
          },
        },
      });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
      });

    let node = cadence.Nodes?.[0];

    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started importing contact, please check back after some time'
      );

    for (let lead of contacts) {
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch + 1,
          size: contacts.length,
        },
        socketId: loaderId,
      });
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              sr_no: r[1]?.sr_no,
              id: r[1].integration_id,
              cadence_id,
              msg,
              type: r[1].type,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              sr_no: r[0]?.sr_no,
              id: r[0].integration_id,
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
      lead.integration_id = lead.id;
      lead.cadence_id = cadence_id;

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.Id}`);

      promiseArray.push(
        LeadHelper.linkSellsyLeadWithCadence({
          lead_id: lead.lead_id,
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
          sr_no: lead.sr_no,
        })
      );
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          sr_no: r[1]?.sr_no,
          id: r[1].integration_id,
          cadence_id,
          msg,
          type: r[1].type,
        });
        response.total_error++;
        continue;
      } else {
        response.element_success.push({
          sr_no: r[0]?.sr_no,
          id: r[0].integration_id,
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
    else
      return successResponse(
        res,
        'Leads have been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking contact to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking contacts for sellsy: ${err.message}`,
      });
    if (websocket)
      return SocketHelper.sendCadenceImportResponseEvent({
        response_data: {
          leads: [],
          error: `An error occurred, please try again later or contact support`,
        },
        socketId: loaderId,
      });
    else
      return serverErrorResponseWithDevMsg({
        res,
        msg: `An error occurred, please try again later or contact support`,
        error: `Error while linking sellsy contacts: ${err.message}`,
      });
  }
};

// * Import Temp contacts
const importSellsyTempContacts = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body?.contacts || !req.body?.cadence_id)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, contacts or cadenceId is missing`,
    });
  try {
    // * JOI Validation
    const body = sellsyImportSchema.importSellsyContactSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for Sellsy',
        error: `Error while creating contact in tool: ${body.error.message}`,
      });

    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for Sellsy',
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
    let [{ cadence, node }, errFetchingPreImportData] =
      await ImportHelper.preImportData({
        user_id: req.user.user_id,
        cadence_id,
        integration_type: CRM_INTEGRATIONS.SELLSY,
      });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for Sellsy',
        error: errFetchingPreImportData,
      });

    // * Send success response indicating processing has been started
    successResponse(
      res,
      'Started importing contacts, please check back after some time'
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
              contact_preview_id: r[1].preview_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              contact_preview_id: r[0].preview_id,
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
      lead.preview_id = lead.sr_no;
      lead.cadence_id = cadence_id;

      //* Company name check
      if (!lead?.Account?.name) {
        logger.info('Sellsy company name is not present');
        i++;
        response.element_error.push({
          contact_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Sellsy company name not present',
        });
        response.total_error++;
        continue;
      }

      // Check if user with given sellsy owner id is found
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.owner_id,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        logger.info('Owner not present in cadence tool.');
        response.element_error.push({
          contact_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Owner id not present in cadence tool',
        });
        response.total_error++;
        i++;
        continue;
      }

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          contact_preview_id: lead.preview_id,
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
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          contact_preview_id: r[1].preview_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        continue;
      } else {
        response.element_success.push({
          contact_preview_id: r[0].preview_id,
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
      `An error ocurred while trying to create contacts in tool for Sellsy: `,
      { err, user_id: req.user.user_id }
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing leads for sellsy: ${err.message}`,
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

const SellsyImportController = {
  getCSVColumns,
  getSheetsColumns,
  previewContactsForCSVImport,
  previewLeadsViaCSV,
  previewLeadsViaSheets,
  fetchSellsyContactList,
  linkContactWithCadence,
  importSellsyTempContacts,
  importSellsyContacts,
};

module.exports = SellsyImportController;
