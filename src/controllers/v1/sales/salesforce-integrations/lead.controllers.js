// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponse,
  badRequestResponse,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  CADENCE_STATUS,
  CADENCE_LEAD_STATUS,
  ACTIVITY_TYPE,
  ACTIVITY_SUBTYPES,
  SALESFORCE_SOBJECTS,
  CADENCE_TYPES,
  WORKFLOW_TRIGGERS,
  USER_INTEGRATION_TYPES,
  LEAD_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  LEAD_SCORE_RUBRIKS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../../Cadence-Brain/src/utils/constants');
const {
  SERVER_URL,
} = require('../../../../../../Cadence-Brain/src/utils/config');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');
const axios = require('axios');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');

// Helpers and services
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const PhoneNumberHelper = require('../../../../../../Cadence-Brain/src/helper/phone-number');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const SalesforceHelper = require('../../../../../../Cadence-Brain/src/helper/salesforce');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const JsonHelper = require('../../../../../../Cadence-Brain/src/helper/json');
const leadEmailHelper = require('../../../../../../Cadence-Brain/src/helper/email');
const WorkflowHelper = require('../../../../../../Cadence-Brain/src/helper/workflow');
const CompanyHelper = require('../../../../../../Cadence-Brain/src/helper/company');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../Cadence-Brain/src/helper/company-field-map');
const LeadScoreHelper = require('../../../../../../Cadence-Brain/src/helper/lead-score/');

// * GRPC Imports
const v2GrpcClients = require('../../../../../../Cadence-Brain/src/grpc/v2');

const createLeads = async (req, res) => {
  try {
    const { leads } = req.body;
    if (leads === undefined || leads.length === 0)
      return badRequestResponse(res, 'Leads array in empty');
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

    // Fetch salesforce admin
    let [salesforceAdmin, errForSalesforceAdmin] =
      await CompanyHelper.getSalesforceUserForCompany({
        company_id: req.company_id,
      });
    if (errForSalesforceAdmin)
      return serverErrorResponse(res, errForSalesforceAdmin);

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: salesforceAdmin.user_id,
      });

    // * Fetch salesforce field map
    let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
      await SalesforceHelper.getFieldMapForCompanyFromUser(
        salesforceAdmin.user_id,
        SALESFORCE_SOBJECTS.LEAD
      );
    if (errFetchingSalesforceFieldMap)
      return serverErrorResponse(res, errFetchingSalesforceFieldMap);

    while (i <= leads.length) {
      if (i === leads.length)
        return successResponse(res, 'Leads have been processed.', response);

      let lead = leads[i];

      lead.integration_type = LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD;

      logger.info(`For lead id: ${lead.salesforce_lead_id}`);
      if (
        lead.salesforce_lead_id === null ||
        lead.salesforce_lead_id === undefined ||
        lead.salesforce_lead_id === ''
      ) {
        logger.info('Lead id not present');
        response.element_error.push({
          salesforce_lead_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Salesforce lead id not present',
        });
        response.total_error++;
        i++;
        continue;
      }

      // * Phone validation
      let phone_number = [];
      salesforceFieldMap?.phone_numbers.forEach((phone_type) => {
        phone_number.push({ phone_number: lead[phone_type], type: phone_type });
      });
      lead.phone_number = phone_number;

      // * Email validation
      let emails = [];
      salesforceFieldMap?.emails.forEach((email_field) => {
        emails.push({ email_id: lead[email_field], type: email_field });
      });
      lead.emails = emails;

      // Check if user with given salesforce owner id is found
      let [user, userErr] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        //query: { salesforce_owner_id: lead.salesforce_owner_id },
        query: {
          integration_id: lead.salesforce_owner_id,
          integration_type: USER_INTEGRATION_TYPES.SALESFORCE_OWNER,
        },
      });
      if (userErr || user === null) {
        logger.info('Owner not present in our tool.');
        response.element_error.push({
          salesforce_lead_id: lead.salesforce_lead_id,
          cadence_id: lead.cadence_id,
          msg: 'Owner id not present in cadence tool',
        });
        response.total_error++;
        i++;
        continue;
      }

      // Deletes salesforce owner id from the lead object and add user id
      delete lead.salesforce_owner_id;
      lead.user_id = user.user_id;

      // Checks for duplicates in Salesforce
      const [duplicate, errForDuplicate] =
        await SalesforceService.checkDuplicates(
          lead.salesforce_lead_id,
          access_token,
          instance_url
        );
      if (duplicate) lead.duplicate = true;

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
            salesforce_contact_id: lead.salesforce_contact_id,
            cadence_id: lead.cadence_id,
            msg: 'This user does not have access to this cadence.',
          });
          response.total_error++;
          i++;
          continue;
        }

        lead.cadenceStatus = cadence?.status;
      } else {
        [cadence, errForCadence] = await Repository.fetchOne({
          tableName: DB_TABLES.CADENCE,
          query: {
            cadence_id: lead.cadence_id,
          },
        });
        if (!cadence) {
          logger.info('Cadence not present.');
          response.element_error.push({
            salesforce_lead_id: lead.salesforce_lead_id,
            cadence_id: lead.cadence_id,
            msg: 'Cadence does not exist in cadence tool.',
          });
          response.total_error++;
          i++;
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
            salesforce_contact_id: lead.salesforce_contact_id,
            cadence_id: lead.cadence_id,
            msg: 'This user does not have access to this cadence.',
          });
          response.total_error++;
          i++;
          continue;
        }

        fetchedCadences[lead.cadence_id] = cadence;
        lead.cadenceStatus = cadence?.status;

        fetchedCadenceUserOrder[lead.cadence_id] = {};
      }

      // * If entry of lead_cadence_order for user in cadence exists, use it
      if (fetchedCadences[lead.cadence_id][lead.user_id]) {
        // * append leadCadenceOrder to lead
        lead.leadCadenceOrder =
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

        // * increment leadCadenceOrder by 1 after assigning to lead is over
        fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id]++;
      }

      let t = await sequelize.transaction();

      //const [createdLead, err] =
      //await LeadRepository.createAndAssignLeadFromSalesforce(lead);
      let [createdLead, err] = await LeadHelper.createLead(
        lead,
        salesforceFieldMap,
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
          salesforce_lead_id: lead.salesforce_lead_id,
          cadence_id: lead.cadence_id,
          msg,
        });
        response.total_error++;
        i++;
        fetchedCadenceUserOrder[lead?.cadence_id][lead.user_id]--;
        continue;
      }

      createdLead = createdLead.createdLead;

      t.commit();

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
                null,
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
        salesforce_lead_id: lead.salesforce_lead_id,
        //integration_id: lead.salesforce_lead_id,
        cadence_id: lead.cadence_id,
        identifier: createdLead.lead_cadence_id,
      });
      response.total_success++;
      i++;

      if (i === leads.length)
        return successResponse(res, 'Leads have been processed.', response);
    }
  } catch (err) {
    logger.error('Error while creating salesforce leads: ', err);
    return serverErrorResponse(res);
  }
};

const getLeadsBySalesforceLeadId = async (req, res) => {
  try {
    const { id: salesforce_lead_id } = req.params;
    if (!salesforce_lead_id)
      return badRequestResponse(res, 'Lead id cannot be empty.');

    const [lead, err] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      //query: { salesforce_lead_id },
      query: {
        integration_id: salesforce_lead_id,
        integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
      },
      include: {
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['lead_id', 'cadence_id', 'status'],
        },
        [DB_TABLES.LEAD_EMAIL]: { attributes: ['email_id', 'type'] },
        [DB_TABLES.LEAD_PHONE_NUMBER]: { attributes: ['phone_number', 'type'] },
        [DB_TABLES.USER]: {
          where: { company_id: req.company_id },
          required: true,
          attributes: [
            'first_name',
            'last_name',
            'integration_id',
            'integration_type',
          ],
        },
      },
      extras: {
        attributes: [
          'first_name',
          'last_name',
          'integration_id',
          'integration_type',
          'status',
        ],
      },
    });
    if (err) return serverErrorResponse(res);
    if (!lead) return badRequestResponse(res, 'No lead found.');

    return successResponse(res, 'Lead found in cadence tool.', lead);
  } catch (err) {
    logger.error('Error while updating lead: ', err);
    return serverErrorResponse(res);
  }
};

const updateLeads = async (req, res) => {
  try {
    axios.put(`${SERVER_URL}/webhook/v1/salesforce/lead`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Leads updated successfully`);
    const { leads } = req.body;
    if (leads === undefined || leads.length === 0)
      return badRequestResponse(res, 'Array cannot be empty');

    // * Fetch salesforce field map
    let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
      await SalesforceHelper.getFieldMapForCompanyFromCompany(req.company_id);
    if (errFetchingSalesforceFieldMap)
      return badRequestResponse(res, errFetchingSalesforceFieldMap);
    let leadSalesforceMap = salesforceFieldMap.lead_map;

    let i = 0;

    console.log('[debug-update-lead] Updating lead...');
    console.log(leads);

    while (i < leads.length) {
      if (i === leads.length)
        return successResponse(res, 'Leads updated successfully');
      let lead = leads[i];

      let [fetchedLead, errForLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_lead_id: lead.salesforce_lead_id },
        query: {
          integration_id: lead.salesforce_lead_id,
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
        },
        include: {
          [DB_TABLES.USER]: {
            where: { company_id: req.company_id },
            required: true,
          },
        },
      });

      console.log('[debug-update-lead] Fetched lead ===>');
      console.log(fetchedLead?.lead_id);

      // * Send lead to automated workflow irrespective of whether the lead exists in database or not
      v2GrpcClients.advancedWorkflow.updateSalesforceLead({
        integration_data: {
          lead,
          fetchedLead: fetchedLead ?? null,
          company_id: req.company_id,
        },
      });

      if (errForLead || !fetchedLead) {
        i++;
        continue;
      }

      let zip_code = null;
      try {
        zip_code = parseInt(lead?.[leadSalesforceMap?.zip_code]);
        if (isNaN(zip_code)) zip_code = null;
      } catch (err) {
        logger.error('Unable to parse zipcode of account');
      }

      let accountObject = {
        name: lead?.[leadSalesforceMap?.company],
        size:
          lead?.[
            CompanyFieldMapHelper.getCompanySize({
              size: leadSalesforceMap?.size,
            })[0]
          ] ?? null,
        url: lead?.[leadSalesforceMap?.url] ?? null,
        country: lead?.[leadSalesforceMap?.country] ?? null,
        zipcode: zip_code,
        phone_number: lead?.[leadSalesforceMap?.company_phone_number] ?? null,
      };
      accountObject = JsonHelper.clean(accountObject);
      if (Object.keys(accountObject).length)
        await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          query: { account_id: fetchedLead.account_id },
          updateObject: accountObject,
        });

      let cleanedLead = JsonHelper.clean({
        first_name: lead?.[leadSalesforceMap?.first_name],
        last_name: lead?.[leadSalesforceMap?.last_name],
        email_validity: lead.Email_Validity__c,
        linkedin_url: lead?.[leadSalesforceMap?.linkedin_url],
        source_site: lead?.[leadSalesforceMap?.source_site],
        job_position: lead?.[leadSalesforceMap?.job_position],
        integration_status: lead?.[leadSalesforceMap?.integration_status.name],
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
      for (let phone_type of leadSalesforceMap?.phone_numbers) {
        if (lead[phone_type] || lead[phone_type] === '')
          await PhoneNumberHelper.updatePhoneNumber(
            lead[phone_type],
            phone_type,
            fetchedLead.lead_id
          );
      }

      // * Updating contact email
      for (let email_type of leadSalesforceMap?.emails) {
        if (lead[email_type] || lead[email_type] === '')
          leadEmailHelper.updateEmail(
            lead[email_type],
            email_type,
            fetchedLead.lead_id
          );
      }
      // Lead has been disqualified in salesforce
      if (
        lead?.[leadSalesforceMap?.integration_status.name] ===
          leadSalesforceMap?.integration_status?.disqualified?.value &&
        leadSalesforceMap?.integration_status?.disqualified?.value !==
          undefined &&
        lead?.[leadSalesforceMap?.integration_status.name] !== undefined
      ) {
        // * Fetch latest task for lead
        const [task, errForTask] = await Repository.fetchOne({
          tableName: DB_TABLES.TASK,
          query: {
            lead_id: fetchedLead.lead_id,
            completed: false,
            is_skipped: false,
          },
        });
        if (errForTask)
          logger.error(`Error while fetching latest task: `, errForTask);

        await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            status: LEAD_STATUS.TRASH,
            status_update_timestamp: new Date(),
          },
        });

        await Repository.create({
          tableName: DB_TABLES.STATUS,
          createObject: {
            lead_id: fetchedLead.lead_id,
            status: LEAD_STATUS.TRASH,
          },
        });

        await Repository.update({
          tableName: DB_TABLES.LEADTOCADENCE,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            status: CADENCE_LEAD_STATUS.STOPPED,
            status_node_id: task?.node_id ?? null,
          },
        });

        const [activityFromTemplate, errForActivityFromTemplate] =
          ActivityHelper.getActivityFromTemplates({
            type: ACTIVITY_TYPE.LEAD_DISQUALIFIED,
            sub_type: ACTIVITY_SUBTYPES.LEAD,
            activity: {
              lead_id: fetchedLead.lead_id,
              incoming: null,
            },
          });

        ActivityHelper.activityCreation(
          activityFromTemplate,
          fetchedLead.user_id
        );
        TaskHelper.recalculateDailyTasksForUsers([fetchedLead.user_id]);

        // Lead Score
        if (
          lead?.[leadSalesforceMap?.integration_status.name] &&
          fetchedLead?.integration_status
        ) {
          let [leadScoreUpdate, errForLeadScoreUpdate] =
            await LeadScoreHelper.updateLeadScore({
              lead: fetchedLead,
              rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
              current_status:
                lead?.[leadSalesforceMap?.integration_status.name],
              previous_status: fetchedLead.integration_status,
              field_map: leadSalesforceMap,
            });

          if (errForLeadScoreUpdate)
            logger.error(
              'An error occured while updating lead score',
              errForLeadScoreUpdate
            );
        }
      } else if (
        lead?.[leadSalesforceMap?.integration_status.name] !==
          leadSalesforceMap?.integration_status?.disqualified?.value &&
        fetchedLead.status === LEAD_STATUS.TRASH &&
        lead?.[leadSalesforceMap?.integration_status.name] !== undefined
      ) {
        // * The lead should not be disqualified
        await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            status: LEAD_STATUS.ONGOING,
            status_update_timestamp: new Date(),
          },
        });

        await Repository.create({
          tableName: DB_TABLES.STATUS,
          createObject: {
            lead_id: fetchedLead.lead_id,
            message: `Lead status updated in salesforce to ${
              lead?.[leadSalesforceMap?.integration_status.name]
            }`,
            status: LEAD_STATUS.ONGOING,
          },
        });

        TaskHelper.recalculateDailyTasksForUsers([fetchedLead.user_id]);

        // Lead Score
        if (
          lead?.[leadSalesforceMap?.integration_status.name] &&
          fetchedLead?.integration_status
        ) {
          let [leadScoreUpdate, errForLeadScoreUpdate] =
            await LeadScoreHelper.updateLeadScore({
              lead: fetchedLead,
              rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
              current_status:
                lead?.[leadSalesforceMap?.integration_status.name],
              previous_status: fetchedLead.integration_status,
              field_map: leadSalesforceMap,
            });
          if (errForLeadScoreUpdate)
            logger.error(
              'An error occured while updating lead score',
              errForLeadScoreUpdate
            );
        }
      }
      // Lead has been converted
      if (
        lead?.[leadSalesforceMap?.integration_status.name] ===
          leadSalesforceMap?.integration_status?.converted?.value &&
        leadSalesforceMap?.integration_status?.converted?.value !== undefined &&
        lead?.[leadSalesforceMap?.integration_status.name] !== undefined
      ) {
        logger.info(
          'Sf integration: Lead status is converted and changed to account/contact, updating status in lead, create status, stopped cadence, create activity'
        );
        await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            status: LEAD_STATUS.CONVERTED,
            status_update_timestamp: new Date(),
            salesforce_lead_id: null,
            salesforce_contact_id: lead.ConvertedContactId,
            integration_id: lead.ConvertedContactId,
            integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
          },
        });

        await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          query: { account_id: fetchedLead.account_id },
          updateObject: {
            salesforce_account_id: lead.ConvertedAccountId,
            integration_id: lead.ConvertedAccountId,
            integration_type: ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT,
          },
        });

        await Repository.create({
          tableName: DB_TABLES.STATUS,
          createObject: {
            lead_id: fetchedLead.lead_id,
            status: LEAD_STATUS.CONVERTED,
          },
        });

        // * Fetch latest task for lead
        const [task, errForTask] = await Repository.fetchOne({
          tableName: DB_TABLES.TASK,
          query: {
            lead_id: fetchedLead.lead_id,
            completed: false,
            is_skipped: false,
          },
        });
        if (errForTask)
          logger.error(`Error while fetching latest task: `, errForTask);

        await Repository.update({
          tableName: DB_TABLES.LEADTOCADENCE,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            status: CADENCE_LEAD_STATUS.STOPPED,
            status_node_id: task?.node_id ?? null,
          },
        });

        const [activityFromTemplate, errForActivityFromTemplate] =
          ActivityHelper.getActivityFromTemplates({
            type: ACTIVITY_TYPE.LEAD_CONVERTED,
            sub_type: ACTIVITY_SUBTYPES.LEAD,
            activity: {
              lead_id: fetchedLead.lead_id,
              incoming: null,
            },
          });

        ActivityHelper.activityCreation(
          activityFromTemplate,
          fetchedLead.user_id
        );
        TaskHelper.recalculateDailyTasksForUsers([fetchedLead.user_id]);

        // Lead Score
        if (cleanedLead.integration_status && fetchedLead?.integration_status) {
          let [leadScoreUpdate, errForLeadScoreUpdate] =
            await LeadScoreHelper.updateLeadScore({
              lead: fetchedLead,
              rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
              current_status: cleanedLead.integration_status,
              previous_status: fetchedLead.integration_status,
              field_map: leadSalesforceMap,
            });
          if (errForLeadScoreUpdate)
            logger.error(
              'An error occured while updating lead score',
              errForLeadScoreUpdate
            );
        }
      } else if (
        lead?.[leadSalesforceMap?.integration_status.name] !==
          leadSalesforceMap?.integration_status?.converted?.value &&
        fetchedLead.status === LEAD_STATUS.CONVERTED &&
        lead?.[leadSalesforceMap?.integration_status.name] !== undefined
      ) {
        // * The lead should not be converted
        await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            status: LEAD_STATUS.ONGOING,
            status_update_timestamp: new Date(),
          },
        });

        await Repository.create({
          tableName: DB_TABLES.STATUS,
          createObject: {
            lead_id: fetchedLead.lead_id,
            message: 'Lead status has been changed',
            status: LEAD_STATUS.ONGOING,
          },
        });

        TaskHelper.recalculateDailyTasksForUsers([fetchedLead.user_id]);
      }

      if (cleanedLead?.integration_status && fetchedLead?.integration_status) {
        let [leadScoreUpdate, errForLeadScoreUpdate] =
          await LeadScoreHelper.updateLeadScore({
            lead: fetchedLead,
            rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
            current_status: cleanedLead?.integration_status,
            previous_status: fetchedLead.integration_status,
            field_map: leadSalesforceMap,
          });
        if (errForLeadScoreUpdate)
          logger.error(
            'An error occured while updating lead score',
            errForLeadScoreUpdate
          );
      }
      i++;
      if (i === leads.length)
        return successResponse(res, 'Leads updated successfully');
    }
    return successResponse(res, 'Leads updated successfully');
  } catch (err) {
    logger.error('Error while updating salesforce leads: ', err);
    return serverErrorResponse(res);
  }
};

const linkLeadsWithCadence = async (req, res) => {
  try {
    const { leads } = req.body;
    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };

    while (i < leads.length) {
      if (i === leads.length) break;
      let leadObj = leads[i];
      logger.info(`Processing link for ${leadObj.salesforce_lead_id}`);

      [lead, err] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_lead_id: leadObj.salesforce_lead_id },
        query: {
          integration_id: leadObj.salesforce_lead_id,
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
        },
        include: {
          [DB_TABLES.USER]: {
            where: { company_id: req.company_id },
            required: true,
          },
        },
      });
      if (!lead) {
        logger.info(`Give lead does not exist`);
        response.element_error.push({
          salesforce_lead_id: leadObj.salesforce_lead_id,
          cadence_id: leadObj.cadence_id,
          msg: 'Lead does not exist',
        });
        response.total_error++;
        i++;
        continue;
      }

      let user = lead.User;

      const [cadence, errForCadence] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: leadObj.cadence_id },
      });
      if (!cadence) {
        logger.info(`Give cadence does not exist`);
        response.element_error.push({
          salesforce_lead_id: leadObj.salesforce_lead_id,
          cadence_id: leadObj.cadence_id,
          msg: 'Cadence does not exist',
        });
        response.total_error++;
        i++;
        continue;
      }

      // Lead and cadence both are present

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
          salesforce_contact_id: lead.salesforce_contact_id,
          cadence_id: lead.cadence_id,
          msg: 'This user does not have access to this cadence.',
        });
        response.total_error++;
        i++;
        continue;
      }

      const [link, errForGetLink] =
        await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery({
          lead_id: lead.lead_id,
          cadence_id: leadObj.cadence_id,
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
        // * If it does not exists, initialiaze it to 1
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
            salesforce_lead_id: leadObj.salesforce_lead_id,
            cadence_id: leadObj.cadence_id,
            msg: errForLink,
          });
          response.total_error++;
          i++;
          continue;
        }

        if (leadObj.status === CADENCE_LEAD_STATUS.IN_PROGRESS) {
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
          salesforce_lead_id: leadObj.salesforce_lead_id,
          lead_cadence_id: createdLink.lead_cadence_id,
          cadence_id: leadObj.cadence_id,
          status: createdLink.status,
        });
        response.total_success++;
        i++;
        continue;
      } else {
        // Link already exists
        logger.info(`Link already exists`);

        if (link[0].status === leadObj.status) {
          logger.info(`Link already exists and the status is the same`);
          response.element_error.push({
            salesforce_lead_id: leadObj.salesforce_lead_id,
            cadence_id: leadObj.cadence_id,
            msg: 'Link already exists and status is same',
          });
          response.total_error++;
          i++;
          continue;
        }

        // * if cadence is not started, then don't update lead-cadence status.
        if (cadence.status === CADENCE_STATUS.NOT_STARTED) {
          logger.info(
            'Link already exists and status cannot be changed since cadence is not started'
          );
          response.element_error.push({
            salesforce_lead_id: leadObj.salesforce_lead_id,
            cadence_id: leadObj.cadence_id,
            msg: 'Link already exists and status cannot be changed since cadence is not started',
          });
          response.total_error++;
          i++;
          continue;
        }

        if (leadObj.status === CADENCE_LEAD_STATUS.NOT_STARTED) {
          logger.info(
            `Link already exists and status cannot be changed to not started`
          );
          response.element_error.push({
            salesforce_lead_id: leadObj.salesforce_lead_id,
            cadence_id: leadObj.cadence_id,
            msg: 'Link already exists and status cannot be changed to not started',
          });
          response.total_error++;
          i++;
          continue;
        } else if (leadObj.status === CADENCE_LEAD_STATUS.IN_PROGRESS) {
          // * If cadence status is not "in_progress", while updating lead-cadence status to "in_progress" then dont do it
          if (cadence.status === CADENCE_STATUS.IN_PROGRESS) {
            // * see if any task is created for this lead with cadence, if yes, then just update status, else create tasks and update tasks

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
                await TaskHelper.createTasksForLeads({
                  leads: [lead],
                  node,
                  cadence_id: cadence.cadence_id,
                  firstTask: true,
                });
              }
            }
          } else {
            logger.info(
              `Link already exists and status cannot be changed since cadence is not in progress`
            );
            response.element_error.push({
              salesforce_lead_id: leadObj.salesforce_lead_id,
              cadence_id: leadObj.cadence_id,
              msg: 'Link already exists and status cannot be changed since cadence is not in progress',
            });
            response.total_error++;
            i++;
            continue;
          }
        }

        const [updatedLink, errForLink] = await Repository.update({
          tableName: DB_TABLES.LEADTOCADENCE,
          query: {
            lead_id: lead.lead_id,
            cadence_id: leadObj.cadence_id,
          },
          updateObject: {
            status: leadObj.status,
          },
        });

        if (!errForLink && leadObj.status !== CADENCE_LEAD_STATUS.NOT_STARTED)
          TaskHelper.recalculateDailyTasksForUsers([lead.user_id]);

        response.element_success.push({
          salesforce_lead_id: leadObj.salesforce_lead_id,
          lead_cadence_id: link[0]?.lead_cadence_id,
          cadence_id: leadObj.cadence_id,
          status: updatedLink?.[0] ? leadObj.status : link[0]?.status,
        });
        response.total_success++;
      }

      i++;
      if (i === leads.length) break;
    }

    return successResponse(res, 'Links have been processed.', response);
  } catch (err) {
    logger.error(`Error while linking leads to cadence: `, err);
    return serverErrorResponse(res, err.message);
  }
};

//const linkLeadsWithCadence = async (req, res) => {
//try {
//const { leads } = req.body;
//let i = 0;
//let response = {
//total_success: 0,
//total_error: 0,
//element_success: [],
//element_error: [],
//};

//while (i < leads.length) {
//if (i === leads.length) break;
//let leadObj = leads[i];
//logger.info(`Processing link for ${leadObj.salesforce_lead_id}`);

//const [lead, err] = await LeadRepository.getLeadByQuery({
//salesforce_lead_id: leadObj.salesforce_lead_id,
//});
//if (!lead) {
//logger.info(`Give lead does not exist`);
//response.element_error.push({
//salesforce_lead_id: leadObj.salesforce_lead_id,
//cadence_id: leadObj.cadence_id,
//msg: 'Lead does not exist',
//});
//response.total_error++;
//i++;
//continue;
//}
//const [cadence, errForCadence] = await CadenceRepository.getCadence({
//cadence_id: leadObj.cadence_id,
//});
//if (!cadence) {
//logger.info(`Give cadence does not exist`);
//response.element_error.push({
//salesforce_lead_id: leadObj.salesforce_lead_id,
//cadence_id: leadObj.cadence_id,
//msg: 'Cadence does not exist',
//});
//response.total_error++;
//i++;
//continue;
//}

//// Lead and cadence both are present
//if (lead !== null && cadence !== null) {
//const [link, errForGetLink] =
//await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery({
//lead_id: lead.lead_id,
//cadence_id: leadObj.cadence_id,
//});

//// Link does not exist
//if (link.length === 0) {
//let [unsubscribed, ___] = await LeadHelper.hasLeadUnsubscribed(
//lead.lead_id
//);

//let lead_cadence_order = 0;

//// * fetch last lead number for user in cadence
//let [
//lastLeadToCadenceForUserInCadence,
//errForLastLeadToCadenceForUserInCadence,
//] = await LeadToCadenceRepository.getLastLeadToCadenceByLeadQuery(
//{
//cadence_id: leadObj.cadence_id,
//lead_cadence_order: {
//[Op.lt]: LEAD_CADENCE_ORDER_MAX,
//},
//}, // * lead_cadence_query
//{ user_id: lead?.user_id } // * lead_query
//);

//lastLeadToCadenceForUserInCadence =
//lastLeadToCadenceForUserInCadence?.[0];

//// * If last link exists, use its leadCadenceOrder
//if (lastLeadToCadenceForUserInCadence)
//lead_cadence_order =
//(lastLeadToCadenceForUserInCadence?.lead_cadence_order || 0) + 1;
//// * If it does not exists, initialiaze it to 1
//else lead_cadence_order = 1;

//const [createdLink, errForLink] =
//await LeadToCadenceRepository.createLeadToCadenceLink({
//lead_id: lead.lead_id,
//cadence_id: leadObj.cadence_id,
//status: cadence?.status,
//unsubscribed: unsubscribed ?? false,
//lead_cadence_order,
//});
//if (errForLink) {
//response.element_error.push({
//salesforce_lead_id: leadObj.salesforce_lead_id,
//cadence_id: leadObj.cadence_id,
//msg: errForLink,
//});
//response.total_error++;
//i++;
//continue;
//}

//if (leadObj.status === CADENCE_LEAD_STATUS.IN_PROGRESS) {
//const [tasks, errForTask] = await TaskRepository.getTasks({
//lead_id: lead.lead_id,
//cadence_id: leadObj.cadence_id,
//});

//if (!errForTask && tasks.length === 0) {
//const [node, errForNode] = await NodeRepository.getNode({
//cadence_id: cadence.cadence_id,
//is_first: 1,
//});

//if (!errForNode && node) {
//TaskHelper.createTasksForLeads({
//leads: [lead],
//node,
//cadence_id: cadence.cadence_id,
//firstTask: true,
//});
//}
//}
//}

//response.element_success.push({
//salesforce_lead_id: leadObj.salesforce_lead_id,
//lead_cadence_id: createdLink.lead_cadence_id,
//cadence_id: leadObj.cadence_id,
//status: createdLink.status,
//});
//response.total_success++;
//} else {
//response.element_error.push({
//salesforce_lead_id: leadObj.salesforce_lead_id,
//cadence_id: leadObj.cadence_id,
//msg: 'Link already exists',
//});
//response.total_error++;
//// * if cadence is not started, then don't update lead-cadence status.
//if (cadence.status === CADENCE_STATUS.NOT_STARTED) {
//i++;
//continue;
//}

//if (leadObj.status === CADENCE_LEAD_STATUS.NOT_STARTED) {
//i++;
//continue;
//} else if (leadObj.status === CADENCE_LEAD_STATUS.IN_PROGRESS) {
//// * If cadence status is not "in_progress", while updating lead-cadence status to "in_progress" then dont do it
//if (cadence.status === CADENCE_STATUS.IN_PROGRESS) {
//// * see if any task is created for this lead with cadence, if yes, then just update status, else create tasks and update tasks

//const [tasks, errForTask] = await TaskRepository.getTasks({
//lead_id: lead.lead_id,
//cadence_id: leadObj.cadence_id,
//});

//if (!errForTask && tasks.length === 0) {
//const [node, errForNode] = await NodeRepository.getNode({
//cadence_id: cadence.cadence_id,
//is_first: 1,
//});

//if (!errForNode && node) {
//TaskHelper.createTasksForLeads({
//leads: [lead],
//node,
//cadence_id: cadence.cadence_id,
//firstTask: true,
//});
//}
//}
//} else {
//i++;
//continue;
//}
//}

//const [updatedLink, errForLink] =
//await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
//{
//lead_id: lead.lead_id,
//cadence_id: leadObj.cadence_id,
//},
//{
//status: leadObj.status,
//}
//);

//response.element_success.push({
//salesforce_lead_id: leadObj.salesforce_lead_id,
//lead_cadence_id: link[0]?.lead_cadence_id,
//cadence_id: leadObj.cadence_id,
//status: updatedLink?.[0] ? leadObj.status : link[0]?.status,
//});
//response.total_success++;
//}
//}

//i++;

//if (i === leads.length) break;
//}

//return successResponse(res, 'Links have been processed.', response);
//} catch (err) {
//logger.error(`Error while linking leads to cadence: ${err.message}`);
//return serverErrorResponse(res, err.message);
//}
//};

const updateLeadToCadenceStatus = async (req, res) => {
  try {
    const { leads } = req.body;
    let i = 0;
    while (i < leads.length) {
      let lead = leads[i];
      if (
        lead.status &&
        Object.values(CADENCE_LEAD_STATUS).includes(lead.status)
      ) {
        [fetchedLead, errForLead] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          //query: { salesforce_lead_id: lead.salesforce_lead_id },
          query: {
            integration_id: lead.salesforce_lead_id,
            integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
          },
          include: {
            [DB_TABLES.USER]: {
              where: { company_id: req.company_id },
              required: true,
            },
          },
        });

        if (!fetchedLead) {
          i++;
          continue;
        }

        await Repository.update({
          tableName: DB_TABLES.LEADTOCADENCE,
          query: {
            lead_id: fetchedLead.lead_id,
            cadence_id: lead.cadence_id,
          },
          updateObject: {
            status: lead.status,
          },
        });
      }
      i++;

      if (i === leads.length)
        return successResponse(res, 'Updated status for leads successfully');
    }
  } catch (err) {
    logger.error(`Error while updating leads to cadence status: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const updateLeadOwnerId = async (req, res) => {
  try {
    axios.put(`${SERVER_URL}/webhook/v1/salesforce/lead/owner`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Lead owner successfully updated`);
    const { leads } = req.body;
    let i = 0;
    let recaculateUsers = [];

    while (i < leads.length) {
      if (i === leads.length)
        return successResponse(res, 'Lead owner successfully updated.');

      let lead = leads[i];
      logger.info('Owner update lead id: ' + lead.salesforce_lead_id);
      const { salesforce_lead_id } = lead;

      // Fetching lead
      [fetchedLead, errForLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_lead_id: salesforce_lead_id },
        query: {
          integration_id: salesforce_lead_id,
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
        },
        include: {
          [DB_TABLES.USER]: {
            where: { company_id: req.company_id },
            required: true,
          },
        },
      });
      if (errForLead || !fetchedLead) {
        logger.info('Lead not found or error for lead');
        i++;
        continue;
      }

      //await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
      //{ lead_id: fetchedLead.lead_id },
      //{ status: CADENCE_LEAD_STATUS.STOPPED }
      //);

      // Fetching new owner
      const oldOwner = fetchedLead.User;
      if (oldOwner == undefined) {
        logger.info('Error while finding old lead owner');
        i++;
        continue;
      }

      // Fetching new owner
      const [newOwner, errForNewOwner] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        //query: { salesforce_owner_id: lead.salesforce_owner_id },
        query: {
          integration_id: lead.salesforce_owner_id,
          integration_type: USER_INTEGRATION_TYPES.SALESFORCE_OWNER,
        },
      });
      if (errForNewOwner) {
        logger.info('Error while finding new lead owner');
        i++;
        continue;
      }
      if (!newOwner) {
        logger.info('The new owner does not exist in the cadence tool.');
        await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
          { lead_id: fetchedLead.lead_id },
          { status: CADENCE_LEAD_STATUS.STOPPED }
        );

        const [activityFromTemplate, errForActivityFromTemplate] =
          ActivityHelper.getActivityFromTemplates({
            type: ACTIVITY_TYPE.OWNER_CHANGE,
            variables: {
              crm: CRM_INTEGRATIONS.SALESFORCE,
            },
            activity: {
              lead_id: fetchedLead.lead_id,
              incoming: null,
            },
          });
        await ActivityHelper.activityCreation(
          activityFromTemplate,
          fetchedLead.user_id
        );
        i++;
        continue;
      }

      const [workflow, errForWorkflow] = await WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
        lead_id: fetchedLead.lead_id,
        extras: {
          //salesforce_owner_id: newOwner.salesforce_owner_id,
          crm: CRM_INTEGRATIONS.SALESFORCE,
          integration_id: newOwner.integration_id,
          new_user_id: newOwner.user_id,
          oldOwnerSdId: oldOwner.sd_id,
        },
      });
      if (!errForWorkflow)
        await TaskHelper.skipReplyTaskOwnerChange({
          lead: fetchedLead,
          newOwner,
          oldOwner,
        });

      i++;
      if (i === leads.length)
        return successResponse(res, 'Lead owner successfully updated.');
    }

    return successResponse(res, 'Lead owner successfully updated.');
  } catch (err) {
    logger.error(`Error while updating lead owner id: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const deleteLeads = async (req, res) => {
  try {
    axios.delete(`${SERVER_URL}/webhook/v1/salesforce/lead`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Leads updated successfully`);
    const { leads } = req.body;
    console.log('Leads are', leads);
    if (leads === undefined || leads.length === 0)
      return badRequestResponse(res, 'Leads array in empty');

    let count = 0;

    for (let lead of leads) {
      const [fetchedLead, errForLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_lead_id: lead.salesforce_lead_id },
        query: {
          integration_id: lead.salesforce_lead_id,
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
        },
        include: {
          [DB_TABLES.USER]: {
            where: { company_id: req.company_id },
            required: true,
          },
        },
      });
      if (errForLead) continue;
      if (!fetchedLead) continue;

      ++count;

      await Repository.destroy({
        tableName: DB_TABLES.LEAD,
        query: { lead_id: fetchedLead.lead_id },
      });

      await Repository.destroy({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { lead_id: fetchedLead.lead_id },
      });

      await Repository.destroy({
        tableName: DB_TABLES.STATUS,
        query: { lead_id: fetchedLead.lead_id },
      });

      await Repository.destroy({
        tableName: DB_TABLES.LEAD_EMAIL,
        query: { lead_id: fetchedLead.lead_id },
      });

      await Repository.destroy({
        tableName: DB_TABLES.LEAD_PHONE_NUMBER,
        query: { lead_id: fetchedLead.lead_id },
      });

      await Repository.destroy({
        tableName: DB_TABLES.CONVERSATION,
        query: { lead_id: fetchedLead.lead_id },
      });

      await Repository.destroy({
        tableName: DB_TABLES.TASK,
        query: { lead_id: fetchedLead.lead_id },
      });

      await Repository.destroy({
        tableName: DB_TABLES.ACTIVITY,
        query: { lead_id: fetchedLead.lead_id },
      });
    }
    return successResponse(res, 'Deleted leads successfully.', {
      delete_count: count,
    });
  } catch (err) {
    logger.error('Error while deleting leads: ', err);
    return serverErrorResponse(res);
  }
};

// ==== DEPRECATED | NO LONGER USED ====
const createLeadCadenceMember = async (req, res) => {
  try {
    let cadences = {};
    let access_token = '',
      instance_url = '',
      errForAccessToken = '';

    // * Get access token and instance url
    [{ access_token, instance_url }, errForAccessToken] =
      await SalesforceService.getAccessToken(
        '99999999-9999-9999-9999-999999999999'
      );
    if (errForAccessToken) {
      // * Get access token and instance url
      [{ access_token, instance_url }, errForAccessToken] =
        await SalesforceService.getAccessToken(
          '22222222-2222-2222-2222-222222222222'
        );
    }
    if (errForAccessToken) {
      // * Get access token and instance url
      [{ access_token, instance_url }, errForAccessToken] =
        await SalesforceService.getAccessToken(
          '11111111-1111-1111-1111-111111111111'
        );
    }
    if (errForAccessToken) {
      // * Get access token and instance url
      [{ access_token, instance_url }, errForAccessToken] =
        await SalesforceService.getAccessToken(
          '33333333-3333-3333-3333-333333333333'
        );
    }
    if (errForAccessToken) {
      t.rollback();
      if (errForAccessToken === 'Please log in with salesforce')
        return badRequestResponse(
          res,
          'Please log in with salesforce to reassign.'
        );
      return serverErrorResponse(
        res,
        `Error while fetching tokens for salesforce: ${errForAccessToken}.`
      );
    }

    for (let data of req.body.data) {
      let cadence = '';
      if (!cadences[data?.cadence_id]) {
        [cadence, _] = await Repository.fetchOne({
          tableName: DB_TABLES.CADENCE,
          query: { cadence_id: data?.cadence_id },
        });
        cadences[data?.cadence_id] = cadence;
      } else cadence = cadences[data?.cadence_id];
      if (cadence) {
        const [memberData, errForMemberData] =
          await SalesforceService.createLeadCadenceMember(
            cadence?.salesforce_cadence_id,
            data.salesforce_lead_id,
            cadence?.status,
            access_token,
            instance_url
          );
        console.log({ memberData, errForMemberData });
      }
    }
  } catch (err) {
    logger.error(
      `Error while creating lead cadence member in controller: `,
      err
    );
    return serverErrorResponse(
      res,
      `Error while creating lead cadence member in controller: ${err.message}.`
    );
  }
};

// * Fetch if lead/contact is present in cadence
const checkIfExists = async (req, res) => {
  try {
    let [lead, errFetchingLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        company_id: req.company_id,
        integration_id: req.params.integration_id,
      },
      include: {
        [DB_TABLES.LEADTOCADENCE]: {
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
          },
          attributes: ['lead_cadence_id', 'cadence_id'],
        },
      },
    });
    if (errFetchingLead) return serverErrorResponse(res, errFetchingLead);
    if (!lead)
      return successResponse(res, 'Lead does not exist is cadence', {
        isPresent: false,
      });

    let cadences = [];

    for (let cadence of lead.LeadToCadences)
      cadences.push({
        lead_cadence_id: cadence.lead_cadence_id,
        cadence_id: cadence.cadence_id,
        name: cadence.Cadences[0].name,
      });

    return successResponse(res, 'Lead exists in cadence', {
      isPresent: true,
      cadences,
    });
  } catch (err) {
    logger.error(
      'An error occurred while checking if lead exists in cadence: ',
      err
    );
    return serverErrorResponse(res, err.message);
  }
};

module.exports = {
  createLeads,
  getLeadsBySalesforceLeadId,
  updateLeads,
  deleteLeads,
  linkLeadsWithCadence,
  updateLeadToCadenceStatus,
  updateLeadOwnerId,
  createLeadCadenceMember,
  checkIfExists,
};
