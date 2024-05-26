// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  CADENCE_STATUS,
  CADENCE_TYPES,
  LEAD_INTEGRATION_TYPES,
  GSHEETS_LEAD_STATUS,
  USER_INTEGRATION_TYPES,
  CADENCE_LEAD_STATUS,
  GOOGLE_SHEETS_PHONE_NUMBER_FIELDS,
  GOOGLE_SHEETS_EMAIL_FIELDS,
  IMPORT_ERROR_TYPE,
  INTEGRATIONS_TYPE,
  SHEETS_CADENCE_INTEGRATION_TYPE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  EMAIL_REGEX,
  PHONE_REGEX,
  LINKEDIN_REGEX,
  WEBSITE_URL_REGEX,
  GOOGLE_SHEETS_REGEX,
} = require('../../../../../../Cadence-Brain/src/utils/constants');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../../Cadence-Brain/src/utils/constants');
const {
  GOOGLE_SHEETS_LEAD_URL,
} = require('../../../../../../Cadence-Brain/src/utils/config');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');
const NodeRepository = require('../../../../../../Cadence-Brain/src/repository/node.repository');
const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');

//Helpers and Services
const GoogleSheets = require('../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const PhoneNumberHelper = require('../../../../../../Cadence-Brain/src/helper/phone-number');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const JsonHelper = require('../../../../../../Cadence-Brain/src/helper/json');
const leadEmailHelper = require('../../../../../../Cadence-Brain/src/helper/email');
const SocketHelper = require('../../../../../../Cadence-Brain/src/helper/socket');
const LeadsToCadenceHelper = require('../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ImportHelper = require('../../../../../../Cadence-Brain/src/helper/imports');

// Joi
const GoogleSheetsLeadSchema = require('../../../../joi/v2/sales/department/cadence-imports/google-sheets-imports.joi');

const createLeads = async (req, res) => {
  try {
    // Step: JOI Validation
    const body = GoogleSheetsLeadSchema.createLeadsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import google sheets leads',
        error: `Error while fetching google sheets leads: ${body.error.message}`,
      });
    // Step: Destructure body variables
    let { leads, cadence_id, loaderId, url } = req.body;
    // Step: Apply limit of 1000 leads to be imported at a time
    if (leads?.length > 1000)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Cannot import more than 1000 leads at a time`,
      });

    let [updateCadenceIntegrationType, errForUpdateCadenceIntegrationType] =
      await Repository.update({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: req.body.cadence_id,
        },
        updateObject: {
          integration_type: SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS,
        },
      });
    if (errForUpdateCadenceIntegrationType)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add leads',
        error: `Error while update cadence type: ${errForUpdateCadenceIntegrationType}`,
      });

    // Step: Check access to google sheet
    const [___, spreadsheetId, sheetId] = url.match(GOOGLE_SHEETS_REGEX);
    let [{ rows: gsLeads, sheetInfo }, errForGSLeads] =
      await GoogleSheets.getSheet(
        spreadsheetId, // id
        0, // sheet index
        true // get sheet info
      );
    if (errForGSLeads && errForGSLeads?.includes('403'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Please provide edit access to "Anyone with the link" to the google sheet`,
      });
    if (errForGSLeads)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching leads from sheet: ${errForGSLeads}`,
        msg: 'Failed to fetch leads from sheet',
      });

    // Step: Fetch pre-import data
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
      return serverErrorResponseWithDevMsg({ res, msg: 'Cadence not found' });
    if (!cadence?.field_map)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `No field map associated with cadence`,
      });
    if (cadence?.integration_type === SHEETS_CADENCE_INTEGRATION_TYPE.EXCEL)
      return serverErrorResponseWithDevMsg({
        res,
        msg: "You can't add google sheet leads in this cadence",
        error: `Excel leads are already present in this cadence`,
      });

    // Step: Declaring variables
    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    let googleSheetsFieldMap = cadence.field_map;
    let fetchedNodes = {};
    let node = cadence?.Nodes?.[0];
    // stores data to update in google sheet
    let dataToUpdate = [];
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
            const gsLead = gsLeads[data.sr_no - 1];
            gsLead[googleSheetsFieldMap.lead_id] = data.lead_id;
            gsLead[googleSheetsFieldMap.integration_id] = data.integration_id;
            dataToUpdate.push({
              values: [gsLead._rawData],
              range: `${sheetInfo?.name}!A${gsLead._rowNumber}`,
            });
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
      // destructure lead
      let lead = leads[i];

      // increment variables
      i++;
      leadCadenceOrderBatch++;

      // assign necessary field to lead
      lead.salesforce_lead_id = null;
      lead.cadence_id = cadence_id;
      lead.integration_type = LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD;

      logger.info(`For lead ${i}`);

      // Step: Fetch user
      let [user, errForUser] = await ImportHelper.getUser({
        // If 'GS' is present in the 'integration_id', it will be replaced with 'S' for existing Google sheet users
        user_integration_id: lead.Owner.OwnerId?.replace('GS', 'S'),
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

      // Step: Assign cadence status and leadCadenceOrder to lead
      lead.cadenceStatus = cadence?.status;
      lead.leadCadenceOrder = i + 1;

      // Step: push into promise array
      promiseArray.push(
        LeadHelper.createLeadForGoogleSheet({
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
        const gsLead = gsLeads[data.sr_no - 1];
        gsLead[googleSheetsFieldMap.lead_id] = data.lead_id;
        gsLead[googleSheetsFieldMap.integration_id] = data.integration_id;
        dataToUpdate.push({
          values: [gsLead._rawData],
          range: `${sheetInfo?.name}!A${gsLead._rowNumber}`,
        });
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

    // Step: Update data in google sheets
    GoogleSheets.batchUpdate({
      spreadsheetId,
      data: dataToUpdate,
    });

    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
    //return successResponse(res, 'Leads have been processed.', response);
  } catch (err) {
    logger.error('Error while creating google sheets leads: ', err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating google sheets leads: ${err.message}`,
      });
  }
};

const updateLeads = async (req, res) => {
  try {
    const { start, end, url } = req.body;
    if (start == undefined || end == undefined)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Range has to be provided',
      });

    let leads = (await GoogleSheets.getSheet(url))[0].slice(start, end);
    // * Fetch google sheets field map
    let [leadForFieldMap, errFetchingGoogleSheetsFieldMap] =
      await Repository.fetchOne({
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
              [DB_TABLES.GOOGLE_SHEETS_FIELD_MAP]: {},
            },
          },
        },
      });
    if (errFetchingGoogleSheetsFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching field map: ${errFetchingGoogleSheetsFieldMap}`,
        msg: 'Failed to fetch field map',
      });
    if (!leadForFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly ask admin to create field map',
      });
    let googleSheetsFieldMap =
      leadForFieldMap.Company.Company_Setting.Google_Sheets_Field_Map.lead_map;

    let i = 0;
    while (i < leads.length) {
      if (i === leads.length)
        return successResponse(res, 'Leads updated successfully');
      let lead = leads[i];

      let [fetchedLead, errForLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_lead_id: lead.salesforce_lead_id },
        query: {
          integration_id: lead[googleSheetsFieldMap.integration_id],
          integration_type: LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD,
        },
        include: {
          [DB_TABLES.USER]: {
            where: { user_id: lead[googleSheetsFieldMap.user_id] },
            required: true,
          },
        },
      });
      if (errForLead || !fetchedLead) {
        i++;
        continue;
      }

      let accountObject = {
        name: lead?.[googleSheetsFieldMap?.company],
        size: lead?.[googleSheetsFieldMap?.size?.name] ?? null,
        url: lead?.[googleSheetsFieldMap?.url] ?? null,
        country: lead?.[googleSheetsFieldMap?.country] ?? null,
        zipcode: lead?.[googleSheetsFieldMap?.zip_code] ?? null,
      };
      accountObject = JsonHelper.clean(accountObject);
      if (Object.keys(accountObject).length)
        await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          query: { account_id: fetchedLead.account_id },
          updateObject: accountObject,
        });

      let cleanedLead = JsonHelper.clean({
        first_name: lead?.[googleSheetsFieldMap?.first_name],
        last_name: lead?.[googleSheetsFieldMap?.last_name],
        email_validity: lead.Email_Validity__c,
        linkedin_url: lead?.[googleSheetsFieldMap?.linkedin_url],
        source_site: lead?.[googleSheetsFieldMap?.source_site],
        job_position: lead?.[googleSheetsFieldMap?.job_position],
        // integration_status:
        //   lead?.[googleSheetsFieldMap?.integration_status.name],
      });

      let full_name = '';
      if (cleanedLead?.first_name !== undefined)
        full_name += cleanedLead.first_name;
      else full_name += fetchedLead?.first_name;
      if (cleanedLead?.last_name !== undefined)
        full_name += ` ${cleanedLead.last_name}`;
      else full_name += ' ' + fetchedLead?.last_name;

      cleanedLead.full_name = full_name;

      const [updatedLead, err] = await Repository.update({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_lead_id: lead.salesforce_lead_id },
        query: { lead_id: fetchedLead.lead_id },
        updateObject: cleanedLead,
      });

      // * Updating lead phone number
      googleSheetsFieldMap?.phone_numbers.forEach(async (phone_type) => {
        const [fetchedPhone, errForFetchedPhone] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_PHONE_NUMBER,
          query: {
            lead_id: fetchedLead.lead_id,
            type: phone_type,
          },
        });
        if (errForFetchedPhone)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching lead phone number: ${errForFetchedPhone}`,
            msg: 'Failed to fetch lead phone number',
          });
        if (fetchedPhone) {
          if (lead[phone_type] || lead[phone_type] === '')
            PhoneNumberHelper.updatePhoneNumber(
              lead[phone_type],
              phone_type,
              fetchedLead.lead_id
            );
        } else {
          if (lead[phone_type])
            PhoneNumberHelper.createPhoneNumber(
              lead[phone_type],
              phone_type,
              fetchedLead.lead_id
            );
        }
      });

      // * Updating contact email
      googleSheetsFieldMap?.emails.forEach(async (email_type) => {
        const [fetchedEmail, errForFetchedEmail] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_EMAIL,
          query: {
            lead_id: fetchedLead.lead_id,
            type: email_type,
          },
        });
        if (errForFetchedEmail)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching lead email: ${errForFetchedEmail}`,
            msg: 'Failed to fetch lead email',
          });
        if (fetchedEmail) {
          if (lead[email_type] || lead[email_type] === '')
            leadEmailHelper.updateEmail(
              lead[email_type],
              email_type,
              fetchedLead.lead_id
            );
        } else {
          if (lead[email_type])
            leadEmailHelper.createEmailUsingType(
              lead[email_type],
              fetchedLead.lead_id,
              email_type
            );
        }
      });

      // // Lead has been disqualified in salesforce
      // if (
      //   lead?.[googleSheetsFieldMap?.integration_status.name] ===
      //     googleSheetsFieldMap?.integration_status?.disqualified?.value &&
      //   googleSheetsFieldMap?.integration_status?.disqualified?.value !== undefined
      // ) {
      //   await Repository.update({
      //     tableName: DB_TABLES.LEAD,
      //     query: { lead_id: fetchedLead.lead_id },
      //     updateObject: { status: LEAD_STATUS.TRASH },
      //   });

      //   await Repository.create({
      //     tableName: DB_TABLES.STATUS,
      //     createObject: {
      //       lead_id: fetchedLead.lead_id,
      //       status: LEAD_STATUS.TRASH,
      //     },
      //   });

      //   await Repository.update({
      //     tableName: DB_TABLES.LEADTOCADENCE,
      //     query: { lead_id: fetchedLead.lead_id },
      //     updateObject: { status: CADENCE_LEAD_STATUS.STOPPED },
      //   });

      //   const [activityFromTemplate, errForActivityFromTemplate] =
      //     ActivityHelper.getActivityFromTemplates({
      //       type: ACTIVITY_TYPE.LEAD_DISQUALIFIED,
      //       sub_type: ACTIVITY_SUBTYPES.LEAD,
      //       activity: {
      //         lead_id: fetchedLead.lead_id,
      //         incoming: null,
      //       },
      //     });

      //   ActivityHelper.activityCreation(
      //     activityFromTemplate,
      //     fetchedLead.user_id
      //   );
      //   TaskHelper.recalculateDailyTasksForUsers([fetchedLead.user_id]);
      // }

      // // Lead has been converted
      // if (
      //   lead?.[googleSheetsFieldMap?.integration_status.name] ===
      //     googleSheetsFieldMap?.integration_status?.converted?.value &&
      //   googleSheetsFieldMap?.integration_status?.converted?.value !== undefined
      // ) {
      //   logger.info(
      //     'Sf integration: Lead status is converted and changed to account/contact, updating status in lead, create status, stopped cadence, create activity'
      //   );
      //   await Repository.update({
      //     tableName: DB_TABLES.LEAD,
      //     query: { lead_id: fetchedLead.lead_id },
      //     updateObject: {
      //       status: LEAD_STATUS.CONVERTED,
      //       salesforce_lead_id: null,
      //       salesforce_contact_id: lead.ConvertedContactId,
      //       integration_id: lead.ConvertedContactId,
      //       integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
      //     },
      //   });

      //   await Repository.update({
      //     tableName: DB_TABLES.ACCOUNT,
      //     query: { lead_id: fetchedLead.account_id },
      //     updateObject: {
      //       salesforce_account_id: lead.ConvertedAccountId,
      //       integration_id: lead.ConvertedAccountId,
      //       integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
      //     },
      //   });

      //   await Repository.create({
      //     tableName: DB_TABLES.STATUS,
      //     createObject: {
      //       lead_id: fetchedLead.lead_id,
      //       status: LEAD_STATUS.CONVERTED,
      //     },
      //   });

      //   await Repository.update({
      //     tableName: DB_TABLES.LEADTOCADENCE,
      //     query: { lead_id: fetchedLead.lead_id },
      //     updateObject: { status: CADENCE_LEAD_STATUS.STOPPED },
      //   });

      //   const [activityFromTemplate, errForActivityFromTemplate] =
      //     ActivityHelper.getActivityFromTemplates({
      //       type: ACTIVITY_TYPE.LEAD_CONVERTED,
      //       sub_type: ACTIVITY_SUBTYPES.LEAD,
      //       activity: {
      //         lead_id: fetchedLead.lead_id,
      //         incoming: null,
      //       },
      //     });

      //   ActivityHelper.activityCreation(
      //     activityFromTemplate,
      //     fetchedLead.user_id
      //   );
      //   TaskHelper.recalculateDailyTasksForUsers([fetchedLead.user_id]);
      // }

      i++;
      if (i === leads.length)
        return successResponse(res, 'Leads updated successfully');
    }
    return successResponse(res, 'Leads updated successfully');
  } catch (err) {
    logger.error('Error while updating leads from google sheets:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating leads from google sheets: ${err.message}`,
    });
  }
};

const previewLeads = async (req, res) => {
  let loaderId = req.body?.loaderId;
  if (!loaderId || !req.body.field_map)
    return badRequestResponseWithDevMsg({
      res,
      error: `One of the things from loaderId, field_map is missing`,
    });
  try {
    //cadence id from body
    let body = GoogleSheetsLeadSchema.leadsPreviewSchema.validate(req.body);
    if (body.error)
      return badRequestResponseWithDevMsg({
        res,
        error: body.error.details[0].message,
      });

    body = body.value;
    const { field_map } = body;
    const [_, spreadsheetId, sheetId] = req.body.url.match(GOOGLE_SHEETS_REGEX);

    let [leads, errForLeads] = await GoogleSheets.getSheet(spreadsheetId);
    if (errForLeads?.includes('403'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Please provide edit access to "Anyone with the link" to the google sheet`,
      });
    if (errForLeads)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching lead from google sheet: ${errForLeads}`,
        msg: 'Failed to fetch leads from google sheet',
      });

    try {
      await leads[0]?.save();
    } catch (err) {
      if (err.message?.includes('403'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Please provide edit access to "Anyone with the link" to the google sheet`,
        });
      else
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while previewing leads: ${err.message}`,
        });
    }

    const [cadence, errForfetchingCadencee] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id: body.cadence_id },
    });
    if (errForfetchingCadencee)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching cadence: ${errForUpdate}`,
        msg: 'Failed to fetch cadence',
      });
    if (!cadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cadence not found',
      });
    if (cadence?.integration_type === SHEETS_CADENCE_INTEGRATION_TYPE.EXCEL)
      return badRequestResponseWithDevMsg({
        res,
        msg: "You can't add google sheets leads in this cadence",
        error: `Excel leads are already present in this cadence`,
      });

    const [__, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.CADENCE,
      updateObject: { salesforce_cadence_id: spreadsheetId, field_map },
      query: { cadence_id: body.cadence_id },
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating cadence: ${errForUpdate}`,
        msg: 'Failed to update cadence',
      });

    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_error: [],
    };
    let leadsToPreview = [];

    // * to store fetched users, so that we do not fetch repeatedly for same one's
    let fetchedUsers = {};

    // * Fetch google sheets field map
    //let [userForFieldMap, errFetchingUser] = await Repository.fetchOne({
    //tableName: DB_TABLES.USER,
    //query: {
    //user_id: req.user.user_id,
    //},
    //extras: {
    //attributes: ['first_name'],
    //},
    //include: {
    //[DB_TABLES.COMPANY]: {
    //attributes: ['name'],
    //[DB_TABLES.COMPANY_SETTINGS]: {
    //[DB_TABLES.GOOGLE_SHEETS_FIELD_MAP]: {},
    //},
    //},
    //},
    //});
    //if (errFetchingUser) return serverErrorResponse(res, errFetchingUser);
    //if (!userForFieldMap)
    //return serverErrorResponse(res, 'Kindly ask admin to create field map');

    //let googleSheetsFieldMap =
    //userForFieldMap?.Company?.Company_Setting?.Google_Sheets_Field_Map
    //?.lead_map;
    let googleSheetsFieldMap = field_map;

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

      if (lead?._rawData[0] === 'empty row') {
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
      const filteredRows = lead?._rawData?.filter(
        (element) => element?.trim() !== ''
      );
      if (filteredRows.length < 1) {
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: ++i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // removing empty spaces
      const rowData = lead?._rawData?.map((element) => element.trim());
      lead._rawData = rowData;

      // * Check if lead already exists
      if (lead[googleSheetsFieldMap.integration_id]) {
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: ++i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      if (lead[googleSheetsFieldMap.status] == LEAD_STATUS.CONVERTED) {
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: ++i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Phone validation
      let phone_number = [];
      if (lead[googleSheetsFieldMap.primary_phone]) {
        if (!PHONE_REGEX.test(lead[googleSheetsFieldMap.primary_phone])) {
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
        phone_number: lead[googleSheetsFieldMap.primary_phone] || '',
        type: googleSheetsFieldMap.primary_phone,
      });

      googleSheetsFieldMap?.phone_numbers.forEach((phone_type) => {
        if (lead[phone_type]) {
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
          phone_number: lead[phone_type] ?? '',
          type: phone_type,
        });
      });
      lead.phone_number = phone_number;

      // * Email validation
      let emails = [];
      if (lead[googleSheetsFieldMap.primary_email]) {
        if (!EMAIL_REGEX.test(lead[googleSheetsFieldMap.primary_email])) {
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
        email_id: lead[googleSheetsFieldMap.primary_email] || '',
        type: googleSheetsFieldMap.primary_email,
      });

      googleSheetsFieldMap?.emails.forEach((email_field) => {
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
          email_id: lead[email_field] ?? '',
          type: email_field,
        });
      });
      lead.emails = emails;

      // Linkedin link validation
      if (lead[googleSheetsFieldMap.linkedin_url]) {
        if (!LINKEDIN_REGEX.test(lead[googleSheetsFieldMap.linkedin_url])) {
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
      if (lead[googleSheetsFieldMap.url]) {
        if (!WEBSITE_URL_REGEX.test(lead[googleSheetsFieldMap.url])) {
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

      // company phone number validation
      if (lead[googleSheetsFieldMap.company_phone_number]) {
        if (
          !PHONE_REGEX.test(lead[googleSheetsFieldMap.company_phone_number])
        ) {
          let errMsg = `Company phone number is invalid`;
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
      Object.keys(googleSheetsFieldMap).forEach((key) => {
        createdLead[googleSheetsFieldMap[key]] =
          lead[googleSheetsFieldMap[key]];
      });
      createdLead.emails = lead.emails;
      createdLead.phone_number = lead.phone_number;
      createdLead['Full Name'] =
        lead[googleSheetsFieldMap.first_name] +
        ' ' +
        lead[googleSheetsFieldMap.last_name];

      //const [existingLead, errForExistingLead] = await Repository.fetchOne({
      //tableName: DB_TABLES.LEAD,
      //query: {
      //first_name: lead[googleSheetsFieldMap.first_name] || '',
      //last_name: lead[googleSheetsFieldMap.last_name] || '',
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
      //createdLead.status = GSHEETS_LEAD_STATUS.LEAD_PRESENT_IN_TOOL;
      //let cadences = existingLead.LeadToCadences.map((leadToCadence) => {
      //return {
      //cadence_id: leadToCadence.Cadences[0].cadence_id,
      //name: leadToCadence.Cadences[0].name,
      //};
      //});
      //createdLead.cadences = cadences;
      //createdLead.lead_id = existingLead.lead_id;
      //createdLead.integration_id = existingLead.integration_id;
      //}

      logger.info(`For lead ${i}`);

      let user = null,
        userErr = null;

      // if user is not already fetched, fetch it
      if (
        lead[googleSheetsFieldMap.owner_integration_id] &&
        !fetchedUsers[lead[googleSheetsFieldMap.owner_integration_id]]
      ) {
        // Check if user with given salesforce owner id is found
        [user, userErr] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            // If 'GS' is present in the 'integration_id', it will be replaced with 'S' for existing Google sheet users
            integration_id: lead?.[
              googleSheetsFieldMap.owner_integration_id
            ]?.replace('GS', 'S'),
            company_id: req.user.company_id,
            // integration_type: USER_INTEGRATION_TYPES.GOOGLE_SHEETS_USER,
            //user_id: lead[googleSheetsFieldMap.user_id],
          },
        });

        fetchedUsers[lead[googleSheetsFieldMap.owner_integration_id]] = user;
      } else
        user = fetchedUsers[lead[googleSheetsFieldMap.owner_integration_id]];

      if (userErr || !user || user === null) {
        logger.info('Owner not present in our tool.');
        createdLead.status = GSHEETS_LEAD_STATUS.USER_NOT_PRESENT;
      } else {
        createdLead.owner_full_name =
          (user?.first_name || '') + ' ' + (user?.last_name || '');
        lead.user_id = user?.user_id;
      }

      if (!createdLead.status)
        createdLead.status = GSHEETS_LEAD_STATUS.LEAD_ABSENT_IN_TOOL;

      // Cheking Required Values
      let values = [
        googleSheetsFieldMap.first_name,
        googleSheetsFieldMap.company,
        googleSheetsFieldMap.owner_integration_id,
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
      } else response.total_success++;

      createdLead.sr_no = i + 1;

      // Structure lead
      let structuredLead = {};

      if (createdLead[googleSheetsFieldMap.first_name]?.length > 50) {
        response.total_error++;
        createdLead.fieldStatus = "First name can't be more than 50 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "First name can't be more than 50 characters",
        });
      }

      if (createdLead[googleSheetsFieldMap.last_name]?.length > 75) {
        response.total_error++;
        createdLead.fieldStatus = "Last name can't be more than 75 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Last name can't be more than 75 characters",
        });
      }

      if (createdLead[googleSheetsFieldMap.job_position]?.length > 100) {
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

      if (createdLead[googleSheetsFieldMap.company]?.length > 200) {
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

      if (createdLead[googleSheetsFieldMap.country]?.length > 100) {
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

      if (createdLead[googleSheetsFieldMap.zip_code]?.length > 10) {
        response.total_error++;
        createdLead.fieldStatus = "Zipcode can't be more than 10 characters";
        createdLead.status = 'another';
        response.element_error.push({
          sr_no: i + 1,
          cadence_id: lead.cadence_id,
          msg: "Zipcode can't be more than 10 characters",
        });
      }

      if (createdLead[googleSheetsFieldMap.size]?.length > 25) {
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

      structuredLead.first_name =
        createdLead[googleSheetsFieldMap.first_name] || '';
      structuredLead.last_name =
        createdLead[googleSheetsFieldMap.last_name] || '';
      structuredLead.job_position =
        createdLead[googleSheetsFieldMap.job_position] || '';
      structuredLead.emails = createdLead.emails || [];
      structuredLead.phone_numbers = createdLead.phone_number || [];
      structuredLead.linkedin_url =
        createdLead[googleSheetsFieldMap.linkedin_url] || '';
      structuredLead.primary_email =
        createdLead[googleSheetsFieldMap.primary_email] || '';
      structuredLead.primary_phone =
        createdLead[googleSheetsFieldMap.primary_phone] || '';
      structuredLead.size = createdLead[googleSheetsFieldMap.size] || '';
      structuredLead.zip_code =
        createdLead[googleSheetsFieldMap.zip_code] || '';
      structuredLead.country = createdLead[googleSheetsFieldMap.country] || '';
      structuredLead.company = createdLead[googleSheetsFieldMap.company] || '';
      structuredLead.url = createdLead[googleSheetsFieldMap.url] || '';
      structuredLead.company_phone_number =
        createdLead[googleSheetsFieldMap.company_phone_number] || '';
      structuredLead.Owner = {
        Name: createdLead?.owner_full_name || '',
        OwnerId: lead[googleSheetsFieldMap.owner_integration_id] || '',
      };
      structuredLead.status = createdLead.status || '';
      structuredLead.fieldStatus = createdLead.fieldStatus || '';
      structuredLead.sr_no = createdLead.sr_no;
      structuredLead.cadences = createdLead.cadences || [];
      structuredLead.lead_id = createdLead.lead_id;
      structuredLead.integration_id = createdLead.integration_id;
      structuredLead.owner_integration_id =
        lead[googleSheetsFieldMap.owner_integration_id] || '';

      leadsToPreview.push(structuredLead);
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: ++i,
          size: leads.length,
        },
        socketId: loaderId,
      });
      //lead['DB Status'] = 'Previewed';
      //lead.save();
      if (i === leads.length) {
        response.previewLeads = leadsToPreview;
        return SocketHelper.sendCadenceImportResponseEvent({
          response_data: { data: response, error: null },
          socketId: loaderId,
        });
        //return successResponse(res, 'Leads have been processed.', response);
      }
    }
  } catch (err) {
    logger.error('Error while creating google sheets leads: ', err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while processing google sheets leads: ${err.message}`,
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

const linkLeads = async (req, res) => {
  try {
    // * JOI Validation
    // const body = salesforceImportSchema.importSalesforceLeadSchema.validate(
    //   req.body
    // );
    // if (body.error) return serverErrorResponse(res, body.error.message);

    // * Destructure request
    const { leads, cadence_id, loaderId, stopPreviousCadences, url } = req.body;

    if (leads?.length > 1000)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Cannot import more than 1000 leads at a time`,
      });

    // check access to google sheet
    const [___, spreadsheetId, sheetId] = url.match(GOOGLE_SHEETS_REGEX);
    let [{ rows: gsLeads, sheetInfo }, errForGSLeads] =
      await GoogleSheets.getSheet(
        spreadsheetId, // id
        0, // sheet index
        true // get sheet info
      );
    if (errForGSLeads && errForGSLeads?.includes('403'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Please provide edit access to "Anyone with the link" to the google sheet`,
      });
    if (errForGSLeads) {
      if (errForGSLeads.includes('Duplicate header detected'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Duplicate columns found. Please ensure no duplicate columns are present in your sheet',
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching leads from google sheet: ${errForGSLeads}`,
        msg: 'Failed to fetch leads from google sheet',
      });
    }

    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };

    // TODO:URGENT
    // let [admin, errForAdmin] = await UserRepository.findUserByQuery({
    //   role: USER_ROLE.SUPER_ADMIN,
    // });
    // if (errForAdmin) return serverErrorResponse(res, 'Unable to find admin');
    // if (!admin) return serverErrorResponse(res, 'Unable to find admin');

    // * Check if cadence exists
    let [cadenceFromGSheets, errFetchingCadenceFromGSheets] =
      await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id },
      });
    if (errFetchingCadenceFromGSheets)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to find cadence',
      });
    if (!cadenceFromGSheets.salesforce_cadence_id)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cadence not linked with any google sheet yet',
      });
    let salesforce_cadence_id = cadenceFromGSheets.salesforce_cadence_id;
    let googleSheetsFieldMap = cadenceFromGSheets.field_map;

    let dataToUpdate = [];
    let leadCadenceOrderBatch = -1;

    while (i < leads.length) {
      leadCadenceOrderBatch++;
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0)
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
      if (i === leads.length) break;
      let leadObj = leads[i];

      // Cheking Required Values
      //let values = [
      //googleSheetsFieldMap.first_name,
      //googleSheetsFieldMap.company,
      //googleSheetsFieldMap.owner_integration_id,
      //];
      //let errMsg = '';
      //values.forEach((val) => {
      //if (!leadObj[val]) {
      //if (errMsg) errMsg += ',';
      //errMsg += val + ' ';
      //}
      //});
      //if (errMsg) {
      //errMsg += 'is required values';
      //response.total_error++;
      //response.element_error.push({
      //sr_no: leadObj.sr_no,
      //cadence_id: leadObj.cadence_id,
      //msg: errMsg,
      //});
      //i++;
      //continue;
      //}

      leadObj.salesforce_lead_id = leadObj.integration_id;
      leadObj.integration_id = leadObj.integration_id;
      leadObj.lead_id = leadObj.lead_id;
      leadObj.cadence_id = cadence_id;

      logger.info(`Processing link for Lead ${i}`);

      const [lead, err] = await LeadRepository.getLeadByQuery({
        integration_id: leadObj.integration_id,
      });
      if (!lead) {
        logger.info(`Given lead does not exist`);
        response.element_error.push({
          sr_no: leadObj.sr_no,
          cadence_id: leadObj.cadence_id,
          msg: 'Lead does not exist',
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

      // * Stop all cadences of lead
      if (stopPreviousCadences) {
        // * Fetch cadences to
        let cadence_ids = [];

        for (let leadToCadence of lead.LeadToCadences)
          cadence_ids.push(leadToCadence.cadence_id);

        await LeadHelper.stopCadenceForLead(lead, cadence_ids, req.user);
      }

      const [cadence, errForCadence] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: leadObj.cadence_id },
        include: {
          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: ['name'],
          },
          [DB_TABLES.USER]: {
            attributes: ['first_name', 'last_name'],
          },
        },
      });

      if (!cadence || errForCadence) {
        logger.info(`Given cadence does not exist`);
        response.element_error.push({
          sr_no: leadObj.sr_no,
          cadence_id: leadObj.cadence_id,
          msg: 'Cadence does not exist',
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
      // Check if user with given salesforce owner id is found
      let [user, userErr] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          // If 'GS' is present in the 'integration_id', it will be replaced with 'S' for existing Google sheet users
          integration_id: leadObj.owner_integration_id?.replace('GS', 'S'),
        },
        include: {
          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: ['name'],
          },
        },
      });
      if (userErr || user === null) {
        logger.info('Owner not present in our tool.');
        response.element_error.push({
          sr_no: leadObj.sr_no,
          cadence_id: cadence.cadence_id,
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

      // Check if the user has access to the cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        response.element_error.push({
          sr_no: lead.sr_no,
          cadence_id: cadence.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
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

      const [link, errForGetLink] =
        await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery({
          lead_id: lead.lead_id,
          cadence_id: leadObj.cadence_id,
        });

      const gsLead = gsLeads[leadObj.sr_no - 1];
      gsLead[googleSheetsFieldMap.lead_id] = leadObj.lead_id;
      gsLead[googleSheetsFieldMap.integration_id] = leadObj.integration_id;

      dataToUpdate.push({
        values: [gsLead._rawData],
        range: `${sheetInfo?.name}!A${gsLead._rowNumber}`,
      });
      // Link does not exist
      if (link.length === 0) {
        logger.info(`Link does not exist`);
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
            sr_no: leadObj.sr_no,
            cadence_id: leadObj.cadence_id,
            msg: errForLink,
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

        if (cadence.status === CADENCE_LEAD_STATUS.IN_PROGRESS) {
          const [tasks, errForTask] = await TaskRepository.getTasks({
            lead_id: lead.lead_id,
            cadence_id: leadObj.cadence_id,
          });

          if (!errForTask && tasks.length === 0) {
            const [node, errForNode] = await NodeRepository.getNode({
              cadence_id: cadence.cadence_id,
              is_first: 1,
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
          sr_no: leadObj.sr_no,
          lead_cadence_id: createdLink.lead_cadence_id,
          cadence_id: leadObj.cadence_id,
          lead_id: link[0]?.lead_id,
          status: createdLink.status,
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
        continue;
      } else {
        // Link already exists
        logger.info(`Link already exists`);

        response.element_success.push({
          sr_no: leadObj.sr_no,
          lead_cadence_id: link[0]?.lead_cadence_id,
          cadence_id: leadObj.cadence_id,
          lead_id: link[0]?.lead_id,
          status: link[0]?.status,
        });
        response.total_success++;
      }

      i++;
      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: i,
          size: leads.length,
        },
        socketId: loaderId,
      });
      //if (i === leads.length) break;
    }

    // if leads length is less than 10 or last batch of leads had less than 10 leads
    if (leads.length < 10 || leadCadenceOrderBatch % 10 != 0)
      LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    GoogleSheets.batchUpdate({
      spreadsheetId,
      data: dataToUpdate,
    });
    return successResponse(res, 'Links have been processed.', response);
  } catch (err) {
    logger.error(`Error while linking leads to cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while linking leads to cadence: ${err.message}`,
    });
  }
};

const resyncLeads = async (req, res) => {
  try {
    let { cadence_id, loaderId } = req.body;

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
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
        msg: 'Failed to fetch cadence',
      });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence',
        error: `Cadence does not exist`,
      });
    if (!cadence.salesforce_cadence_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Cadence is not linked with any google sheet`,
      });

    const spreadsheetId = cadence.salesforce_cadence_id;

    let [{ rows: leads, sheetInfo }, errForGSLeads] =
      await GoogleSheets.getSheet(
        spreadsheetId, // id
        0, // sheet index
        true // get sheet details
      );
    if (errForGSLeads && errForGSLeads?.includes('403'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Please provide edit access to "Anyone with the link" to the google sheet`,
      });
    if (errForGSLeads && errForGSLeads?.includes('404'))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Google sheet does not exist anymore`,
      });
    if (errForGSLeads) {
      if (errForGSLeads.includes('Duplicate header detected'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Duplicate columns found. Please ensure no duplicate columns are present in your sheet',
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching leads from google sheet: ${errForGSLeads}`,
        msg: 'Failed to fetch leads from google sheet',
      });
    }
    if (!sheetInfo.name)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cannot read your sheet',
      });

    try {
      await leads[0]?.save();
    } catch (err) {
      if (err.message?.includes('403'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Please provide edit access to "Anyone with the link" to the google sheet`,
        });
      else
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while resyncing leads: ${err.message}`,
        });
    }

    let i = 0;
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

    // * Fetch google sheets field map
    let [userForFieldMap, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      extras: {
        attributes: ['first_name', 'last_name'],
      },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['name'],
          [DB_TABLES.COMPANY_SETTINGS]: {
            [DB_TABLES.GOOGLE_SHEETS_FIELD_MAP]: {},
          },
        },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['name'],
        },
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to resync leads',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    if (!userForFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly ask admin to create field map',
      });

    let googleSheetsFieldMap = cadence.field_map;

    successResponse(
      res,
      'Resync has been started, please check after some time.'
    );

    // update resynching status to true for cadence
    Repository.update({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      updateObject: {
        resynching: 1,
      },
    });

    let sheet_lead_ids = [];
    let dataToUpdate = [];
    let leadCadenceOrderBatch = -1;

    while (i <= leads.length) {
      leadCadenceOrderBatch++;
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0)
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
      if (i === leads.length) {
        logger.info('Finished resyncing.');
        break;
      }
      //return successResponse(res, 'Leads have been processed.', response);

      let lead = leads[i];
      lead.cadence_id = cadence_id;

      logger.info(`For lead ${i}`);
      const rowData = lead?._rawData?.map((element) => element.trim());
      lead._rawData = rowData;

      // Phone Validation
      if (lead[googleSheetsFieldMap.primary_phone]) {
        if (!PHONE_REGEX.test(lead[googleSheetsFieldMap.primary_phone])) {
          i++;
          logger.error(`Primary phone number is invalid`);
          continue;
        }
      }
      let isPhoneErr = false;
      googleSheetsFieldMap?.phone_numbers.forEach((phone_type) => {
        if (lead[phone_type]) {
          if (!PHONE_REGEX.test(lead[phone_type])) {
            logger.error(`${phone_type} number is invalid`);
            isPhoneErr = true;
          }
        }
      });
      if (isPhoneErr) {
        i++;
        continue;
      }

      // Email Validation
      if (lead[googleSheetsFieldMap.primary_email]) {
        if (!EMAIL_REGEX.test(lead[googleSheetsFieldMap.primary_email])) {
          logger.error('Primary email is invalid');
          i++;
          continue;
        }
      }
      let emailErr = false;
      googleSheetsFieldMap?.emails.forEach((email_field) => {
        if (lead[email_field]) {
          if (!EMAIL_REGEX.test(lead[email_field])) {
            logger.error(`${email_field} is invalid`);
            emailErr = true;
          }
        }
      });
      if (emailErr) {
        i++;
        continue;
      }

      // Linkedin link validation
      if (lead[googleSheetsFieldMap.linkedin_url]) {
        if (!LINKEDIN_REGEX.test(lead[googleSheetsFieldMap.linkedin_url])) {
          logger.error(`Linkedin url is invalid`);
          i++;
          continue;
        }
      }

      // company website link validation
      if (lead[googleSheetsFieldMap.url]) {
        if (!WEBSITE_URL_REGEX.test(lead[googleSheetsFieldMap.url])) {
          logger.error(`Company website url is invalid`);
          i++;
          continue;
        }
      }

      // company phone number validation
      if (lead[googleSheetsFieldMap.company_phone_number]) {
        if (
          !PHONE_REGEX.test(lead[googleSheetsFieldMap.company_phone_number])
        ) {
          logger.error(`Company phone number is invalid`);
          i++;
          continue;
        }
      }

      // Other fields lenght limit validations
      if (lead[googleSheetsFieldMap.first_name]?.length > 50) {
        logger.error("First name can't be more than 50 characters");
        i++;
        continue;
      }
      if (lead[googleSheetsFieldMap.last_name]?.length > 75) {
        logger.error("Last name can't be more than 75 characters");
        i++;
        continue;
      }
      if (lead[googleSheetsFieldMap.job_position]?.length > 100) {
        logger.error("Job Position can't be more than 100 characters");
        i++;
        continue;
      }
      if (lead[googleSheetsFieldMap.company]?.length > 200) {
        logger.error("Company name can't be more than 200 characters");
        i++;
        continue;
      }
      if (lead[googleSheetsFieldMap.country]?.length > 100) {
        logger.error("Country name can't be more than 100 characters");
        i++;
        continue;
      }
      if (lead[googleSheetsFieldMap.zip_code]?.length > 10) {
        logger.error("Zipcode can't be more than 10 characters");
        i++;
        continue;
      }
      if (lead[googleSheetsFieldMap.size]?.length > 25) {
        logger.error("Company size can't be more than 25 characters");
        i++;
        continue;
      }

      if (!lead[googleSheetsFieldMap.lead_id]) {
        // * Creating leads
        lead.salesforce_lead_id = lead[googleSheetsFieldMap.integration_id];
        lead.integration_type = LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD;
        // Check if user with given salesforce owner id is found
        let [user, userErr] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          //query: { salesforce_owner_id: lead.salesforce_owner_id },
          query: {
            // integration_id: lead.salesforce_owner_id,
            // integration_type: USER_INTEGRATION_TYPES.SALESFORCE_OWNER,
            // If 'GS' is present in the 'integration_id', it will be replaced with 'S' for existing Google sheet users
            integration_id: lead?.[googleSheetsFieldMap.owner_integration_id]
              ?.trim()
              ?.replace('GS', 'S'),
          },
        });
        if (userErr || user === null) {
          logger.info('Owner not present in our tool.');
          response.element_error.push({
            sr_no: i + 1,
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

        lead.user_id = user.user_id;

        let node,
          errForNode = null;

        // Check if the user has access to the cadence
        let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
          cadence,
          user,
        });
        if (errCheckingAccess) {
          response.element_error.push({
            sr_no: i + 1,
            cadence_id: lead.cadence_id,
            msg: errCheckingAccess,
            type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
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

        let t = await sequelize.transaction();

        // * Phone validation
        let phone_number = [];
        if (lead[googleSheetsFieldMap.primary_phone])
          phone_number.push({
            phone_number: lead[googleSheetsFieldMap.primary_phone],
            type: googleSheetsFieldMap.primary_phone,
          });
        googleSheetsFieldMap?.phone_numbers.forEach((phone_type) => {
          if (lead[phone_type])
            phone_number.push({
              phone_number: lead[phone_type],
              type: phone_type,
            });
        });
        //lead.phone_number = phone_number;
        if (phone_number.length > 0) lead.phone_number = phone_number;

        // * Email validation
        let emails = [];
        if (lead[googleSheetsFieldMap.primary_email])
          emails.push({
            email_id: lead[googleSheetsFieldMap.primary_email],
            type: googleSheetsFieldMap.primary_email,
          });
        googleSheetsFieldMap?.emails.forEach((email_field) => {
          if (lead[email_field])
            emails.push({ email_id: lead[email_field], type: email_field });
        });
        //lead.emails = emails;
        if (emails.length > 0) lead.emails = emails;

        //const [createdLead, err] =
        //await LeadRepository.createAndAssignLeadFromSalesforce(lead);
        lead.salesforce_lead_id = lead.integration_id;
        lead.leadCadenceOrder = leadCadenceOrderBatch + 1;
        //console.log(lead.phone_number);
        let [{ createdLead, account }, err] = await LeadHelper.createLead(
          lead,
          googleSheetsFieldMap,
          user.company_id,
          t
        );
        if (err) {
          let msg;
          if (err.includes('must be unique'))
            msg = 'Lead present in cadence tool';
          else msg = err;
          t.rollback();
          response.element_error.push({
            sr_no: i + 1,
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
          //fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id]--;
          continue;
        }

        //createdLead = createdLead.createdLead;
        //if (lead?.[googleSheetsFieldMap.company_phone_number]) {
        //const [__, errForUpdateAccount] = await Repository.update({
        //tableName: DB_TABLES.ACCOUNT,
        //updateObject: {
        //phone_number: lead[googleSheetsFieldMap.company_phone_number],
        //},
        //query: { account_id: account.account_id },
        //t,
        //});
        //if (errForUpdateAccount)
        //return serverErrorResponse(res, errForUpdateAccount);
        //}

        await t.commit(); // need to use await since we are updating integration_id after so we need to make sure it is created before execution reaches update step

        lead[googleSheetsFieldMap.lead_id] = createdLead.lead_id;
        lead[googleSheetsFieldMap.integration_id] =
          lead[googleSheetsFieldMap.owner_integration_id] + createdLead.lead_id;

        dataToUpdate.push({
          values: [lead._rawData],
          range: `${sheetInfo?.name}!A${lead._rowNumber}`,
        });

        const [_, errForUpdate] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: {
            lead_id: createdLead.lead_id,
          },
          updateObject: {
            integration_id: lead[googleSheetsFieldMap.integration_id],
          },
        });
        if (errForUpdate)
          logger.error(
            `Could not update integration id for lead ${createdLead?.lead_id}`
          );
        //return serverErrorResponse(res, errForUpdate);

        if (!errForCadence && cadence) {
          // * cadence found, check for its status
          if (cadence?.status === CADENCE_STATUS.IN_PROGRESS) {
            // * see if node is already fetched
            if (fetchedNodes[lead.cadence_id])
              node = fetchedNodes[lead.cadence_id];
            // * cadence is in progress, start cadence for this lead
            else {
              [node, errForNode] = await Repository.fetchOne({
                tableName: DB_TABLES.NODE,
                query: {
                  cadence_id: lead.cadence_id,
                  is_first: 1,
                },
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
               * since it is possible that we get many leads at once in this route
               * In that case tasks wont show up if we calculate after every lead is created
               * */
              if (taskCreated)
                TaskHelper.recalculateDailyTasksForUsers([createdLead.user_id]);
            }
          }
        }

        response.element_success.push({
          sr_no: i + 1,
          //integration_id: lead.salesforce_lead_id,
          cadence_id: lead.cadence_id,
          identifier: createdLead.lead_cadence_id,
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
      } else {
        // updating leads
        if (i === leads.length) {
          logger.info('Finished resynching.');
          break;
        } //return successResponse(res, 'Leads updated successfully', response);

        let [fetchedLead, errForLead] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          //query: { salesforce_lead_id: lead.salesforce_lead_id },
          query: {
            lead_id: lead[googleSheetsFieldMap.lead_id],
            integration_type: LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD,
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                // If 'GS' is present in the 'integration_id', it will be replaced with 'S' for existing Google sheet users
                integration_id: lead?.[
                  googleSheetsFieldMap.owner_integration_id
                ]
                  ?.trim()
                  ?.replace('GS', 'S'),
              },
              required: true,
            },
          },
        });
        if (errForLead || !fetchedLead) {
          logger.info('Lead does not exist or owner does not exist in tool');
          response.element_error.push({
            sr_no: i + 1,
            cadence_id: lead.cadence_id,
            msg: 'Lead does not exist or owner does not exist in tool',
          });
          response.total_error++;
          i++;
          continue;
        }

        let cleanedLead = JsonHelper.clean({
          first_name: lead?.[googleSheetsFieldMap?.first_name],
          last_name: lead?.[googleSheetsFieldMap?.last_name],
          linkedin_url: lead?.[googleSheetsFieldMap?.linkedin_url],
          job_position: lead?.[googleSheetsFieldMap?.job_position],
          // integration_status:
          //   lead?.[googleSheetsFieldMap?.integration_status.name],
        });

        let full_name = '';
        if (cleanedLead?.first_name !== undefined)
          full_name += cleanedLead.first_name;
        else full_name += fetchedLead?.first_name;
        if (cleanedLead?.last_name !== undefined)
          full_name += ` ${cleanedLead.last_name}`;
        else full_name += ' ' + fetchedLead?.last_name;

        cleanedLead.full_name = full_name;

        const [updatedLead, err] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          //query: { salesforce_lead_id: lead.salesforce_lead_id },
          query: { lead_id: fetchedLead.lead_id },
          updateObject: cleanedLead,
        });
        //if (err) serverErrorResponse(res, err);
        if (err) logger.error(`Could not update lead: `, err);
        // * Updating lead phone number
        let lead_phone_numbers =
          googleSheetsFieldMap?.phone_numbers?.concat(
            googleSheetsFieldMap?.primary_phone
          ) || [];
        //lead_phone_numbers?.forEach(async (phone_type) => {
        for (let phone_type of lead_phone_numbers) {
          const [fetchedPhone, errForFetchedPhone] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD_PHONE_NUMBER,
            query: {
              lead_id: fetchedLead.lead_id,
              type: phone_type,
            },
          });
          //if (errForFetchedPhone)
          //return serverErrorResponse(res, errForFetchedPhone);
          if (errForFetchedPhone)
            logger.error(
              `Error while fetching phone for type: ${phone_type} and lead_id: ${fetchedLead.lead_id}`
            );

          if (fetchedPhone) {
            if (
              (lead[phone_type] || lead[phone_type] === '') &&
              lead[phone_type] !== fetchedPhone?.phone_number
            )
              PhoneNumberHelper.updatePhoneNumber(
                lead[phone_type],
                phone_type,
                fetchedLead.lead_id
              );
          } else {
            if (lead[phone_type])
              Repository.create({
                tableName: DB_TABLES.LEAD_PHONE_NUMBER,
                createObject: {
                  type: phone_type,
                  phone_number: lead[phone_type],
                  lead_id: fetchedLead.lead_id,
                  is_primary:
                    phone_type === googleSheetsFieldMap?.primary_phone ? 1 : 0,
                },
              });

            //PhoneNumberHelper.createPhoneNumber(
            //lead[phone_type],
            //phone_type,
            //fetchedLead.lead_id
            //);
          }
        }

        // * Updating contact email
        let lead_emails =
          googleSheetsFieldMap?.emails?.concat(
            googleSheetsFieldMap?.primary_email
          ) || [];
        //lead_emails.forEach(async (email_type) => {
        for (let email_type of lead_emails) {
          const [fetchedEmail, errForFetchedEmail] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD_EMAIL,
            query: {
              lead_id: fetchedLead.lead_id,
              type: email_type,
            },
          });
          //if (errForFetchedEmail)
          //return serverErrorResponse(res, errForFetchedEmail);
          if (errForFetchedEmail)
            logger.error(
              `Error while fetching emails for type: ${email_type} and lead_id: ${fetchedLead.lead_id}`
            );
          if (fetchedEmail) {
            if (
              (lead[email_type] || lead[email_type] === '') &&
              lead[email_type] !== fetchedEmail?.email_id
            )
              leadEmailHelper.updateEmail(
                lead[email_type],
                email_type,
                fetchedLead.lead_id
              );
          } else {
            if (lead[email_type])
              Repository.create({
                tableName: DB_TABLES.LEAD_EMAIL,
                createObject: {
                  type: email_type,
                  email_id: lead[email_type],
                  lead_id: fetchedLead.lead_id,
                  is_primary:
                    email_type === googleSheetsFieldMap?.primary_email ? 1 : 0,
                },
              });
            //leadEmailHelper.createEmailUsingType(
            //lead[email_type],
            //fetchedLead.lead_id,
            //email_type
            //);
          }
        }

        // Updating Account details
        let cleannedAccountDetails = JsonHelper.clean({
          name: lead?.[googleSheetsFieldMap?.company],
          phone_number: lead[googleSheetsFieldMap.company_phone_number] || '',
          size: lead?.[googleSheetsFieldMap?.size] || '',
          zipcode: lead?.[googleSheetsFieldMap?.zip_code] || null,
          country: lead?.[googleSheetsFieldMap?.country] || '',
          url: lead?.[googleSheetsFieldMap?.url] || '',
          linkedin_url: lead?.[googleSheetsFieldMap?.linkedin_url] || '',
          // integration_status:
          //   lead?.[googleSheetsFieldMap?.integration_status.name],
        });
        const [__, errForUpdateAccount] = await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          updateObject: cleannedAccountDetails,
          query: {
            account_id: fetchedLead.account_id,
          },
        });
        //if (errForUpdateAccount)
        //return serverErrorResponse(res, errForUpdateAccount);
        if (errForUpdateAccount)
          logger.error(`Error while updating account: ${errForUpdateAccount}`);

        response.element_success.push({
          sr_no: i + 1,
          //integration_id: lead.salesforce_lead_id,
          cadence_id: lead.cadence_id,
          // identifier: createdLead.lead_cadence_id,
        });
        response.total_success++;
        i++;
        //if (i === leads.length)
        //return successResponse(res, 'Leads have been processed', response);
      }

      sheet_lead_ids.push(lead[googleSheetsFieldMap.lead_id]);
    }

    const [fecthLeadsInCadence, errForFetchingLeadsInCadence] =
      await Repository.fetchAll({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: {
          cadence_id: cadence_id,
          lead_id: { [Op.notIn]: sheet_lead_ids },
        },
        attributes: ['lead_id', 'account_id'],
      });
    if (errForFetchingLeadsInCadence)
      logger.error(
        'Err for fetching leads from cadence',
        errForFetchingLeadsInCadence
      );

    let lead_ids = [];
    let account_ids = [];
    fecthLeadsInCadence.forEach((lead) => {
      lead_ids.push(lead.lead_id);
      account_ids.push(lead.account_id);
    });

    // Deleting leads which are not present in excel
    if (lead_ids.length > 0) {
      const [deletedAllLeadInfo, errForDeletedAllLeadInfo] =
        await LeadHelper.deleteAllLeadInfo({
          leadIds: lead_ids,
          accountIds: account_ids,
        });
      if (errForDeletedAllLeadInfo) {
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to resync leads',
          error: `Error while deleting all lead info: ${errForDeletedAllLeadInfo}`,
        });
      }
    }

    if (leads.length < 10 || leadCadenceOrderBatch % 10 != 0)
      LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    // update all info in one batch
    await GoogleSheets.batchUpdate({
      spreadsheetId,
      data: dataToUpdate,
    });

    let [leadsInCadence, errForLeadsInCadence] = await Repository.count({
      tableName: DB_TABLES.LEADTOCADENCE,
      query: { cadence_id: cadence_id },
    });
    if (errForLeadsInCadence)
      logger.error('Error while fetching lead to cadnce', errForLeadsInCadence);

    if (!leadsInCadence) {
      let [updateCadenceType, errForCadenceType] = await Repository.update({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: cadence_id },
        updateObject: { integration_type: null },
      });
      if (errForCadenceType)
        logger.error('Error while updating cadence type', errForCadenceType);
    } else {
      let [updateCadenceType, errForCadenceType] = await Repository.update({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: cadence_id },
        updateObject: {
          integration_type: SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS,
        },
      });
      if (errForCadenceType)
        logger.error('Error while updating cadence type', errForCadenceType);
    }

    // update resynching status to false for cadence
    Repository.update({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      updateObject: {
        resynching: 0,
      },
    });
  } catch (err) {
    logger.error('Error while resyncing google sheets leads: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while resyncing google sheet leads: ${err.message}`,
    });
  }
};

const fetchHeaders = async (req, res) => {
  try {
    // STEP : JOI check
    const validation = GoogleSheetsLeadSchema.fetchHeadersSchema.validate(
      req.body
    );
    if (validation.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to fetch headers',
        error: validation.error.message,
      });

    // STEP:  fetch id from url
    const [_, spreadsheetId, sheetId] = req.body.url.match(GOOGLE_SHEETS_REGEX);

    // STEP : Load doc
    const [doc, errForDoc] = await GoogleSheets.loadDocument(spreadsheetId);
    if (errForDoc) {
      if (errForDoc?.includes('403'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Please provide edit access to "Anyone with the link" to the google sheet`,
        });
      if (errForDoc?.includes('404'))
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please provide valid google sheets url`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Something went wrong while reading google sheet headers`,
      });
    }

    // STEP: fetch sheet no. 0
    const sheet = doc.sheetsByIndex[0];

    // STEP: load header row, loaded value will be found in sheet.headerValues
    await sheet.loadHeaderRow();
    const filteredHeader = sheet?.headerValues?.filter(
      (element) => element !== ''
    );

    return successResponse(
      res,
      `Fetched headers of the google sheet successfully`,
      {
        headers: filteredHeader || [],
      }
    );
  } catch (err) {
    logger.error(`Error while fetching google sheet headers: `, err);
    if (
      err?.message?.includes('Duplicate header detected') ||
      err.message?.includes('No values in the header row')
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: err.message,
      });
    return serverErrorResponseWithDevMsg({
      res,
      msg: `Something went wrong while reading google sheet headers`,
    });
  }
};

const sheetsController = {
  createLeads,
  updateLeads,
  previewLeads,
  linkLeads,
  resyncLeads,
  fetchHeaders,
};

module.exports = sheetsController;
