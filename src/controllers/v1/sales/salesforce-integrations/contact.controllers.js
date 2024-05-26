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
  SALESFORCE_SOBJECTS,
  CADENCE_TYPES,
  WORKFLOW_TRIGGERS,
  ACTIVITY_TYPE,
  LEAD_INTEGRATION_TYPES,
  USER_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
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
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const SalesforceHelper = require('../../../../../../Cadence-Brain/src/helper/salesforce');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const WorkflowHelper = require('../../../../../../Cadence-Brain/src/helper/workflow');
const CompanyHelper = require('../../../../../../Cadence-Brain/src/helper/company');
const LeadEmailHelper = require('../../../../../../Cadence-Brain/src/helper/email');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const {
  deleteAllLeadInfo,
} = require('../../../../../../Cadence-Brain/src/helper/lead');

// * GRPC Imports
const v2GrpcClients = require('../../../../../../Cadence-Brain/src/grpc/v2');

const createContacts = async (req, res) => {
  try {
    const { contacts: leads } = req.body;
    if (leads === undefined || leads.length === 0)
      return badRequestResponse(res, 'Contacts array in empty');
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
        SALESFORCE_SOBJECTS.CONTACT
      );
    if (errFetchingSalesforceFieldMap)
      return badRequestResponse(res, errFetchingSalesforceFieldMap);

    while (i <= leads.length) {
      if (i === leads.length)
        return successResponse(res, 'Contacts have been processed.', response);

      let lead = leads[i];

      logger.info(`For lead: ${lead.Id}`);
      if (
        lead.salesforce_contact_id === null ||
        lead.salesforce_contact_id === undefined ||
        lead.salesforce_contact_id === ''
      ) {
        logger.info('Salesforce contact id not present');
        response.element_error.push({
          salesforce_contact_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Salesforce contact id not present',
        });
        response.total_error++;
        i++;
        continue;
      }

      if (!lead.Account) {
        logger.info('Account information not included');
        response.element_error.push({
          salesforce_contact_id: lead.salesforce_contact_id,
          cadence_id: lead.cadence_id,
          msg: 'Account information not present.',
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
      const [user, userErr] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { salesforce_owner_id: lead.salesforce_owner_id },
        //query: {
        //integration_id: lead.salesforce_owner_id,
        //integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
        //},
      });
      if (userErr || user === null) {
        logger.info('Owner not present in cadence tool.');
        response.element_error.push({
          salesforce_contact_id: lead.salesforce_contact_id,
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

      // Checks if duplicates are present for the given lead
      const [duplicate, errForDuplicate] =
        await SalesforceService.checkDuplicates(
          lead.salesforce_contact_id,
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
          query: { cadence_id: lead.cadence_id },
        });
        if (!cadence) {
          logger.info('Cadence not present.');
          response.element_error.push({
            salesforce_contact_id: lead.salesforce_contact_id,
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

      let [createdLead, err] = await LeadHelper.createContact(
        lead,
        salesforceFieldMap,
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
          salesforce_contact_id: lead.salesforce_contact_id,
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
             * since it is possible that we get many contacts at once in this route
             * In that case tasks wont show up if we calculate after every contact is created
             * */
            if (taskCreated)
              TaskHelper.recalculateDailyTasksForUsers([createdLead.user_id]);
          }
        }
      }

      response.element_success.push({
        salesforce_contact_id: lead.salesforce_contact_id,
        cadence_id: lead.cadence_id,
        identifier: createdLead.lead_cadence_id,
      });
      response.total_success++;
      i++;

      if (i === leads.length)
        return successResponse(res, 'Contacts have been processed.', response);
    }
  } catch (err) {
    logger.error(`Error while creating salesforce contacts: `, err);
    return serverErrorResponse(res);
  }
};

const getContactsBySalesforceContactId = async (req, res) => {
  try {
    const { id: salesforce_contact_id } = req.params;
    const [lead, err] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      //query: { salesforce_contact_id },
      query: {
        integration_id: salesforce_contact_id,
        integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
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
          //attributes: ['first_name', 'last_name', 'salesforce_owner_id'],
          attributes: ['first_name', 'last_name', 'integration_id'],
        },
      },
      extras: {
        //attributes: ['first_name', 'last_name', 'salesforce_lead_id', 'status'],
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
    if (!lead) return badRequestResponse(res, 'No contact found.');

    return successResponse(res, 'Contact found in cadence tool.', lead);
  } catch (err) {
    logger.error('Error while fetching contact: ', err);
    return serverErrorResponse(res);
  }
};

const updateContacts = async (req, res) => {
  try {
    axios.put(`${SERVER_URL}/webhook/v1/salesforce/contact`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Contacts updated successfully`);
    const { contacts } = req.body;
    if (contacts === undefined || contacts.length === 0)
      return badRequestResponse(res, 'Array cannot be empty');

    // * Fetch salesforce field map
    let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
      await SalesforceHelper.getFieldMapForCompanyFromCompany(
        req.company_id,
        SALESFORCE_SOBJECTS.CONTACT
      );
    if (errFetchingSalesforceFieldMap)
      return badRequestResponse(res, errFetchingSalesforceFieldMap);

    let i = 0;
    let leadsUpdated = 0;

    while (i < contacts.length) {
      if (i === contacts.length)
        return successResponse(res, 'Contacts updated successfully');
      let contact = contacts[i];

      [fetchedLead, errForLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_contact_id: contact.salesforce_contact_id },
        query: {
          integration_id: contact.salesforce_contact_id,
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
        },
        include: {
          [DB_TABLES.USER]: {
            where: { company_id: req.company_id },
            required: true,
          },
        },
      });

      // * Send contact to automated workflow irrespective of whether the contact exists in database or not
      v2GrpcClients.advancedWorkflow.updateSalesforceContact({
        integration_data: {
          contact,
          fetchedLead: fetchedLead ?? null,
          company_id: req.company_id,
        },
      });

      if (errForLead || !fetchedLead) {
        i++;
        continue;
      }

      let full_name = '';
      if (contact?.[salesforceFieldMap?.first_name] !== undefined)
        full_name += contact?.[salesforceFieldMap?.first_name];
      else full_name += fetchedLead?.first_name;
      if (contact?.[salesforceFieldMap?.last_name] !== undefined)
        full_name += ` ${contact?.[salesforceFieldMap?.last_name]}`;
      else full_name += ' ' + fetchedLead?.last_name;

      if (contact.salesforce_account_id) {
        let [account, errForAccount] = await Repository.fetchOne({
          tableName: DB_TABLES.ACCOUNT,
          //query: { salesforce_account_id: contact.salesforce_account_id },
          query: {
            integration_id: contact.salesforce_account_id,
            integration_type: ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT,
          },
        });

        if (account.length === 1) {
          const [updatedContact, err] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            //query: { salesforce_contact_id: contact.salesforce_contact_id },
            query: { lead_id: fetchedLead.lead_id },
            updateObject: {
              first_name: contact?.[salesforceFieldMap?.first_name],
              last_name: contact?.[salesforceFieldMap?.last_name],
              full_name,
              email_validity: contact?.[salesforceFieldMap?.email_validity],
              linkedin_url: contact?.[salesforceFieldMap?.linkedin_url],
              source_site: contact?.[salesforceFieldMap?.source_site],
              job_position: contact?.[salesforceFieldMap?.job_position],
              account_id: account[0]?.[salesforceFieldMap?.account_id],
            },
          });
        } else {
          const [updatedContact, err] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            //query: { salesforce_contact_id: contact.salesforce_contact_id },
            query: { lead_id: fetchedLead.lead_id },
            updateObject: {
              first_name: contact?.[salesforceFieldMap?.first_name],
              last_name: contact?.[salesforceFieldMap?.last_name],
              full_name,
              email_validity: contact?.[salesforceFieldMap?.email_validity],
              linkedin_url: contact?.[salesforceFieldMap?.linkedin_url],
              source_site: contact?.[salesforceFieldMap?.source_site],
              job_position: contact?.[salesforceFieldMap?.job_position],
              account_id: account[0]?.[salesforceFieldMap?.account_id],
            },
          });
        }
      } else {
        const [updatedContact, err] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          //query: { salesforce_contact_id: contact.salesforce_contact_id },
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            first_name: contact?.[salesforceFieldMap?.first_name],
            last_name: contact?.[salesforceFieldMap?.last_name],
            full_name,
            email_validity: contact?.[salesforceFieldMap?.email_validity],
            linkedin_url: contact?.[salesforceFieldMap?.linkedin_url],
            source_site: contact?.[salesforceFieldMap?.source_site],
            job_position: contact?.[salesforceFieldMap?.job_position],
          },
        });
      }

      // Updating contact phone number
      salesforceFieldMap?.phone_numbers.forEach((phone_type) => {
        if (contact[phone_type] || contact[phone_type] === '')
          PhoneNumberHelper.updatePhoneNumber(
            contact[phone_type],
            phone_type,
            fetchedLead.lead_id
          );
      });

      // * Updating contact email
      salesforceFieldMap?.emails.forEach((email_type) => {
        if (contact[email_type] || contact[email_type] === '')
          LeadEmailHelper.updateEmail(
            contact[email_type],
            email_type,
            fetchedLead.lead_id
          );
      });

      if (
        contact.status &&
        contact.cadence_id &&
        Object.values(LEAD_STATUS).includes(contact.status)
      ) {
        await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: {
            status: contact.status,
            status_update_timestamp: new Date(),
          },
        });
        await Repository.create({
          tableName: DB_TABLES.STATUS,
          query: { lead_id: fetchedLead.lead_id },
          createObject: { status: contact.status },
        });
      }
      leadsUpdated++;

      i++;
      if (i === contacts.length) {
        if (leadsUpdated === 0)
          return badRequestResponse(
            res,
            'No contacts were updated due to invalid data or contact not present.'
          );
        return successResponse(res, 'Contacts updated successfully');
      }
    }
    return successResponse(res, 'Contacts have been processed.');
  } catch (err) {
    logger.error('Error while updating salesforce contacts: ', err);
    return serverErrorResponse(res);
  }
};

const linkContactsWithCadence = async (req, res) => {
  try {
    const { contacts } = req.body;
    let i = 0;
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };

    while (i <= contacts.length) {
      if (i === contacts.length) break;
      let leadObj = contacts[i];
      logger.info(`Processing link for ${leadObj.salesforce_contact_id}`);

      [lead, err] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: { salesforce_contact_id: leadObj.salesforce_contact_id },
        include: {
          [DB_TABLES.USER]: {
            where: { company_id: req.company_id },
            required: true,
          },
        },
      });
      if (!lead) {
        response.element_error.push({
          salesforce_contact_id: leadObj.salesforce_contact_id,
          cadence_id: leadObj.cadence_id,
          msg: 'Contact does not exist',
        });
        response.total_error++;
        i++;
        continue;
      }
      const [cadence, errForCadence] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: leadObj.cadence_id,
        },
      });
      if (!cadence) {
        response.element_error.push({
          salesforce_contact_id: leadObj.salesforce_contact_id,
          cadence_id: leadObj.cadence_id,
          msg: 'Cadence does not exist',
        });
        response.total_error++;
        i++;
        continue;
      }

      let user = lead?.User;
      if (user === null) {
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

        const [createdLink, errForLink] = await Repository.create({
          tableName: DB_TABLES.LEADTOCADENCE,
          createObject: {
            lead_id: lead.lead_id,
            cadence_id: leadObj.cadence_id,
            status: cadence?.status,
            unsubscribed: unsubscribed ?? false,
            lead_cadence_order,
          },
        });
        if (errForLink) {
          response.element_error.push({
            salesforce_contact_id: leadObj.salesforce_contact_id,
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
          salesforce_contact_id: leadObj.salesforce_contact_id,
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
            salesforce_contact_id: leadObj.salesforce_contact_id,
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
            salesforce_contact_id: leadObj.salesforce_contact_id,
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
            salesforce_contact_id: leadObj.salesforce_contact_id,
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
              salesforce_contact_id: leadObj.salesforce_contact_id,
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

        // if status is updated to any status other than not_started, then task should be recalculated
        if (!errForLink && leadObj.status !== CADENCE_LEAD_STATUS.NOT_STARTED)
          TaskHelper.recalculateDailyTasksForUsers([lead.user_id]);

        response.element_success.push({
          salesforce_contact_id: leadObj.salesforce_contact_id,
          lead_cadence_id: link[0]?.lead_cadence_id,
          cadence_id: leadObj.cadence_id,
          status: updatedLink?.[0] ? leadObj.status : link[0]?.status,
        });
        response.total_success++;
      }

      i++;

      if (i === contacts.length) break;
    }

    return successResponse(res, 'Links have been processed.', response);
  } catch (err) {
    logger.error(`Error while linking contacts to cadence: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const updateContactToCadenceStatus = async (req, res) => {
  try {
    const { contacts } = req.body;
    let i = 0;
    while (i < contacts.length) {
      let lead = contacts[i];
      if (
        lead.status &&
        Object.values(CADENCE_LEAD_STATUS).includes(lead.status)
      ) {
        [fetchedLead, errForLead] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          //query: { salesforce_contact_id: lead.salesforce_contact_id },
          query: {
            integration_id: lead.salesforce_contact_id,
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

      if (i === contacts.length)
        return successResponse(res, 'Updated status for contacts successfully');
    }
  } catch (err) {
    logger.error(
      `Error while updating contacts to cadence status: ${err.message}`
    );
    return serverErrorResponse(res, err.message);
  }
};

const updateContactOwnerId = async (req, res) => {
  try {
    axios.put(`${SERVER_URL}/webhook/v1/salesforce/contact/owner`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Contact owner successfully updated`);
    const { contacts } = req.body;
    let i = 0;

    console.log('[Updating contact owner ====>]');
    console.log(contacts);

    while (i < contacts.length) {
      if (i === contacts.length)
        return successResponse(res, 'Contact owner successfully updated.');

      let lead = contacts[i];
      logger.info('Owner update contact id: ' + lead.salesforce_contact_id);
      const { salesforce_contact_id } = lead;

      // Fetching lead
      const [fetchedLead, errForLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_contact_id },
        query: {
          integration_id: salesforce_contact_id,
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
        },
        include: { [DB_TABLES.LEADTOCADENCE]: { [DB_TABLES.CADENCE]: {} } },
      });
      if (errForLead || !fetchedLead) {
        logger.info('Contact not found or error for Contact');
        i++;
        continue;
      }

      const [oldOwner, errForOldOwner] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          user_id: fetchedLead.user_id,
        },
      });
      if (errForOldOwner) {
        logger.info('Error while finding previous contact owner');
        i++;
        continue;
      }
      if (!oldOwner) {
        logger.info('The previous owner does not exist in the cadence tool.');
        i++;
        continue;
      }

      // Fetching new owner
      const [newOwner, errForNewOwner] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { salesforce_owner_id: lead.salesforce_owner_id },
      });
      if (errForNewOwner) {
        logger.info('Error while finding new contact owner');
        i++;
        continue;
      }

      const [workflow, errForWorkflow] = await WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
        lead_id: fetchedLead.lead_id,
        extras: {
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

      // Check if the old and new owner is the same
      //if (oldOwner.user_id === newOwner.user_id) {
      //logger.info('The old and new owner is the same.');
      //i++;
      //continue;
      //}

      //let flag = 0;
      //// Check if the new owner has access to the cadences of the old owner
      //for (let leadToCadence of fetchedLead.LeadToCadences) {
      //let cadence = leadToCadence?.Cadences?.[0];
      //// Check if user has access to the cadence
      //switch (cadence.type) {
      //case CADENCE_TYPES.PERSONAL: {
      //await Repository.destroy({
      //tableName: DB_TABLES.LEADTOCADENCE,
      //query: {
      //cadence_id: cadence.cadence_id,
      //lead_id: fetchedLead.lead_id,
      //},
      //});
      //await Repository.destroy({
      //tableName: DB_TABLES.TASK,
      //query: {
      //cadence_id: cadence.cadence_id,
      //lead_id: fetchedLead.lead_id,
      //},
      //});
      //break;
      //}
      //case CADENCE_TYPES.COMPANY: {
      //flag = 1;
      //await Repository.update({
      //tableName: DB_TABLES.TASK,
      //updateObject: { user_id: newOwner.user_id },
      //query: {
      //cadence_id: cadence.cadence_id,
      //lead_id: fetchedLead.lead_id,
      //},
      //});
      //break;
      //}
      //case CADENCE_TYPES.TEAM: {
      //if (oldOwner.sd_id === newOwner.sd_id) {
      //flag = 1;
      //await Repository.update({
      //tableName: DB_TABLES.TASK,
      //updateObject: { user_id: newOwner.user_id },
      //query: {
      //cadence_id: cadence.cadence_id,
      //lead_id: fetchedLead.lead_id,
      //},
      //});
      //} else {
      //await Repository.destroy({
      //tableName: DB_TABLES.LEADTOCADENCE,
      //query: {
      //cadence_id: cadence.cadence_id,
      //lead_id: fetchedLead.lead_id,
      //},
      //});
      //await Repository.destroy({
      //tableName: DB_TABLES.TASK,
      //query: {
      //cadence_id: cadence.cadence_id,
      //lead_id: fetchedLead.lead_id,
      //},
      //});
      //}
      //break;
      //}
      //}
      //}

      //await Repository.update({
      //tableName: DB_TABLES.LEAD,
      //updateObject: { user_id: newOwner.user_id },
      //query: { lead_id: fetchedLead.lead_id },
      //});

      //let activity;
      //if (flag === 0) {
      //activity = {
      //name: `The owner of the contact has been changed from salesforce and the new owner does not have access to the previous cadences of the contact.`,
      //type: 'owner_change',
      //status: `Owner changed and all cadence links have been deleted.`,
      //lead_id: fetchedLead.lead_id,
      //incoming: null,
      //};
      //} else {
      //activity = {
      //name: `The owner of the contact has been changed from salesforce and the tasks for the required cadences have been updated.`,
      //type: 'owner_change',
      //status: `Owner changed and tasks have been shifted.`,
      //lead_id: fetchedLead.lead_id,
      //incoming: null,
      //};
      //}

      //recaculateUsers.push(oldOwner.user_id);
      //recaculateUsers.push(newOwner.user_id);
      //await ActivityHelper.activityCreation(
      //activity,
      //newOwner.user_id,
      //sendActivity
      //);

      i++;
      if (i === contacts.length)
        return successResponse(res, 'Contact owners successfully updated.');
    }

    return successResponse(res, 'Contact owner successfully updated.');
  } catch (err) {
    logger.error(`Error while updating contact owner id: `, err);
    return serverErrorResponse(res, err.message);
  }
};

// Old owner update logic
// Fetching contact
//const [lead, errForLead] = await LeadRepository.getLeadByQuery({
//salesforce_contact_id,
//});
//if (errForLead)
//return serverErrorResponse(res, `Error finding contact: ${errForLead}`);
//if (!lead)
//return notFoundResponse(
//res,
//'This contact does not exist in the cadence tool.'
//);

//ActivityHelper.activityCreation(activity, lead.user_id, sendActivity);
//return successResponse(res, 'Lead owner successfully updated.');

const deleteContacts = async (req, res) => {
  try {
    const { contacts } = req.body;
    if (contacts === undefined || contacts.length === 0)
      return badRequestResponse(res, 'Leads array in empty');

    let recaculateUsers = [];

    for (let lead of contacts) {
      const [fetchedLead, errForLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        //query: { salesforce_contact_id: lead.salesforce_contact_id },
        query: {
          integration_id: lead.salesforce_contact_id,
          integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
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

      const [deletedLead, errForDeletedLead] = await deleteAllLeadInfo({
        leadIds: [fetchedLead.lead_id],
      });
      recaculateUsers.push(fetchedLead.user_id);
    }
    // Recalculate tasks for user
    TaskHelper.recalculateDailyTasksForUsers(recaculateUsers);

    return successResponse(res, 'Deleted contacts successfully.');
  } catch (err) {
    logger.error('Error while deleting leads: ', err);
    return serverErrorResponse(res);
  }
};

// ==== DEPRECATED | NO LONGER USED ====
const createContactCadenceMember = async (req, res) => {
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
          await SalesforceService.createContactCadenceMember(
            cadence?.salesforce_cadence_id,
            data.salesforce_contact_id,
            cadence?.status,
            access_token,
            instance_url
          );
      }
    }
  } catch (err) {
    logger.error(
      `Error while creating contact cadence member in controller: `,
      err
    );
    return serverErrorResponse(
      res,
      `Error while creating contact cadence member in controller: ${err.message}.`
    );
  }
};

module.exports = {
  createContacts,
  getContactsBySalesforceContactId,
  updateContacts,
  deleteContacts,
  linkContactsWithCadence,
  updateContactToCadenceStatus,
  updateContactOwnerId,
  createContactCadenceMember,
};
