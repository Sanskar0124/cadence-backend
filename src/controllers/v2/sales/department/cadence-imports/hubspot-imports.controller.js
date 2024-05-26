// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../../utils/response');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../../../Cadence-Brain/src/utils/constants');
const {
  CADENCE_LEAD_STATUS,
  CADENCE_STATUS,
  CADENCE_TYPES,
  HUBSPOT_CONTACT_IMPORT_STATUS,
  HUBSPOT_CSV_IMPORT_FIELDS,
  CRM_INTEGRATIONS,
  LEAD_STATUS,
  IMPORT_ERROR_TYPE,
  HUBSPOT_IMPORT_SOURCE,
  LEAD_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  USER_INTEGRATION_TYPES,
  HUBSPOT_CSV_GS_IMPORT_FIELDS,
  SALESFORCE_LEAD_IMPORT_STATUS,
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

const csv = require('fast-csv');
const { Op } = require('sequelize');
const {
  sequelize,
} = require('../../../../../../../Cadence-Brain/src/db/models');
const xlsx = require('xlsx');

// * Repository Imports
const Repository = require('../../../../../../../Cadence-Brain/src/repository');
const LeadToCadenceRepository = require('../../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const LeadRepository = require('../../../../../../../Cadence-Brain/src/repository/lead.repository');
const NodeRepository = require('../../../../../../../Cadence-Brain/src/repository/node.repository');

// * Helper Imports
const GoogleSheets = require('../../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');
const HubspotHelper = require('../../../../../../../Cadence-Brain/src/helper/hubspot');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const SocketHelper = require('../../../../../../../Cadence-Brain/src/helper/socket');
const TaskHelper = require('../../../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const CadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/cadence');
const LeadsToCadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ImportHelper = require('../../../../../../../Cadence-Brain/src/helper/imports');
const HubspotService = require('../../../../../../../Cadence-Brain/src/services/Hubspot');
const ExcelHelper = require('../../../../../../../Cadence-Brain/src/helper/excel');

// * Joi
const hubspotImportSchema = require('../../../../../joi/v2/sales/department/cadence-imports/hubspot-imports.joi');

// * gRPC
const v2GrpcClients = require('../../../../../../../Cadence-Brain/src/grpc/v2');

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
    const body = hubspotImportSchema.fetchSheetsColumnsSchema.validate(
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

const previewHubspotContactsViaCSV = async (req, res) => {
  try {
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    // * JOI Validation
    const body = hubspotImportSchema.contactsPreviewSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    let { loaderId, field_map } = body.value;
    let contacts = [];
    // * Fetch hubspot field map
    let [hubspotFieldMap, errFetchingHubspotFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errFetchingHubspotFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Hubspot contacts via CSV',
        error: `Error while fetching fieldmap for company from user: ${errFetchingHubspotFieldMap}`,
      });

    const ownerIdRegex = /^\d+$/;
    csv
      .parseFile(req.file.path)
      .on('data', (data) => {
        let contact = {
          id: data[field_map.record_id]?.trim(),
          first_name: data[field_map.first_name]?.trim(),
          last_name: data[field_map.last_name]?.trim(),
          linkedin_url: data[field_map.linkedin_url]?.trim(),
          job_position: data[field_map.job_position]?.trim(),
          owner: data[field_map.owner]?.trim(),
          integration_status: data[field_map.integration_status]?.trim(),
          phone_numbers: [],
          emails: [],
          Account: {
            name: data[field_map.company_name]?.trim(),
            url: data[field_map.url]?.trim(),
            phone_number: data[field_map.account_phone_number]?.trim(),
            size: data[field_map.size]?.trim(),
            linkedin_url: data[field_map.account_linkedin_url]?.trim(),
            country: data[field_map.country]?.trim(),
            zipcode: data[field_map.zipcode]?.trim() ?? null,
            integration_id: data[field_map.company_id]?.trim(),
          },
          company_id: data[field_map.company_id]?.trim(),
        };

        // * Process phone
        let errMsg = '';
        if (field_map.phone_numbers) {
          let phone_numbers = JSON.parse(field_map.phone_numbers);
          phone_numbers?.elements?.forEach((phone) => {
            if (data[phone.column_index]) {
              if (!PHONE_REGEX.test(data[phone.column_index]?.trim())) {
                errMsg = `${errMsg} ,${phone.type} number is invalid`;
              }
            }
            contact.phone_numbers.push({
              type: phone.type,
              phone_number: data[phone.column_index]?.trim() ?? '',
            });
          });
        }

        // * Process email
        if (field_map.emails) {
          let emails = JSON.parse(field_map.emails);
          emails?.elements?.forEach((email) => {
            if (data[email.column_index]) {
              if (!EMAIL_REGEX.test(data[email.column_index]?.trim())) {
                errMsg = `${errMsg} ,${email.type} is invalid`;
              }
            }
            contact.emails.push({
              type: email.type,
              email_id: data[email.column_index]?.trim(),
            });
          });
        }
        if (errMsg.length) contact.status = errMsg.slice(2);

        contacts.push(contact);
      })
      .on('error', async (error) => {
        logger.error('Unable to process CSV', error);
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to import Hubspot contact via csv',
          error: `Error while processing CSV: ${error.message}`,
        });
      })
      .on('end', async () => {
        contacts.shift();

        contacts = contacts.slice(0, 500);

        let contactIds = [];
        contacts.map((contact) => {
          contactIds.push(contact.id);
        });

        // * Query database to find existing links from integration id
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
          },
        });
        if (errFetchingLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching contacts: ${errFetchingLeads}`,
          });
        successResponse(
          res,
          'Started importing, please check back after some time'
        );
        let userMap = {};
        let i = 0;
        let finalContacts = [];
        for (let contact of contacts) {
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: ++i,
              size: contacts.length,
            },
            socketId: loaderId,
          });

          // Checking for empty row
          const isEmptyRow = Object.keys(contact).every((key) => {
            const value = contact[key];

            if (Array.isArray(value)) {
              return value.length === 0; // Check for an empty array
            } else if (typeof value === 'object' && value !== null) {
              return Object.values(value).join('').length === 0; // Check for an empty object
            } else {
              return value === null || value === ''; // Check for null or empty string
            }
          });
          if (isEmptyRow) continue;

          // assign integration to created lead
          contact.integration_type = LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT;
          contact.Account.integration_type =
            ACCOUNT_INTEGRATION_TYPES.HUBSPOT_COMPANY;
          contact.is_success = true; // for error handling
          let missingFields = [];

          // Checking data of required fields
          if (!contact?.first_name) {
            logger.info(`first name not present in hubspot csv.`);
            missingFields.push(HUBSPOT_CSV_IMPORT_FIELDS.FIRST_NAME);
            contact.is_success = false;
          }
          if (!contact?.last_name) {
            logger.info(`last name not present in hubspot csv.`);
            missingFields.push(HUBSPOT_CSV_IMPORT_FIELDS.LAST_NAME);
            contact.is_success = false;
          }
          if (!contact?.owner) {
            logger.info(`Owner not present in hubspot csv.`);
            missingFields.push(HUBSPOT_CSV_IMPORT_FIELDS.CONTACT_OWNER);
            contact.is_success = false;
          }
          if (!contact?.id) {
            logger.info(`Record Id not present in hubspot csv.`);
            missingFields.push(HUBSPOT_CSV_IMPORT_FIELDS.RECORD_ID);
            contact.is_success = false;
          }

          if (!missingFields?.length) {
            // field format validation
            if (
              contact?.linkedin_url &&
              !LINKEDIN_REGEX.test(contact.linkedin_url)
            ) {
              logger.error(`Linkedin url is invalid`);
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
              contact.is_success = false;
            } else if (
              contact?.Account?.url &&
              !WEBSITE_URL_REGEX.test(contact?.Account?.url)
            ) {
              logger.error(`Company website url is invalid`);
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.WEBSITE_URL} is invalid`;
              contact.is_success = false;
            } else if (contact?.id && !ownerIdRegex.test(contact?.id)) {
              logger.error(`Record Id is invalid`);
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.RECORD_ID} is invalid`;
              contact.is_success = false;
            } else if (
              contact?.company_id &&
              !ownerIdRegex.test(contact?.company_id)
            ) {
              logger.error(`Record Id is invalid`);
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.ASSOCIATED_COMPANY_ID} is invalid`;
              contact.is_success = false;
            }
            // fields length limit validations
            else if (contact?.owner?.length > 100) {
              logger.error(`Owner name can't be more than 100 characters`);
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.Owner} can't be more than 100 characters`;
              contact.is_success = false;
            } else if (contact?.first_name?.length > 50) {
              logger.error("First name can't be more than 50 characters");
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
              contact.is_success = false;
            } else if (contact?.last_name?.length > 75) {
              logger.error("Last name can't be more than 75 characters");
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
              contact.is_success = false;
            } else if (contact?.job_position?.length > 50) {
              logger.error("Job title can't be more than 50 characters");
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.JOB_TITLE} can't be more than 50 characters`;
              contact.is_success = false;
            } else if (contact?.Account?.name?.length > 200) {
              logger.error("Company name can't be more than 200 characters");
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
              contact.is_success = false;
            } else if (contact?.Account?.country?.length > 100) {
              logger.error("Country name can't be more than 100 characters");
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
              contact.is_success = false;
            } else if (contact?.Account?.zipcode?.length > 10) {
              logger.error("Zipcode can't be more than 10 characters");
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
              contact.is_success = false;
            } else if (contact?.Account?.size?.length > 25) {
              logger.error("Company size can't be more than 25 characters");
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
              contact.is_success = false;
            } else if (contact?.integration_status > 100) {
              logger.error(
                `Integration status can't be more than 100 characters`
              );
              contact.status = `${HUBSPOT_CSV_IMPORT_FIELDS.INTEGRATION_STATUS} can't be more than 100 characters`;
              contact.is_success = false;
            }
          } else {
            contact.status = missingFields
              .join(', ')
              .concat(' should be present');
          }

          let errMsg = [];
          let isPhoneErr = false;
          hubspotFieldMap?.phone_numbers?.forEach((phone_number) => {
            let phoneNumber =
              leadData[phone_number.column_name]?.trim() || null;
            if (phoneNumber && !PHONE_REGEX.test(phoneNumber)) {
              errMsg.push(phone_number.column_name);

              isPhoneErr = true;
            } else
              contact.phone_numbers.push({
                phone_number: phoneNumber,
                type: phone_number.type,
              });
          });
          if (isPhoneErr && !contact?.status?.length) {
            contact.status = errMsg.join(', ').concat(' should be valid');
            contact.is_success = false;
          }

          let emailErr = false;
          hubspotFieldMap?.emails?.forEach((email) => {
            let emailId = leadData[email.column_name]?.trim() || null;
            if (emailId && !EMAIL_REGEX.test(emailId)) {
              errMsg.push(email.column_name);
              emailErr = true;
            } else
              contact.emails.push({
                email_id: leadData[email.column_name]?.trim() || null,
                type: email.type,
              });
          });
          if (emailErr && !contact?.status?.length) {
            contact.status = errMsg.join(', ').concat(' should be valid');
            contact.is_success = false;
          }
          let isUserPresentInDB = false;

          if (!(contact.owner in userMap)) {
            let [user, errFetchingUser] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                [Op.and]: [
                  sequelize.where(
                    sequelize.fn('lower', sequelize.col('first_name')),
                    contact?.owner?.toLowerCase()?.split(' ')[0] ?? ''
                  ),
                  sequelize.where(
                    sequelize.fn('lower', sequelize.col('last_name')),
                    contact?.owner?.toLowerCase()?.split(' ')[1] ?? ''
                  ),
                ],
                company_id: req.user.company_id,
              },
            });
            if (errFetchingUser) continue;
            if (!user) {
              userMap[contact.OwnerId] = false;
              isUserPresentInDB = false;
            } else if (
              !contact?.owner?.split(' ')[0] ||
              !contact?.owner?.split(' ')[1]
            ) {
              userMap[contact.OwnerId] = false;
              isUserPresentInDB = false;
            } else {
              userMap[contact.OwnerId] = true;
              isUserPresentInDB = true;
              contact.Owner = {
                Name: `${user.first_name} ${user.last_name}`,
                OwnerId: user.integration_id,
              };
            }
          } else isUserPresentInDB = userMap[contact.OwnerId];

          if (!isUserPresentInDB) {
            contact.status = HUBSPOT_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
            finalContacts.push(contact);
            continue;
          }

          var isPresent = dbContacts.filter(function (value) {
            return value.integration_id == contact.id;
          });

          if (isPresent.length > 0) {
            contact.status = HUBSPOT_CONTACT_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
            contact.lead_id = isPresent[0].lead_id;
            contact.cadences = isPresent[0]?.LeadToCadences;
          } else if (!contact?.status?.length)
            contact.status = HUBSPOT_CONTACT_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

          if (!contact.Account.name) contact.Account = null;

          finalContacts.push(contact);
        }
        SocketHelper.sendCadenceImportResponseEvent({
          response_data: { contacts: finalContacts, error: null },
          socketId: loaderId,
        });
      });
  } catch (err) {
    logger.error(`Error ocurred while importing contacts for hubspot: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing contacts from hubspot: ${err.message}`,
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

// * Import Temp contacts
const importHubspotTempContacts = async (req, res) => {
  try {
    // * JOI Validation
    const body = hubspotImportSchema.importHubspotContactSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for integrations Hubspot',
        error: `Error while creating contact in tool: ${body.error.message}`,
      });

    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for integration Hubspot',
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
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
      });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create contacts in tool for integration Hubspot',
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
      lead.preview_id = lead.id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead with preview id: ${lead.id}`);

      //* Company name check
      if (!lead?.Account?.name) {
        logger.info('Hubspot company name is not present');
        i++;
        response.element_error.push({
          contact_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Hubspot company name not present',
        });
        response.total_error++;
        continue;
      }

      // Check if user with given hubspot owner id is found
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
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

      // * Deletes hubspot owner id from the lead object and add user id
      delete lead.hubspot_owner_id;
      lead.user_id = user.user_id;

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
      `An error ocurred while trying to create contacts in tool for integration Hubspot: `,
      { err, user_id: req.user.user_id }
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating contact in tool for integration Hubspot: ${err.message}`,
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

const addHubspotContactsViaCSV = async (req, res) => {
  try {
    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = req.body;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to add Hubspot contacts via csv',
        error: 'Contacts array is empty',
      });
    if (leads.length > 500)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'More than 500 contacts cannot be imported together',
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
      integration_type: CRM_INTEGRATIONS.HUBSPOT,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to add Hubspot contacts via csv',
        error: errFetchingPreImportData,
      });

    let hubspotContactMap = companyFieldMap.contact_map;
    let hubspotAccountMap = companyFieldMap.company_map;

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
      lead.integration_id = lead.id;
      lead.cadence_id = cadence_id;
      // * Ensure status is correct
      if (lead.status === HUBSPOT_CONTACT_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL) {
        logger.info('Hubspot contact present in tool.');
        response.element_error.push({
          id: null,
          cadence_id,
          msg: 'Hubspot contact present in tool.',
        });
        response.total_error++;
        i++;
        continue;
      }

      // * Validate owner
      if (lead.owner === '' || !lead.Owner) {
        logger.info('No contact owner present.');
        response.element_error.push({
          id: lead.id,
          cadence_id,
          msg: 'No contact owner present.',
        });
        response.total_error++;
        i++;
        continue;
      }

      // * Validate lead integration_id
      if (lead.id === null || lead.id === undefined || lead.id === '') {
        logger.info('Hubspot contact id not present');
        response.element_error.push({
          id: null,
          cadence_id,
          msg: 'Hubspot contact id not present',
        });
        response.total_error++;
        i++;
        continue;
      }

      // * Phone validation
      let phone_number = [];
      hubspotContactMap?.phone_numbers.forEach((phone_type) => {
        let pn = lead?.phone_numbers?.find((p) => p?.type === phone_type);
        phone_number.push({ phone_number: pn?.phone_number, type: phone_type });
      });
      lead.phone_number = phone_number;

      // * Email validation
      let emails = [];
      hubspotContactMap?.emails.forEach((email_field) => {
        let em = lead?.emails?.find((e) => e?.type === email_field);
        emails.push({ email_id: em?.email_id, type: email_field });
      });
      lead.emails = emails;

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          integration_id: lead.id,
          cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        continue;
      }

      // Add user id to lead
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          integration_id: lead.id,
          cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createContactFromHubspotCSV({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
          companyFieldMap,
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

    // * Send success response with socket
    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(`Error ocurred while adding contacts for hubspot: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while adding contacts for hubspot: ${err.message}`,
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

const linkHubspotContactsViaCSV = async (req, res) => {
  try {
    // * JOI Validation
    const body = hubspotImportSchema.importHubspotContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const {
      contacts: leads,
      cadence_id,
      loaderId,
      stopPreviousCadences,
      websocket = true,
    } = req.body;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to link Hubspot contact via CSV',
        error: 'Contacts array is empty',
      });

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
      integration_type: CRM_INTEGRATIONS.HUBSPOT,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Unable to import leads',
        error: errFetchingPreImportData,
      });

    // * Send success response indicating processing has been started
    if (websocket)
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
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
              type: r[1].type,
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

      if (!lead.lead_id) {
        logger.error(`Lead id not present.`);
        i++;
        continue;
      }

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.id}`);

      promiseArray.push(
        LeadHelper.linkHubspotLeadWithCadenceCSV({
          lead_id: lead.lead_id,
          integration_id: lead.id,
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
          type: r[1].type,
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

    // * Send success response with socket
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else
      successResponse(res, 'Leads have been proccessed successfully', response);
  } catch (err) {
    logger.error(`Error ocurred while links contacts for hubspot: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking contacts for hubspot: ${err.message}`,
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

const fetchHubspotImportContacts = async (req, res) => {
  try {
    const [contacts, errForContacts] = await Repository.fetchAll({
      tableName: DB_TABLES.HUBSPOT_IMPORTS,
      query: { company_id: req.user.company_id },
    });
    if (errForContacts)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import contacts from Hubspot',
        error: `Error while fetching contacts: ${errForContacts}`,
      });
    if (contacts.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch contacts to import from Hubspot',
        error: 'No contacts present',
      });

    return successResponse(res, 'Contacts fetched successfully.', contacts);
  } catch (err) {
    logger.error(
      `Error ocurred while fetching import contacts for hubspot: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching import contacts for hubspot: ${err.message}`,
    });
  }
};

const addHubspotContactsViaWebhook = async (req, res) => {
  try {
    const { contacts: leads, cadence_id, loaderId } = req.body;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to add Hubspot contacts via webhook',
        error: 'Contacts array is empty',
      });
    let i = 0;

    // * Response object
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };

    // * to store fetched cadences and nodes, so that we do not fetch repeatedly for same one's
    let fetchedCadences = {};
    let fetchedNodes = {};
    let fetchedCadenceUserOrder = {};

    while (i <= leads.length) {
      if (i === leads.length)
        return successResponse(res, 'Contacts have been processed.', response);

      let lead = leads[i];
      let hubspot_import_id = lead.hubspot_import_id;

      if (lead.status === HUBSPOT_CONTACT_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL) {
        logger.info('Hubspot contact present in tool.');
        response.element_error.push({
          id: lead.contact_id,
          cadence_id,
          msg: 'Hubspot contact present in tool.',
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

      if (lead.contact.owner === '' || !lead.contact.owner) {
        logger.info('No contact owner present.');
        response.element_error.push({
          id: lead.contact_id,
          cadence_id: cadence_id,
          msg: 'No contact owner present.',
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

      lead.integration_id = lead.contact_id;
      lead.contact.integration_id = lead.contact_id;
      lead.cadence_id = cadence_id;
      lead.contact.cadence_id = cadence_id;

      logger.info(`For lead: ${lead.id}`);
      if (
        lead.integration_id === null ||
        lead.integration_id === undefined ||
        lead.integration_id === ''
      ) {
        logger.info('Hubspot contact id not present');
        response.element_error.push({
          id: lead.contact_id,
          cadence_id: lead.cadence_id,
          msg: 'Hubspot contact id not present',
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

      // Check if user with given hubspot owner id is found
      const [user, userErr] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { integration_id: lead.contact.owner.integration_id },
      });
      if (userErr || user === null) {
        logger.info('Owner not present in cadence tool.');
        response.element_error.push({
          id: lead.contact_id,
          cadence_id: lead.cadence_id,
          msg: 'Owner id not present in cadence tool',
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

      // Add user id to lead
      lead.user_id = user.user_id;
      lead.contact.user_id = user.user_id;

      let cadence,
        errForCadence,
        node,
        errForNode = null;

      // * see if cadence is already fetched
      if (fetchedCadences[lead.cadence_id]) {
        cadence = fetchedCadences[lead.cadence_id];

        // Check if the user has access to the cadence
        if (
          (cadence.type === CADENCE_TYPES.PERSONAL &&
            cadence.user_id !== user.user_id) ||
          // (cadence.type === CADENCE_TYPES.TEAM &&
          //   cadence.sd_id !== user.sd_id) ||
          (cadence.type === CADENCE_TYPES.COMPANY &&
            cadence.company_id !== user.company_id)
        ) {
          logger.info('User not part of the cadence.');
          response.element_error.push({
            id: lead.contact_id,
            cadence_id: lead.cadence_id,
            msg: 'This user does not have access to this cadence.',
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

        lead.cadenceStatus = cadence?.status;
        lead.contact.cadenceStatus = cadence?.status;
      } else {
        [cadence, errForCadence] = await Repository.fetchOne({
          tableName: DB_TABLES.CADENCE,
          query: { cadence_id: lead.cadence_id },
        });
        if (!cadence) {
          logger.info('Cadence not present.');
          response.element_error.push({
            id: lead.contact_id,
            cadence_id: lead.cadence_id,
            msg: 'Cadence does not exist in cadence tool.',
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

        // Check if the user has access to the cadence
        if (
          (cadence.type === CADENCE_TYPES.PERSONAL &&
            cadence.user_id !== user.user_id) ||
          // (cadence.type === CADENCE_TYPES.TEAM &&
          //   cadence.sd_id !== user.sd_id) ||
          (cadence.type === CADENCE_TYPES.COMPANY &&
            cadence.company_id !== user.company_id)
        ) {
          logger.info('User not part of the cadence.');
          response.element_error.push({
            id: lead.contact_id,
            cadence_id: lead.cadence_id,
            msg: 'This user does not have access to this cadence.',
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

        fetchedCadences[lead.cadence_id] = cadence;
        lead.cadenceStatus = cadence?.status;
        lead.contact.cadenceStatus = cadence?.status;

        fetchedCadenceUserOrder[lead.cadence_id] = {};
      }

      // * If entry of lead_cadence_order for user in cadence exists, use it
      if (fetchedCadences[lead.cadence_id][lead.user_id]) {
        // * append leadCadenceOrder to lead
        lead.leadCadenceOrder =
          fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id];
        lead.contact.leadCadenceOrder =
          fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id];

        // * increment leadCadenceOrderForCadence for current lead's cadence
        fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id]++;
      } else {
        // * fetch last lead number for user in cadence
        let [
          lastLeadToCadenceForUserInCadence,
          errForLastLeadToCadenceForUserInCadence,
        ] = await LeadToCadenceRepository.getLastLeadToCadenceByLeadQuery(
          {
            cadence_id: lead.cadence_id,
            lead_cadence_order: {
              [Op.lt]: LEAD_CADENCE_ORDER_MAX,
            },
          }, // * lead_cadence_query
          { user_id: lead.user_id } // * lead_query
        );

        lastLeadToCadenceForUserInCadence =
          lastLeadToCadenceForUserInCadence?.[0];

        // * If last link exists, use its leadCadenceOrder
        if (lastLeadToCadenceForUserInCadence)
          fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id] =
            (lastLeadToCadenceForUserInCadence?.lead_cadence_order || 0) + 1;
        // * If it does not exists, initialiaze it to 1
        else fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id] = 1;

        // * append leadCadenceOrder to lead
        lead.leadCadenceOrder =
          fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id];
        lead.contact.leadCadenceOrder =
          fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id];

        // * increment leadCadenceOrder by 1 after assigning to lead is over
        fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id]++;
      }

      let t = await sequelize.transaction();

      let [createdLead, err] = await HubspotHelper.createContactWebhook(
        lead.contact,
        user.company_id,
        t
      );
      if (err) {
        t.rollback();
        let msg;
        if (err.includes('must be unique'))
          msg = 'Contact present in cadence tool';
        else msg = err;
        response.element_error.push({
          id: lead.contact_id,
          cadence_id: lead.cadence_id,
          msg,
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
        fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id]--;
        continue;
      }

      createdLead = createdLead.createdLead;

      if (createdLead) {
        await Repository.destroy({
          tableName: DB_TABLES.HUBSPOT_IMPORTS,
          query: { hubspot_import_id },
        });
      }

      t.commit();

      if (!errForCadence && cadence) {
        // * cadence found, check for its status
        if (cadence?.status === CADENCE_STATUS.IN_PROGRESS) {
          // * see if node is already fetched
          if (fetchedNodes[lead.cadence_id])
            node = fetchedNodes[lead.cadence_id];
          // * cadence is in progress, start cadence for this lead
          else {
            [node, errForNode] = await NodeRepository.getNode({
              cadence_id: lead.cadence_id,
              is_first: 1,
            });
            fetchedNodes[lead.cadence_id] = node;
          }
          if (!errForNode && node) {
            const [taskCreated, errForTaskCreated] =
              await CadenceHelper.launchCadenceForLead(
                createdLead,
                lead.cadence_id,
                node,
                req.user.user_id,
                true
              );
            /*
             * recalculating after each task created,
             * since it is possible that we get many contacts at once in this route
             * In that case tasks wont show up if we calculate after every contact is created
             * */
            if (taskCreated)
              TaskHelper.recalculateDailyTasksForUsers([createdLead.user_id]);
          }
        }
      }

      response.element_success.push({
        id: lead.contact_id,
        cadence_id: lead.cadence_id,
        identifier: createdLead.lead_cadence_id,
        lead_id: createdLead.lead_id,
      });
      response.total_success++;
      i++;
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: i,
          size: leads.length,
        },
        socketId: loaderId,
      });

      if (i === leads.length)
        return successResponse(res, 'Contacts have been processed.', response);
    }
  } catch (err) {
    logger.error(`Error ocurred while adding contacts for hubspot: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding contacts for Hubspot: ${err.message}`,
    });
  }
};

const linkHubspotContactsViaWebhook = async (req, res) => {
  try {
    // * JOI Validation
    const body = hubspotImportSchema.importHubspotContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    const { contacts, cadence_id, loaderId, stopPreviousCadences } = req.body;
    if (contacts === undefined || contacts.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to link Hubspot contacts via webhook',
        error: 'Contacts array is empty.',
      });
    let i = 0;

    // * Response object
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to link Hubspot contacts via webhook',
        error: 'Cadence does not exist',
      });

    while (i <= contacts.length) {
      if (i === contacts.length) break;
      let leadObj = contacts[i];
      let hubspot_import_id = leadObj.hubspot_import_id;

      leadObj.cadence_id = cadence_id;
      leadObj.contact.cadence_id = cadence_id;
      logger.info(`Processing link for ${leadObj.lead_id}`);

      if (!leadObj.lead_id) {
        logger.error(`Lead id not present.`);
        i++;
        continue;
      }

      const [lead, err] = await LeadRepository.getLeadByQuery({
        lead_id: leadObj.lead_id,
      });
      if (err) {
        logger.error(`Error while fetching lead: ${leadObj.lead_id}`);
        i++;
        continue;
      }

      if (!lead) {
        response.element_error.push({
          id: leadObj.contact_id,
          cadence_id,
          msg: 'Contact does not exist in cadence.',
        });
        response.total_error++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: contacts.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Stop all cadences of lead
      if (stopPreviousCadences) {
        // * Fetch cadences to
        let cadence_ids = [];

        for (let leadToCadence of lead.LeadToCadences) {
          if (leadToCadence.cadence_id !== cadence_id)
            cadence_ids.push(leadToCadence.cadence_id);
        }

        await LeadHelper.stopCadenceForLead(lead, cadence_ids, req.user);
      }

      // Lead and cadence both are present
      // Check if user with given hubspot owner id is found
      let [user, userErr] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { user_id: lead.user_id },
      });

      // Check if the user has access to the cadence
      if (
        (cadence.type === CADENCE_TYPES.PERSONAL &&
          cadence.user_id !== user.user_id) ||
        // (cadence.type === CADENCE_TYPES.TEAM && cadence.sd_id !== user.sd_id) ||
        (cadence.type === CADENCE_TYPES.COMPANY &&
          cadence.company_id !== user.company_id)
      ) {
        logger.info('User not part of the cadence.');
        response.element_error.push({
          id: lead.id,
          cadence_id: lead.cadence_id,
          msg: 'This user does not have access to this cadence.',
        });
        response.total_error++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: contacts.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      const [link, errForGetLink] = await Repository.fetchAll({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { lead_id: leadObj.lead_id, cadence_id: leadObj.cadence_id },
      });

      // Link does not exist
      if (link.length === 0) {
        let [unsubscribed, ___] = await LeadHelper.hasLeadUnsubscribed(
          lead.lead_id
        );

        let lead_cadence_order = 0;

        // * fetch last lead number for user in cadence
        let [
          lastLeadToCadenceForUserInCadence,
          errForLastLeadToCadenceForUserInCadence,
        ] = await LeadToCadenceRepository.getLastLeadToCadenceByLeadQuery(
          {
            cadence_id: leadObj.cadence_id,
            lead_cadence_order: {
              [Op.lt]: LEAD_CADENCE_ORDER_MAX,
            },
          }, // * lead_cadence_query
          { user_id: lead?.user_id } // * lead_query
        );

        lastLeadToCadenceForUserInCadence =
          lastLeadToCadenceForUserInCadence?.[0];

        // * If last link exists, use its leadCadenceOrder
        if (lastLeadToCadenceForUserInCadence)
          lead_cadence_order =
            (lastLeadToCadenceForUserInCadence?.lead_cadence_order || 0) + 1;
        // * If it does not exists, initialize it to 1
        else lead_cadence_order = 1;

        const [createdLink, errForLink] =
          await LeadToCadenceRepository.createLeadToCadenceLink({
            lead_id: lead.lead_id,
            cadence_id: leadObj.cadence_id,
            status:
              lead.status === LEAD_STATUS.CONVERTED ||
              lead.status === LEAD_STATUS.TRASH
                ? CADENCE_LEAD_STATUS.STOPPED
                : cadence.status === CADENCE_STATUS.IN_PROGRESS
                ? CADENCE_LEAD_STATUS.IN_PROGRESS
                : CADENCE_STATUS.NOT_STARTED,
            unsubscribed: unsubscribed ?? false,
            lead_cadence_order,
          });
        if (errForLink) {
          response.element_error.push({
            id: leadObj.contact_id,
            cadence_id: leadObj.cadence_id,
            msg: errForLink,
          });
          response.total_error++;
          i++;
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: i,
              size: contacts.length,
            },
            socketId: loaderId,
          });
          continue;
        }

        await Repository.destroy({
          tableName: DB_TABLES.HUBSPOT_IMPORTS,
          query: { hubspot_import_id },
        });

        if (cadence.status === CADENCE_LEAD_STATUS.IN_PROGRESS) {
          const [tasks, errForTask] = await Repository.fetchAll({
            tableName: DB_TABLES.TASK,
            query: {
              lead_id: lead.lead_id,
              cadence_id: leadObj.cadence_id,
            },
          });

          if (!errForTask && tasks.length === 0) {
            const [node, errForNode] = await Repository.fetchOne({
              tableName: DB_TABLES.NODE,
              query: {
                cadence_id: cadence.cadence_id,
                is_first: 1,
              },
            });

            if (!errForNode && node) {
              const [taskCreated, errForTaskCreated] =
                await TaskHelper.createTasksForLeads({
                  leads: [lead],
                  node,
                  cadence_id: cadence.cadence_id,
                  firstTask: true,
                });
              if (taskCreated)
                TaskHelper.recalculateDailyTasksForUsers([lead.user_id]);
            }
          }
        }

        response.element_success.push({
          id: leadObj.contact_id,
          lead_cadence_id: createdLink.lead_cadence_id,
          cadence_id: leadObj.cadence_id,
          status: createdLink.status,
          lead_id: lead.lead_id,
        });
        response.total_success++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: contacts.length,
          },
          socketId: loaderId,
        });
        continue;
      } else {
        // Link already exists
        logger.info(`Link already exists`);

        response.element_success.push({
          id: leadObj.contact_id,
          lead_cadence_id: link[0]?.lead_cadence_id,
          cadence_id: leadObj.cadence_id,
          status: link[0]?.status,
          lead_id: lead.lead_id,
        });
        response.total_success++;
      }

      i++;
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: i,
          size: contacts.length,
        },
        socketId: loaderId,
      });

      if (i === contacts.length) break;
    }

    return successResponse(res, 'Links have been processed.', response);
  } catch (err) {
    logger.error(`Error ocurred while links contacts for hubspot: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while linking contacts for Hubspot: ${err.message}`,
    });
  }
};

// * Remove contact from hubspot imports
const deleteContactFromHubspotImports = async (req, res) => {
  try {
    const [_, errForDelete] = await Repository.destroy({
      tableName: DB_TABLES.HUBSPOT_IMPORTS,
      query: {
        contact_id: req.params.contact_id,
        company_id: req.user.company_id,
      },
    });
    if (errForDelete)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete contact',
        error: `Error while deleting contact: ${errForDelete}`,
      });

    return successResponse(res, 'Successfully deleted contact from imports');
  } catch (err) {
    logger.error(`Unable to delete contact from hubspot imports: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting contact from Hubspot imports: ${err.message}`,
    });
  }
};

const previewLeadsForCSVImport = async (req, res) => {
  try {
    // loaderId from body
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    let body = hubspotImportSchema.leadsPreviewSchemaForCSV.validate(req.body);
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
    const { loaderId, field_map: hubspotFieldMap } = body;

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
    let i = 0;
    let leadsToPreview = [];

    // To store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUserMap = {};
    const ownerIdRegex = /^\d+$/;
    successResponse(
      res,
      'Started importing, please check back after some time'
    );
    while (i < leads.length) {
      let leadData = leads[i];
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });

      logger.info(`For lead ${i}`);
      let createdLead = {
        first_name: leadData[hubspotFieldMap?.first_name]?.trim() || null,
        last_name: leadData[hubspotFieldMap?.last_name]?.trim() || null,
        linkedin_url: leadData[hubspotFieldMap?.linkedin_url]?.trim() || null,
        job_position: leadData[hubspotFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: leadData[hubspotFieldMap?.owner_full_name],
          OwnerId: leadData[hubspotFieldMap?.hubspot_owner_id]?.trim(),
        },
        Account: {
          name: leadData[hubspotFieldMap?.company_name]?.trim() || null,
          phone_number:
            leadData[hubspotFieldMap?.company_phone_number]?.trim() || null,
          size: leadData[hubspotFieldMap?.size]?.trim() || null,
          url: leadData[hubspotFieldMap?.url]?.trim() || null,
          country: leadData[hubspotFieldMap?.country]?.trim() || null,
          zipcode: leadData[hubspotFieldMap?.zip_code]?.trim() || null,
        },
      };

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
      hubspotFieldMap?.phone_numbers?.forEach((phone_number) => {
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
      hubspotFieldMap?.emails?.forEach((email) => {
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

      createdLead.integration_type = LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.HUBSPOT_CSV_COMPANY;
      createdLead.is_success = true; // for error handling
      let missingFields = [];

      // Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.HUBSPOT_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.COMPANY_NAME);
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
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead.Account.phone_number &&
        !PHONE_REGEX.test(createdLead.Account.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Owner?.OwnerId &&
        !ownerIdRegex.test(createdLead.Owner.OwnerId)
      ) {
        logger.error(`Owner id is invalid`);
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.HUBSPOT_OWNER_ID} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
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

      if (!createdLead.status) {
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      }
      createdLead.id = `lead_${i}`;
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
    let body = hubspotImportSchema.leadsPreviewSchemaForSheets.validate(
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

    let hubspotFieldMap = body.field_map;
    successResponse(
      res,
      'Started importing, please check back after some time'
    );
    while (i < leads.length) {
      let leadData = leads[i];
      logger.info(`For lead ${i + 1}`);
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
        first_name: leadData[hubspotFieldMap?.first_name]?.trim() || null,
        last_name: leadData[hubspotFieldMap?.last_name]?.trim() || null,
        linkedin_url: leadData[hubspotFieldMap?.linkedin_url]?.trim() || null,
        job_position: leadData[hubspotFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: leadData[hubspotFieldMap?.owner_full_name]?.trim(),
          OwnerId: leadData[hubspotFieldMap?.hubspot_owner_id]?.trim(),
        },
        Account: {
          name: leadData[hubspotFieldMap?.company_name]?.trim() || null,
          phone_number:
            leadData[hubspotFieldMap?.company_phone_number]?.trim() || null,
          size: leadData[hubspotFieldMap?.size]?.trim() || null,
          url: leadData[hubspotFieldMap?.url]?.trim() || null,
          country: leadData[hubspotFieldMap?.country]?.trim() || null,
          zipcode: leadData[hubspotFieldMap?.zip_code]?.trim() || null,
        },
      };

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
      hubspotFieldMap?.phone_numbers?.forEach((phone_number) => {
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
      hubspotFieldMap?.emails?.forEach((email) => {
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
        LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_COMPANY;
      createdLead.is_success = true; // for error handling

      let missingFields = [];
      // Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`first name not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`last name not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.HUBSPOT_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`company name not present in google sheets.`);
        missingFields.push(HUBSPOT_CSV_GS_IMPORT_FIELDS.COMPANY_NAME);
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
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.LINKEDIN_URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead.Account.phone_number &&
        !PHONE_REGEX.test(createdLead.Account.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Owner?.OwnerId &&
        !ownerIdRegex.test(createdLead.Owner.OwnerId)
      ) {
        logger.error(`Owner id is invalid`);
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.HUBSPOT_OWNER_ID} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.status = `${HUBSPOT_CSV_GS_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
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

      if (!createdLead.status) {
        createdLead.status = SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      }
      createdLead.id = `lead_${i}`;
      createdLead.sr_no = i;
      leadsToPreview.push(createdLead);
    }
    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: leadsToPreview, error: null },
      socketId: loaderId,
    });
  } catch (err) {
    logger.error('Error while previewing contacts from google sheets: ', {
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

// * Import list/contact from hubspot
const previewHubspotDataFromExtension = async (req, res) => {
  try {
    let request = {
      ...req.params,
    };

    // * JOI Validation
    const params =
      hubspotImportSchema.previewHubspotDataFromExtension.validate(request);
    if (params.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from hubspot',
        error: `Error while importing data from hubspot: ${params.error.message}`,
      });

    let { type, id } = params.value;

    let [{ access_token }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken) {
      if (errFetchingAccessToken === 'Kindly log in with Hubspot')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Kindly log in with Hubspot',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from hubspot',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });
    }

    // * Fetch hubspot field map
    let [hubspotFieldMap, errFetchingHubspotFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errFetchingHubspotFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Hubspot data to cadence',
        error: errFetchingHubspotFieldMap,
      });

    let hubspotAccountMap = hubspotFieldMap.company_map;
    let hubspotContactMap = hubspotFieldMap.contact_map;

    let contact_properties_query = '';
    for (const [key, value] of Object.entries(hubspotContactMap)) {
      if (key === 'disqualification_reason') continue;
      if (key === 'integration_status') {
        contact_properties_query + `&property=${value?.name}`;
        continue;
      }
      if (key === 'variables') continue;

      if (typeof value === 'string')
        contact_properties_query =
          contact_properties_query + `&property=${value}`;
      else if (typeof value === 'object') {
        for (let v of value)
          contact_properties_query =
            contact_properties_query + `&property=${v}`;
      }
    }
    contact_properties_query =
      contact_properties_query +
      '&property=associatedcompanyid&property=hubspot_owner_id';

    contact_properties_query = contact_properties_query.slice(1);

    if (type === HUBSPOT_IMPORT_SOURCE.LIST) {
      let promiseArray = [];
      let hubspotContactsInList = []; // * Store all contacts
      let contactIntegrationIds = []; // * Store all hubspot contact Ids
      let uniqueCompanyIds = []; // * Store all hubspot company ids
      let uniqueHubspotOwnerIds = [];
      let has_more = true; // * Go through pagination
      let offset = 0;

      while (has_more) {
        // * If number of contacts exceed 1000, then return.
        if (hubspotContactsInList.length > 500) {
          logger.error('List is too large too import', {
            user_id: req.user.user_id,
          });
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Maximum 500 contacts can be imported at a time.',
          });
        }
        const [hubspotContacts, errFetchingHubspotContacts] =
          await v2GrpcClients.crmIntegration.getContactsFromList({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            integration_data: {
              access_token,
              list_id: id,
              contact_properties_query,
              offset,
            },
          });
        if (errFetchingHubspotContacts)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Unable to fetch contact list from hubspot',
            error: errFetchingHubspotContacts,
          });
        if (!hubspotContacts['has-more'] || hubspotContacts.length === 0)
          has_more = false;

        promiseArray.push(
          HubspotHelper.formatContactsForPreview({
            hubspotContacts: hubspotContacts.contacts,
            hubspotContactMap,
            contactIntegrationIds,
            uniqueCompanyIds,
            uniqueHubspotOwnerIds,
            hubspotContactsInList,
          })
        );

        offset = hubspotContacts['vid-offset'];
      }

      let formattedContacts = await Promise.all(promiseArray);
      for (let formattedContact of formattedContacts)
        if (formattedContact[1])
          return serverErrorResponseWithDevMsg({
            res,
            error: formattedContact[1],
          });

      contactIntegrationIds = [...new Set(contactIntegrationIds)];
      uniqueCompanyIds = [...new Set(uniqueCompanyIds)];
      uniqueHubspotOwnerIds = [...new Set(uniqueHubspotOwnerIds)];

      // * Fetch all contacts
      const leadPromise = Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          company_id: req.user.company_id,
          integration_id: {
            [Op.in]: contactIntegrationIds,
          },
          integration_type: LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT,
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
            [Op.in]: uniqueHubspotOwnerIds,
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
            [Op.in]: uniqueCompanyIds,
          },
          integration_type: ACCOUNT_INTEGRATION_TYPES.HUBSPOT_COMPANY,
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
          msg: 'Unable to fetch contacts from hubspot',
          error: errFetchingContacts,
        });
      const [users, errFetchingUsers] = values[1];
      if (errFetchingUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch contacts from hubspot',
          error: errFetchingUsers,
        });
      let [accounts, errFetchingAccounts] = values[2];
      if (errFetchingAccounts)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to fetch contacts from hubspot',
          error: errFetchingAccounts,
        });

      // * Get missing company Ids
      const accountIntegrationIds = accounts.map(
        (account) => account.integration_id
      );
      const missingCompanyIds = uniqueCompanyIds.filter(
        (companyId) => !accountIntegrationIds.includes(companyId)
      );

      // * Get missing user Ids
      const userIntegrationIds = users.map((user) => user.integration_id);
      const missingUserIds = uniqueHubspotOwnerIds.filter(
        (userId) => !userIntegrationIds.includes(userId)
      );

      // * Fetch users that were not present in database
      if (missingUserIds.length) {
        // * Fetch all users that don't exit in the database
        let has_more = true; // * Go through pagination
        let pagingToken = null;

        while (has_more) {
          const [hubspotUsers, errFetchingHubspotUser] =
            await HubspotHelper.getUsers({
              access_token,
              pagingToken,
            });
          if (errFetchingHubspotUser)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Unable to fetch contacts from hubspot',
              error: errFetchingHubspotUser,
            });

          if (hubspotUsers?.paging?.next)
            pagingToken = hubspotUsers?.paging?.next?.after;
          else has_more = false;

          // * Get only the missing users
          const missingUsers = hubspotUsers.results.filter((hubspotUser) =>
            missingUserIds.includes(String(hubspotUser.id))
          );

          // * Push to user array
          for (let missingUser of missingUsers)
            users.push({
              integration_id: String(missingUser.id),
              first_name: missingUser.firstName,
              last_name: missingUser.lastName,
            });
          if (!pagingToken) has_more = false;
        }
      }

      // * Fetch all accounts that don't exit in the database
      let accountsNotInDatabase = [];
      if (missingCompanyIds.length) {
        let account_properties_query = [];
        for (const [key, value] of Object.entries(hubspotAccountMap))
          if (typeof value === 'string') account_properties_query.push(value);

        let has_more = true;
        let offset = 0;
        let limit = 100;

        while (has_more) {
          let [hubspotAccounts, errFetchingHubspotAccounts] =
            await v2GrpcClients.crmIntegration.searchAccount({
              integration_type: CRM_INTEGRATIONS.HUBSPOT,
              integration_data: {
                companyIds: missingCompanyIds,
                properties: account_properties_query,
                offset,
                limit,
                access_token,
              },
            });
          if (errFetchingHubspotAccounts)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Unable to fetch contacts from hubspot',
              error: errFetchingHubspotAccounts,
            });

          for (let hubspotAccount of hubspotAccounts.results) {
            // * Format accounts
            let formattedAccount = {
              name: hubspotAccount.properties?.[hubspotAccountMap.name],
              size: hubspotAccount.properties?.[hubspotAccountMap.size],
              phone_number:
                hubspotAccount.properties?.[hubspotAccountMap.phone_number],
              linkedin_url:
                hubspotAccount.properties?.[hubspotAccountMap.linkedin_url],
              url: hubspotAccount.properties?.[hubspotAccountMap.url],
              country: hubspotAccount.properties?.[hubspotAccountMap.country],
              integration_id: hubspotAccount.id,
              zipcode: hubspotAccount.properties?.[hubspotAccountMap.zip_code],
            };
            accountsNotInDatabase.push(formattedAccount);
          }

          if (!hubspotAccounts.paging) has_more = false;
          else offset = hubspotAccounts.paging.next.after;
        }
      }
      accounts = [...accounts, ...accountsNotInDatabase];

      return successResponse(res, 'Successfully fetched list from hubspot', {
        hubspotContactsInList,
        contacts,
        users,
        accounts,
      });
    } else if (type === HUBSPOT_IMPORT_SOURCE.CONTACT) {
      let contact_properties_query = '';
      for (const [key, value] of Object.entries(hubspotContactMap)) {
        if (key === 'disqualification_reason') continue;
        if (key === 'integration_status') {
          contact_properties_query +
            contact_properties_query +
            `${value?.name},`;
          continue;
        }
        if (key === 'variables') continue;
        if (typeof value === 'string')
          contact_properties_query = contact_properties_query + `${value},`;
        else if (typeof value === 'object') {
          for (let v of value)
            contact_properties_query = contact_properties_query + `${v},`;
        }
      }
      contact_properties_query =
        contact_properties_query + 'associatedcompanyid,hubspot_owner_id';

      // * Fetch hubspot contact
      const [contactData, errFetchingContactFromHubspot] =
        await v2GrpcClients.crmIntegration.getContact({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: {
            access_token,
            contact_id: id,
            properties: contact_properties_query,
          },
        });
      if (errFetchingContactFromHubspot)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Hubspot data to cadence',
          error: errFetchingContactFromHubspot,
        });

      let formattedContact = {
        first_name: contactData.properties[hubspotContactMap.first_name],
        last_name: contactData.properties[hubspotContactMap.last_name],
        linkedin_url: contactData.properties[hubspotContactMap.linkedin_url],
        source_site: contactData.properties[hubspotContactMap.source_site],
        job_position: contactData.properties[hubspotContactMap.job_position],
        Id: contactData.id,
        phone_numbers: [],
        emails: [],
        associatedcompanyid: contactData.properties.associatedcompanyid,
        hubspot_owner_id: contactData.properties.hubspot_owner_id,
      };

      // * Process phone
      hubspotContactMap?.phone_numbers.forEach((phone_type) => {
        formattedContact.phone_numbers.push({
          type: phone_type,
          phone_number: contactData.properties[phone_type] || '',
        });
      });

      // * Process email
      hubspotContactMap?.emails.forEach((email_type) => {
        formattedContact.emails.push({
          type: email_type,
          email_id: contactData.properties[email_type] || '',
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
            integration_type: LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT,
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
            integration_id: contactData.properties?.hubspot_owner_id,
            company_id: req.user.company_id,
            integration_type: USER_INTEGRATION_TYPES.HUBSPOT_OWNER,
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

      // * Fetch account from hubspot
      if (contactData?.properties?.associatedcompanyid) {
        let account_properties_query = [];
        for (const [key, value] of Object.entries(hubspotAccountMap))
          if (typeof value === 'string') account_properties_query.push(value);
        promiseArray.push(
          v2GrpcClients.crmIntegration.getAccount({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            integration_data: {
              access_token,
              company_id: contactData?.properties?.associatedcompanyid,
              properties: account_properties_query,
            },
          })
        );
      }

      let values = await Promise.all(promiseArray);

      const [contact, errFetchingContact] = values[0];
      if (errFetchingContact)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Hubspot data to cadence',
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
          msg: 'Failed to import Hubspot data to cadence',
          error: errFetchingUser,
        });
      if (user) formattedContact.Owner = user;
      else {
        let [hubspotUser, _] = await v2GrpcClients.crmIntegration.getUser({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: {
            access_token,
            hubspot_owner_id: contactData.properties?.hubspot_owner_id,
          },
        });

        if (hubspotUser)
          formattedContact.Owner = {
            integration_id: hubspotUser.id,
            first_name: hubspotUser.firstName,
            last_name: hubspotUser.lastName,
          };
        else formattedContact.Owner = {};
      }

      let [accountFromHubspot, errFetchingAccountFromHubspot] = [null, null];
      if (contactData?.properties?.associatedcompanyid)
        [accountFromHubspot, errFetchingAccountFromHubspot] = values[2];
      if (errFetchingAccountFromHubspot)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to import Hubspot data to cadence',
          error: errFetchingAccountFromHubspot,
        });
      if (accountFromHubspot)
        formattedContact.Account = {
          name: accountFromHubspot.properties?.[hubspotAccountMap.name],
          size: accountFromHubspot.properties?.[hubspotAccountMap.size],
          phone_number:
            accountFromHubspot.properties?.[hubspotAccountMap.phone_number],
          linkedin_url:
            accountFromHubspot.properties?.[hubspotAccountMap.linkedin_url],
          url: accountFromHubspot.properties?.[hubspotAccountMap.url],
          country: accountFromHubspot.properties?.[hubspotAccountMap.country],
          integration_id: accountFromHubspot.id,
          zipcode: accountFromHubspot.properties?.[hubspotAccountMap.zip_code],
        };

      return successResponse(res, 'Successfully fetched contact from hubspot', {
        contact: formattedContact,
      });
    }

    return badRequestResponseWithDevMsg({
      res,
      msg: 'Requested import is not allowed',
    });
  } catch (err) {
    logger.error(`Error ocurred while fetching import data from hubspot: `, {
      user_id: req.user.user_id,
      err,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching import data from hubspot: ${err.message}`,
    });
  }
};

const getCustomViews = async (req, res) => {
  try {
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Hubspot',
      });

    const [data, errorFetchingViews] = await HubspotService.fetchCustomViews({
      access_token,
      instance_url,
      moduleName: req.query.module_name,
      offset: 0,
    });
    let list = data?.lists ? data?.lists : [];
    let has_more = data['has-more'];
    let offset = data.offset;
    while (has_more) {
      let [paginatedList, errForFetchingPaginatedList] =
        await HubspotService.fetchCustomViews({
          access_token,
          instance_url,
          offset,
          moduleName: req.query.module_name,
        });
      if (errForFetchingPaginatedList)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch custom views',
          error: `Error while fetching custom views: ${errForFetchingPaginatedList}`,
        });

      list.push(...paginatedList?.lists);
      has_more = paginatedList['has-more'];
      offset = paginatedList.offset;
    }

    if (errorFetchingViews)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch custom views',
        error: `Error while fetching custom views: ${errorFetchingViews}`,
      });

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

const HubspotImportController = {
  getCSVColumns,
  getSheetsColumns,
  previewHubspotContactsViaCSV,
  importHubspotTempContacts,
  addHubspotContactsViaCSV,
  linkHubspotContactsViaCSV,
  fetchHubspotImportContacts,
  addHubspotContactsViaWebhook,
  linkHubspotContactsViaWebhook,
  deleteContactFromHubspotImports,
  previewLeadsForCSVImport,
  previewLeadsForSheetsImport,
  previewHubspotDataFromExtension,
  getCustomViews,
};

module.exports = HubspotImportController;
