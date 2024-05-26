// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
} = require('../../../../../utils/response');
const {
  LEAD_CADENCE_ORDER_MAX,
  PIPEDRIVE_PHONE_FIELDS,
  PIPEDRIVE_EMAIL_FIELDS,
} = require('../../../../../../../Cadence-Brain/src/utils/constants');
const {
  SALESFORCE_LEAD_IMPORT_STATUS,
  CADENCE_STATUS,
  CADENCE_TYPES,
  CRM_INTEGRATIONS,
  PIPEDRIVE_VIEW_TYPES,
  LEAD_INTEGRATION_TYPES,
  CADENCE_LEAD_STATUS,
  PIPEDRIVE_CSV_IMPORT_FIELDS,
  IMPORT_ERROR_TYPE,
  ACCOUNT_INTEGRATION_TYPES,
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
const GoogleSheets = require('../../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const PipedriveHelper = require('../../../../../../../Cadence-Brain/src/helper/pipedrive');
const TaskHelper = require('../../../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const CadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/cadence');
const SocketHelper = require('../../../../../../../Cadence-Brain/src/helper/socket');
const LeadsToCadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ImportHelper = require('../../../../../../../Cadence-Brain/src/helper/imports');
const PipedriveService = require('../../../../../../../Cadence-Brain/src/services/Pipedrive');
const ExcelHelper = require('../../../../../../../Cadence-Brain/src/helper/excel');

// Joi validation
const pipedriveImportSchema = require('../../../../../joi/v2/sales/department/cadence-imports/pipedrive-imports.joi');

// * gRPC
const v2GrpcClients = require('./../../../../../../../Cadence-Brain/src/grpc/v2');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../../../Cadence-Brain/src/utils/modelEnums');
const { FRONTEND_URL } = require('../../../../../utils/config');

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

      const headers = workbook_response[0].filter((item) => item !== '');

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
    const body = pipedriveImportSchema.fetchSheetsColumnsSchema.validate(
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
      error: `Error while fetching google ssheets columns: ${err.message}`,
    });
  }
};

// * Import list/lead/contact from pipedrive
const importPipedriveDataToCadence = async (req, res) => {
  try {
    // * JOI Validation
    const query = pipedriveImportSchema.importDataToCadenceSchema.validate(
      req.query
    );
    if (query.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from Pipedrive',
        error: `${query.error.message}`,
      });

    // * Destructuring
    let { resource, view, selectedIds, excludedIds, filter, filter_id } =
      query.value;

    // * Fetch company field map
    let [companyFieldMap, errFetchingCompanyFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errFetchingCompanyFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import pipedrive data to cadence',
        error: `Error while fetching fieldmap for company from user: ${errFetchingCompanyFieldMap}`,
      });

    // * Fetch Pipedrive access tokens and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from Pipedrive',
        error: `Error while fetching tokens for Pipedrive: ${errForAccessToken}.`,
      });

    let leads,
      err,
      decodedLeads = [];
    switch (view) {
      case PIPEDRIVE_VIEW_TYPES.LIST:
        {
          // * Fetch leads from pipedrive
          [leads, err] = await PipedriveHelper.getPersonList({
            resource,
            selectedIds,
            excludedIds,
            userFilter: filter,
            access_token,
            instance_url,
          });
        }
        break;
      case PIPEDRIVE_VIEW_TYPES.DETAILS: {
        [leads, err] = await v2GrpcClients.crmIntegration.getContact({
          integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
          integration_data: {
            access_token,
            instance_url,
            person_id: selectedIds,
          },
        });
        leads.data = [leads.data];
        break;
      }
      case PIPEDRIVE_VIEW_TYPES.CUSTOM_VIEW:
        {
          // * Fetch leads from pipedrive
          [leads, err] = await PipedriveHelper.getPersonOfFilter({
            filter_id,
            access_token,
            instance_url,
          });
          selectedIds = '';
          if (!leads?.data)
            return successResponse(res, 'Successfully fetched list data', []);
          leads.data.map((lead) => {
            selectedIds = `${selectedIds},${lead.id}`;
          });
        }
        break;
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to import data from Pipedrive',
          error: 'Invalid view',
        });
    }
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from Pipedrive',
        error: `Error while fetching leads : ${err}`,
      });

    let personIdList = selectedIds.split(',');

    if (personIdList?.[0] === '') {
      personIdList = [];

      for (let lead of leads.data) personIdList.push(lead.id);
    }

    // * Fetch leads from database using person Id's
    let [leadsFromDB, errFetchingLeadsFromDB] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        [Op.or]: {
          integration_id: personIdList,
        },
        integration_type: LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON,
      },
      include: {
        [DB_TABLES.USER]: {
          [DB_TABLES.COMPANY]: {
            where: { company_id: req.user.company_id },
            required: true,
          },
          required: true,
        },
      },
    });
    if (errFetchingLeadsFromDB)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from Pipedrive',
        error: `Error while fetching leads from db: ${errFetchingLeadsFromDB}`,
      });

    // * Merge results from pipedrive and database
    let userMap = {};
    let orgMap = {};
    leads = leads.data;
    for (let lead of leads) {
      let isUserPresentInDB = false;

      let phone_numbers = [];
      let emails = [];

      let decodedPerson = {
        first_name: lead[companyFieldMap?.person_map?.first_name],
        last_name: lead[companyFieldMap?.person_map?.last_name],
        linkedin_url: lead[companyFieldMap?.person_map?.linkedin_url],
        source_site: lead[companyFieldMap?.person_map?.source_site],
        job_position: lead[companyFieldMap?.person_map?.job_position],
        Id: lead.id,
        Owner: {
          Name: lead?.owner_id?.name,
          OwnerId: lead?.owner_id?.id,
        },
      };

      // * Integrate account
      if (lead.org_id) {
        let organization,
          errFetchingOrganization = false;
        if (lead.org_id.value in orgMap)
          organization = orgMap[lead.org_id.value];
        else {
          [organization, err] = await v2GrpcClients.crmIntegration.getAccount({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            integration_data: {
              id: lead.org_id.value,
              access_token,
              instance_url,
            },
          });
          organization = organization.data;
          orgMap[lead.org_id.value] = organization;
        }
        if (errFetchingOrganization) continue;

        decodedPerson.Account = {
          Id: organization.id,
          url: organization?.[companyFieldMap?.organization_map?.url],
          size: organization?.[companyFieldMap?.organization_map?.size?.name],
          country: organization?.[companyFieldMap?.organization_map?.country],
          name: organization?.[companyFieldMap?.organization_map?.name],
          zipcode: organization?.[companyFieldMap?.organization_map?.zip_code],
          phone_number:
            organization?.[companyFieldMap?.organization_map?.phone_number],
        };
      }

      // * Integrate Person phone number
      lead[companyFieldMap?.person_map?.phone_numbers].forEach((phoneObj) => {
        phone_numbers.push({
          phone_number: phoneObj.value,
          type: phoneObj.label,
        });
      });

      decodedPerson.phone_numbers = phone_numbers;

      // * Lead emails
      lead[companyFieldMap?.person_map?.emails].forEach((emailObj) => {
        emails.push({ email_id: emailObj.value, type: emailObj.label });
      });

      decodedPerson.emails = emails;

      if (!(lead.owner_id in userMap)) {
        let [user, errFetchingUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id: lead.owner_id.id,
            company_id: req.user.company_id,
          },
        });
        if (errFetchingUser) continue;
        if (!user) {
          userMap[lead.owner_id] = false;
          isUserPresentInDB = false;
        } else {
          userMap[lead.owner_id] = true;
          isUserPresentInDB = true;
        }
      } else isUserPresentInDB = userMap[lead.owner_id];

      if (!isUserPresentInDB) {
        decodedPerson.status = SALESFORCE_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        decodedLeads.push(decodedPerson);

        continue;
      }
      var isPresent = leadsFromDB.filter(function (value) {
        return value.integration_id == lead.id;
      });

      if (isPresent.length > 0) {
        decodedPerson.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        decodedPerson.lead_id = isPresent[0].lead_id;
      } else
        decodedPerson.status =
          SALESFORCE_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

      decodedLeads.push(decodedPerson);
    }

    return successResponse(res, 'Successfully fetched list data', decodedLeads);
  } catch (err) {
    logger.error(
      `Error ocurred while fetching import data from pipedrive: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching import data from Pipedrive: ${err.message}`,
    });
  }
};

// * Import persons
const importPipedrivePersons = async (req, res) => {
  try {
    // * JOI Validation
    const body = pipedriveImportSchema.importPipedrivePersonsSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import Pipedrive persons',
        error: `Error while importing Pipedrive person: ${body.error.message}`,
      });

    // * Destructure request
    const { persons: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Pipedrive persons',
        error: 'Persons array is empty',
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
      integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Pipedrive persons',
        error: errFetchingPreImportData,
      });

    let pipedriveOrganizationMap = companyFieldMap.organization_map;
    let pipedrivePersonMap = companyFieldMap.person_map;

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
              msg = `Lead is already present in <a href = "${FRONTEND_URL}/crm/cadence/${cadence.cadence_id}?view=list" target = "_blank"><strong>${cadence.name}</strong><a>`;
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
      }

      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;

      logger.info(`For lead: ${lead.Id}`);
      if (!lead.Id) {
        logger.info('Pipedrive person id is not present');
        response.element_error.push({
          integration_id: null,
          cadence_id,
          msg: 'Pipedrive person id not present',
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

      // * Phone validation
      let phone_number = [];
      lead?.phone_numbers?.forEach((pn) => {
        phone_number.push({ phone_number: pn?.phone_number, type: pn.type });
      });
      lead.phone_number = phone_number;

      // * Email validation
      let emails = [];
      lead?.emails.forEach((em) => {
        emails.push({ email_id: em?.email_id, type: em.type });
      });
      lead.emails = emails;

      // Check if user with given pipedrive owner id is found
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        logger.info('Owner not present in cadence tool.');
        response.element_error.push({
          integration_id: lead.Id,
          cadence_id,
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

      // * Deletes pipedrive owner id from the lead object and add user id
      delete lead.pipedrive_owner_id;
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          integration_id: lead.Id,
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
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createLeadFromPipedrive({
          lead,
          cadence,
          node,
          company_id: user.company_id,
          access_token,
          instance_url,
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
          msg = `Lead is already present in <a href = "${FRONTEND_URL}/crm/cadence/${cadence.cadence_id}?view=list" target = "_blank"><strong>${cadence.name}</strong><a>`;
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

    // * Send success response with socket
    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create persons in tool from pipedrive: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating person in tool from Pipedrive: ${err.message}`,
    });
  }
};

// * Import Temp persons
const importPipedriveTempPersons = async (req, res) => {
  try {
    // * JOI Validation
    const body = pipedriveImportSchema.importPipedrivePersonsSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create persons in tool for integrations Pipedrive',
        error: `Error while creating person in tool: ${body.error.message}`,
      });

    // * Destructure request
    const { persons: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create persons in tool for integration Pipedrive',
        error: 'Persons array is empty',
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
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
      });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create persons in tool for integration Pipedrive',
        error: errFetchingPreImportData,
      });

    // * Send success response indicating processing has been started
    successResponse(
      res,
      'Started importing persons, please check back after some time'
    );

    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              person_preview_id: r[1].preview_id,
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
              person_preview_id: r[0].preview_id,
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

      //* Organization name check
      if (!lead?.Account?.name) {
        logger.info('Pipedrive organization name is not present');
        i++;
        response.element_error.push({
          person_preview_id: lead.preview_id,
          cadence_id: lead.cadence_id,
          msg: 'Pipedrive organization name not present',
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

      // Check if user with given pipedrive owner id is found
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.OwnerId,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        logger.info('Owner not present in cadence tool.');
        response.element_error.push({
          person_preview_id: lead.preview_id,
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

      // * Deletes pipedrive owner id from the lead object and add user id
      delete lead.integration_owner_id;
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          person_preview_id: lead.preview_id,
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
          person_preview_id: r[1].preview_id,
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
          person_preview_id: r[0].preview_id,
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
      `An error ocurred while trying to create persons in tool for integration pipedrive: `,
      { err, user_id: req.user.user_id }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating person in tool for integration Pipedrive: ${err.message}`,
    });
  }
};

// * Link existing person to cadence
const linkPersonWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = pipedriveImportSchema.importPipedrivePersonsSchema.validate(
      req.body
    );
    if (body.error)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to link person with cadence',
        error: `Error while linking person with cadence: ${body.error.message}`,
      });

    // * Destructure request
    const {
      persons: leads,
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
      integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Unable to import leads',
        error: errFetchingPreImportData,
      });

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
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
              type: r[1].type,
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

      logger.info(`Processing link for ${lead.Id}`);

      promiseArray.push(
        LeadHelper.linkPipedriveLeadWithCadence({
          lead_id: lead.lead_id,
          integration_id: lead.Id,
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
          type: r[1].type,
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

    // * Send success response with socket if websocket is true
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
    logger.error(`Error while linking persons to cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while linking persons to cadence: ${err.message}`,
    });
  }
};

const previewLeadsForCSVImport = async (req, res) => {
  const { loaderId } = req.body;
  if (!loaderId)
    return badRequestResponseWithDevMsg({
      res,
      error: 'loaderId is missing',
    });
  try {
    // * Parse field map
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }

    // * JOI Validation
    let body = pipedriveImportSchema.leadsPreviewSchemaForCSV.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    body = body.value;
    const { loaderId, field_map: pipedriveFieldMap } = body;

    // File validation
    const supportedExtensions = ['xlsx', 'xls', 'csv'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );
    let leads, errForLeads;
    if (supportedExtensions.includes(fileExtension.toLowerCase())) {
      // Read the file to ensure it is valid
      [leads, errForLeads] = await ExcelHelper.parseXlsx(req.file.path, 500);
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
    successResponse(
      res,
      'Started importing, please check back after some time'
    );

    const ownerIdRegex = /^\d+$/;

    while (i < leads.length) {
      let data = leads[i];

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });

      let createdLead = {
        Id: `lead_${i}`,
        first_name: data[pipedriveFieldMap?.first_name]?.trim() || null,
        last_name: data[pipedriveFieldMap?.last_name]?.trim() || null,
        linkedin_url: data[pipedriveFieldMap?.linkedin_url]?.trim() || null,
        job_position: data[pipedriveFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: '',
          OwnerId: data[pipedriveFieldMap?.pipedrive_owner_id]?.trim() || null,
        },
        Account: {
          name: data[pipedriveFieldMap?.company_name]?.trim() || null,
          phone_number:
            data[pipedriveFieldMap?.company_phone_number]?.trim() || null,
          linkedin_url:
            data[pipedriveFieldMap?.company_linkedin_url]?.trim() || null,
          size: data[pipedriveFieldMap?.size]?.trim() || null,
          url: data[pipedriveFieldMap?.url]?.trim() || null,
          country: data[pipedriveFieldMap?.country]?.trim() || null,
          zipcode: data[pipedriveFieldMap?.zip_code]?.trim() || null,
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
      pipedriveFieldMap?.phone_numbers?.forEach((phone_number) => {
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
      pipedriveFieldMap?.emails?.forEach((email) => {
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
      if (isEmptyRow) continue;

      createdLead.integration_type =
        LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.PIPEDRIVE_CSV_ORGANIZATION;
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // * Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`First name not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`Last name not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.PIPEDRIVE_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`Company name not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }

      if (missingFields?.length) {
        createdLead.status = missingFields
          .join(', ')
          .concat(' should be present');
        createdLead.is_success = false;
      }
      // * Field format validation
      else if (
        createdLead?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdLead.linkedin_url)
      ) {
        logger.error(`Linkedin url should be valid`);
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.LINKEDIN_URL} should be valid`;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.URL} is invalid`;
      } else if (
        createdLead?.Account?.phone_number &&
        !PHONE_REGEX.test(createdLead?.Account?.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
      } else if (
        createdLead?.Owner?.OwnerId &&
        !ownerIdRegex.test(createdLead.Owner.OwnerId)
      ) {
        logger.error(`Owner Id is invalid`);
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.PIPEDRIVE_OWNER_ID} is invalid`;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
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

      createdLead.sr_no = i;
      leadsToPreview.push(createdLead);
    }

    SocketHelper.sendCadenceImportResponseEvent({
      response_data: { leads: leadsToPreview, error: null },
      socketId: loaderId,
    });
    // return successResponse(res, 'Leads have been processed.', response);
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
      socketId: loaderId,
    });
  }
};

const previewLeadsForSheetsImport = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body.field_map || !req.body.url)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, field_map or url is missing`,
    });
  try {
    // * JOI Validation
    const body = pipedriveImportSchema.leadsPreviewSchemaForSheets.validate(
      req.body
    );
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads from google sheet',
        error: body.error.details[0].message,
      });

    const {
      loaderId,
      url,
      cadence_id,
      field_map: pipedriveFieldMap,
    } = body.value;
    const [_, spreadsheetId, sheetId] = url.match(GOOGLE_SHEETS_REGEX);

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
      'Started importing, please check back after some time'
    );

    const ownerIdRegex = /^\d+$/;

    while (i < leads.length) {
      let data = leads[i];
      logger.info(`For lead ${i + 1}`);

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });

      if (
        data?._rawData.includes(
          'Make a copy (File > Make a Copy) of this Google Sheet for your reference'
        )
      )
        continue;

      let createdLead = {
        Id: `lead_${i}`,
        first_name: data[pipedriveFieldMap?.first_name]?.trim() || null,
        last_name: data[pipedriveFieldMap?.last_name]?.trim() || null,
        linkedin_url: data[pipedriveFieldMap?.linkedin_url]?.trim() || null,
        job_position: data[pipedriveFieldMap?.job_position]?.trim() || null,
        emails: [],
        phone_numbers: [],
        Owner: {
          Name: '',
          OwnerId: data[pipedriveFieldMap?.pipedrive_owner_id]?.trim() || null,
        },
        Account: {
          name: data[pipedriveFieldMap?.company_name]?.trim() || null,
          phone_number:
            data[pipedriveFieldMap?.company_phone_number]?.trim() || null,
          linkedin_url:
            data[pipedriveFieldMap?.company_linkedin_url]?.trim() || null,
          size: data[pipedriveFieldMap?.size]?.trim() || null,
          url: data[pipedriveFieldMap?.url]?.trim() || null,
          country: data[pipedriveFieldMap?.country]?.trim() || null,
          zipcode: data[pipedriveFieldMap?.zip_code]?.trim() || null,
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
      pipedriveFieldMap?.phone_numbers?.forEach((phone_number) => {
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
      pipedriveFieldMap?.emails?.forEach((email) => {
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
      if (isEmptyRow) continue;

      createdLead.integration_type =
        LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON;
      createdLead.Account.integration_type =
        ACCOUNT_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_ORGANIZATION;
      createdLead.is_success = true; // for error handling

      let missingFields = [];

      // * Checking data of required fields
      if (!createdLead?.first_name) {
        logger.info(`First name not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.FIRST_NAME);
      }
      if (!createdLead?.last_name) {
        logger.info(`Last name not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.LAST_NAME);
      }
      if (!createdLead?.Owner?.OwnerId) {
        logger.info(`Owner not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.PIPEDRIVE_OWNER_ID);
      }
      if (!createdLead?.Account?.name) {
        logger.info(`Company name not present in CSV.`);
        missingFields.push(PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_NAME);
      }

      if (missingFields?.length) {
        createdLead.status = missingFields
          .join(', ')
          .concat(' should be present');
        createdLead.is_success = false;
      }

      // * Field format validation
      else if (
        createdLead?.linkedin_url &&
        !LINKEDIN_REGEX.test(createdLead.linkedin_url)
      ) {
        logger.error(`Linkedin url should be valid`);
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.LINKEDIN_URL} should be valid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.url &&
        !WEBSITE_URL_REGEX.test(createdLead?.Account?.url)
      ) {
        logger.error(`Company website url is invalid`);
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.URL} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Account?.phone_number &&
        !PHONE_REGEX.test(createdLead?.Account?.phone_number)
      ) {
        logger.error(`Company phone number is invalid`);
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER} is invalid`;
        createdLead.is_success = false;
      } else if (
        createdLead?.Owner?.OwnerId &&
        !ownerIdRegex.test(createdLead.Owner.OwnerId)
      ) {
        logger.error(`Owner Id is invalid`);
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.PIPEDRIVE_OWNER_ID} is invalid`;
        createdLead.is_success = false;
      }
      // fields length limit validations
      else if (createdLead?.first_name?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.FIRST_NAME} can't be more than 50 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.last_name?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.LAST_NAME} can't be more than 75 characters`;
        createdLead.is_success = false;
      } else if (createdLead?.job_position?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.JOB_POSITION} can't be more than 100 characters`;
      } else if (createdLead?.Account?.name?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_NAME} can't be more than 200 characters`;
      } else if (createdLead?.Account?.country?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.COUNTRY} can't be more than 100 characters`;
      } else if (createdLead?.Account?.zipcode?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.ZIP_CODE} can't be more than 10 characters`;
      } else if (createdLead?.Account?.size?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        createdLead.is_success = false;
        createdLead.status = `${PIPEDRIVE_CSV_IMPORT_FIELDS.SIZE} can't be more than 25 characters`;
      }

      if (phoneErrMsg?.length && !createdLead?.status?.length) {
        createdLead.status = phoneErrMsg.join(', ').concat(' should be valid');
        createdLead.is_success = false;
      }

      if (emailErrMsg?.length && !createdLead?.status?.length) {
        createdLead.status = emailErrMsg.join(', ').concat(' should be valid');
        createdLead.is_success = false;
      }
      // Checking data of required fields
      if (createdLead?.Owner?.OwnerId) {
        let [user, errFetchingUser] = await ImportHelper.getUser({
          user_integration_id: createdLead?.Owner?.OwnerId,
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
      socketId: loaderId,
    });
  }
};

const getCustomViews = async (req, res) => {
  try {
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        user_id: req.user.user_id,
      });

    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Pipedrive',
      });

    const [data, errorFetchingViews] = await PipedriveService.fetchCustomViews({
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

    return successResponse(res, 'Fetched view successfully', data?.data);
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

const CadenceImportController = {
  getCSVColumns,
  getSheetsColumns,
  importPipedriveDataToCadence,
  importPipedrivePersons,
  importPipedriveTempPersons,
  linkPersonWithCadence,
  previewLeadsForCSVImport,
  previewLeadsForSheetsImport,
  getCustomViews,
};

module.exports = CadenceImportController;
