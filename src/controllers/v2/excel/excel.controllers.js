// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  LEAD_STATUS,
  CADENCE_STATUS,
  CADENCE_TYPES,
  LEAD_INTEGRATION_TYPES,
  EXCEL_LEAD_STATUS,
  USER_INTEGRATION_TYPES,
  CADENCE_LEAD_STATUS,
  EXCEL_PHONE_NUMBER_FIELDS,
  EXCEL_EMAIL_FIELDS,
  IMPORT_ERROR_TYPE,
  SHEETS_CADENCE_INTEGRATION_TYPE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  EMAIL_REGEX,
  PHONE_REGEX,
  LINKEDIN_REGEX,
  WEBSITE_URL_REGEX,
} = require('../../../../../Cadence-Brain/src/utils/constants');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');
const xlsx = require('xlsx');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');
const LeadToCadenceRepository = require('../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const LeadRepository = require('../../../../../Cadence-Brain/src/repository/lead.repository');
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');
const CadenceRepository = require('../../../../../Cadence-Brain/src/repository/cadence.repository');
const NodeRepository = require('../../../../../Cadence-Brain/src/repository/node.repository');
const TaskRepository = require('../../../../../Cadence-Brain/src/repository/task.repository');

//Helpers and Services
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../Cadence-Brain/src/helper/lead');
const CadenceHelper = require('../../../../../Cadence-Brain/src/helper/cadence');
const SocketHelper = require('../../../../../Cadence-Brain/src/helper/socket');
const ExcelHelper = require('../../../../../Cadence-Brain/src/helper/excel');
const LeadsToCadenceHelper = require('../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ImportHelper = require('../../../../../Cadence-Brain/src/helper/imports');

// Joi
const ExcelLeadSchema = require('../../../joi/v2/sales/department/cadence-imports/excel-imports.joi');

const previewLeads = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body.field_map)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, field_map is missing`,
    });
  try {
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    let body = ExcelLeadSchema.leadsPreviewSchema.validate(req.body);
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map } = body;

    // * Fetch excel sheets field map
    let [userForFieldMap, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      extras: {
        attributes: ['first_name'],
      },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['name'],
          [DB_TABLES.COMPANY_SETTINGS]: {
            [DB_TABLES.EXCEL_FIELD_MAP]: {},
          },
        },
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching user: ${errFetchingUser}`,
        msg: 'Failed to fetch user',
      });
    if (!userForFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly ask admin to create field map',
      });

    //let excelFieldMap =
    //userForFieldMap?.Company?.Company_Setting?.Excel_Field_Map?.lead_map;

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

    // Step: Apply limit of 1000 leads to be imported at a time
    //if (leads?.length > 1000)
    //return badRequestResponseWithDevMsg({
    //res,
    //msg: `Cannot import more than 1000 leads at a time`,
    //});
    // read only first 1000 leads
    //leads = leads.splice(0, 1000);

    const [cadence, errForFetchingCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      updateObject: { field_map },
      query: { cadence_id: body.cadence_id },
    });
    if (errForFetchingCadence)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating cadence: ${errForFetchingCadence}`,
        msg: 'Failed to update fieldmap',
      });
    if (!cadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cadence not found',
      });
    if (cadence?.integration_type === SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Excel leads are not allowed in this cadence',
        error: `Google sheets leads are already present in this cadence`,
      });

    const [__, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.CADENCE,
      updateObject: { field_map },
      query: { cadence_id: body.cadence_id },
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating cadence: ${errForUpdate}`,
        msg: 'Failed to update fieldmap',
      });

    let excelFieldMap = field_map;

    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_error: [],
    };
    let leadsToPreview = [];
    // object to cache users
    let userObj = {};

    // Step: send success response indicating processing has been started
    successResponse(
      res,
      'Started processing leads, please check back after some time'
    );

    while (i <= leads.length) {
      if (i === leads.length) {
        response.previewLeads = leadsToPreview;
        return SocketHelper.sendCadenceImportResponseEvent({
          response_data: { data: response, error: null },
          socketId: loaderId,
        });
        //return successResponse(res, 'Leads have been processed.', response);
      }

      let createdLead = {};
      let lead = leads[i];

      // skip empty rows
      if (lead?.Status === 'empty row') {
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: ++i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // removing empty rows
      if (
        lead[excelFieldMap.first_name] === '' &&
        lead[excelFieldMap.last_name] === '' &&
        lead[excelFieldMap.job_position] === '' &&
        lead[excelFieldMap.linkedin_url] === '' &&
        lead[excelFieldMap.primary_email] === '' &&
        lead[excelFieldMap.work_email] === '' &&
        lead[excelFieldMap.other_email] === '' &&
        lead[excelFieldMap.home_email] === '' &&
        lead[excelFieldMap.primary_phone] === '' &&
        lead[excelFieldMap.work_phone] === '' &&
        lead[excelFieldMap.home_phone] === '' &&
        lead[excelFieldMap.other_phone] === '' &&
        lead[excelFieldMap.company] === '' &&
        lead[excelFieldMap.url] === '' &&
        lead[excelFieldMap.country] === '' &&
        lead[excelFieldMap.zip_code] === '' &&
        lead[excelFieldMap.size] === '' &&
        lead[excelFieldMap.company_phone_number] === '' &&
        lead[excelFieldMap.owner_integration_id] === ''
      ) {
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: ++i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      if (lead[excelFieldMap.status] == LEAD_STATUS.CONVERTED) {
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: ++i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // Company Phone number validation
      if (lead[excelFieldMap.company_phone_number]) {
        if (
          typeof lead[excelFieldMap.company_phone_number] === 'string' &&
          /^\d+([.]\d+)?[Ee](\+|-)?\d+$/.test(
            lead[excelFieldMap.company_phone_number]
          )
        ) {
          lead[excelFieldMap.company_phone_number] = Number(
            lead[excelFieldMap.company_phone_number]
          );
        }
        if (!PHONE_REGEX.test(lead[excelFieldMap.company_phone_number])) {
          let errMsg = 'Company phone number is invalid';
          response.total_error++;
          createdLead.fieldStatus = errMsg;
          createdLead.status = 'another';
          response.element_error.push({
            sr_no: i + 1,
            cadence_id: lead.cadence_id,
            msg: errMsg,
          });
        }
      }

      // * Phone validation
      let phone_number = [];

      if (lead[excelFieldMap.primary_phone]) {
        if (
          typeof lead[excelFieldMap.primary_phone] === 'string' &&
          /^\d+([.]\d+)?[Ee](\+|-)?\d+$/.test(lead[excelFieldMap.primary_phone])
        ) {
          lead[excelFieldMap.primary_phone] = Number(
            lead[excelFieldMap.primary_phone]
          );
        }
        if (!PHONE_REGEX.test(lead[excelFieldMap.primary_phone])) {
          let errMsg = 'Primary phone number is invalid';
          response.total_error++;
          createdLead.fieldStatus = errMsg;
          createdLead.status = 'another';
          response.element_error.push({
            sr_no: i + 1,
            cadence_id: lead.cadence_id,
            msg: errMsg,
          });
        }
      }
      phone_number.push({
        phone_number: lead[excelFieldMap.primary_phone] || '',
        type: excelFieldMap.primary_phone,
      });

      excelFieldMap?.phone_numbers.forEach((phone_type) => {
        if (lead[phone_type]) {
          if (
            typeof lead[phone_type] === 'string' &&
            /^\d+([.]\d+)?[Ee](\+|-)?\d+$/.test(lead[phone_type])
          ) {
            lead[phone_type] = Number(lead[phone_type]);
          }
          if (!PHONE_REGEX.test(lead[phone_type])) {
            let errMsg = `${phone_type} number is invalid`;
            response.total_error++;
            createdLead.fieldStatus = errMsg;
            createdLead.status = 'another';
            response.element_error.push({
              sr_no: i + 1,
              cadence_id: lead.cadence_id,
              msg: errMsg,
            });
          }
        }
        phone_number.push({
          phone_number: lead[phone_type] || '',
          type: phone_type,
        });
      });
      lead.phone_number = phone_number;

      // * Email validation
      let emails = [];

      if (lead[excelFieldMap.primary_email]) {
        if (!EMAIL_REGEX.test(lead[excelFieldMap.primary_email])) {
          let errMsg = 'Primary email is invalid';
          response.total_error++;
          createdLead.fieldStatus = errMsg;
          createdLead.status = 'another';
          response.element_error.push({
            sr_no: i + 1,
            cadence_id: lead.cadence_id,
            msg: errMsg,
          });
        }
      }
      emails.push({
        email_id: lead[excelFieldMap.primary_email] || '',
        type: excelFieldMap.primary_email,
      });

      excelFieldMap?.emails.forEach((email_field) => {
        if (lead[email_field]) {
          if (!EMAIL_REGEX.test(lead[email_field])) {
            let errMsg = `${email_field} is invalid`;
            response.total_error++;
            createdLead.fieldStatus = errMsg;
            createdLead.status = 'another';
            response.element_error.push({
              sr_no: i + 1,
              cadence_id: lead.cadence_id,
              msg: errMsg,
            });
          }
        }
        emails.push({
          email_id: lead[email_field] || '',
          type: email_field,
        });
      });
      lead.emails = emails;

      // Linkedin link validation
      if (lead[excelFieldMap.linkedin_url]) {
        if (!LINKEDIN_REGEX.test(lead[excelFieldMap.linkedin_url])) {
          let errMsg = `Linkedin url is invalid`;
          response.total_error++;
          createdLead.fieldStatus = errMsg;
          createdLead.status = 'another';
          response.element_error.push({
            sr_no: i + 1,
            cadence_id: lead.cadence_id,
            msg: errMsg,
          });
        }
      }

      // company website link validation
      if (lead[excelFieldMap.url]) {
        if (!WEBSITE_URL_REGEX.test(lead[excelFieldMap.url])) {
          let errMsg = `Company website url is invalid`;
          response.total_error++;
          createdLead.fieldStatus = errMsg;
          createdLead.status = 'another';
          response.element_error.push({
            sr_no: i + 1,
            cadence_id: lead.cadence_id,
            msg: errMsg,
          });
        }
      }

      // * Creating lead object
      Object.keys(excelFieldMap).forEach((key) => {
        createdLead[excelFieldMap[key]] = lead[excelFieldMap[key]];
      });
      createdLead.emails = lead.emails;
      createdLead.phone_number = lead.phone_number;
      createdLead['Full Name'] =
        lead[excelFieldMap.first_name] + ' ' + lead[excelFieldMap.last_name];

      //const [existingLead, errForExistingLead] = await Repository.fetchOne({
      //tableName: DB_TABLES.LEAD,
      //query: {
      //first_name: lead[excelFieldMap.first_name] || '',
      //last_name: lead[excelFieldMap.last_name] || '',
      //company_id: userForFieldMap?.Company?.Company_Setting?.company_id,
      //},
      //include: {
      //[DB_TABLES.LEAD_PHONE_NUMBER]: {
      //where: {
      //lead_id: sequelize.col('lead.lead_id'),
      //phone_number: lead?.phone_number?.[0]?.phone_number || '',
      //is_primary: true,
      //},
      //required: true,
      //},
      //[DB_TABLES.LEAD_EMAIL]: {
      //where: {
      //email_id: lead?.emails?.[0]?.email_id || '',
      //lead_id: sequelize.col('lead.lead_id'),
      //is_primary: true,
      //},
      //required: true,
      //},
      //[DB_TABLES.LEADTOCADENCE]: {
      //where: {
      //lead_id: sequelize.col('lead.lead_id'),
      //},
      //include: [DB_MODELS.cadence],
      //},
      //},
      //});
      //if (errForExistingLead)
      //return serverErrorResponse(res, errForExistingLead);
      //if (existingLead) {
      //createdLead.status = EXCEL_LEAD_STATUS.LEAD_PRESENT_IN_TOOL;
      //let cadences = existingLead.LeadToCadences.map((leadToCadence) => {
      //return {
      //cadence_id: leadToCadence.Cadences[0].cadence_id,
      //name: leadToCadence.Cadences[0].name,
      //};
      //});
      //createdLead.cadences = cadences;
      ////createdLead[excelFieldMap.lead_id] = existingLead.lead_id;
      ////createdLead[excelFieldMap.integration_id] = existingLead.integration_id;
      //createdLead.lead_id = existingLead.lead_id;
      //createdLead.integration_id = existingLead.integration_id;
      //}

      logger.info(`For lead ${i}`);

      let user, errForUser;
      const owner_integration_id = lead[excelFieldMap.owner_integration_id];
      // Fetch user from db
      if (userObj?.[owner_integration_id] === undefined) {
        [user, errForUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            // If 'E' is present in the 'integration_id', it will be replaced with 'S' for existing Excel users.
            integration_id: owner_integration_id?.replace('E', 'S'),
            company_id: req.user.company_id,
          },
        });
        // if error occures or user is not found
        if (errForUser || !user || user === null) {
          logger.info('Owner not present in our tool.');
          createdLead.status = EXCEL_LEAD_STATUS.USER_NOT_PRESENT;
          // mark as null in userObj so we don't try to fetch from db again
          userObj[owner_integration_id] = null;
        } else {
          createdLead.owner_full_name =
            (user?.first_name || '') + ' ' + (user?.last_name || '');
          lead.user_id = user?.user_id;
          userObj[owner_integration_id] = user;
        }
        // already fetched from db but no user found
      } else if (userObj[owner_integration_id] === null) {
        logger.info('Owner not present in our tool.');
        createdLead.status = EXCEL_LEAD_STATUS.USER_NOT_PRESENT;
        // user already fetched from db
      } else if (userObj[owner_integration_id]) {
        user = userObj[owner_integration_id];
        createdLead.owner_full_name =
          (user?.first_name || '') + ' ' + (user?.last_name || '');
        lead.user_id = user?.user_id;
      }

      // Check if user with given salesforce owner id is found
      //let [user, userErr] = await Repository.fetchOne({
      //tableName: DB_TABLES.USER,
      //query: {
      //integration_id: lead[excelFieldMap.owner_integration_id],
      //company_id: req.user.company_id,
      //},
      //});
      //if (errForUser || !user || user === null) {
      //logger.info('Owner not present in our tool.');
      //createdLead.status = EXCEL_LEAD_STATUS.USER_NOT_PRESENT;
      //} else {
      //createdLead.owner_full_name =
      //(user?.first_name || '') + ' ' + (user?.last_name || '');
      //lead.user_id = user?.user_id;
      //}

      if (!createdLead.status)
        createdLead.status = EXCEL_LEAD_STATUS.LEAD_ABSENT_IN_TOOL;

      // Cheking Required Values
      let values = [
        excelFieldMap.first_name,
        excelFieldMap.company,
        excelFieldMap.owner_integration_id,
      ];
      let errMsg = '';
      values.forEach((val) => {
        if (!lead[val]) {
          if (errMsg) errMsg += ', ' + val;
          else errMsg += val;
        }
      });

      if (errMsg) {
        errMsg += ' should be present';
        response.total_error++;
        createdLead.fieldStatus = errMsg;
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: errMsg,
        });
      }

      createdLead.sr_no = i + 1;

      // Structure lead
      let structuredLead = {};

      if (createdLead[excelFieldMap.first_name]?.length > 50) {
        response.total_error++;
        createdLead.fieldStatus = "First name can't be more than 50 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "First name can't be more than 50 characters",
        });
      }

      if (createdLead[excelFieldMap.last_name]?.length > 75) {
        response.total_error++;
        createdLead.fieldStatus = "Last name can't be more than 75 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Last name can't be more than 75 characters",
        });
      }

      if (createdLead[excelFieldMap.job_position]?.length > 100) {
        response.total_error++;
        createdLead.fieldStatus =
          "Job Position can't be more than 100 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Job Position can't be more than 100 characters",
        });
      }

      if (createdLead[excelFieldMap.company]?.length > 200) {
        response.total_error++;
        createdLead.fieldStatus =
          "Company name can't be more than 200 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Company name can't be more than 200 characters",
        });
      }

      if (createdLead[excelFieldMap.country]?.length > 100) {
        response.total_error++;
        createdLead.fieldStatus =
          "Country name can't be more than 100 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Country name can't be more than 100 characters",
        });
      }

      if (createdLead[excelFieldMap.zip_code]?.length > 10) {
        response.total_error++;
        createdLead.fieldStatus = "Zipcode can't be more than 10 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Zipcode can't be more than 10 characters",
        });
      }

      if (createdLead[excelFieldMap.size]?.length > 25) {
        response.total_error++;
        createdLead.fieldStatus =
          "Company size can't be more than 25 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Company size can't be more than 25 characters",
        });
      }

      structuredLead.first_name = createdLead[excelFieldMap.first_name] || '';
      structuredLead.last_name = createdLead[excelFieldMap.last_name] || '';
      structuredLead.emails = createdLead.emails || [];
      structuredLead.phone_numbers = createdLead.phone_number || [];
      structuredLead.job_position =
        createdLead[excelFieldMap.job_position] || '';
      structuredLead.company = createdLead[excelFieldMap.company] || '';
      structuredLead.country = createdLead[excelFieldMap.country] || '';
      structuredLead.zip_code = createdLead[excelFieldMap.zip_code] || '';
      structuredLead.size = createdLead[excelFieldMap.size] || '';
      structuredLead.linkedin_url =
        createdLead[excelFieldMap.linkedin_url] || '';
      structuredLead.primary_email =
        createdLead[excelFieldMap.primary_email] || '';
      structuredLead.primary_phone =
        createdLead[excelFieldMap.primary_phone] || '';
      structuredLead.url = createdLead[excelFieldMap.url] || '';
      structuredLead.company_phone_number =
        createdLead[excelFieldMap.company_phone_number] || '';
      structuredLead.Owner = {
        Name: createdLead?.owner_full_name || '',
        OwnerId: lead[excelFieldMap.owner_integration_id] || '',
      };
      structuredLead.status = createdLead.status || '';
      structuredLead.fieldStatus = createdLead.fieldStatus || '';
      structuredLead.sr_no = createdLead.sr_no;
      structuredLead.cadences = createdLead.cadences || [];
      structuredLead.lead_id = createdLead.lead_id;
      structuredLead.integration_id = createdLead.integration_id;
      structuredLead.owner_integration_id =
        lead[excelFieldMap.owner_integration_id] || '';
      leadsToPreview.push(structuredLead);

      response.total_success++;
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });
      if (i === leads.length) {
        response.previewLeads = leadsToPreview;
        return SocketHelper.sendCadenceImportResponseEvent({
          response_data: { data: response, error: null },
          socketId: loaderId,
        });
        //return successResponse(res, 'Leads have been processed.', response);
      }
    }

    //return successResponse(res, 'Leads have been processed.');
  } catch (err) {
    logger.error('Error while creating excel leads: ', err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while previewing leads: ${err.message}`,
      });
    return SocketHelper.sendCadenceImportResponseEvent({
      response_data: {
        data: {
          total_success: 0,
          total_error: 0,
          element_error: [],
          previewLeads: [],
        },
        error: `An error occurred, please try again later or contact support`,
      },
      socketId: loaderId,
    });
  }
};

const createLeads = async (req, res) => {
  try {
    // Step: JOI Validation
    const body = ExcelLeadSchema.createLeads.validate(req.body);
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import excel leads',
        error: `Error while fetching excel leads: ${body.error.message}`,
      });
    // Step: Destructure body
    let { leads, cadence_id, loaderId } = req.body;
    // Step: Apply limit of 1000 leads to be imported at a time
    if (leads?.length > 1000)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Cannot import more than 1000 leads at a time`,
      });

    // Fetch pre-import data
    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: {
          where: {
            is_first: 1,
            cadence_id,
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
        error: `Error while fetching cadence: ${errForCadence}`,
        msg: 'Failed to find cadence',
      });
    if (!cadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cadence not found',
      });
    if (!cadence?.field_map)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `No field map associated with cadence`,
      });
    if (cadence?.integration_type === SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Excel leads are not allowed in this cadence',
        error: `Google sheets leads are already present in this cadence`,
      });

    let [updateCadenceIntegrationType, errForUpdateCadenceIntegrationType] =
      await Repository.update({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: req.body.cadence_id,
        },
        updateObject: {
          integration_type: SHEETS_CADENCE_INTEGRATION_TYPE.EXCEL,
        },
      });
    if (errForUpdateCadenceIntegrationType)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add leads',
        error: `Error while update cadence type: ${errForUpdateCadenceIntegrationType}`,
      });

    // Step: Declaring variables
    let excelFieldMap = cadence.field_map;
    let node = cadence?.Nodes?.[0];
    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    let leadCadenceOrderBatch = -1;
    // Promise array to process leads faster
    let promiseArray = [];
    // map to cache fetched users
    let fetchedUserMap = {};

    // Step: send success response indicating processing has been started
    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );

    // Step: loop through all leads
    while (i <= leads.length) {
      // Step: Resolve all promises in promiseArray as we have 10 promises
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        // resolve all promises
        let results = await Promise.all(promiseArray);
        // loop through all results
        for (let r of results) {
          // destructure result
          let [data, err] = r;
          if (err) {
            let msg;
            if (err?.error?.includes('must be unique'))
              msg = 'Lead present in cadence tool';
            else msg = err?.error;
            response.element_error.push({
              sr_no: err?.sr_no,
              cadence_id: cadence_id,
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
              sr_no: data?.sr_no,
              cadence_id,
              identifier: data?.lead_cadence_id,
              lead_id: data?.lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }
      if (i === leads.length) {
        logger.info(`Leads have been processed.`);
        break;
      }
      logger.info(`For lead ${i}`);

      // destructure lead
      let lead = leads[i];

      // increment variables
      i++;
      leadCadenceOrderBatch++;

      // assign necessary field to lead
      lead.salesforce_lead_id = lead.integration_id;
      lead.cadence_id = cadence_id;
      lead.integration_type = LEAD_INTEGRATION_TYPES.EXCEL_LEAD;

      // Step: Fetch user
      let [user, errForUser] = await ImportHelper.getUser({
        // If 'E' is present in the 'integration_id', it will be replaced with 'S' for existing Excel users.
        user_integration_id: lead.Owner.OwnerId?.replace('E', 'S'),
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errForUser) {
        response.element_error.push({
          sr_no: lead.sr_no,
          cadence_id,
          msg: errForUser,
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

      // Assign user id to lead
      lead.user_id = user.user_id;

      // Step: Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        response.element_error.push({
          sr_no: lead.sr_no,
          cadence_id,
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

      // Step: Assign cadence status and leadCadenceOrder to lead
      lead.cadenceStatus = cadence?.status;
      lead.leadCadenceOrder = i + 1;

      promiseArray.push(
        LeadHelper.createLeadForExcel({
          lead,
          cadence,
          node,
          company_id: user.company_id,
        })
      );
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: i,
          size: leads.length,
        },
        socketId: loaderId,
      });
    }

    // resolve all promises
    let results = await Promise.all(promiseArray);
    // loop through all results
    for (let r of results) {
      // destructure result
      let [data, err] = r;
      if (err) {
        let msg;
        if (err?.error?.includes('must be unique'))
          msg = 'Lead present in cadence tool';
        else msg = err?.error;
        response.element_error.push({
          sr_no: err?.sr_no,
          cadence_id: cadence_id,
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
          sr_no: data?.sr_no,
          cadence_id,
          identifier: data?.lead_cadence_id,
          lead_id: data?.lead_id,
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
    logger.error('Error while creating excel leads: ', err);
    // handling like this because this controller sends an early success reponse
    // but if something goes wrong before it is send then only server error should be returned
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating leads: ${err.message}`,
      });
  }
};

const linkLeads = async (req, res) => {
  try {
    // Step: JOI Validation
    const body = ExcelLeadSchema.createLeads.validate(req.body);
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import excel leads',
        error: `Error while fetching excel leads: ${body.error.message}`,
      });
    // Step: Destructure body
    let { leads, cadence_id } = req.body;
    // Step: Apply limit of 1000 leads to be imported at a time
    if (leads?.length > 1000)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Cannot import more than 1000 leads at a time`,
      });

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: {
          where: {
            is_first: 1,
            cadence_id,
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
        error: `Error while fetching cadence: ${errForCadence}`,
        msg: 'Failed to find cadence',
      });
    if (!cadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cadence not found',
      });
    if (cadence?.integration_type === SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Excel leads are not allowed in this cadence',
        error: `Google sheets leads are already present in this cadence`,
      });

    let [updateCadenceIntegrationType, errForUpdateCadenceIntegrationType] =
      await Repository.update({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: req.body.cadence_id,
        },
        updateObject: {
          integration_type: SHEETS_CADENCE_INTEGRATION_TYPE.EXCEL,
        },
      });
    if (errForUpdateCadenceIntegrationType)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add leads',
        error: `Error while update cadence type: ${errForUpdateCadenceIntegrationType}`,
      });

    // Step: Declaring variables
    let node = cadence?.Nodes?.[0];
    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    let leadCadenceOrderBatch = -1;
    // Promise array to process leads faster
    let promiseArray = [];
    // map to cache fetched users
    let fetchedUserMap = {};

    // Step: loop through all leads
    while (i <= leads.length) {
      // Step: Resolve all promises in promiseArray as we have 10 promises
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        // resolve all promises
        let results = await Promise.all(promiseArray);
        // loop through all results
        for (let r of results) {
          // destructure result
          let [data, err] = r;
          if (err) {
            let msg;
            if (err?.error?.includes('must be unique'))
              msg = 'Lead present in cadence tool';
            else msg = err?.error;
            response.element_error.push({
              sr_no: err?.sr_no,
              cadence_id: cadence_id,
              msg,
            });
            response.total_error++;
            continue;
          } else {
            response.element_success.push({
              sr_no: data?.sr_no,
              cadence_id,
              identifier: data?.lead_cadence_id,
              lead_id: data?.lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }
      if (i === leads.length) {
        logger.info(`Leads have been processed.`);
        break;
      }
      logger.info(`For lead ${i}`);

      // destructure lead
      let lead = leads[i];

      // increment variables
      i++;
      leadCadenceOrderBatch++;

      // assign necessary field to lead
      lead.salesforce_lead_id = lead.integration_id;
      lead.cadence_id = cadence_id;
      lead.integration_type = LEAD_INTEGRATION_TYPES.EXCEL_LEAD;

      // Step: Fetch user
      let [user, errForUser] = await ImportHelper.getUser({
        // If 'E' is present in the 'integration_id', it will be replaced with 'S' for existing Excel users.
        user_integration_id: lead.Owner.OwnerId?.replace('E', 'S'),
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errForUser) {
        response.element_error.push({
          sr_no: lead.sr_no,
          cadence_id,
          msg: errForUser,
        });
        response.total_error++;
        continue;
      }

      // Assign user id to lead
      lead.user_id = user.user_id;

      // Step: Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        response.element_error.push({
          sr_no: lead.sr_no,
          cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        continue;
      }

      // Step: Assign cadence status and leadCadenceOrder to lead
      lead.cadenceStatus = cadence?.status;
      lead.leadCadenceOrder = i + 1;

      promiseArray.push(
        LeadHelper.linkLeadForExcel({
          lead,
          cadence,
          node,
        })
      );
    }

    // resolve all promises
    let results = await Promise.all(promiseArray);
    // loop through all results
    for (let r of results) {
      // destructure result
      let [data, err] = r;
      if (err) {
        let msg;
        if (err?.error?.includes('must be unique'))
          msg = 'Lead present in cadence tool';
        else msg = err?.error;
        response.element_error.push({
          sr_no: err?.sr_no,
          cadence_id: cadence_id,
          msg,
        });
        response.total_error++;
        continue;
      } else {
        response.element_success.push({
          sr_no: data?.sr_no,
          cadence_id,
          identifier: data?.lead_cadence_id,
          lead_id: data?.lead_id,
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
    logger.error('Error while linking excel leads to cadence: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while  linking excel leads to cadence: ${err.message}`,
    });
  }
};

const extractColumns = async (req, res) => {
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
        return badRequestResponseWithDevMsg({
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
    logger.error('An error occurred while fetching CSV Columns : ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching CSV columns: ${err.message}`,
    });
  }
};

const excelController = {
  previewLeads,
  createLeads,
  linkLeads,
  extractColumns,
};

module.exports = excelController;
