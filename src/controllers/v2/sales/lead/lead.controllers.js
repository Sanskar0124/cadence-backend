// Utils
const logger = require('../../../../utils/winston');
const {
  notFoundResponseWithDevMsg,
  successResponse,
  forbiddenResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  USER_ROLE,
  CUSTOM_TASK_NODE_ID,
  LEAD_STATUS,
  LUSHA_KASPR_OPTIONS,
  LUSHA_TYPES,
  LUSHA_FIELD_MAP,
  CRM_INTEGRATIONS,
  LEAD_INTEGRATION_TYPES,
  WEBHOOK_TYPE,
  SALESFORCE_SOBJECTS,
  INTEGRATION_TYPE,
  SALESFORCE_DATA_IMPORT_TYPES,
  CADENCE_LEAD_STATUS,
  ACTIVITY_TYPE,
  HUBSPOT_ENDPOINTS,
  CADENCE_OPTIONS,
  LEAD_SCORE_RUBRIKS,
  LEAD_WARMTH,
  BULK_OPTIONS,
  HIRING_INTEGRATIONS,
  SHEETS_CADENCE_INTEGRATION_TYPE,
  BULLHORN_ENDPOINTS,
  ACCOUNT_INTEGRATION_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
  DB_MODELS,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  GOOGLE_SHEETS_LEAD_ID,
} = require('../../../../../../Cadence-Brain/src/utils/config');

// Packages
const { Op } = require('sequelize');

// DB
const {
  sequelize,
  Lead_phone_number,
  Lead_email,
  Activity,
} = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const PhoneNumberHelper = require('../../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../../Cadence-Brain/src/helper/email');
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const SalesforceHelper = require('../../../../../../Cadence-Brain/src/helper/salesforce');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../Cadence-Brain/src/helper/company-field-map');
const LushaService = require('../../../../../../Cadence-Brain/src/services/Lusha');
const KasprService = require('../../../../../../Cadence-Brain/src/services/Kaspr');
const HunterService = require('../../../../../../Cadence-Brain/src/services/Hunter');
const DropcontactService = require('../../../../../../Cadence-Brain/src/services/DropContact');
const GoogleSheets = require('../../../../../../Cadence-Brain/src/services/Google/Google-Sheets');
const reassignLeadsOnSalesforce = require('../../../../../../Cadence-Brain/src/helper/lead/reassignLeadsOnSalesforce');
const UrlHelpers = require('../../../../../../Cadence-Brain/src/helper/url');
const ZohoService = require('../../../../../../Cadence-Brain/src/services/Zoho');
const SellsyHelper = require('../../../../../../Cadence-Brain/src/helper/sellsy');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const GoogleSheetsHelper = require('../../../../../../Cadence-Brain/src/helper/google-sheets');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const LeadScoreHelper = require('../../../../../../Cadence-Brain/src/helper/lead-score/');
const SnovService = require('../../../../../../Cadence-Brain/src/services/Snov');
const SocketHelper = require('../../../../../../Cadence-Brain/src/helper/socket');
const logToIntegration = require('../../../../../../Cadence-Brain/src/helper/logToIntegration');
const HtmlHelper = require('../../../../../../Cadence-Brain/src/helper/html');
const ObjectHelper = require('../../../../../../Cadence-Brain/src/helper/object');
const JsonHelper = require('../../../../../../Cadence-Brain/src/helper/json');

// GRPC
const v2GrpcClients = require('../../../../../../Cadence-Brain/src/grpc/v2');

// Joi
const leadSchema = require('../../../../joi/v2/sales/lead/lead.joi');
const { default: axios } = require('axios');
const {
  address_fields,
} = require('../../../../../../Cadence-Brain/src/helper/sellsy/describeCompanyFields');

const getLeadInfo = async (req, res) => {
  try {
    const { lead_id } = req.params;

    let leadPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'first_name',
            'last_name',
            'sd_id',
            'primary_email',
            'primary_phone_number',
            'calendly_url',
            'company_id',
            'salesforce_owner_id',
            'integration_id',
          ],
        },
        [DB_TABLES.ACCOUNT]: {
          attributes: [
            'account_id',
            'salesforce_account_id',
            'user_id',
            'name',
            'size',
            'zipcode',
            'country',
            'url',
            'linkedin_url',
            'phone_number',
            'linkedin_url',
            'integration_id',
            'integration_type',
          ],
        },
        [DB_TABLES.LEAD_PHONE_NUMBER]: {
          attributes: [
            'formatted_phone_number',
            'time',
            'lpn_id',
            'phone_number',
            'type',
            'timezone',
            'is_primary',
          ],
        },
        [DB_TABLES.LEAD_EMAIL]: {
          attributes: ['lem_id', 'email_id', 'is_primary', 'type'],
        },
      },
      extras: {
        attributes: [
          'lead_id',
          'first_name',
          'last_name',
          'job_position',
          'user_id',
          'salesforce_lead_id',
          'salesforce_contact_id',
          'account_id',
          'duplicate',
          'linkedin_url',
          'status',
          'type',
          'created_at',
          'integration_id',
          'integration_type',
          'lead_score',
          'lead_warmth',
        ],
      },
    });

    let nextNodePromise = [null, 'No node id provided in query.'];

    // promise to fetch next node
    if (req.query.next_node_id) {
      nextNodePromise = Repository.fetchOne({
        tableName: DB_TABLES.NODE,
        query: { node_id: req.query.next_node_id },
        extras: { attributes: ['type', 'wait_time'] },
      });
    }

    // resolve promises
    let [[lead, errForLead], [nextNode, errForNextNode]] = await Promise.all([
      leadPromise,
      nextNodePromise,
    ]);

    // If error occures
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead details',
        error: `Error while fetching lead: ${errForLead}.`,
      });

    // If lead is not present in db
    if (lead === null)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead details',
        error: 'Lead not found',
      });

    // * If lead is not assigned to the requested user
    if (lead.user_id !== req.user.user_id) {
      // if lead is not assigned to requested user, then check if requested user is manager of the user to which lead belongs or is admin of the company of user to which lead belongs.

      const isManager =
        [USER_ROLE.SALES_MANAGER, USER_ROLE.SALES_MANAGER_PERSON].includes(
          req.user?.role
        ) && req.user?.sd_id === lead?.User?.sd_id;

      const isAdmin =
        [USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN].includes(req.user?.role) &&
        req.user.company_id === lead?.User?.company_id;

      // If its neither admin nor manager, return forbidden response
      if (!isManager && !isAdmin) return forbiddenResponseWithDevMsg({ res });
    }

    if (errForNextNode) nextNode = {};

    return successResponse(res, 'Lead fetched successfully', {
      lead: {
        data: lead,
        msg: `Lead fetched successfully.`,
        success: true,
      },
      nextNode,
    });
  } catch (err) {
    logger.error('Error while fetching lead info: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error occurred while fetching lead info: ${err.message}`,
    });
  }
};

const getLeadCadences = async (req, res) => {
  try {
    const { lead_id } = req.params;

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'sd_id', 'company_id'],
        },
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['cadence_id', 'status'],
          [DB_TABLES.CADENCE]: {
            attributes: ['cadence_id', 'name'],
            [DB_TABLES.NODE]: {
              attributes: ['node_id'],
            },
          },
          [DB_TABLES.TASK]: {
            on: sequelize.literal(
              '`LeadToCadences`.`cadence_id` = `LeadToCadences->Tasks`.`cadence_id` ' +
                'AND `LeadToCadences`.`lead_id` = `LeadToCadences->Tasks`.`lead_id` ' +
                'AND `LeadToCadences->Tasks`.`is_skipped` = false ' +
                'AND `LeadToCadences->Tasks`.`completed` = false ' +
                'AND `LeadToCadences->Tasks`.`node_id` NOT IN ' +
                `(${Object.values(CUSTOM_TASK_NODE_ID)})`
            ),
            attributes: ['task_id'],
            [DB_TABLES.NODE]: {
              attributes: ['type', 'step_number'],
            },
          },
        },
      },
      extras: {
        attributes: ['lead_id', 'user_id'],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead cadences',
        error: `Error while fetching lead cadences: ${errForLead}.`,
      });

    if (lead?.LeadToCadences?.length) {
      lead.LeadToCadences.forEach((leadToCadence) => {
        leadToCadence.Cadences[0].Nodes =
          leadToCadence.Cadences[0]?.Nodes?.length;
      });
    }

    if (lead.user_id !== req.user.user_id) {
      // if lead is not assigned to requested user, then check if requested user is manager of the user to which lead belongs or is admin of the company of user to which lead belongs.

      const isManager =
        [USER_ROLE.SALES_MANAGER, USER_ROLE.SALES_MANAGER_PERSON].includes(
          req.user?.role
        ) && req.user?.sd_id === lead?.User?.sd_id;

      const isAdmin =
        [USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN].includes(req.user?.role) &&
        req.user.company_id === lead?.User?.company_id;

      // If its neither admin nor manager, return forbidden response
      if (!isManager && !isAdmin) return forbiddenResponseWithDevMsg({ res });
    }

    return successResponse(
      res,
      'Lead cadences fetched successfully',
      lead.LeadToCadences || []
    );
  } catch (err) {
    logger.error('Error while fetching lead cadences: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error occurred while fetching lead cadences: ${err.message}`,
    });
  }
};

const getLeadActivities = async (req, res) => {
  try {
    const { lead_id } = req.params;

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'sd_id', 'company_id'],
        },
        [DB_TABLES.ACTIVITY]: {
          [DB_TABLES.CADENCE]: { attributes: ['name'] },
          [DB_TABLES.EMAIL]: {
            attributes: ['status'],
          },
          [DB_TABLES.TASK]: {
            attributes: ['node_id', 'start_time'],
          },
        },
      },
      extras: {
        order: [[{ model: Activity }, 'created_at', 'ASC']],
        attributes: ['lead_id', 'user_id'],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error occurred while fetching lead: ${errForLead.message}`,
      });

    if (lead.user_id !== req.user.user_id) {
      const isManager =
        [USER_ROLE.SALES_MANAGER, USER_ROLE.SALES_MANAGER_PERSON].includes(
          req.user?.role
        ) && req.user?.sd_id === lead?.User?.sd_id;

      const isAdmin =
        [USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN].includes(req.user?.role) &&
        req.user.company_id === lead?.User?.company_id;

      if (!isManager && !isAdmin) return forbiddenResponseWithDevMsg({ res });
    }

    let activities = [];
    if (lead?.Activities?.length) {
      activities = lead?.Activities?.map((activity) => {
        const { Task, ...rest } = activity;
        const task_type = Object.keys(CUSTOM_TASK_NODE_ID).find(
          (key) => CUSTOM_TASK_NODE_ID[key] === Task?.node_id
        );

        const updatedActivity = {
          ...rest,
          task_type,
          start_time: Task?.start_time,
        };

        // Remove null value pairs
        Object.keys(updatedActivity).forEach((key) => {
          if (updatedActivity[key] === null && key !== 'incoming') {
            delete updatedActivity[key];
          }
        });

        return updatedActivity;
      });
    }

    return successResponse(
      res,
      'Lead activities fetched successfully',
      activities
    );
  } catch (err) {
    logger.error('Error while fetching lead activities: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error occurred while fetching lead activities: ${err.message}`,
    });
  }
};

const updateLeadAndAccountDetailsNew = async (req, res) => {
  try {
    const params = leadSchema.leadUpdateSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    let { lead, phone_numbers, emails } = req.body;

    if (phone_numbers) {
      let primary_phone = phone_numbers.filter((phone) => phone.is_primary);
      if (primary_phone.length > 1)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Only one phone can be selected as primary',
        });
      if (primary_phone?.[0]?.phone_number === '')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Primary phone number cannot be empty',
        });
    }

    if (emails) {
      let primary_email = emails.filter((email) => email.is_primary);
      if (primary_email.length > 1)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Only one email can be selected as primary',
        });
      if (primary_email?.[0]?.email_id === '')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Primary email cannot be empty',
        });
    }

    if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS) {
      const emailRegex = /^(.{1,320})@[^\s@]{1,255}\.[^\s@]{2,}$/;
      const phoneRegex =
        /^(?:\+\d{1,3}\s?)?(?:\(\d{1,4}\)\s?)?(?:\d{1,4}[\s-])?\d{7,14}$/;
      const linkedinRegex =
        /^(https?:\/\/)?(www\.)?linkedin\.com\/(in\/[a-zA-Z0-9_-]{1,100}|company\/[0-9]+)\/?$/;
      const websiteUrlRegex =
        /^(https?:\/\/)?([\w.-]{1,100})\.([a-z]{2,})(:\d{2,5})?(\/\S*)?$/i;

      phone_numbers.forEach((entry) => {
        if (entry.phone_number && !phoneRegex.test(entry.phone_number))
          return unprocessableEntityResponseWithDevMsg({
            res,
            msg: `${entry.type} is not valid.`,
          });
      });

      emails.forEach((entry) => {
        if (entry.email_id && !emailRegex.test(entry.email_id))
          return unprocessableEntityResponseWithDevMsg({
            res,
            msg: `${entry.type} is not valid`,
          });
      });

      if (lead.first_name?.length > 50)
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: `First name can't be more than 50 characters`,
        });
      if (lead.last_name?.length > 75)
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: `Last name can't be more than 75 characters`,
        });
      if (lead.job_position?.length > 50)
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: `Job Position can't be more than 50 characters`,
        });
      if (lead.linkedin_url)
        if (!linkedinRegex.test(lead.linkedin_url))
          return unprocessableEntityResponseWithDevMsg({
            res,
            msg: `Linkedin url is invalid`,
          });
      if (lead.country?.length > 100)
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: "Country name can't be more than 100 characters",
        });
      if (lead.account.linkedin_url)
        if (!linkedinRegex.test(lead.account.linkedin_url))
          return unprocessableEntityResponseWithDevMsg({
            res,
            msg: `Linkedin url is invalid`,
          });
      if (lead.account?.length > 200)
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: "Company name can't be more than 200 characters",
        });
      if (lead.account.phone_number)
        if (!phoneRegex.test(lead.account.phone_number))
          return unprocessableEntityResponseWithDevMsg({
            res,
            msg: `Account phone number is invalid`,
          });
      if (lead.size?.length > 10)
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: "Company size can't be more than 10 characters",
        });
      if (lead.account.url)
        if (!websiteUrlRegex.test(lead.account.url))
          return unprocessableEntityResponseWithDevMsg({
            res,
            msg: 'Company website url is invalid',
          });
      if (lead.account.zipcode?.length > 100)
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: "Zipcode can't be more than 10 characters",
        });
    }

    // Updating lead and account info db
    lead.full_name = lead.first_name + ' ' + lead.last_name;

    let tokensToFetch;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE: {
        tokensToFetch = DB_TABLES.SALESFORCE_TOKENS;
        break;
      }
      case CRM_INTEGRATIONS.PIPEDRIVE: {
        tokensToFetch = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      }
      case CRM_INTEGRATIONS.HUBSPOT: {
        tokensToFetch = DB_TABLES.HUBSPOT_TOKENS;
        break;
      }
      case CRM_INTEGRATIONS.ZOHO: {
        tokensToFetch = DB_TABLES.ZOHO_TOKENS;
        break;
      }
      case CRM_INTEGRATIONS.SELLSY: {
        tokensToFetch = DB_TABLES.SELLSY_TOKENS;
        break;
      }
      case HIRING_INTEGRATIONS.BULLHORN: {
        tokensToFetch = DB_TABLES.BULLHORN_TOKENS;
        break;
      }
      case CRM_INTEGRATIONS.DYNAMICS: {
        tokensToFetch = DB_TABLES.DYNAMICS_TOKENS;
        break;
      }
    }

    let [fetchedLead, errForFetch] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id: lead.lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
      },
      [DB_TABLES.USER]: {
        [tokensToFetch]: {},
      },
    });
    if (errForFetch)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching leads: ${errForFetch}`,
        msg: 'Failed to find lead',
      });
    if (!fetchedLead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to find lead',
        error: 'Lead not found',
      });

    leadObj = {
      first_name: lead.first_name,
      last_name: lead.last_name,
      job_position: lead.job_position,
      linkedin_url: lead.linkedin_url,
    };

    // Updating lead phone numbers in db
    if (phone_numbers)
      for (let phone of phone_numbers) leadObj[phone.type] = phone.phone_number;

    if (emails) for (let email of emails) leadObj[email.type] = email.email_id;

    switch (fetchedLead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD:
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (
          errForAccessToken === 'Please log in with salesforce' ||
          errForAccessToken === 'expired access/refresh token'
        )
          return successResponse(
            res,
            'Please sign in with salesforce to update lead details.'
          );
        // * Fetch salesforce field map
        let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingSalesforceFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
            error: `Error while fetching Salesforce fieldmap: ${errFetchingSalesforceFieldMap}`,
          });

        let salesforceAccountMap = salesforceFieldMap.account_map;
        let salesforceContactMap = salesforceFieldMap.contact_map;
        let salesforceLeadMap = salesforceFieldMap.lead_map;

        if (
          fetchedLead.integration_type ===
          LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD
        ) {
          const sfLead = {};

          sfLead[salesforceLeadMap?.first_name] = leadObj.first_name;
          sfLead[salesforceLeadMap?.last_name] = leadObj.last_name;
          sfLead[salesforceLeadMap?.job_position] = leadObj.job_position;
          sfLead[salesforceLeadMap?.linkedin_url] = leadObj.linkedin_url;

          // * Lead account
          sfLead[salesforceLeadMap?.company] = lead.account.name;
          sfLead[salesforceLeadMap?.company_phone_number] =
            lead.account.phone_number;
          sfLead[
            CompanyFieldMapHelper.getCompanySize({
              size: salesforceLeadMap?.size,
            })[0]
          ] = lead.account.size;
          sfLead[salesforceLeadMap?.url] = lead.account.url;
          sfLead[salesforceLeadMap?.country] = lead.account.country;
          sfLead[salesforceLeadMap?.zip_code] = lead.account.zipcode;

          salesforceLeadMap.emails.forEach((emailType) => {
            sfLead[emailType] = leadObj[emailType];
          });

          salesforceLeadMap.phone_numbers.forEach((phoneType) => {
            sfLead[phoneType] = leadObj[phoneType];
          });

          delete sfLead['undefined'];
          delete sfLead['null'];

          let [_, errUpdatingLeadSalesforce] =
            await v2GrpcClients.crmIntegration.updateLead({
              integration_type: CRM_INTEGRATIONS.SALESFORCE,
              integration_data: {
                sfLeadId: fetchedLead.integration_id,
                lead: { ...sfLead, ...lead.variables },
                access_token,
                instance_url,
              },
            });
          if (errUpdatingLeadSalesforce) {
            logger.error('Lead update failed: ', errUpdatingLeadSalesforce);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update leads, please contact support',
              error: errUpdatingLeadSalesforce,
            });
          }

          let accountToUpdate = lead.account;
          delete lead['account'];
          delete lead['variables'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: lead,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update lead',
              error: updateLeadErr,
            });

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: accountToUpdate,
          });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                lead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                lead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }
        } else if (
          fetchedLead.integration_type ===
          LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT
        ) {
          const contact = {};

          contact[salesforceContactMap?.first_name] = leadObj.first_name;
          contact[salesforceContactMap?.last_name] = leadObj.last_name;
          contact[salesforceContactMap?.job_position] = leadObj.job_position;
          contact[salesforceContactMap?.linkedin_url] = leadObj.linkedin_url;

          salesforceContactMap.emails.forEach((emailType) => {
            contact[emailType] = leadObj[emailType];
          });

          salesforceContactMap.phone_numbers.forEach((phoneType) => {
            contact[phoneType] = leadObj[phoneType];
          });

          delete contact['undefined'];

          let [_, errUpdatingContactSalesforce] =
            await v2GrpcClients.crmIntegration.updateContact({
              integration_type: CRM_INTEGRATIONS.SALESFORCE,
              integration_data: {
                sfContactId: fetchedLead.integration_id,
                contact: { ...contact, ...lead.variables },
                access_token,
                instance_url,
              },
            });
          if (errUpdatingContactSalesforce)
            return serverErrorResponseWithDevMsg({
              res,
              error: errUpdatingContactSalesforce,
              msg: 'Failed to update contact in salesforce',
            });

          let leadAccount = lead.account;
          delete lead['account'];
          delete lead['variables'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: contact,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update lead',
              error: `Error while updating lead: ${updateLeadErr}`,
            });

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: leadAccount,
          });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                fetchedLead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                fetchedLead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }

          if (leadAccount) {
            let account = {};

            account[salesforceAccountMap?.name] = leadAccount.name;
            account[
              CompanyFieldMapHelper.getCompanySize({
                size: salesforceAccountMap?.size,
              })[0]
            ] = leadAccount.size;
            account[salesforceAccountMap?.url] = leadAccount.url;
            account[salesforceAccountMap?.country] = leadAccount.country;
            account[salesforceAccountMap?.zip_code] = leadAccount.zipcode;
            account[salesforceAccountMap?.linkedin_url] =
              leadAccount.linkedin_url;
            account[salesforceAccountMap?.phone_number] =
              leadAccount.phone_number;

            delete account['undefined'];

            let [__, errUpdatingAccountSalesforce] =
              await v2GrpcClients.crmIntegration.updateAccount({
                integration_type: CRM_INTEGRATIONS.SALESFORCE,
                integration_data: {
                  sfAccountId: fetchedLead.Account.integration_id,
                  account: { ...account, ...leadAccount.variables },
                  access_token,
                  instance_url,
                },
              });
            if (errUpdatingAccountSalesforce)
              return successResponse(
                res,
                `Successfully updated contact. Error while updating Account: ${errUpdatingAccountSalesforce}`
              );

            delete leadAccount['variables'];
            lead.account = leadAccount;

            let [___, updateAccountErr] = await LeadRepository.updateLead(lead);
            if (updateAccountErr)
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to update lead',
                error: `Error while updating lead: ${updateAccountErr}`,
              });
          }
        }
        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            user_id: req.user.user_id,
          });
        if (
          errForAccessToken === 'Please log in with pipedrive' ||
          errForAccessToken === 'expired access/refresh token'
        )
          return successResponse(
            res,
            'Please sign in with pipedrive to update lead details.'
          );

        // * Fetch pipedrive field map
        let [pipedriveFieldMap, errFetchingPipedriveFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingPipedriveFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update',
            error: `Error while fetching Pipedrive fieldmap: ${errFetchingPipedriveFieldMap}`,
          });

        let pipedrivePersonMap = pipedriveFieldMap.person_map;
        let pipedriveOrganizationMap = pipedriveFieldMap.organization_map;

        const pdPerson = {};

        pdPerson[pipedrivePersonMap?.first_name] = leadObj.first_name;
        pdPerson[pipedrivePersonMap?.last_name] = leadObj.last_name;
        pdPerson[pipedrivePersonMap?.job_position] = leadObj.job_position;
        pdPerson[pipedrivePersonMap?.linkedin_url] = leadObj.linkedin_url;
        if (emails?.length) {
          pdPerson[pipedrivePersonMap?.emails] = [];
          emails?.map((email) => {
            pdPerson[pipedrivePersonMap?.emails].push({
              label: email.type,
              value: email.email_id,
              primary: email.is_primary,
            });
          });
        }
        if (phone_numbers.length) {
          pdPerson[pipedrivePersonMap?.phone_numbers] = [];
          phone_numbers?.map((phone_number) => {
            pdPerson[pipedrivePersonMap?.phone_numbers].push({
              label: phone_number.type,
              value: phone_number.phone_number,
              primary: phone_number.is_primary,
            });
          });
        }

        let [updatedContact, errUpdatingContactSalesforce] =
          await v2GrpcClients.crmIntegration.updateContact({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            integration_data: {
              person_id: fetchedLead.integration_id,
              person: { ...pdPerson, ...lead.variables },
              access_token,
              instance_url,
            },
          });
        if (errUpdatingContactSalesforce)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while updating person in pipedrive: ${errUpdatingContactSalesforce}`,
            msg: 'Failed to update person in pipedrive',
          });

        let leadAccount = lead.account;
        delete lead['account'];
        delete lead['variables'];

        let [updatedLead, updateLeadErr] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: lead,
        });
        if (updateLeadErr)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
          });

        if (fetchedLead.account_id) {
          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: leadAccount,
          });

          if (leadAccount && fetchedLead.Account !== null) {
            let pdAccount = {};

            pdAccount[pipedriveOrganizationMap?.name] = leadAccount.name;
            pdAccount[pipedriveOrganizationMap?.country] = leadAccount.country;
            pdAccount[pipedriveOrganizationMap?.phone_number] =
              leadAccount.phone_number;
            pdAccount[
              CompanyFieldMapHelper.getCompanySize({
                size: pipedriveOrganizationMap?.size,
              })[0]
            ] = leadAccount.size;
            pdAccount[pipedriveOrganizationMap?.url] = leadAccount.url;
            pdAccount[pipedriveOrganizationMap?.linkedin_url] =
              leadAccount.linkedin_url;
            pdAccount[pipedriveOrganizationMap?.zip_code] = leadAccount.zipcode;

            delete pdAccount['undefined'];
            delete pdAccount['null'];

            let [updatedAccount, errUpdatingAccountSalesforce] =
              await v2GrpcClients.crmIntegration.updateAccount({
                integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
                integration_data: {
                  organization_id: fetchedLead.Account.integration_id,
                  organization: { ...pdAccount, ...leadAccount.variables },
                  access_token,
                  instance_url,
                },
              });
            if (errUpdatingAccountSalesforce)
              return successResponse(
                res,
                `Successfully updated contact. Error while updating Account: ${errUpdatingAccountSalesforce}`
              );
          }
        }

        // Updating lead phone numbers in db
        if (phone_numbers) {
          // for (let phone of phone_numbers) {
          //   PhoneNumberHelper.updatePhoneNumberUsingId(
          //     phone.lpn_id,
          //     fetchedLead.lead_id,
          //     phone.phone_number,
          //     phone.is_primary
          //   );
          // }
          const [upsertedPhones, errForUpsertedPhones] =
            await PhoneNumberHelper.bulkUpsertPhoneNumbers({
              phone_numbers,
              lead_id: fetchedLead.lead_id,
            });
        }

        // Updating lead emails in db
        if (emails) {
          // for (let email of emails) {
          //   LeadEmailHelper.updateEmailUsingId(
          //     email.lem_id,
          //     fetchedLead.lead_id,
          //     email.email_id,
          //     email.is_primary
          //   );
          // }
          const [upsertedEmails, errForUpsertedEmails] =
            await LeadEmailHelper.bulkUpsertEmails({
              emails,
              lead_id: fetchedLead.lead_id,
            });
        }

        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT: {
        const [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            user_id: req.user.user_id,
          });
        if (
          errForAccessToken === 'Please log in with hubspot' ||
          errForAccessToken === 'expired access/refresh token'
        )
          return successResponse(
            res,
            'Please sign in with hubspot to update lead details.'
          );

        // * Fetch hubspot field map
        let [hubspotFieldMap, errFetchingHubspotFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingHubspotFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update',
            error: `Error while fetching Hubspot fieldmap: ${errFetchingHubspotFieldMap}`,
          });

        let hubspotContactMap = hubspotFieldMap.contact_map;
        let hubspotCompanyMap = hubspotFieldMap.company_map;

        const contact = {};

        contact[hubspotContactMap?.first_name] = leadObj.first_name;
        contact[hubspotContactMap?.last_name] = leadObj.last_name;
        contact[hubspotContactMap?.job_position] = leadObj.job_position;
        contact[hubspotContactMap?.linkedin_url] = leadObj.linkedin_url;
        const emap = new Map();
        let em = hubspotContactMap?.emails;
        for (let i = 0; i < em.length; i++) {
          emap.set(em[i], i);
        }
        if (emails?.length) {
          emails?.map((email) => {
            if (emap.has(email.type))
              contact[hubspotContactMap?.emails[emap.get(email.type)]] =
                email.email_id;
          });
        }
        const pmap = new Map();
        let ph = hubspotContactMap?.phone_numbers;
        for (let i = 0; i < ph.length; i++) {
          pmap.set(ph[i], i);
        }
        if (phone_numbers.length) {
          phone_numbers?.map((phone_number) => {
            if (pmap.has(phone_number.type)) {
              contact[
                hubspotContactMap?.phone_numbers[pmap.get(phone_number.type)]
              ] = phone_number.phone_number;
            }
          });
        }

        delete contact['undefined'];
        delete contact['null'];
        let [_, errUpdatingContactHubspot] =
          await v2GrpcClients.crmIntegration.updateContact({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            integration_data: {
              contact_id: fetchedLead.integration_id,
              data: { ...contact, ...lead.variables },
              access_token,
            },
          });
        if (errUpdatingContactHubspot)
          return serverErrorResponseWithDevMsg({
            res,
            error: errUpdatingContactHubspot,
            msg: 'Failed to update contact in Hubspot',
          });

        let leadAccount = lead.account;
        delete lead['account'];
        delete lead['variables'];

        let [updatedLead, updateLeadErr] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: {
            lead_id: fetchedLead.lead_id,
          },
          updateObject: lead,
        });

        if (updateLeadErr)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
            error: `Error while updating lead: ${updateLeadErr}`,
          });

        await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          query: {
            account_id: fetchedLead.account_id,
          },
          updateObject: leadAccount,
        });

        // Updating lead phone numbers in db
        if (phone_numbers) {
          for (let phone of phone_numbers) {
            PhoneNumberHelper.updatePhoneNumber(
              phone.phone_number,
              phone.type,
              fetchedLead.lead_id
            );
          }
        }

        if (emails) {
          for (let email of emails) {
            LeadEmailHelper.updateEmail(
              email.email_id,
              email.type,
              fetchedLead.lead_id
            );
          }
        }

        if (leadAccount && fetchedLead.Account !== null) {
          let account = {};

          account[hubspotCompanyMap?.name] = leadAccount.name;
          account[hubspotCompanyMap?.size] = leadAccount.size;
          account[hubspotCompanyMap?.url] = leadAccount.url;
          account[hubspotCompanyMap?.phone_number] = leadAccount.phone_number;
          account[hubspotCompanyMap?.country] = leadAccount.country;
          account[hubspotCompanyMap?.zip_code] = leadAccount.zipcode;
          delete account['undefined'];

          let [__, errUpdatingAccountHubspot] =
            await v2GrpcClients.crmIntegration.updateAccount({
              integration_type: CRM_INTEGRATIONS.HUBSPOT,
              integration_data: {
                company_id: fetchedLead.Account.integration_id,
                data: { ...account, ...leadAccount.variables },
                access_token,
              },
            });
          if (errUpdatingAccountHubspot)
            return successResponse(
              res,
              `Successfully updated contact. Error while updating Account: ${errUpdatingAccountHubspot}`
            );
        }
        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD: {
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
        //return serverErrorResponse(
        //res,
        //'Kindly ask admin to create field map'
        //);

        // const [sheetID, errForSheetID] = await Repository.fetchOne({

        // })
        //let googleSheetsFieldMap =
        //userForFieldMap?.Company?.Company_Setting?.Google_Sheets_Field_Map
        //?.lead_map;

        const [leadForCadence, errForLead] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          include: {
            [DB_TABLES.LEADTOCADENCE]: {
              include: [DB_MODELS.cadence],
            },
          },
        });
        if (errForLead)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching lead: ${errForLead}`,
            msg: 'Failed to fetch lead',
          });
        let cadences = [];
        leadForCadence.LeadToCadences.forEach((lead) => {
          cadences = cadences.concat(lead.Cadences);
        });
        for (let i = 0; i < cadences.length; i++) {
          let cadence = cadences[i];
          let googleSheetsFieldMap = cadence.field_map;
          const [gsLeads, errForGsLeads] = await GoogleSheets.getSheet(
            cadence.salesforce_cadence_id
          );
          if (errForGsLeads && errForGsLeads.includes('403'))
            return serverErrorResponseWithDevMsg({
              res,
              msg: `Please provide edit access to "Anyone with the link" to the spreadsheet`,
            });
          if (errForGsLeads)
            return serverErrorResponseWithDevMsg({
              res,
              error: `Error while fetching leads from google sheet: ${errForGsLeads}`,
              msg: 'Failed to fetch leads from google sheet',
            });

          // Updating lead in google sheets
          const gsLead = await gsLeads.find((row) => {
            return row[googleSheetsFieldMap.lead_id] == lead.lead_id;
          });
          if (!gsLead)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Could not find lead in google sheets',
            });
          for (let key of Object.keys(lead))
            gsLead[googleSheetsFieldMap[key]] = lead[key];

          const account_map = {
            company: googleSheetsFieldMap?.company,
            size: googleSheetsFieldMap?.size,
            url: googleSheetsFieldMap?.url,
            country: googleSheetsFieldMap?.country,
            zip_code: googleSheetsFieldMap?.zip_code,
            company_phone_number: googleSheetsFieldMap?.company_phone_number,
          };

          lead.account.company = lead.account.name;
          lead.account.zip_code = lead.account.zipcode;
          lead.account.company_phone_number = lead.account.phone_number;

          for (let key of Object.keys(account_map || {}))
            gsLead[googleSheetsFieldMap[key]] = lead.account?.[key];

          // Updating lead phone numbers in google sheets
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              let pn = phone.phone_number;
              if (pn && pn.startsWith('+')) pn = `'${pn}`;
              gsLead[phone.type] = pn;
              //switch (phone.type) {
              //case GOOGLE_SHEETS_PHONE_NUMBER_FIELDS.WORK_PHONE:
              //case GOOGLE_SHEETS_PHONE_NUMBER_FIELDS.HOME_PHONE:
              //case GOOGLE_SHEETS_PHONE_NUMBER_FIELDS.OTHER_PHONE:
              //case GOOGLE_SHEETS_PHONE_NUMBER_FIELDS.PRIMARY:
              //// Add a ' before a number if it begins with a +
              //// Else google sheet parses it as a formula and not a plain text
              //let pn = phone.phone_number;
              //if (pn && pn.startsWith('+')) pn = `'${pn}`;
              //gsLead[phone.type] = pn;

              //break;
              //default:
              //return serverErrorResponse(
              //res,
              //'Invalid phone type. Allowed types: ' +
              //Object.values(GOOGLE_SHEETS_PHONE_NUMBER_FIELDS)
              //);
              //}
            }
          }

          // Updating lead email ids in google sheets
          if (emails) {
            for (let email of emails) {
              gsLead[email.type] = email.email_id;
              //switch (email.type) {
              //case GOOGLE_SHEETS_EMAIL_FIELDS.WORK_EMAIL:
              //case GOOGLE_SHEETS_EMAIL_FIELDS.HOME_EMAIL:
              //case GOOGLE_SHEETS_EMAIL_FIELDS.OTHER_EMAIL:
              //case GOOGLE_SHEETS_EMAIL_FIELDS.PRIMARY:
              //gsLead[email.type] = email.email_id;
              //break;
              //default:
              //return serverErrorResponse(
              //res,
              //'Invalid email type. Allowed types: ' +
              //Object.values(GOOGLE_SHEETS_EMAIL_FIELDS)
              //);
              //}
            }
          }
          gsLead.save();
        }
        let [updatedLead, updateLeadErr] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: lead,
        });
        if (updateLeadErr)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
            error: `Error while updating lead: ${updateLeadErr}`,
          });

        await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          query: { account_id: fetchedLead.account_id },
          updateObject: lead.account,
        });

        // Updating lead phone numbers in db
        if (phone_numbers) {
          for (let phone of phone_numbers) {
            PhoneNumberHelper.updatePhoneNumberUsingId(
              phone.lpn_id,
              fetchedLead.lead_id,
              phone.phone_number,
              phone.is_primary
            );
          }
        }

        if (emails) {
          for (let email of emails) {
            LeadEmailHelper.updateEmailUsingId(
              email.lem_id,
              fetchedLead.lead_id,
              email.email_id,
              email.is_primary
            );
          }
        }
        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.ZOHO_LEAD:
      case LEAD_INTEGRATION_TYPES.ZOHO_CONTACT: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            user_id: req.user.user_id,
          });
        if (
          errForAccessToken === 'Please log in with zoho' ||
          errForAccessToken === 'expired access/refresh token'
        )
          return successResponse(
            res,
            'Please sign in with zoho to update lead details.'
          );
        // * Fetch zoho field map
        let [zohoFieldMap, errFetchingZohoFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingZohoFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update',
            error: `Error while fetching Salesforce fieldmap: ${errFetchingSalesforceFieldMap}`,
          });

        let zohoAccountMap = zohoFieldMap.account_map;
        let zohoContactMap = zohoFieldMap.contact_map;
        let zohoLeadMap = zohoFieldMap.lead_map;

        if (fetchedLead.integration_type === LEAD_INTEGRATION_TYPES.ZOHO_LEAD) {
          const zohoLead = {};

          zohoLead[zohoLeadMap?.first_name] = leadObj.first_name
            ? leadObj.first_name
            : null;
          zohoLead[zohoLeadMap?.last_name] = leadObj.last_name
            ? leadObj.last_name
            : null;
          zohoLead[zohoLeadMap?.job_position] = leadObj.job_position
            ? leadObj.job_position
            : null;
          zohoLead[zohoLeadMap?.linkedin_url] = leadObj.linkedin_url
            ? leadObj.linkedin_url
            : null;

          // * Lead account
          zohoLead[zohoLeadMap?.company] = lead.account.name;
          zohoLead[
            CompanyFieldMapHelper.getCompanySize({
              size: zohoLeadMap?.size,
            })[0]
          ] = lead.account.size ? lead.account.size : null;
          zohoLead[zohoLeadMap?.url] = lead.account.url
            ? lead.account.url
            : null;
          zohoLead[zohoLeadMap?.country] = lead.account.country
            ? lead.account.country
            : null;
          zohoLead[zohoLeadMap?.zip_code] = lead.account.zipcode
            ? lead.account.zipcode
            : null;

          /* linkedIn url of led is again updated null because of linkedIn url of account as mapping of linkedIn url account is not 
          present so commenting it for now */
          // zohoLead[zohoLeadMap?.linkedin_url] = lead.account.linkedin_url
          //   ? lead.account.linkedin_url
          //   : null;

          zohoLeadMap.emails.forEach((emailType) => {
            zohoLead[emailType] = leadObj[emailType]
              ? leadObj[emailType]
              : null;
          });

          zohoLeadMap.phone_numbers.forEach((phoneType) => {
            zohoLead[phoneType] = leadObj[phoneType]
              ? leadObj[phoneType]
              : null;
          });

          delete zohoLead['undefined'];

          let [_, errUpdatingLeadZoho] =
            await v2GrpcClients.crmIntegration.updateLead({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                lead_id: fetchedLead.integration_id,
                lead: { ...zohoLead, ...lead.variables },
                access_token,
                instance_url,
              },
            });
          if (errUpdatingLeadZoho) {
            logger.error('Lead update failed: ', errUpdatingLeadZoho);
            return serverErrorResponseWithDevMsg({
              res,
              error: `Error while updating lead: ${errUpdatingLeadZoho}`,
              msg: 'Failed to update lead',
            });
          }

          let accountToUpdate = lead.account;
          delete lead['account'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: lead,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              error: `Error while updating lead: ${updateLeadErr}`,
              msg: 'Failed to update lead',
            });

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: accountToUpdate,
          });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                lead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                lead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }
        } else if (
          fetchedLead.integration_type === LEAD_INTEGRATION_TYPES.ZOHO_CONTACT
        ) {
          const contact = {};

          contact[zohoContactMap?.first_name] = leadObj.first_name
            ? leadObj.first_name
            : null;
          contact[zohoContactMap?.last_name] = leadObj.last_name
            ? leadObj.last_name
            : null;
          contact[zohoContactMap?.job_position] = leadObj.job_position
            ? leadObj.job_position
            : null;
          contact[zohoContactMap?.linkedin_url] = leadObj.linkedin_url
            ? leadObj.linkedin_url
            : null;

          zohoContactMap.emails.forEach((emailType) => {
            contact[emailType] = leadObj[emailType] ? leadObj[emailType] : null;
          });

          zohoContactMap.phone_numbers.forEach((phoneType) => {
            contact[phoneType] = leadObj[phoneType] ? leadObj[phoneType] : null;
          });

          delete contact['undefined'];

          let [_, errUpdatingContactZoho] =
            await v2GrpcClients.crmIntegration.updateContact({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                contact_id: fetchedLead.integration_id,
                contact: { ...contact, ...lead.variables },
                access_token,
                instance_url,
              },
            });
          if (errUpdatingContactZoho)
            return serverErrorResponseWithDevMsg({
              res,
              error: `Error while updating lead: ${errUpdatingContactZoho}`,
              msg: 'Failed to update lead',
            });

          let leadAccount = lead.account;
          delete lead['account'];
          delete lead['variables'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: contact,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              error: `Error while updating lead: ${updateLeadErr}`,
              msg: 'Failed to update lead',
            });

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: leadAccount,
          });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                fetchedLead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                fetchedLead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }

          if (leadAccount) {
            let account = {};

            account[zohoAccountMap?.name] = leadAccount.name;
            account[
              CompanyFieldMapHelper.getCompanySize({
                size: zohoAccountMap?.size,
              })[0]
            ] = leadAccount.size ? leadAccount.size : null;
            account[zohoAccountMap?.url] = leadAccount.url
              ? leadAccount.url
              : null;
            account[zohoAccountMap?.country] = leadAccount.country
              ? leadAccount.country
              : null;
            account[zohoAccountMap?.zip_code] = leadAccount.zipcode
              ? leadAccount.zipcode
              : null;
            account[zohoAccountMap?.linkedin_url] = leadAccount.linkedin_url
              ? leadAccount.linkedin_url
              : null;
            account[zohoAccountMap?.phone_number] = leadAccount.phone_number
              ? leadAccount.phone_number
              : null;

            delete account['undefined'];

            let [__, errUpdatingAccountZoho] =
              await v2GrpcClients.crmIntegration.updateAccount({
                integration_type: CRM_INTEGRATIONS.ZOHO,
                integration_data: {
                  account_id: fetchedLead.Account.integration_id,
                  account: { ...account, ...leadAccount.variables },
                  access_token,
                  instance_url,
                },
              });
            if (errUpdatingAccountZoho)
              return successResponse(
                res,
                `Successfully updated contact. Error while updating Account: ${errUpdatingAccountZoho}`
              );

            delete leadAccount['variables'];
            lead.account = leadAccount;

            let [___, updateAccountErr] = await LeadRepository.updateLead(lead);
            if (updateAccountErr)
              return serverErrorResponseWithDevMsg({
                res,
                error: `Error while updating lead: ${updateAccountErr}`,
                msg: 'Failed to update lead',
              });
          }
        }
        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.SELLSY_CONTACT: {
        const [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return successResponse(
            res,
            'Please connect with sellsy to update lead details.'
          );

        // * Fetch pipedrive field map
        let [sellsyFieldMap, errFetchingSellsyFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingSellsyFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
            error: `Error while fetching sellsy fieldmap: ${errFetchingSellsyFieldMap}`,
          });

        let sellsyContactMap = sellsyFieldMap.contact_map;
        let sellsyCompanyMap = sellsyFieldMap.company_map;

        if (phone_numbers) {
          for (let phone of phone_numbers) delete leadObj[phone.type];
          leadObj.phone_numbers = phone_numbers;
        }

        if (emails) {
          for (let email of emails) delete leadObj[email.type];
          leadObj.emails = emails;
        }

        if (
          leadObj?.linkedin_url?.length &&
          !leadObj.linkedin_url.startsWith('https://') &&
          !leadObj.linkedin_url.startsWith('http://')
        )
          leadObj.linkedin_url = 'https://' + leadObj.linkedin_url;

        const [sellsyContact, errForContactObj] = SellsyHelper.fieldToObjectMap(
          sellsyContactMap,
          leadObj
        );
        if (errForContactObj)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update',
            error: `Error while mapping field to object: ${errForContactObj}`,
          });

        let [_, errUpdatingSellsyContact] =
          await v2GrpcClients.crmIntegration.updateContact({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: {
              contact_id: fetchedLead.integration_id,
              contact: ObjectHelper.mergeDeep(sellsyContact, lead.variables),
              access_token,
            },
          });
        if (errUpdatingSellsyContact)
          return serverErrorResponseWithDevMsg({
            res,
            error: errUpdatingSellsyContact,
            msg: 'Failed to update contact in sellsy',
          });

        let leadAccount = lead.account;
        delete lead['account'];
        delete lead['variables'];

        let [updatedLead, updateLeadErr] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: lead,
        });
        if (updateLeadErr)
          return serverErrorResponseWithDevMsg({
            res,
            error: updateLeadErr,
            msg: 'Failed to update lead',
          });

        if (fetchedLead.account_id) {
          if (leadAccount && fetchedLead.Account !== null) {
            const leadAccountVariables = leadAccount?.variables;

            delete leadAccount?.variables;
            delete leadAccount?.linkedin_url;
            delete leadAccount?.zipcode;
            delete leadAccount?.country;

            let [sellsyAccount, errForAccountObj] =
              SellsyHelper.fieldToObjectMap(sellsyCompanyMap, leadAccount);
            if (errForAccountObj)
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Failed to update',
                error: `Error while mapping field to object: ${errForAccountObj}`,
              });

            const [companyObj, errForCompanyObj] =
              SellsyHelper.companyFieldSchema(sellsyAccount);
            if (errForCompanyObj)
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Failed to update',
                error: `Error while checking field map: ${errForCompanyObj}`,
              });

            let [_, errUpdatingSellsyAccount] =
              await v2GrpcClients.crmIntegration.updateAccount({
                integration_type: CRM_INTEGRATIONS.SELLSY,
                integration_data: {
                  company_id: fetchedLead.Account.integration_id,
                  company: ObjectHelper.mergeDeep(
                    companyObj,
                    leadAccountVariables
                  ),
                  access_token,
                },
              });
            if (errUpdatingSellsyAccount)
              return serverErrorResponseWithDevMsg({
                res,
                error: errUpdatingSellsyAccount,
                msg: 'Failed to update sellsy account',
              });
          }

          let [updatedAccount, errForUpdateAccount] = await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: leadAccount,
          });
          if (errForUpdateAccount)
            return serverErrorResponseWithDevMsg({
              res,
              error: errForUpdateAccount,
              msg: 'Failed to update account',
            });
        }

        // Updating lead phone numbers in db
        if (phone_numbers) {
          const [upsertedPhones, errForUpsertedPhones] =
            await PhoneNumberHelper.bulkUpsertPhoneNumbers({
              phone_numbers,
              lead_id: fetchedLead.lead_id,
            });
          if (errForUpsertedPhones)
            return serverErrorResponseWithDevMsg({
              res,
              error: `Error while updating lead phone number ${errForUpsertedPhones}`,
              msg: 'Failed to update lead phone number',
            });
        }

        // Updating lead emails in db
        if (emails) {
          const [upsertedEmails, errForUpsertedEmails] =
            await LeadEmailHelper.bulkUpsertEmails({
              emails,
              lead_id: fetchedLead.lead_id,
            });
          if (errForUpsertedEmails)
            return serverErrorResponseWithDevMsg({
              res,
              error: `Error while updating lead email: ${errForUpsertedEmails}`,
              msg: 'Failed to update lead email',
            });
        }

        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.EXCEL_LEAD: {
        // * Fetch excel field map
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
            msg: 'Failed to find user',
          });
        if (!userForFieldMap)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Kindly ask admin to create field map',
          });
        let [updatedLead, updateLeadErr] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: lead,
        });
        if (updateLeadErr)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while updating lead: ${updateLeadErr}`,
            msg: 'Failed to update lead',
          });

        await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          query: { account_id: fetchedLead.account_id },
          updateObject: lead.account,
        });
        // Updating lead phone numbers in db
        if (phone_numbers) {
          for (let phone of phone_numbers) {
            PhoneNumberHelper.updatePhoneNumberUsingId(
              phone.lpn_id,
              fetchedLead.lead_id,
              phone.phone_number,
              phone.is_primary
            );
          }
        }
        if (emails) {
          for (let email of emails) {
            LeadEmailHelper.updateEmailUsingId(
              email.lem_id,
              fetchedLead.lead_id,
              email.email_id,
              email.is_primary
            );
          }
        }
        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD:
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON:
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON:
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT:
      case LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD:
      case LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT:
      case LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD: {
        let accountToUpdate = lead.account;
        delete lead['account'];

        let [updatedLead, updateLeadErr] = await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { lead_id: fetchedLead.lead_id },
          updateObject: lead,
        });
        if (updateLeadErr)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
            error: `Error while updating CSV/Google Sheet lead: ${updateLeadErr}`,
          });

        let [updatedAccount, updateAccountErr] = await Repository.update({
          tableName: DB_TABLES.ACCOUNT,
          query: { account_id: fetchedLead.account_id },
          updateObject: accountToUpdate,
        });
        if (updateAccountErr)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update account',
            error: `Error while updating CSV/Google Sheet account: ${updateAccountErr}`,
          });

        // Updating lead phone numbers in db
        if (phone_numbers) {
          for (let phone of phone_numbers) {
            PhoneNumberHelper.updatePhoneNumberUsingId(
              phone.lpn_id,
              lead.lead_id,
              phone.phone_number,
              phone.is_primary
            );
          }
        }

        if (emails) {
          for (let email of emails) {
            LeadEmailHelper.updateEmailUsingId(
              email.lem_id,
              lead.lead_id,
              email.email_id,
              email.is_primary
            );
          }
        }

        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD:
      case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE:
      case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please login with bullhorn',
            error: errForAccessToken,
          });
        // * Fetch zoho field map
        let [bullhornFieldMap, errFetchingBullhornFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingBullhornFieldMap)
          return serverErrorResponseWithDevMsg({
            res,
            error: errFetchingBullhornFieldMap,
          });

        let bullhornAccountMap = bullhornFieldMap.account_map;
        let bullhornContactMap = bullhornFieldMap.contact_map;
        let bullhornLeadMap = bullhornFieldMap.lead_map;
        let bullhornCandidateMap = bullhornFieldMap.candidate_map;

        if (
          fetchedLead.integration_type === LEAD_INTEGRATION_TYPES.BULLHORN_LEAD
        ) {
          const bullhornLead = {};

          bullhornLead[bullhornLeadMap?.first_name] = leadObj.first_name
            ? leadObj.first_name
            : null;
          bullhornLead[bullhornLeadMap?.last_name] = leadObj.last_name
            ? leadObj.last_name
            : null;
          bullhornLead[bullhornLeadMap?.job_position] = leadObj.job_position
            ? leadObj.job_position
            : null;
          bullhornLead[bullhornLeadMap?.linkedin_url] = leadObj.linkedin_url
            ? leadObj.linkedin_url
            : null;

          bullhornLeadMap.emails.forEach((emailType) => {
            bullhornLead[emailType] = leadObj[emailType]
              ? leadObj[emailType]
              : null;
          });

          bullhornLeadMap.phone_numbers.forEach((phoneType) => {
            bullhornLead[phoneType] = leadObj[phoneType]
              ? leadObj[phoneType]
              : null;
          });

          delete bullhornLead['undefined'];

          let [_, errUpdatingLeadBullhorn] =
            await v2GrpcClients.hiringIntegration.updateLead({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                lead_id: fetchedLead.integration_id,
                lead: { ...bullhornLead, ...lead.variables },
                access_token,
                instance_url,
              },
            });
          if (errUpdatingLeadBullhorn) {
            logger.error('Lead update failed: ', errUpdatingLeadBullhorn);
            return serverErrorResponseWithDevMsg({
              res,
              error: errUpdatingLeadBullhorn,
              msg: 'Failed to update lead',
            });
          }

          let leadAccount = lead.account;
          delete lead['account'];
          delete lead['variables'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: lead,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              error: updateLeadErr,
              msg: 'Failed to update lead',
            });

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: leadAccount,
          });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                lead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                lead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }
          if (leadAccount) {
            let countryId = leadAccount?.countryId;
            delete leadAccount['countryId'];
            let account = {};
            account.address = {};

            account[bullhornAccountMap?.name] = leadAccount.name;
            account[
              CompanyFieldMapHelper.getCompanySize({
                size: bullhornAccountMap?.size,
              })[0]
            ] = leadAccount.size ? leadAccount.size : null;
            account[bullhornAccountMap?.url] = leadAccount.url
              ? leadAccount.url
              : null;
            account.address.countryID = countryId ? countryId : null;
            account.address.zip = leadAccount?.zipcode
              ? leadAccount?.zipcode
              : null;
            account[bullhornAccountMap?.linkedin_url] = leadAccount.linkedin_url
              ? leadAccount.linkedin_url
              : null;
            account[bullhornAccountMap?.phone_number] = leadAccount.phone_number
              ? leadAccount.phone_number
              : null;

            delete account['undefined'];

            let [__, errUpdatingAccountBullhorn] =
              await v2GrpcClients.hiringIntegration.updateAccount({
                integration_type: HIRING_INTEGRATIONS.BULLHORN,
                integration_data: {
                  corporation_id: fetchedLead.Account.integration_id,
                  corporation: { ...account, ...leadAccount.variables },
                  access_token,
                  instance_url,
                },
              });
            if (errUpdatingAccountBullhorn)
              return successResponse(
                res,
                `Successfully updated contact. Error while updating Account: ${errUpdatingAccountBullhorn}`
              );

            delete leadAccount['variables'];
            lead.account = leadAccount;

            let [___, updateAccountErr] = await LeadRepository.updateLead(lead);
            if (updateAccountErr)
              return serverErrorResponseWithDevMsg({
                res,
                error: updateAccountErr,
                msg: 'Failed to update lead',
              });
          }
        } else if (
          fetchedLead.integration_type ===
          LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT
        ) {
          const contact = {};

          contact[bullhornContactMap?.first_name] = leadObj.first_name
            ? leadObj.first_name
            : null;
          contact[bullhornContactMap?.last_name] = leadObj.last_name
            ? leadObj.last_name
            : null;
          contact[bullhornContactMap?.job_position] = leadObj.job_position
            ? leadObj.job_position
            : null;
          contact[bullhornContactMap?.linkedin_url] = leadObj.linkedin_url
            ? leadObj.linkedin_url
            : null;

          bullhornContactMap.emails.forEach((emailType) => {
            contact[emailType] = leadObj[emailType] ? leadObj[emailType] : null;
          });

          bullhornContactMap.phone_numbers.forEach((phoneType) => {
            contact[phoneType] = leadObj[phoneType] ? leadObj[phoneType] : null;
          });

          delete contact['undefined'];

          let [_, errUpdatingContactBullhorn] =
            await v2GrpcClients.hiringIntegration.updateContact({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                contact_id: fetchedLead.integration_id,
                contact: { ...contact, ...lead.variables },
                access_token,
                instance_url,
              },
            });
          if (errUpdatingContactBullhorn)
            return serverErrorResponseWithDevMsg({
              res,
              error: errUpdatingContactBullhorn,
              msg: 'Failed to update lead',
            });

          let leadAccount = lead.account;
          delete lead['account'];
          delete lead['variables'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: contact,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              error: updateLeadErr,
              msg: 'Failed to update lead',
            });

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: leadAccount,
          });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                fetchedLead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                fetchedLead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }

          if (leadAccount) {
            let countryId = leadAccount?.countryId;
            delete leadAccount['countryId'];
            let account = {};
            account.address = {};
            account[bullhornAccountMap?.name] = leadAccount.name;
            account[
              CompanyFieldMapHelper.getCompanySize({
                size: bullhornAccountMap?.size,
              })[0]
            ] = leadAccount.size ? leadAccount.size : null;
            account[bullhornAccountMap?.url] = leadAccount.url
              ? leadAccount.url
              : null;
            account.address.countryID = countryId ? countryId : null;
            account.address.zip = leadAccount?.zipcode
              ? leadAccount?.zipcode
              : null;
            account[bullhornAccountMap?.linkedin_url] = leadAccount.linkedin_url
              ? leadAccount.linkedin_url
              : null;
            account[bullhornAccountMap?.phone_number] = leadAccount.phone_number
              ? leadAccount.phone_number
              : null;

            delete account['undefined'];

            let [__, errUpdatingAccountBullhorn] =
              await v2GrpcClients.hiringIntegration.updateAccount({
                integration_type: HIRING_INTEGRATIONS.BULLHORN,
                integration_data: {
                  corporation_id: fetchedLead.Account.integration_id,
                  corporation: { ...account, ...leadAccount.variables },
                  access_token,
                  instance_url,
                },
              });
            if (errUpdatingAccountBullhorn)
              return successResponse(
                res,
                `Successfully updated contact. Error while updating Account: ${errUpdatingAccountBullhorn}`
              );

            delete leadAccount['variables'];
            lead.account = leadAccount;

            let [___, updateAccountErr] = await LeadRepository.updateLead(lead);
            if (updateAccountErr)
              return serverErrorResponseWithDevMsg({
                res,
                error: updateAccountErr,
                msg: 'Failed to update lead',
              });
          }
        } else if (
          fetchedLead.integration_type ===
          LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE
        ) {
          const bullhornCandidate = {};
          bullhornCandidate.address = {};
          bullhornCandidate[bullhornCandidateMap?.first_name] =
            leadObj.first_name ? leadObj.first_name : null;
          bullhornCandidate[bullhornCandidateMap?.last_name] = leadObj.last_name
            ? leadObj.last_name
            : null;
          bullhornCandidate[bullhornCandidateMap?.job_position] =
            leadObj.job_position ? leadObj.job_position : null;
          bullhornCandidate[bullhornCandidateMap?.linkedin_url] =
            leadObj.linkedin_url ? leadObj.linkedin_url : null;

          // * Lead account
          if (lead?.account?.name) {
            bullhornCandidate[bullhornCandidateMap?.company] =
              lead.account.name;
            bullhornCandidate[
              CompanyFieldMapHelper.getCompanySize({
                size: bullhornCandidateMap?.size,
              })[0]
            ] = lead.account.size ? lead.account.size : null;
            bullhornCandidate[bullhornCandidateMap?.url] = lead.account.url
              ? lead.account.url
              : null;
            bullhornCandidate.address.countryID = lead?.account?.countryId
              ? lead?.account?.countryId
              : null;
            bullhornCandidate.address.zip = lead?.account?.zipcode
              ? lead?.account?.zipcode
              : null;
            // bullhornCandidate[bullhornCandidateMap?.linkedin_url] = lead.account
            //   .linkedin_url
            //   ? lead.account.linkedin_url
            //   : null;
            let accountToUpdate = lead.account;
            delete lead['account'];
            delete accountToUpdate['countryId'];
            await Repository.update({
              tableName: DB_TABLES.ACCOUNT,
              query: { account_id: fetchedLead.account_id },
              updateObject: accountToUpdate,
            });
          }

          bullhornCandidateMap.emails.forEach((emailType) => {
            bullhornCandidate[emailType] = leadObj[emailType]
              ? leadObj[emailType]
              : null;
          });

          bullhornCandidateMap.phone_numbers.forEach((phoneType) => {
            bullhornCandidate[phoneType] = leadObj[phoneType]
              ? leadObj[phoneType]
              : null;
          });

          delete bullhornCandidate['undefined'];

          let [_, errUpdatingCandidateBullhorn] =
            await v2GrpcClients.hiringIntegration.updateCandidate({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                candidate_id: fetchedLead.integration_id,
                candidate: { ...bullhornCandidate, ...lead.variables },
                access_token,
                instance_url,
              },
            });
          if (errUpdatingCandidateBullhorn) {
            logger.error('Lead update failed: ', errUpdatingCandidateBullhorn);
            return serverErrorResponseWithDevMsg({
              res,
              error: errUpdatingCandidateBullhorn,
              msg: 'Failed to update lead',
            });
          }

          delete lead['variables'];
          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: lead,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              error: updateLeadErr,
              msg: 'Failed to update lead',
            });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                lead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                lead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }
        }
        return successResponse(res, 'Successfully updated information.');
      }
      case LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT:
      case LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please login with Dynamics',
            error: errForAccessToken,
          });
        // * Fetch dynamics field map
        let [dynamicsFieldMap, errFetchingDynamicsFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingDynamicsFieldMap)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
            error: errFetchingDynamicsFieldMap,
          });

        let dynamicsAccountMap = dynamicsFieldMap.account_map;
        let dynamicsContactMap = dynamicsFieldMap.contact_map;
        let dynamicsLeadMap = dynamicsFieldMap.lead_map;

        if (
          fetchedLead.integration_type === LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD
        ) {
          let dynamicsLead = {};

          dynamicsLead[dynamicsLeadMap?.first_name] = leadObj.first_name
            ? leadObj.first_name
            : null;
          dynamicsLead[dynamicsLeadMap?.last_name] = leadObj.last_name
            ? leadObj.last_name
            : null;
          dynamicsLead[dynamicsLeadMap?.job_position] = leadObj.job_position
            ? leadObj.job_position
            : null;
          dynamicsLead[dynamicsLeadMap?.linkedin_url] = leadObj.linkedin_url
            ? leadObj.linkedin_url
            : null;

          // * Lead account
          dynamicsLead[dynamicsLeadMap?.account] = lead.account.name;
          dynamicsLead[
            CompanyFieldMapHelper.getCompanySize({
              size: dynamicsLeadMap?.size,
            })[0]
          ] = lead.account.size ? lead.account.size : null;
          dynamicsLead[dynamicsLeadMap?.url] = lead.account.url
            ? lead.account.url
            : null;
          dynamicsLead[dynamicsLeadMap?.country] = lead.account.country
            ? lead.account.country
            : null;
          dynamicsLead[dynamicsLeadMap?.zip_code] = lead.account.zipcode
            ? lead.account.zipcode
            : null;
          dynamicsLead[dynamicsLeadMap?.company_phone_number] = lead.account
            .phone_number
            ? lead.account.phone_number
            : null;

          dynamicsLeadMap.emails.forEach((emailType) => {
            dynamicsLead[emailType] = leadObj[emailType]
              ? leadObj[emailType]
              : null;
          });

          dynamicsLeadMap.phone_numbers.forEach((phoneType) => {
            dynamicsLead[phoneType] = leadObj[phoneType]
              ? leadObj[phoneType]
              : null;
          });

          delete dynamicsLead['undefined'];

          let [_, errUpdatingLeadDynamics] =
            await v2GrpcClients.crmIntegration.updateLead({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              integration_data: {
                lead_id: fetchedLead.integration_id,
                lead: dynamicsLead,
                access_token,
                instance_url,
              },
            });
          if (errUpdatingLeadDynamics) {
            logger.error('Lead update failed: ', errUpdatingLeadDynamics);
            return serverErrorResponseWithDevMsg({
              res,
              error: errUpdatingLeadDynamics,
              msg: 'Failed to update lead',
            });
          }

          let accountToUpdate = lead.account;
          delete lead['account'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: lead,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              error: updateLeadErr,
              msg: 'Failed to update lead',
            });

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: { account_id: fetchedLead.account_id },
            updateObject: accountToUpdate,
          });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                lead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                lead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }
        } else if (
          fetchedLead.integration_type ===
          LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT
        ) {
          let contact = {};

          contact[dynamicsContactMap?.first_name] = leadObj.first_name
            ? leadObj.first_name
            : null;
          contact[dynamicsContactMap?.last_name] = leadObj.last_name
            ? leadObj.last_name
            : null;
          contact[dynamicsContactMap?.job_position] = leadObj.job_position
            ? leadObj.job_position
            : null;
          contact[dynamicsContactMap?.linkedin_url] = leadObj.linkedin_url
            ? leadObj.linkedin_url
            : null;

          dynamicsContactMap.emails.forEach((emailType) => {
            contact[emailType] = leadObj[emailType] ? leadObj[emailType] : null;
          });

          dynamicsContactMap.phone_numbers.forEach((phoneType) => {
            contact[phoneType] = leadObj[phoneType] ? leadObj[phoneType] : null;
          });

          delete contact['undefined'];

          let [_, errUpdatingContactDynamics] =
            await v2GrpcClients.crmIntegration.updateContact({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              integration_data: {
                contact_id: fetchedLead.integration_id,
                contact,
                access_token,
                instance_url,
              },
            });
          if (errUpdatingContactDynamics)
            return serverErrorResponseWithDevMsg({
              res,
              error: errUpdatingContactDynamics,
              msg: 'Failed to update lead',
            });

          let leadAccount = lead.account;
          delete lead['account'];

          let [updatedLead, updateLeadErr] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: fetchedLead.lead_id },
            updateObject: lead,
          });
          if (updateLeadErr)
            return serverErrorResponseWithDevMsg({
              res,
              error: updateLeadErr,
              msg: 'Failed to update lead',
            });

          // Updating lead phone numbers in db
          if (phone_numbers) {
            for (let phone of phone_numbers) {
              PhoneNumberHelper.updatePhoneNumberUsingId(
                phone.lpn_id,
                fetchedLead.lead_id,
                phone.phone_number,
                phone.is_primary
              );
            }
          }

          if (emails) {
            for (let email of emails) {
              LeadEmailHelper.updateEmailUsingId(
                email.lem_id,
                fetchedLead.lead_id,
                email.email_id,
                email.is_primary
              );
            }
          }

          if (leadAccount) {
            let account = {};

            account[dynamicsAccountMap?.name] = leadAccount.name;
            account[
              CompanyFieldMapHelper.getCompanySize({
                size: dynamicsAccountMap?.size,
              })[0]
            ] = leadAccount.size ? leadAccount.size : null;
            account[dynamicsAccountMap?.url] = leadAccount.url
              ? leadAccount.url
              : null;
            account[dynamicsAccountMap?.country] = leadAccount.country
              ? leadAccount.country
              : null;
            account[dynamicsAccountMap?.zip_code] = leadAccount.zipcode
              ? leadAccount.zipcode
              : null;
            account[dynamicsAccountMap?.linkedin_url] = leadAccount.linkedin_url
              ? leadAccount.linkedin_url
              : null;
            account[dynamicsAccountMap?.phone_number] = leadAccount.phone_number
              ? leadAccount.phone_number
              : null;

            delete account['undefined'];

            let [__, errUpdatingAccountDynamics] =
              await v2GrpcClients.crmIntegration.updateAccount({
                integration_type: CRM_INTEGRATIONS.DYNAMICS,
                integration_data: {
                  account_id: fetchedLead.Account.integration_id,
                  account: account,
                  access_token,
                  instance_url,
                },
              });
            if (errUpdatingAccountDynamics)
              return successResponse(
                res,
                `Successfully updated contact. Error while updating Account: ${errUpdatingAccountDynamics}`
              );

            let [___, updateAccountErr] = await Repository.update({
              tableName: DB_TABLES.ACCOUNT,
              query: { account_id: fetchedLead.account_id },
              updateObject: leadAccount,
            });
            if (updateAccountErr)
              return serverErrorResponseWithDevMsg({
                res,
                error: updateAccountErr,
                msg: 'Failed to update lead',
              });
          }
        }

        return successResponse(res, 'Successfully updated information.');
      }
      default: {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to update lead',
          error: 'Invalid integration type',
        });
      }
    }
  } catch (err) {
    logger.error('Error while updating lead and account info: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating lead and account info: ${err.message}`,
    });
  }
};

const getLeadsListViewForUser = async (req, res) => {
  try {
    const curr_time = new Date().getTime();
    //let [leadFilters, errForLeadFilters] = LeadHelper.getLeadsListFilter(
    //req.body,
    //req.user.user_id
    //);

    let [leadFilters, errForLeadFilters] =
      LeadHelper.getLeadsListFilterForRawQuery(req.body, req.user.user_id);
    if (errForLeadFilters)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads',
        error: `Error while fetching leads list filter for raw query: ${errForLeadFilters}`,
      });

    const { limit, offset } = req.query;

    let extrasQuery = {};

    if (limit) extrasQuery.limit = parseInt(limit);
    if (offset) extrasQuery.offset = parseInt(offset);

    //extrasQuery.order = ['lead_id'];
    extrasQuery.order = [['created_at', 'DESC']];

    let limit_offset_query = [];

    if (limit) limit_offset_query.push(` LIMIT ${parseInt(limit)} `);
    if (offset) limit_offset_query.push(` OFFSET ${parseInt(offset)} `);
    limit_offset_query = limit_offset_query.join(' ');

    const [leads, errForLeads] = await LeadHelper.getLeadsListViewByRawQuery({
      user_id: req.user.user_id,
      lead_query: leadFilters?.lead_query || '',
      account_query: leadFilters?.account_query || '',
      replacements: leadFilters?.replacements || {},
      limit_offset_query,
      //3
    });

    //const [leads, errForLeads] = await LeadRepository.getLeadsForLeadsListView(
    //leadFilters, // query object
    //{
    //// attributes object
    //lead: {
    //attributes: [
    //'lead_id',
    //'first_name',
    //'last_name',
    //'duplicate',
    //'status',
    //'created_at',
    //'lead_score',
    //'lead_warmth',
    //],
    //},
    //account: { attributes: ['account_id', 'name', 'size'] },
    //leadToCadence: { attributes: ['status'] },
    //cadence: { attributes: ['cadence_id', 'name', 'status'] },
    //node: { attributes: ['node_id'] },
    //activity: {
    //attributes: [
    //'type',
    //'name',
    //'status',
    //'read',
    //'incoming',
    //'created_at',
    //],
    //},
    //},
    //extrasQuery
    //);
    if (errForLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads',
        error: `Error while fetching leads by raw query: ${errForLeads}`,
      });

    logger.info(`LEADS LENGTH: ${leads.length}`);

    console.timeEnd('inside getLeadsListViewForUser controller: ${curr_time}');
    return successResponse(res, `Leads fetched successfully for user.`, leads);
  } catch (err) {
    logger.error('Error while fetching leads list view for user: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching leads list view for user: ${err.message}`,
    });
  }
};

// * Fetch lead_to_Cadence links for a lead
const getLeadToCadenceLinksForLead = async (req, res) => {
  try {
    let { lead_id } = req.params;

    const [lead, errFetchingLead] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      extras: { attributes: [] },
      include: {
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['status'],
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
          },
        },
      },
    });
    if (errFetchingLead)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences for lead',
        error: `Failed to fetch cadences for lead: ${errFetchingLead}`,
      });

    return successResponse(res, 'Successfully fetched cadences for lead', lead);
  } catch (err) {
    logger.error('Error while fetching lead to cadence links: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead to cadence links: ${err.message}`,
    });
  }
};

const getLeadsCountForUser = async (req, res) => {
  try {
    const { integration_type } = req.user;
    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        const leadsCountPromise = Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            //salesforce_lead_id: {
            //[Op.ne]: null,
            //},
            //salesforce_contact_id: null,
            integration_id: {
              [Op.ne]: null,
            },
            integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
          },
        });

        const contactsCountPromise = Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            //salesforce_contact_id: {
            //[Op.ne]: null,
            //},
            integration_id: {
              [Op.ne]: null,
            },
            integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
          },
        });

        const [
          [leadCount, errForLeadCount],
          [contactCount, errForContactCount],
        ] = await Promise.all([leadsCountPromise, contactsCountPromise]);

        if (errForLeadCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for salesforce leads: ${errForLeadCount} `,
            msg: 'Failed to fetch count for salesforce leads',
          });
        if (errForContactCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for salesforce contacts: ${errForContactCount} `,
            msg: 'Failed to fetch count for salesforce contacts',
          });

        return successResponse(
          res,
          `Successfully fetched leads and contacts count for user.`,
          {
            leadCount: leadCount || 0,
            contactCount: contactCount || 0,
          }
        );
      case CRM_INTEGRATIONS.PIPEDRIVE:
        const [personsCount, errForPersonsCount] = await Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            integration_id: {
              [Op.ne]: null,
            },
            integration_type: LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON,
          },
        });

        if (errForPersonsCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for pipedrive persons: ${errForPersonsCount}`,
            msg: 'Failed to fetch count for pipedrive persons',
          });

        return successResponse(
          res,
          `Successfully fetched persons count for user`,
          {
            personsCount: personsCount || 0,
          }
        );
      case CRM_INTEGRATIONS.HUBSPOT:
        const [hubspotContactCount, errForHubspotContactCount] =
          await Repository.count({
            tableName: DB_TABLES.LEAD,
            query: {
              user_id: req.params.user_id,
              integration_id: {
                [Op.ne]: null,
              },
              integration_type: LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT,
            },
          });

        if (errForHubspotContactCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for hubspot contacts: ${errForHubspotContactCount}`,
            msg: 'Failed to fetch count for hubspot contacts',
          });

        return successResponse(
          res,
          `Successfully fetched hubspot count for user.`,
          {
            hubspotContactCount: hubspotContactCount || 0,
          }
        );
      case CRM_INTEGRATIONS.SHEETS:
        const [gsLeadsCount, errForGsLeadsCount] = await Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            integration_id: {
              [Op.ne]: null,
            },
            integration_type: LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD,
          },
        });
        if (errForGsLeadsCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for google sheet leads: ${errForGsLeadsCount}`,
            msg: 'Failed to fetch count for google sheet leads',
          });

        return successResponse(
          res,
          `Successfully fetched leads count for user.`,
          {
            leadCount: gsLeadsCount || 0,
          }
        );
      case CRM_INTEGRATIONS.SELLSY:
        const [sellsyContactCount, errForSellsyContactCount] =
          await Repository.count({
            tableName: DB_TABLES.LEAD,
            query: {
              user_id: req.params.user_id,
              integration_id: {
                [Op.ne]: null,
              },
              integration_type: LEAD_INTEGRATION_TYPES.SELLSY_CONTACT,
            },
          });
        if (errForSellsyContactCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for sellsy contacts: ${errForSellsyContactCount}`,
            msg: 'Failed to fetch count for sellsy contacts',
          });

        return successResponse(
          res,
          `Successfully fetched sellsy count for user.`,
          {
            sellsyContactCount: sellsyContactCount || 0,
          }
        );
      case HIRING_INTEGRATIONS.BULLHORN:
        const bullhornLeadsCountPromise = Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            integration_id: {
              [Op.ne]: null,
            },
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_LEAD,
          },
        });

        const bullhornContactsCountPromise = Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            integration_id: {
              [Op.ne]: null,
            },
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT,
          },
        });
        const bullhornCandidatesCountPromise = Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            integration_id: {
              [Op.ne]: null,
            },
            integration_type: LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE,
          },
        });

        const [
          [bullhornLeadCount, errForBullhornLeadCount],
          [bullhornContactCount, errForBullhornContactCount],
          [bullhornCandidateCount, errForBullhornCandidateCount],
        ] = await Promise.all([
          bullhornLeadsCountPromise,
          bullhornContactsCountPromise,
          bullhornCandidatesCountPromise,
        ]);

        if (errForBullhornLeadCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for bullhorn leads: ${errForBullhornLeadCount} `,
            msg: 'Failed to fetch count for salesforce leads',
          });
        if (errForBullhornContactCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for bullhorn contacts: ${errForBullhornContactCount} `,
            msg: 'Failed to fetch count for salesforce contacts',
          });
        if (errForBullhornCandidateCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for bullhorn candidates: ${errForBullhornCandidateCount} `,
            msg: 'Failed to fetch count for salesforce candidates',
          });

        return successResponse(
          res,
          `Successfully fetched leads and contacts count for user.`,
          {
            leadCount: bullhornLeadCount || 0,
            contactCount: bullhornContactCount || 0,
            candidateCount: bullhornCandidateCount || 0,
          }
        );
      case CRM_INTEGRATIONS.DYNAMICS:
        const dynamicsLeadsCountPromise = Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            integration_id: { [Op.ne]: null },
            integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD,
          },
        });

        const dynamicsContactsCountPromise = Repository.count({
          tableName: DB_TABLES.LEAD,
          query: {
            user_id: req.params.user_id,
            integration_id: { [Op.ne]: null },
            integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT,
          },
        });

        const [
          [dynamicsLeadCount, errForDynamicsLeadCount],
          [dynamicsContactCount, errForDynamicsContactCount],
        ] = await Promise.all([
          dynamicsLeadsCountPromise,
          dynamicsContactsCountPromise,
        ]);

        if (errForDynamicsLeadCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for dynamics leads: ${errForDynamicsLeadCount} `,
            msg: 'Failed to fetch count for dynamics leads',
          });
        if (errForDynamicsContactCount)
          return serverErrorResponseWithDevMsg({
            res,
            error: `Error while fetching count for dynamics contacts: ${errForDynamicsContactCount} `,
            msg: 'Failed to fetch count for dynamics contacts',
          });

        return successResponse(
          res,
          `Successfully fetched leads and contacts count for user.`,
          {
            leadCount: dynamicsLeadCount || 0,
            contactCount: dynamicsContactCount || 0,
          }
        );
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch leads count',
          error: `Invalid Integration type`,
        });
    }
  } catch (err) {
    logger.error('Error while fetching leads count for user: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching leads count for user: ${err.message} `,
    });
  }
};

/**
 *
 * @description Returns array of leads having lead name,lead_id, account name in order most recent first i.e. decreasing order of lead_id
 * @param {*} req
 * @param {*} res
 * @returns
 *  data object:
 * [
 *  {
 *      lead_id:
 *      first_name:
 *      last_name: ,
 *      Account: {
 *      	name:
 *      }
 *  },
 *  ...
 * ]
 */
const fetchLeadsForDropdown = async (req, res) => {
  try {
    // Step: accept query params
    // limit: no of leads to fetch
    // last_lead_id: lead_id of the last lead received in your previous request
    let { limit, last_lead_id, search } = req.query;

    // Step: Declaring variables
    let limitQuery = {};
    // query to fetch leads
    let whereQuery = {
      user_id: req.user.user_id,
      status: {
        [Op.in]: [LEAD_STATUS.NEW_LEAD, LEAD_STATUS.ONGOING],
      },
    };

    // if limit is passed, then convert it to int and add it to limit query
    if (limit) {
      limit = parseInt(limit);
      limitQuery = { limit };
    }
    // if last_lead_id is passed, then convert it to int and add it to whereQuery such that only leads having lead_id less than this are fetched
    if (last_lead_id) {
      last_lead_id = parseInt(last_lead_id);
      whereQuery.lead_id = {
        [Op.lt]: last_lead_id,
      };
    }
    // if search is passed, then add it to whereQuery such that leads whose name matches with search are fetched
    if (search) {
      whereQuery[Op.or] = [
        sequelize.where(
          sequelize.fn(
            'concat',
            sequelize.fn('lower', sequelize.col('first_name')),
            ' ',
            sequelize.fn('lower', sequelize.col('last_name'))
          ),
          {
            [Op.like]: `%${search.toLowerCase()}%`,
          }
        ),
      ];
    }

    // Step: Fetch leads
    const [data, err] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: whereQuery,
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name'],
        },
      },
      extras: {
        attributes: ['lead_id', 'first_name', 'last_name'],
        order: [['lead_id', 'DESC']],
        ...limitQuery,
      },
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch leads',
        error: `Error while fetching leads for drop down: ${err}`,
      });

    return successResponse(
      res,
      `Fetched leads for dropdown successfully.`,
      data
    );
  } catch (err) {
    logger.error('Error while fetching leads for drop down: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fethcing leads for drop down: ${err.message}`,
    });
  }
};

const enrichLeadWithLusha = async (req, res) => {
  try {
    const { lead_id } = req.params;

    // Fetch lead
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
      },
      extras: {
        order: [
          [{ model: Lead_phone_number }, 'type'],
          [{ model: Lead_email }, 'type'],
        ],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Lusha',
        error: `Error while fetching lead: ${errForLead}.`,
      });
    if (!lead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Lusha',
        error: 'Lead not found.',
      });

    const leadPhoneNumbers = lead.Lead_phone_numbers ?? [];
    const leadPhoneObj = {};
    const leadPhoneNumberTypes = [];
    for (const pn of leadPhoneNumbers) {
      leadPhoneNumberTypes.push(pn.type);
    }

    const leadEmails = lead.Lead_emails ?? [];
    const leadEmailsObj = {};
    const leadEmailTypes = [];
    for (const email of leadEmails) {
      leadEmailTypes.push(email.type);
    }

    // Fetch user with api keys and user tokens
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: ['lusha_service_enabled'],
        },
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {},
          [DB_TABLES.ENRICHMENTS]: {},
        },
      },
      extras: {
        attributes: ['user_id', 'company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Lusha',
        error: `Error while fetching user: ${errForUser}.`,
      });
    if (!user)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Lusha',
        error: 'User not found',
      });

    // Fetch company's enrichments config
    const enrichments = user.Company?.Enrichment;
    if (!enrichments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Lusha',
        error: 'Company has no associated enrichments',
      });

    if (enrichments.lusha_api_calls >= enrichments.lusha_api_limit)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Your company daily API limit has reached. Please contact your company Admin',
      });

    if (!enrichments.is_lusha_activated)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Lusha service is not activated. Please activate in the Marketplace and try again',
      });

    let lushaPhoneNumbers = [],
      lushaEmails = [];

    const { lusha_api_key } = user.Company.Company_Token;

    let errForLusha = null;

    // Fetch Lusha data
    if (
      enrichments.is_lusha_activated &&
      user.User_Token.lusha_service_enabled
    ) {
      let lushaData = null;
      [lushaData, errForLusha] = await LushaService.fetchLushaData({
        lusha_api_key,
        first_name: lead.first_name,
        last_name: lead.last_name,
        linkedin_url: lead.linkedin_url,
        account_name: lead.Account?.name,
      });
      if (errForLusha)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to enrich lead with LUSHA',
          error: `Lusha - ${errForLusha}`,
        });
      if (!lushaData) return successResponse(res, 'No data enriched.');

      const [, errWhileUpdatingApiCallCount] = await Repository.update({
        tableName: DB_TABLES.USER_TASK,
        query: {
          user_id: user.user_id,
        },
        updateObject: {
          lusha_calls_per_month: sequelize.literal('lusha_calls_per_month + 1'),
        },
      });
      if (errWhileUpdatingApiCallCount)
        logger.error(
          `Error incrementing lusha_calls_per_month in user_task: ${errWhileUpdatingApiCallCount}`
        );

      const [, errUpdateApiCall] = await Repository.update({
        tableName: DB_TABLES.ENRICHMENTS,
        query: {
          company_id: user.company_id,
        },
        updateObject: {
          lusha_api_calls: sequelize.literal('lusha_api_calls + 1'),
        },
      });
      if (errUpdateApiCall)
        logger.error(`Error incrementing lusha_api_calls: ${errUpdateApiCall}`);

      const lushaTypes = Object.values(LUSHA_TYPES);
      let i = 0;

      lushaPhoneNumbers =
        lushaData?.phoneNumbers?.map((pn) => ({
          type: pn.type ?? lushaTypes[i++ % 3],
          phoneNumber: pn.internationalNumber,
        })) ?? [];
      i = 0;
      lushaEmails =
        lushaData?.emailAddresses?.map((email) => ({
          type: email.type ?? lushaTypes[i++ % 3],
          email: email.email,
        })) ?? [];
    }

    const lushaPhoneFields = lushaPhoneNumbers?.map((pn) => {
      const field = LUSHA_FIELD_MAP[pn.type];
      let enrichmentField;
      switch (lead.integration_type) {
        case LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD:
        case LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD: {
          enrichmentField =
            enrichments.lusha_phone[LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON:
        case LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON: {
          enrichmentField =
            enrichments.lusha_phone[LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT:
        case LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT: {
          enrichmentField =
            enrichments.lusha_phone[LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD:
        case LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD: {
          enrichmentField =
            enrichments.lusha_phone[LEAD_INTEGRATION_TYPES.ZOHO_LEAD][field];
          break;
        }
        case LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT:
        case LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT: {
          enrichmentField =
            enrichments.lusha_phone[LEAD_INTEGRATION_TYPES.SELLSY_CONTACT][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD:
        case LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD: {
          enrichmentField =
            enrichments.lusha_phone[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD][
              field
            ];
          break;
        }
        default: {
          enrichmentField =
            enrichments.lusha_phone[lead.integration_type][field];
        }
      }
      return enrichments[enrichmentField];
    });

    const lushaEmailFields = lushaEmails?.map((em) => {
      const field = LUSHA_FIELD_MAP[em.type];
      let enrichmentField;
      switch (lead.integration_type) {
        case LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD:
        case LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD: {
          enrichmentField =
            enrichments.lusha_email[LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON:
        case LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON: {
          enrichmentField =
            enrichments.lusha_email[LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT:
        case LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT: {
          enrichmentField =
            enrichments.lusha_email[LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD:
        case LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD: {
          enrichmentField =
            enrichments.lusha_email[LEAD_INTEGRATION_TYPES.ZOHO_LEAD][field];
          break;
        }
        case LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT:
        case LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT: {
          enrichmentField =
            enrichments.lusha_email[LEAD_INTEGRATION_TYPES.SELLSY_CONTACT][
              field
            ];
          break;
        }
        case LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD:
        case LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD: {
          enrichmentField =
            enrichments.lusha_email[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD][
              field
            ];
          break;
        }
        default: {
          enrichmentField =
            enrichments.lusha_email[lead.integration_type][field];
        }
      }
      return enrichments[enrichmentField];
    });

    if (enrichments.lusha_action === LUSHA_KASPR_OPTIONS.ADD) {
      const validPhoneFields = lushaPhoneFields?.filter(
        (field) =>
          !leadPhoneNumberTypes.includes(field) ||
          !leadPhoneNumbers?.filter((lpn) => lpn.type === field)[0].phone_number
      );

      // phone number
      for (let i = 0; i < lushaPhoneNumbers.length; i++) {
        const field = validPhoneFields[i];
        if (!field) break;

        const pn = {
          phone_number: lushaPhoneNumbers[i].phoneNumber,
        };

        leadPhoneObj[field] = pn;
      }

      const validEmailFields = lushaEmailFields?.filter(
        (field) =>
          !leadEmailTypes.includes(field) ||
          !leadEmails.filter((lem) => lem.type === field)[0].email_id
      );

      // email
      for (let i = 0; i < lushaEmails.length; i++) {
        const field = validEmailFields[i];
        if (!field) break;

        const email = {
          email_id: lushaEmails[i].email,
        };

        leadEmailsObj[field] = email;
      }
    } else if (enrichments.lusha_action === LUSHA_KASPR_OPTIONS.UPDATE) {
      // phone number
      for (let i = 0; i < lushaPhoneNumbers.length; i++) {
        const field = lushaPhoneFields[i];
        if (!field) break;

        const pn = {
          phone_number: lushaPhoneNumbers[i].phoneNumber,
        };

        leadPhoneObj[field] = pn;
      }

      // email
      for (let i = 0; i < lushaEmails.length; i++) {
        const field = lushaEmailFields[i];
        if (!field) break;

        const email = {
          email_id: lushaEmails[i].email,
        };

        leadEmailsObj[field] = email;
      }
    }

    // to check if any data has been enriched
    let dataEnriched;
    if (Object.keys(leadPhoneObj).length || Object.keys(leadEmailsObj).length)
      dataEnriched = true;

    const data = {
      phone_numbers: leadPhoneObj,
      emails: leadEmailsObj,
    };

    return successResponse(
      res,
      dataEnriched ? 'Successfully enriched data' : 'No data enriched',
      data
    );
  } catch (err) {
    logger.error('Error while enriching lead with LUSHA: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while enriching lead with LUSHA: ${err.message}.`,
    });
  }
};

const enrichLeadWithKaspr = async (req, res) => {
  try {
    const { lead_id } = req.params;

    // Fetch lead
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
      },
      extras: {
        order: [
          [{ model: Lead_phone_number }, 'type'],
          [{ model: Lead_email }, 'type'],
        ],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Kaspr',
        error: `Error while fetching lead: ${errForLead}.`,
      });
    if (!lead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Kaspr',
        error: 'Lead not found.',
      });

    const leadPhoneNumbers = lead.Lead_phone_numbers ?? [];
    const leadPhoneObj = {};
    const leadPhoneNumberTypes = [];
    for (const pn of leadPhoneNumbers) {
      leadPhoneNumberTypes.push(pn.type);
    }

    const leadEmails = lead.Lead_emails ?? [];
    const leadEmailsObj = {};
    const leadEmailTypes = [];
    for (const email of leadEmails) {
      leadEmailTypes.push(email.type);
    }

    // Fetch user with api keys and user tokens
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: ['kaspr_service_enabled'],
        },
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {},
          [DB_TABLES.ENRICHMENTS]: {},
        },
      },
      extras: {
        attributes: ['user_id', 'company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Kaspr',
        error: `Error while fetching user: ${errForUser}.`,
      });
    if (!user)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Kaspr',
        error: 'User not found',
      });

    // Fetch company's enrichments config
    const enrichments = user.Company?.Enrichment;
    if (!enrichments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Kaspr',
        error: 'Company has no associated enrichments',
      });

    if (enrichments.kaspr_api_calls >= enrichments.kaspr_api_limit)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Your company daily API limit has reached. Please contact your company Admin',
      });

    if (!enrichments.is_kaspr_activated)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Kaspr service is not activated. Please activate it in Marketplace and try again',
      });

    let kasprPhoneNumbers = [],
      kasprEmails = [];

    const { kaspr_api_key } = user.Company.Company_Token;

    let errForKaspr = null;

    // Fetch Kaspr data
    if (
      enrichments.is_kaspr_activated &&
      user.User_Token.kaspr_service_enabled
    ) {
      let kasprData = null;
      [kasprData, errForKaspr] = await KasprService.fetchKasprData({
        kaspr_api_key,
        first_name: lead.first_name,
        last_name: lead.last_name,
        linkedin_url: lead.linkedin_url,
      });
      if (errForKaspr)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to enrich lead with Kaspr',
          error: `Kaspr - ${errForKaspr}`,
        });
      if (!kasprData) return successResponse(res, 'No data enriched.');

      const [, errWhileUpdatingApiCallCount] = await Repository.update({
        tableName: DB_TABLES.USER_TASK,
        query: {
          user_id: user.user_id,
        },
        updateObject: {
          kaspr_calls_per_month: sequelize.literal('kaspr_calls_per_month + 1'),
        },
      });
      if (errWhileUpdatingApiCallCount)
        logger.error(
          `Error incrementing kaspr_calls_per_month in user_task: ${errWhileUpdatingApiCallCount}`
        );

      const [, errUpdateApiCall] = await Repository.update({
        tableName: DB_TABLES.ENRICHMENTS,
        query: {
          company_id: user.company_id,
        },
        updateObject: {
          kaspr_api_calls: sequelize.literal('kaspr_api_calls + 1'),
        },
      });
      if (errUpdateApiCall)
        logger.error(`Error incrementing kaspr_api_calls: ${errUpdateApiCall}`);

      kasprPhoneNumbers = kasprData?.profile?.phones ?? [];
      kasprPhoneNumbers = [...new Set([...kasprPhoneNumbers])];
      kasprEmails =
        kasprData?.profile?.emails
          ?.map((email) => {
            if (email.valid) return email.email;
          })
          .filter((email) => email) ?? [];
    }

    // KASPR
    let kasprPhoneFields, kasprEmailFields;
    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD: {
        kasprPhoneFields =
          enrichments.kaspr_phone[LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]
            ?.fields ?? [];
        kasprEmailFields =
          enrichments.kaspr_email[LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON:
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON: {
        kasprPhoneFields =
          enrichments.kaspr_phone[LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]
            ?.fields ?? [];
        kasprEmailFields =
          enrichments.kaspr_email[LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT: {
        kasprPhoneFields =
          enrichments.kaspr_phone[LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]
            ?.fields ?? [];
        kasprEmailFields =
          enrichments.kaspr_email[LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD: {
        kasprPhoneFields =
          enrichments.kaspr_phone[LEAD_INTEGRATION_TYPES.ZOHO_LEAD]?.fields ??
          [];
        kasprEmailFields =
          enrichments.kaspr_email[LEAD_INTEGRATION_TYPES.ZOHO_LEAD]?.fields ??
          [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT: {
        kasprPhoneFields =
          enrichments.kaspr_phone[LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]
            ?.fields ?? [];
        kasprEmailFields =
          enrichments.kaspr_email[LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD: {
        kasprPhoneFields =
          enrichments.kaspr_phone[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]
            ?.fields ?? [];
        kasprEmailFields =
          enrichments.kaspr_email[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]
            ?.fields ?? [];
        break;
      }
      default: {
        kasprPhoneFields =
          enrichments.kaspr_phone[lead.integration_type]?.fields ?? [];
        kasprEmailFields =
          enrichments.kaspr_email[lead.integration_type]?.fields ?? [];
      }
    }
    if (enrichments.kaspr_action === LUSHA_KASPR_OPTIONS.ADD) {
      const validPhoneFields = kasprPhoneFields.filter(
        (field) =>
          !leadPhoneNumberTypes.includes(field) ||
          !leadPhoneNumbers?.filter((lpn) => lpn.type === field)[0].phone_number
      );

      // phone numbers
      for (let i = 0; i < kasprPhoneNumbers.length; i++) {
        const field = validPhoneFields[i];
        if (!field) break;

        const pn = {
          phone_number: kasprPhoneNumbers[i],
        };

        leadPhoneObj[field] = pn;
      }

      const validEmailFields = kasprEmailFields.filter(
        (field) =>
          !leadEmailTypes.includes(field) ||
          !leadEmails.filter((lem) => lem.type === field)[0].email_id
      );

      // emails
      for (let i = 0; i < kasprEmails.length; i++) {
        const field = validEmailFields[i];
        if (!field) break;

        const email = {
          email_id: kasprEmails[i],
        };

        leadEmailsObj[field] = email;
      }
    } else if (enrichments.kaspr_action === LUSHA_KASPR_OPTIONS.UPDATE) {
      for (let i = 0; i < kasprPhoneNumbers.length; i++) {
        const field = kasprPhoneFields[i];
        if (!field) break;

        const pn = {
          phone_number: kasprPhoneNumbers[i],
        };

        leadPhoneObj[field] = pn;
      }

      // emails
      for (let i = 0; i < kasprEmails.length; i++) {
        const field = kasprEmailFields[i];
        if (!field) break;

        const email = {
          email_id: kasprEmails[i],
        };

        leadEmailsObj[field] = email;
      }
    }

    // to check if any data has been enriched
    let dataEnriched;
    if (Object.keys(leadPhoneObj).length || Object.keys(leadEmailsObj).length)
      dataEnriched = true;

    const data = {
      phone_numbers: leadPhoneObj,
      emails: leadEmailsObj,
    };

    return successResponse(
      res,
      dataEnriched ? 'Successfully enriched data' : 'No data enriched',
      data
    );
  } catch (err) {
    logger.error('Error while enriching lead with KASPR: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while enriching lead with KASPR: ${err.message}.`,
    });
  }
};

const enrichLeadWithHunter = async (req, res) => {
  try {
    const { lead_id } = req.params;

    // Fetch lead
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
      },
      extras: {
        order: [
          [{ model: Lead_phone_number }, 'type'],
          [{ model: Lead_email }, 'type'],
        ],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Hunter',
        error: `Error while fetching lead: ${errForLead}.`,
      });
    if (!lead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Hunter',
        error: 'Lead not found.',
      });

    // Fetch user with api keys and user tokens
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: ['hunter_service_enabled'],
        },
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {},
          [DB_TABLES.ENRICHMENTS]: {},
        },
      },
      extras: {
        attributes: ['user_id', 'company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Hunter',
        error: `Error while fetching user: ${errForUser}.`,
      });
    if (!user)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Hunter',
        error: 'User not found',
      });

    // Fetch company's enrichments config
    const enrichments = user.Company?.Enrichment;
    if (!enrichments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Hunter',
        error: 'Company has no associated enrichments',
      });

    if (enrichments.hunter_api_calls >= enrichments.hunter_api_limit)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Your company daily API limit has reached. Please contact your company Admin',
      });

    if (!enrichments.is_hunter_activated)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Hunter service is not activated. Please activate it in Marketplace and try again',
      });

    const { hunter_api_key } = user.Company.Company_Token;

    let hunterEmail = null;
    let errForHunter = null;

    // Fetch Hunter email
    if (
      enrichments.is_hunter_activated &&
      user.User_Token.hunter_service_enabled
    ) {
      // get company domain from url
      const companyUrl = lead.Account.url;
      let companyDomain = '';

      if (companyUrl) {
        const [validUrl] = UrlHelpers.getValidUrl(companyUrl);
        if (validUrl)
          companyDomain = new URL(validUrl).hostname.replace('www.', '');
      }

      [hunterEmail, errForHunter] = await HunterService.fetchValidEmail({
        first_name: lead.first_name,
        last_name: lead.last_name,
        full_name: lead.full_name,
        account_name: lead.Account.name,
        domain: companyDomain,
        hunter_api_key,
      });
      if (errForHunter)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to enrich lead with Hunter',
          error: `Hunter - ${errForHunter}`,
        });
      if (!hunterEmail) return successResponse(res, 'No data enriched.');

      const [, errWhileUpdatingApiCallCount] = await Repository.update({
        tableName: DB_TABLES.USER_TASK,
        query: {
          user_id: user.user_id,
        },
        updateObject: {
          hunter_calls_per_month: sequelize.literal(
            'hunter_calls_per_month + 1'
          ),
        },
      });
      if (errWhileUpdatingApiCallCount)
        logger.error(
          `Error incrementing hunter_calls_per_month in user_task: ${errWhileUpdatingApiCallCount}`
        );

      const [, errUpdateApiCall] = await Repository.update({
        tableName: DB_TABLES.ENRICHMENTS,
        query: {
          company_id: user.company_id,
        },
        updateObject: {
          hunter_api_calls: sequelize.literal('hunter_api_calls + 1'),
        },
      });
      if (errUpdateApiCall)
        logger.error(
          `Error incrementing hunter_api_calls: ${errUpdateApiCall}`
        );
    }

    let hunterEmailField;
    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD: {
        hunterEmailField =
          enrichments.hunter_email[LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]
            ?.field ?? null;
        break;
      }
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON:
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON: {
        hunterEmailField =
          enrichments.hunter_email[LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]
            ?.field ?? null;
        break;
      }
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT: {
        hunterEmailField =
          enrichments.hunter_email[LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]
            ?.field ?? null;
        break;
      }
      case LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD: {
        hunterEmailField =
          enrichments.hunter_email[LEAD_INTEGRATION_TYPES.ZOHO_LEAD]?.field ??
          null;
        break;
      }
      case LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT: {
        hunterEmailField =
          enrichments.hunter_email[LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]
            ?.field ?? null;
        break;
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD: {
        hunterEmailField =
          enrichments.hunter_email[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]
            ?.field ?? null;
        break;
      }
      default: {
        hunterEmailField =
          enrichments.hunter_email[lead.integration_type]?.field ?? null;
      }
    }
    if (!hunterEmailField)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Hunter field not set in Marketplace. Please set the respective field and try again',
      });

    const data = {
      emails: {
        [hunterEmailField]: {
          email_id: hunterEmail,
        },
      },
    };

    return successResponse(res, 'Successfully enriched data', data);
  } catch (err) {
    logger.error('Error while enriching lead with HUNTER: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while enriching lead with HUNTER: ${err.message}.`,
    });
  }
};

const enrichLeadWithDropcontact = async (req, res) => {
  try {
    const { lead_id } = req.params;

    // Fetch lead
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
      },
      extras: {
        order: [
          [{ model: Lead_phone_number }, 'type'],
          [{ model: Lead_email }, 'type'],
        ],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Dropcontact',
        error: `Error while fetching lead: ${errForLead}.`,
      });
    if (!lead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Dropcontact',
        error: 'Lead not found.',
      });

    const leadEmails = lead.Lead_emails;
    const leadEmailsObj = {};
    const leadEmailTypes = [];

    for (const email of leadEmails) {
      leadEmailTypes.push(email.type);
    }

    // Fetch user with api keys and user tokens
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: ['dropcontact_service_enabled'],
        },
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {},
          [DB_TABLES.ENRICHMENTS]: {},
        },
      },
      extras: {
        attributes: ['user_id', 'company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Dropcontact',
        error: `Error while fetching user: ${errForUser}.`,
      });
    if (!user)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Dropcontact',
        error: 'User not found',
      });

    // Fetch company's enrichments config
    const enrichments = user.Company?.Enrichment;
    if (!enrichments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Dropcontact',
        error: 'Company has no associated enrichments',
      });

    if (enrichments.dropcontact_api_calls >= enrichments.dropcontact_api_limit)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Your company daily API limit has reached. Please contact your company Admin',
      });

    if (!enrichments.is_dropcontact_activated)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Dropcontact service is not activated. Please activate it in Marketplace and try again',
      });

    const { dropcontact_api_key } = user.Company.Company_Token;

    let dcEmails = [],
      errForDc = null;

    if (
      enrichments.is_dropcontact_activated &&
      user.User_Token.dropcontact_service_enabled
    ) {
      [dcEmails, errForDc] = await DropcontactService.fetchValidEmails({
        first_name: lead.first_name,
        last_name: lead.last_name,
        accountName: lead.Account?.name,
        accountUrl: lead.Account?.url,
        linkedinUrl: lead.linkedin_url,
        dropcontact_api_key,
      });
      if (errForDc)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to enrich lead with Dropcontact',
          error: `Dropcontact - ${errForDc}`,
        });
      if (!dcEmails?.length) return successResponse(res, 'No data enriched.');

      const [, errWhileUpdatingApiCallCount] = await Repository.update({
        tableName: DB_TABLES.USER_TASK,
        query: {
          user_id: user.user_id,
        },
        updateObject: {
          dropcontact_calls_per_month: sequelize.literal(
            'dropcontact_calls_per_month + 1'
          ),
        },
      });
      if (errWhileUpdatingApiCallCount)
        logger.error(
          `Error incrementing dropcontact_calls_per_month in user_task: ${errWhileUpdatingApiCallCount}`
        );

      const [, errUpdateApiCall] = await Repository.update({
        tableName: DB_TABLES.ENRICHMENTS,
        query: {
          company_id: user.company_id,
        },
        updateObject: {
          dropcontact_api_calls: sequelize.literal('dropcontact_api_calls + 1'),
        },
      });
      if (errUpdateApiCall)
        logger.error(
          `Error incrementing dropcontact_api_calls: ${errUpdateApiCall}`
        );
    }

    let dcEmailFields;
    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD: {
        dcEmailFields =
          enrichments.dropcontact_email[LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON:
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON: {
        dcEmailFields =
          enrichments.dropcontact_email[LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT: {
        dcEmailFields =
          enrichments.dropcontact_email[LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.ZOHO_LEAD:
      case LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD: {
        dcEmailFields =
          enrichments.dropcontact_email[LEAD_INTEGRATION_TYPES.ZOHO_LEAD]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT: {
        dcEmailFields =
          enrichments.dropcontact_email[LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD: {
        dcEmailFields =
          enrichments.dropcontact_email[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]
            ?.fields ?? [];
        break;
      }
      default: {
        dcEmailFields =
          enrichments.dropcontact_email[lead.integration_type]?.fields ?? [];
      }
    }
    if (enrichments.dropcontact_action === LUSHA_KASPR_OPTIONS.ADD) {
      const validEmailFields = dcEmailFields.filter(
        (field) =>
          !leadEmailTypes.includes(field) ||
          !leadEmails.filter((lem) => lem.type === field)[0].email_id
      );

      for (let i = 0; i < dcEmails.length; i++) {
        const field = validEmailFields[i];
        if (!field) break;

        const email = {
          email_id: dcEmails[i],
        };

        leadEmailsObj[field] = email;
      }
    } else if (enrichments.dropcontact_action === LUSHA_KASPR_OPTIONS.UPDATE) {
      for (let i = 0; i < dcEmails.length; i++) {
        const field = dcEmailFields[i];
        if (!field) break;

        const email = {
          email_id: dcEmails[i],
        };

        leadEmailsObj[field] = email;
      }
    }

    // to check if any data has been enriched
    let dataEnriched;
    if (Object.keys(leadEmailsObj).length) dataEnriched = true;

    const data = {
      emails: leadEmailsObj,
    };

    return successResponse(
      res,
      dataEnriched ? 'Successfully enriched data' : 'No data enriched',
      data
    );
  } catch (err) {
    logger.error('Error while enriching lead with DROPCONTACT: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while enriching lead with DROPCONTACT: ${err.message}`,
    });
  }
};

const enrichLeadWithSnov = async (req, res) => {
  try {
    const { lead_id } = req.params;

    // Fetch lead
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
      },
      extras: {
        order: [
          [{ model: Lead_phone_number }, 'type'],
          [{ model: Lead_email }, 'type'],
        ],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Snov',
        error: `Error while fetching lead: ${errForLead}.`,
      });
    if (!lead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Snov',
        error: 'Lead not found.',
      });

    const leadEmails = lead.Lead_emails;
    const leadEmailsObj = {};
    const leadEmailTypes = [];

    for (const email of leadEmails) {
      leadEmailTypes.push(email.type);
    }

    // Fetch user with api keys and user tokens
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: ['snov_service_enabled'],
        },
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {},
          [DB_TABLES.ENRICHMENTS]: {},
        },
      },
      extras: {
        attributes: ['user_id', 'company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Snov',
        error: `Error while fetching user: ${errForUser}.`,
      });
    if (!user)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Snov',
        error: 'User not found',
      });

    // Fetch company's enrichments config
    const enrichments = user.Company?.Enrichment;
    if (!enrichments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong while enriching lead with Snov',
        error: 'Company has no associated enrichments',
      });

    if (enrichments.snov_api_calls >= enrichments.snov_api_limit)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Your company daily API limit has reached. Please contact your company Admin',
      });

    if (!enrichments.is_snov_activated)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Snov service is not activated. Please activate it in Marketplace and try again',
      });

    const { snov_client_id, snov_client_secret } = user.Company.Company_Token;

    let snovEmails = [],
      errForSnov = null;

    if (enrichments.is_snov_activated && user.User_Token.snov_service_enabled) {
      [snovEmails, errForSnov] =
        await SnovService.fetchValidEmailsFromLinkedinUrl({
          linkedinUrl: lead.linkedin_url,
          snov_client_id,
          snov_client_secret,
        });
      if (errForSnov)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to enrich lead with Snov',
          error: `Snov - ${errForSnov}`,
        });
      if (!snovEmails?.length) return successResponse(res, 'No data enriched.');

      const [, errWhileUpdatingApiCallCount] = await Repository.update({
        tableName: DB_TABLES.USER_TASK,
        query: {
          user_id: user.user_id,
        },
        updateObject: {
          snov_calls_per_month: sequelize.literal('snov_calls_per_month + 1'),
        },
      });
      if (errWhileUpdatingApiCallCount)
        logger.error(
          `Error incrementing snov_calls_per_month in user_task: ${errWhileUpdatingApiCallCount}`
        );

      const [, errUpdateApiCall] = await Repository.update({
        tableName: DB_TABLES.ENRICHMENTS,
        query: {
          company_id: user.company_id,
        },
        updateObject: {
          snov_api_calls: sequelize.literal('snov_api_calls + 1'),
        },
      });
      if (errUpdateApiCall)
        logger.error(`Error incrementing snov_api_calls: ${errUpdateApiCall}`);
    } else {
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to Snov. Please contact your admin',
      });
    }

    let snovEmailFields;
    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.SALESFORCE_GOOGLE_SHEET_LEAD: {
        snovEmailFields =
          enrichments.snov_email[LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_CSV_PERSON:
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_GOOGLE_SHEET_PERSON: {
        snovEmailFields =
          enrichments.snov_email[LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.HUBSPOT_GOOGLE_SHEET_CONTACT: {
        snovEmailFields =
          enrichments.snov_email[LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.ZOHO_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.ZOHO_GOOGLE_SHEET_LEAD: {
        snovEmailFields =
          enrichments.snov_email[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.SELLSY_CSV_CONTACT:
      case LEAD_INTEGRATION_TYPES.SELLSY_GOOGLE_SHEET_CONTACT: {
        snovEmailFields =
          enrichments.snov_email[LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]
            ?.fields ?? [];
        break;
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CSV_LEAD:
      case LEAD_INTEGRATION_TYPES.BULLHORN_GOOGLE_SHEET_LEAD: {
        snovEmailFields =
          enrichments.snov_email[LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]
            ?.fields ?? [];
        break;
      }
      default: {
        snovEmailFields =
          enrichments.snov_email[lead.integration_type]?.fields ?? [];
      }
    }
    if (enrichments.snov_action === LUSHA_KASPR_OPTIONS.ADD) {
      const validEmailFields = snovEmailFields.filter(
        (field) =>
          !leadEmailTypes.includes(field) ||
          !leadEmails.filter((lem) => lem.type === field)[0].email_id
      );

      for (let i = 0; i < snovEmails.length; i++) {
        const field = validEmailFields[i];
        if (!field) break;

        const email = {
          email_id: snovEmails[i],
        };

        leadEmailsObj[field] = email;
      }
    } else if (enrichments.snov_action === LUSHA_KASPR_OPTIONS.UPDATE) {
      for (let i = 0; i < snovEmails.length; i++) {
        const field = snovEmailFields[i];
        if (!field) break;

        const email = {
          email_id: snovEmails[i],
        };

        leadEmailsObj[field] = email;
      }
    }

    // to check if any data has been enriched
    let dataEnriched;
    if (Object.keys(leadEmailsObj).length) dataEnriched = true;

    const data = {
      emails: leadEmailsObj,
    };

    return successResponse(
      res,
      dataEnriched ? 'Successfully enriched data' : 'No data enriched',
      data
    );
  } catch (err) {
    logger.error('Error while enriching lead with SNOV: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while enriching lead with SNOV: ${err.message}`,
    });
  }
};

const getRelatedLeads = async (req, res) => {
  try {
    const params = leadSchema.getRelatedLeadSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    const integration_type = req.user.integration_type;

    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE: {
        let { id, account_name } = req.body;
        let salesforce_account_id = id;

        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });

        if (
          [
            'Kindly sign in with your crm.',
            'Kindly log in with salesforce.',
            'Error while getting access token and refresh token from salesforce auth',
          ].includes(errForAccessToken)
        )
          return badRequestResponseWithDevMsg({
            res,
            msg: 'To get related leads please login and make sure to give correct refresh/access token',
          });

        let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
          await SalesforceHelper.getFieldMapForCompanyFromUser(
            req.user.user_id
          );
        if (errFetchingSalesforceFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching Salesforce fieldmap: ${errFetchingSalesforceFieldMap}`,
          });

        //mapping object from user to company

        let results_from_salesforce = [];

        if (salesforce_account_id) {
          const maps = {
            first_name:
              salesforceFieldMap.contact_map?.['first_name'] ?? 'FirstName',
            last_name:
              salesforceFieldMap.contact_map?.['last_name'] ?? 'LastName',
            email: salesforceFieldMap.contact_map?.['emails'][0] ?? 'Email',
            account_name: salesforceFieldMap.account_map?.['name'] ?? 'Name',
          };

          const query = `
          SELECT Id, ${maps.first_name}, ${maps.last_name}, ${maps.email} 
          FROM contact 
          WHERE account.id = '${salesforce_account_id}' 
      `;

          let [result, errForLead] = await SalesforceService.query(
            query,
            access_token,
            instance_url
          );
          if (errForLead)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: errForLead,
            });

          result = result.records;
          result.forEach((contact) => {
            contact.first_name = contact[maps.first_name];
            contact.last_name = contact[maps.last_name];
            contact.email = contact[maps.email];
            delete contact[maps.first_name];
            delete contact[maps.last_name];
            delete contact[maps.email];
          });
          results_from_salesforce = result;
        } else {
          let salesforce_lead_ids = [];

          const maps = {
            first_name:
              salesforceFieldMap.lead_map?.['first_name'] ?? 'FirstName',
            last_name: salesforceFieldMap.lead_map?.['last_name'] ?? 'LastName',
            email: salesforceFieldMap.lead_map['emails']?.[0] ?? 'Email',
          };

          const query = `SELECT id,${maps.first_name},${maps.last_name}, ${maps.email} FROM lead WHERE ${salesforceFieldMap.lead_map['company']} = '${account_name}'`;

          let [result, errForLead] = await SalesforceService.query(
            query,
            access_token,
            instance_url
          );

          if (errForLead)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: errForLead,
            });

          result = result.records;
          result.forEach((lead) => {
            lead.first_name = lead[maps.first_name];
            lead.last_name = lead[maps.last_name];
            lead.email = lead[maps.email];
            delete lead[maps.first_name];
            delete lead[maps.last_name];
            delete lead[maps.email];
            salesforce_lead_ids.push(lead.Id);
          });

          let [results_from_DB, errFetchingLeadsFromDB] =
            await Repository.fetchAll({
              tableName: DB_TABLES.LEAD,
              query: {
                salesforce_lead_id: {
                  [Op.in]: salesforce_lead_ids,
                },
              },
            });
          if (errFetchingLeadsFromDB)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching leads from DB: ${errFetchingLeadsFromDB}`,
            });

          results_from_salesforce = result;

          const set_of_lead_ids_in_DB = {};

          results_from_DB.forEach(
            ({ lead_id, salesforce_lead_id, salesforce_contact_id }) => {
              if ((salesforce_lead_id || salesforce_contact_id) == false)
                return badRequestResponseWithDevMsg({
                  res,
                  msg: 'Failed to fetch leads',
                  error:
                    'Either Salesforce Lead id or salesforce contact id should be defined',
                });
              set_of_lead_ids_in_DB[
                salesforce_account_id
                  ? salesforce_contact_id
                  : salesforce_lead_id
              ] = lead_id;
            }
          );

          results_from_salesforce.forEach((lead) => {
            lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
              lead.Id
            );
            lead.lead_id_db = set_of_lead_ids_in_DB[lead.Id] ?? null;
          });

          return successResponse(
            res,
            'Successfully fetched related leads',
            results_from_salesforce
          );
        }

        let [results_from_DB, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.ACCOUNT,
          query: {
            [salesforce_account_id ? 'salesforce_account_id' : 'name']: [
              salesforce_account_id ?? account_name,
            ],
          },
          include: {
            [DB_TABLES.LEAD]: {
              attributes: [
                'lead_id',
                'first_name',
                'last_name',
                'salesforce_lead_id',
                'salesforce_contact_id',
              ],
              [DB_TABLES.LEAD_EMAIL]: {
                attributes: ['email_id'],
              },
              required: true,
            },
          },
          extras: {
            attributes: ['account_id', 'name'],
            required: true,
          },
        });
        if (errForLeads)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching leads: ${errForLeads}`,
          });

        const set_of_lead_ids_in_DB = {};

        results_from_DB.forEach(({ Leads }) => {
          Leads.forEach(
            ({ lead_id, salesforce_lead_id, salesforce_contact_id }) => {
              if ((salesforce_lead_id || salesforce_contact_id) == false)
                return badRequestResponseWithDevMsg({
                  res,
                  msg: 'Failed to fetch leads',
                  error:
                    'Either salesforce Lead id or salesforce contact id should be defined ',
                });
              set_of_lead_ids_in_DB[
                salesforce_account_id
                  ? salesforce_contact_id
                  : salesforce_lead_id
              ] = lead_id;
            }
          );
        });

        results_from_salesforce.forEach((lead) => {
          lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
            lead.Id
          );
          lead.lead_id_db = set_of_lead_ids_in_DB[lead.Id] ?? null;
        });

        successResponse(
          res,
          'Successfully fetched related leads',
          results_from_salesforce
        );
        break;
      }
      case CRM_INTEGRATIONS.HUBSPOT: {
        let { id } = req.body;
        let hubspot_company_id = id;

        const [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            user_id: req.user.user_id,
          });
        if (
          errForAccessToken === 'Please log in with hubspot' ||
          errForAccessToken === 'expired access/refresh token'
        )
          return successResponse(
            res,
            'Please sign in with hubspot to get related lead details.'
          );

        // * Fetch hubspot field map
        let [hubspotFieldMap, errFetchingHubspotFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingHubspotFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching fieldmap for company from user: ${errFetchingHubspotFieldMap}`,
          });

        let hubspotContactMap = hubspotFieldMap.contact_map;
        let hubspotCompanyMap = hubspotFieldMap.company_map;

        //mapping object from user to company

        let results_from_hubspot = [];

        const maps = {
          first_name: hubspotContactMap?.['first_name'] ?? 'firstname',
          last_name: hubspotContactMap?.['last_name'] ?? 'lastname',
          email: hubspotContactMap?.['emails'][0] ?? 'email',
          account_name: hubspotCompanyMap?.['name'] ?? 'name',
        };

        let [result, errForLead] =
          await v2GrpcClients.crmIntegration.getRelatedLead({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            integration_data: {
              company_id: hubspot_company_id,
              access_token,
            },
          });
        if (errForLead)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching related lead: ${errForLead}`,
          });

        result = result.contacts;

        let hubspot_lead_ids = [];
        let portal_id = result[0].portalId;

        result.forEach((contact) => {
          let cont = {};
          const emap = new Map();
          let em = contact.properties;
          for (let i = 0; i < em.length; i++) {
            emap.set(em[i].name, i);
          }
          em = contact.identities[0].identity;
          for (let i = 0; i < em.length; i++) {
            if (em[i].type == 'EMAIL') emap.set(maps.email, i);
          }
          if (emap.has(maps.first_name))
            cont.first_name =
              contact.properties[emap.get(maps.first_name)].value;
          if (emap.has(maps.last_name))
            cont.last_name = contact.properties[emap.get(maps.last_name)].value;
          if (emap.has(maps.email)) {
            cont.email =
              contact.identities[0].identity[emap.get(maps.email)].value;
          }
          cont.ID = contact.vid;
          hubspot_lead_ids.push(contact.vid);
          results_from_hubspot.push(cont);
        });

        let [results_from_DB, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: {
              [Op.in]: hubspot_lead_ids,
            },
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              where: {
                integration_id: hubspot_company_id,
              },
              attributes: ['account_id', 'name'],
            },
            [DB_TABLES.USER]: {
              attributes: ['user_id', 'first_name'],
              [DB_TABLES.COMPANY]: {
                where: {
                  company_id: req.user.company_id,
                },
              },
              required: true,
            },
          },
          extras: {
            attributes: [
              'lead_id',
              'first_name',
              'last_name',
              'integration_id',
            ],
            required: true,
          },
        });
        if (errForLeads)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching leads: ${errForLeads}`,
          });

        const set_of_lead_ids_in_DB = {};

        results_from_DB.forEach((lead) => {
          if (lead.integration_id == false)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: 'integration_id must be defined',
            });
          set_of_lead_ids_in_DB[lead.integration_id] = lead.lead_id;
        });

        results_from_hubspot.forEach((lead) => {
          lead.hubspot_url = `https://app.hubspot.com/contacts/${portal_id}/contact/${lead.ID}`;
          lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
            lead.ID
          );
          lead.lead_id = set_of_lead_ids_in_DB[lead.ID] ?? null;
        });

        successResponse(
          res,
          'Successfully fetched related leads',
          results_from_hubspot
        );
        break;
      }
      case CRM_INTEGRATIONS.PIPEDRIVE: {
        let { id } = req.body;
        let pipedrive_organization_id = id;

        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            user_id: req.user.user_id,
          });
        if (
          errForAccessToken === 'Please log in with Pipedrive' ||
          errForAccessToken === 'expired access/refresh token'
        )
          return successResponse(
            res,
            'Please sign in with Pipedrive to get related lead details.'
          );

        // * Fetch pipedrive field map
        let [pipedriveFieldMap, errFetchingPipedriveFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingPipedriveFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching Pipedrive field map: ${errFetchingPipedriveFieldMap}`,
          });

        let pipedriveContactMap = pipedriveFieldMap.contact_map;
        let pipedriveCompanyMap = pipedriveFieldMap.company_map;

        //mapping object from user to company

        let results_from_pipedrive = [];

        const maps = {
          first_name: pipedriveContactMap?.['first_name'] ?? 'firstname',
          last_name: pipedriveContactMap?.['last_name'] ?? 'lastname',
          email: pipedriveContactMap?.['emails'][0] ?? 'email',
          account_name: pipedriveCompanyMap?.['name'] ?? 'name',
        };

        let [result, errForLead] =
          await v2GrpcClients.crmIntegration.getRelatedLead({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            integration_data: {
              organization_id: pipedrive_organization_id,
              access_token,
              instance_url,
            },
          });
        if (errForLead)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching related lead: ${errForLead}`,
          });

        result = result.data;
        let pipedrive_lead_ids = [];
        result.forEach((contact) => {
          contact.first_name = contact[maps.first_name];
          contact.last_name = contact[maps.last_name];
          contact.email = contact[maps.email];
          delete contact[maps.first_name];
          delete contact[maps.last_name];
          delete contact[maps.email];
          pipedrive_lead_ids.push(id);
        });
        results_from_pipedrive = result;
        let [results_from_DB, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: {
              [Op.in]: pipedrive_lead_ids,
            },
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              where: {
                integration_id: pipedrive_organization_id,
              },
              attributes: ['account_id', 'name'],
            },
            [DB_TABLES.USER]: {
              attributes: ['user_id', 'first_name'],
              [DB_TABLES.COMPANY]: {
                where: {
                  company_id: req.user.company_id,
                },
              },
              required: true,
            },
          },
          extras: {
            attributes: [
              'lead_id',
              'first_name',
              'last_name',
              'integration_id',
            ],
            required: true,
          },
        });
        if (errForLeads)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching leads: ${errForLeads}`,
          });

        const set_of_lead_ids_in_DB = {};

        results_from_DB.forEach((lead) => {
          if (lead.integration_id == false)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: 'integration_id must be defined ',
            });
          set_of_lead_ids_in_DB[lead.integration_id] = lead.lead_id;
        });

        results_from_pipedrive.forEach((lead) => {
          lead.pipedrive_url = `${instance_url}/person/${lead.id}`;
          lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
            lead.id
          );
          lead.lead_id = set_of_lead_ids_in_DB[lead.id] ?? null;
        });

        successResponse(
          res,
          'Successfully fetched related leads',
          results_from_pipedrive
        );
        break;
      }
      case CRM_INTEGRATIONS.ZOHO: {
        let { id, account_name } = req.body;
        let zoho_account_id = id;

        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            user_id: req.user.user_id,
          });

        if (
          [
            'Kindly sign in with your crm.',
            'Kindly log in with zoho.',
            'Error while getting access token and refresh token from zoho auth',
          ].includes(errForAccessToken)
        )
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please connect with Zoho ',
          });

        let [zohoFieldMap, errFetchingZohoFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingZohoFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching fieldmap for company from user: ${errFetchingZohoFieldMap}`,
          });

        //mapping object from user to company
        if (zoho_account_id) {
          let results_from_zoho = [];
          const maps = {
            first_name: zohoFieldMap.contact_map?.['first_name'] ?? 'FirstName',
            last_name: zohoFieldMap.contact_map?.['last_name'] ?? 'LastName',
            email: zohoFieldMap.contact_map?.['emails'][0] ?? 'Email',
            account_name: zohoFieldMap.account_map?.['name'] ?? 'Name',
          };
          let fields = `${maps.first_name},${maps.last_name},${maps.email},${maps.account_name}`;

          let [result, errForLead] =
            await v2GrpcClients.crmIntegration.getRelatedLead({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                account_id: zoho_account_id,
                access_token,
                instance_url,
                fields,
              },
            });
          if (errForLead)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching related lead: ${errForLead}`,
            });

          result = result?.data;
          let zoho_lead_ids = [];
          for (let contact of result) {
            contact.first_name = contact[maps.first_name];
            contact.last_name = contact[maps.last_name];
            contact.email = contact[maps.email];
            delete contact[maps.first_name];
            delete contact[maps.last_name];
            delete contact[maps.email];
            zoho_lead_ids.push(contact.id);
          }
          results_from_zoho = result;
          let [results_from_DB, errForLeads] = await Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: {
                [Op.in]: zoho_lead_ids,
              },
            },
            include: {
              [DB_TABLES.ACCOUNT]: {
                where: {
                  integration_id: zoho_account_id,
                  company_id: req.user.company_id,
                },
                attributes: ['account_id', 'name'],
              },
            },
            extras: {
              attributes: [
                'lead_id',
                'first_name',
                'last_name',
                'integration_id',
              ],
              required: true,
            },
          });
          if (errForLeads)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching leads: ${errForLeads}`,
            });
          const set_of_lead_ids_in_DB = {};

          results_from_DB.forEach((lead) => {
            if (lead.integration_id == false)
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Failed to fetch leads',
                error: 'integration_id must be defined ',
              });
            set_of_lead_ids_in_DB[lead.integration_id] = lead.lead_id;
          });
          const domain_url = instance_url.replace('www.zohoapis', 'crm.zoho');

          results_from_zoho.forEach((lead) => {
            lead.zoho_url = `${domain_url}/crm/tab/Contacts/${lead.id}`;
            lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
              lead.id
            );
            lead.lead_id = set_of_lead_ids_in_DB[lead.id] ?? null;
          });

          successResponse(
            res,
            'Successfully fetched related leads',
            results_from_zoho
          );
        } else {
          let zoho_lead_ids = [];

          const maps = {
            first_name: zohoFieldMap.lead_map?.['first_name'] ?? 'First_Name',
            last_name: zohoFieldMap.lead_map?.['last_name'] ?? 'Last_Name',
            email: zohoFieldMap.lead_map['emails']?.[0] ?? 'Email',
          };

          const query = `SELECT id,${maps.first_name},${maps.last_name}, ${maps.email} FROM Leads WHERE ${zohoFieldMap.lead_map['company']} = '${account_name}'`;

          let [result, errForLead] = await ZohoService.query(
            query,
            access_token,
            instance_url
          );

          if (errForLead)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while running COQL query in zoho: ${errForLead}`,
            });

          result = result.data;
          if (!result) result = [];
          for (let lead of result) {
            lead.first_name = lead[maps.first_name];
            lead.last_name = lead[maps.last_name];
            lead.email = lead[maps.email];
            delete lead[maps.first_name];
            delete lead[maps.last_name];
            delete lead[maps.email];
            zoho_lead_ids.push(lead.id);
          }

          let [results_from_DB, errForLeadsFromDB] = await Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: {
                [Op.in]: zoho_lead_ids,
              },
              integration_type: LEAD_INTEGRATION_TYPES.ZOHO_LEAD,
              company_id: req.user.company_id,
            },
            extras: {
              attributes: [
                'lead_id',
                'first_name',
                'last_name',
                'integration_id',
              ],
              required: true,
            },
          });
          if (errForLeadsFromDB)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching leads from DB: ${errFetchingLeadsFromDB}`,
            });

          let results_from_zoho = result;

          const set_of_lead_ids_in_DB = {};
          results_from_DB.forEach((lead) => {
            if (lead.integration_id == false)
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Failed to fetch leads',
                error: 'integration_id must be defined ',
              });
            set_of_lead_ids_in_DB[lead.integration_id] = lead.lead_id;
          });
          const domain_url = instance_url.replace('www.zohoapis', 'crm.zoho');

          results_from_zoho.forEach((lead) => {
            lead.zoho_url = `${domain_url}/crm/tab/Leads/${lead.id}`;
            lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
              lead.id
            );
            lead.lead_id = set_of_lead_ids_in_DB[lead.id] ?? null;
          });

          successResponse(
            res,
            'Successfully fetched related leads',
            results_from_zoho
          );
        }
        break;
      }
      case CRM_INTEGRATIONS.DYNAMICS: {
        let { id, account_name } = req.body;
        let dynamics_account_id = id;

        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            user_id: req.user.user_id,
          });

        if (errForAccessToken) {
          if (
            [
              'Kindly sign in with your crm.',
              'Kindly log in with dynamics.',
              'Error while getting access token from dynamics auth',
            ].includes(errForAccessToken)
          )
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Please connect with Dyanmics',
            });

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while getting access token from dynamics: ${errForAccessToken}`,
          });
        }

        let [dynamicsFieldMap, errFetchingDynamicsFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingDynamicsFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching fieldmap for dynamics company from user: ${errFetchingDynamicsFieldMap}`,
          });

        //mapping object from user to company
        if (dynamics_account_id) {
          let results_from_dynamics = [];
          const maps = {
            first_name:
              dynamicsFieldMap.contact_map?.['first_name'] ?? 'firstname',
            last_name:
              dynamicsFieldMap.contact_map?.['last_name'] ?? 'lastname',
            email:
              dynamicsFieldMap.contact_map?.['emails'][0] ?? 'emailaddress1',
            account_name: dynamicsFieldMap.account_map?.['name'] ?? 'name',
          };
          let fields = {
            contactFields: `${maps.first_name},${maps.last_name},${maps.email}`,
            accountFields: `${maps.account_name}`,
          };

          let [result, errForLead] =
            await v2GrpcClients.crmIntegration.getRelatedLead({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              integration_data: {
                account_id: dynamics_account_id,
                access_token,
                instance_url,
                fields,
              },
            });
          if (errForLead)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching related lead: ${errForLead}`,
            });

          let dynamics_contact_ids = [];
          const dynamics_contact = result?.contact_customer_accounts.map(
            (contact) => {
              dynamics_contact_ids.push(contact.contactid);
              return {
                first_name: contact[maps.first_name],
                last_name: contact[maps.last_name],
                email: contact[maps.email],
                contactid: contact.contactid,
              };
            }
          );

          results_from_dynamics = dynamics_contact;
          let [results_from_DB, errForLeads] = await Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: {
                [Op.in]: dynamics_contact_ids,
              },
            },
            include: {
              [DB_TABLES.ACCOUNT]: {
                where: {
                  integration_id: dynamics_account_id,
                  company_id: req.user.company_id,
                },
                attributes: ['account_id', 'name'],
              },
            },
            extras: {
              attributes: [
                'lead_id',
                'first_name',
                'last_name',
                'integration_id',
              ],
              required: true,
            },
          });
          if (errForLeads)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching leads: ${errForLeads}`,
            });
          const set_of_lead_ids_in_DB = {};

          results_from_DB.forEach((lead) => {
            if (lead.integration_id == false)
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Failed to fetch leads',
                error: 'integration_id must be defined ',
              });
            set_of_lead_ids_in_DB[lead.integration_id] = lead.lead_id;
          });

          results_from_dynamics.forEach((lead) => {
            lead.dynamics_url = `${instance_url}/main.aspx?etn=contact&pagetype=entityrecord&id=${lead.contactid}`;
            lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
              lead.contactid
            );
            lead.lead_id = set_of_lead_ids_in_DB[lead.contactid] ?? null;
          });

          successResponse(
            res,
            'Successfully fetched related leads',
            results_from_dynamics
          );
        } else {
          const maps = {
            first_name:
              dynamicsFieldMap.lead_map?.['first_name'] ?? 'firstname',
            last_name: dynamicsFieldMap.lead_map?.['last_name'] ?? 'lastname',
            email: dynamicsFieldMap.lead_map['emails']?.[0] ?? 'emailaddress1',
          };

          let fields = `${maps.first_name},${maps.last_name},${maps.email}`;

          let [result, errForLead] =
            await v2GrpcClients.crmIntegration.getRelatedLead({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              integration_data: {
                account_name: account_name,
                access_token,
                instance_url,
                fields,
              },
            });
          if (errForLead)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching related lead: ${errForLead}`,
            });

          if (!result) result = [];

          let dynamics_lead_ids = [];
          const dynamics_lead = result?.value.map((lead) => {
            dynamics_lead_ids.push(lead.leadid);
            return {
              first_name: lead[maps.first_name],
              last_name: lead[maps.last_name],
              email: lead[maps.email],
              leadid: lead.leadid,
            };
          });

          let [results_from_DB, errForLeadsFromDB] = await Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: {
                [Op.in]: dynamics_lead_ids,
              },
              integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD,
              company_id: req.user.company_id,
            },
            extras: {
              attributes: [
                'lead_id',
                'first_name',
                'last_name',
                'integration_id',
              ],
              required: true,
            },
          });
          if (errForLeadsFromDB)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: `Error while fetching leads from DB: ${errFetchingLeadsFromDB}`,
            });

          let results_from_dynamics = dynamics_lead;

          const set_of_lead_ids_in_DB = {};
          results_from_DB.forEach((lead) => {
            if (lead.integration_id == false)
              return badRequestResponseWithDevMsg({
                res,
                msg: 'Failed to fetch leads',
                error: 'integration_id must be defined ',
              });
            set_of_lead_ids_in_DB[lead.integration_id] = lead.lead_id;
          });

          results_from_dynamics.forEach((lead) => {
            lead.dynamics_url = `${instance_url}/main.aspx?etn=lead&pagetype=entityrecord&id=${lead.leadid}`;
            lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
              lead.leadid
            );
            lead.lead_id = set_of_lead_ids_in_DB[lead.leadid] ?? null;
          });

          successResponse(
            res,
            'Successfully fetched related leads',
            results_from_dynamics
          );
        }
        break;
      }
      case CRM_INTEGRATIONS.SELLSY: {
        let { id } = req.body;

        const [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            user_id: req.user.user_id,
          });

        if (errForAccessToken) {
          if (
            [
              'Kindly log in with sellsy.',
              'Error while getting access token from sellsy auth',
            ].includes(errForAccessToken)
          )
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Please connect with Sellsy',
            });

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while getting access token from sellsy: ${errForAccessToken}`,
          });
        }

        let [sellsyFieldMap, errFetchingSellsyFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingSellsyFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching fieldmap for sellsy company from user: ${errFetchingSellsyFieldMap}`,
          });

        //mapping object from user to company
        let results_from_sellsy = [];
        const fields = {
          first_name:
            sellsyFieldMap?.contact_map?.['first_name'] ?? 'first_name',
          last_name: sellsyFieldMap?.contact_map?.['last_name'] ?? 'last_name',
          email: sellsyFieldMap?.contact_map?.['emails'][0] ?? 'email',
        };

        let [result, errForLead] =
          await v2GrpcClients.crmIntegration.getRelatedLead({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: {
              company_id: id,
              access_token,
              fields,
            },
          });
        if (errForLead) {
          if (errForLead?.toLowerCase()?.includes('not found'))
            return successResponse(
              res,
              'No related leads found',
              results_from_sellsy
            );
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching related lead: ${errForLead}`,
          });
        }

        let sellsy_lead_ids = [];

        const sellsy_contact = result.map((contact) => {
          sellsy_lead_ids.push(contact?.id?.toString());
          return {
            first_name: contact[fields.first_name],
            last_name: contact[fields.last_name],
            email: contact[fields.email],
            id: contact.id,
          };
        });

        results_from_sellsy = sellsy_contact;
        let [results_from_DB, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            integration_id: {
              [Op.in]: sellsy_lead_ids,
            },
          },
          include: {
            [DB_TABLES.ACCOUNT]: {
              where: {
                integration_id: id,
                company_id: req.user.company_id,
              },
              attributes: ['account_id', 'name'],
            },
          },
          extras: {
            attributes: [
              'lead_id',
              'first_name',
              'last_name',
              'integration_id',
            ],
          },
        });
        if (errForLeads)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch leads',
            error: `Error while fetching leads: ${errForLeads}`,
          });

        const set_of_lead_ids_in_DB = {};

        results_from_DB.forEach((lead) => {
          if (!lead?.integration_id)
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch leads',
              error: 'integration_id must be defined ',
            });
          set_of_lead_ids_in_DB[lead.integration_id] = lead.lead_id;
        });

        results_from_sellsy.forEach((lead) => {
          lead.sellsy_url = `https://www.sellsy.com/peoples/${lead.id}`;
          lead.present_in_cadence = set_of_lead_ids_in_DB.hasOwnProperty(
            lead.id
          );
          lead.lead_id = set_of_lead_ids_in_DB[lead.id] ?? null;
        });

        return successResponse(
          res,
          'Successfully fetched related leads',
          results_from_sellsy
        );
      }
      default: {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Unsupported feature for given integration',
        });
      }
    }
  } catch (err) {
    logger.error('Error while finding related leads: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while finding related leads: ${err.message}`,
    });
  }
};

const getLeadInfoFromCRM = async (req, res) => {
  try {
    const { lead_id } = req.params;

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['integration_id'],
        },
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead',
        error: `Error while fetching lead: ${errForLead}`,
      });
    if (!lead)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: 'Lead not found',
      });

    const [{ access_token, instance_url }, errForTokenFetch] =
      await AccessTokenHelper.getAccessToken({
        integration_type: req.user.integration_type,
        user_id: req.user.user_id,
      });
    if (errForTokenFetch) {
      if (
        [
          'Kindly log in with salesforce.',
          'Kindly log in with pipedrive.',
          'expired access/refresh token',
        ].includes(`Kindly log in with ${req.user.integration_type}.`)
      )
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch lead',
          error: `Error while fetching access token: ${errForTokenFetch}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead',
        error: `Error while fetching access token: ${errForTokenFetch}`,
      });
    }

    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD: {
        const [data, err] = await v2GrpcClients.crmIntegration.getLead({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          integration_data: {
            salesforce_lead_id: lead?.integration_id,
            access_token,
            instance_url,
          },
        });
        if (err) {
          if (err?.includes('Request failed with status code 404'))
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch lead',
              error: 'Lead not found in Salesforce',
            });
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead',
            error: `Error while fetching lead: ${err}`,
          });
        }

        return successResponse(res, 'CRM data fetched successfully.', {
          lead: data?.data,
        });
      }
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT: {
        // * Fetch contact from salesforce
        const contactPromise = v2GrpcClients.crmIntegration.getContact({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          integration_data: {
            salesforce_contact_id: lead?.integration_id,
            access_token,
            instance_url,
          },
        });

        // * Fetch account from salesforce
        const accountPromise = v2GrpcClients.crmIntegration.getAccount({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          integration_data: {
            salesforce_account_id: lead.Account?.integration_id,
            access_token,
            instance_url,
          },
        });

        const [[contact, errForContact], [account, errForAccount]] =
          await Promise.all([contactPromise, accountPromise]);
        if (errForContact?.includes('Request failed with status code 404'))
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: 'Contact not found in salesforce',
          });
        else if (errForContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: `Error while fetching contact: ${errForContact}`,
          });
        if (errForAccount?.includes('Request failed with status code 404'))
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch account',
            error: 'Account not found in salesforce',
          });
        else if (errForAccount)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch account',
            error: `Error while fetching account: ${errForAccount}`,
          });

        return successResponse(res, 'CRM data fetched successfully.', {
          contact: contact?.data,
          account: account?.data,
        });
      }
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON: {
        // * Fetch person from pipedrive
        const personPromise = v2GrpcClients.crmIntegration.getContact({
          integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
          integration_data: {
            person_id: lead?.integration_id,
            access_token,
            instance_url,
          },
        });

        // * Fetch organization from pipedrive
        const organizationPromise = v2GrpcClients.crmIntegration.getAccount({
          integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
          integration_data: {
            id: lead.Account?.integration_id,
            access_token,
            instance_url,
          },
        });

        const [
          [personData, errForPersonData],
          [organizationData, errForOrganizationData],
        ] = await Promise.all([personPromise, organizationPromise]);
        if (errForPersonData)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch person',
            error: `Error while fetching person: ${errForPersonData}`,
          });
        if (errForOrganizationData)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch organization',
            error: `Error while fetching organization: ${errForOrganizationData}`,
          });

        let person = {};
        let organization = {};
        Object.keys(personData?.data)?.forEach((key) => {
          let value = personData?.data[key];
          if (typeof value === 'string') person[key] = value;
          else if (typeof value === 'object' && !Array.isArray(value))
            person[key] = value?.value ?? null;
        });
        Object.keys(organizationData?.data)?.forEach((key) => {
          let value = organizationData?.data[key];
          if (typeof value === 'string') organization[key] = value;
          else if (typeof value === 'object' && !Array.isArray(value))
            organization[key] = value?.value ?? null;
        });

        return successResponse(res, 'CRM data fetched successfully.', {
          person,
          organization,
        });
      }
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT: {
        const [hubspotFieldMap, errForHubspotFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errForHubspotFieldMap)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: `Error while fetching field map for company from user: ${errForHubspotFieldMap}`,
          });

        let hubspotContactMap = hubspotFieldMap.contact_map;
        let hubspotCompanyMap = hubspotFieldMap.company_map;

        let contact_properties_query = '';
        for (let key of Object.keys(hubspotContactMap)) {
          let value = hubspotContactMap[key];
          if (typeof value === 'string')
            contact_properties_query = contact_properties_query + `${value},`;
          else if (typeof value === 'object') {
            if (!Array.isArray(value))
              contact_properties_query =
                contact_properties_query + `${value.name},`;
            else {
              for (let v of value) {
                if (key === 'variables')
                  contact_properties_query =
                    contact_properties_query + `${v?.target_value?.value},`;
                else
                  contact_properties_query = contact_properties_query + `${v},`;
              }
            }
          }
        }
        contact_properties_query =
          contact_properties_query + 'associatedcompanyid';

        let promiseArray = [];
        promiseArray.push(
          v2GrpcClients.crmIntegration.getContact({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            integration_data: {
              contact_id: lead?.integration_id,
              access_token,
              properties: contact_properties_query,
            },
          })
        );

        if (lead?.Account?.integration_id) {
          let account_properties_query = '';
          for (let key of Object.keys(hubspotCompanyMap)) {
            let value = hubspotCompanyMap[key];
            if (typeof value === 'string')
              account_properties_query = account_properties_query + `${value},`;
            else if (key === 'variables')
              for (let v of value)
                account_properties_query =
                  account_properties_query + `${v?.target_value?.value},`;
          }

          promiseArray.push(
            v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.HUBSPOT,
              integration_data: {
                company_id: lead.Account?.integration_id,
                access_token,
                properties: account_properties_query,
              },
            })
          );
        }

        const response = await Promise.all(promiseArray);

        let data = {};
        const [contactData, errForContactData] = response[0];
        if (errForContactData)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: `Error while fetching contact: ${errForContactData}`,
          });
        data.contact = contactData?.properties;

        if (lead?.Account?.integration_id) {
          const [companyData, errForCompanyData] = response[1];
          if (errForCompanyData)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch company',
              error: `Error while fetching company: ${errForCompanyData}`,
            });
          data.company = companyData?.properties;
        }

        return successResponse(res, 'CRM data fetched successfully.', data);
      }
      case LEAD_INTEGRATION_TYPES.ZOHO_LEAD: {
        const [data, err] = await v2GrpcClients.crmIntegration.getLead({
          integration_type: CRM_INTEGRATIONS.ZOHO,
          integration_data: {
            lead_id: lead?.integration_id,
            access_token,
            instance_url,
          },
        });
        if (err)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead',
            error: `Error while fetching lead: ${err}`,
          });

        return successResponse(res, 'CRM data fetched successfully.', {
          lead: data,
        });
      }
      case LEAD_INTEGRATION_TYPES.ZOHO_CONTACT: {
        let contactPromise = null,
          accountPromise = null;
        // * Fetch contact from zoho, if lead id present
        if (lead?.integration_id)
          contactPromise = v2GrpcClients.crmIntegration.getContact({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            integration_data: {
              contact_id: lead?.integration_id,
              access_token,
              instance_url,
            },
          });

        // * Fetch account from zoho, if account id present
        if (lead?.Account?.integration_id)
          accountPromise = v2GrpcClients.crmIntegration.getAccount({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            integration_data: {
              account_id: lead.Account?.integration_id,
              access_token,
              instance_url,
            },
          });

        // both promiseData will be of form [data,err] if promises are not null
        // so after resolving check if any promiseData has [1] element to check for error
        // if no error present then required data will be [0] element of promiseData
        const [contactPromiseData, accountPromiseData] = await Promise.all([
          contactPromise,
          accountPromise,
        ]);
        if (contactPromiseData?.[1])
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: `Error while fetching contact: ${contactPromiseData?.[1]}`,
          });
        if (accountPromiseData?.[1])
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch account',
            error: `Error while fetching account: ${accountPromiseData?.[1]}`,
          });

        return successResponse(res, 'CRM data fetched successfully.', {
          contact: contactPromiseData?.[0],
          account: accountPromiseData?.[0],
        });
      }
      case LEAD_INTEGRATION_TYPES.SELLSY_CONTACT: {
        const contactFields = SellsyHelper.describeContactFields;
        const companyFields = SellsyHelper.describeCompanyFields;

        // * Fetch contact from sellsy
        const contactPromise = v2GrpcClients.crmIntegration.getContact({
          integration_type: CRM_INTEGRATIONS.SELLSY,
          integration_data: {
            contact_id: lead?.integration_id,
            access_token,
          },
        });

        // * Fetch company from sellsy
        let companyPromise = [null, null];
        if (lead?.Account?.integration_id)
          companyPromise = v2GrpcClients.crmIntegration.getAccount({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: {
              company_id: lead.Account?.integration_id,
              access_token,
            },
          });

        const [
          [contactData, errForContactData],
          [companyData, errForCompanyData],
        ] = await Promise.all([contactPromise, companyPromise]);
        if (errForContactData?.includes('Not Found'))
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: 'Contact not found in sellsy',
          });
        else if (errForContactData)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: errForContactData,
          });
        if (errForCompanyData?.includes('Not Found'))
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to fetch company',
            error: 'Company not found in sellsy',
          });
        else if (errForCompanyData)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch company',
            error: errForCompanyData,
          });

        // * Obtaining the contact data for only those string fields which are editable
        const contact = {};
        contactFields?.forEach((field) => {
          if (field.editable === false || field.type !== 'string') return;
          const label = field.label;
          field.value
            ?.trim()
            ?.split('.')
            ?.forEach((key, index) => {
              if (index === 0) contact[label] = contactData[key];
              else contact[label] = contact[label]?.[key];
            });
          if (contact[label]?.length) {
            const [cleanString, _] = HtmlHelper.removeHtmlTags(contact[label]);
            contact[label] = cleanString;
          }
        });

        // * Obtaining the company data for only those string fields which are editable
        const company = {};
        if (lead?.Account?.integration_id)
          companyFields?.company_fields?.forEach((field) => {
            if (field.editable === false || field.type !== 'string') return;
            const label = field.label;
            field.value
              ?.trim()
              ?.split('.')
              ?.forEach((key, index) => {
                if (index === 0) company[label] = companyData[key];
                else company[label] = company[label]?.[key];
              });
            if (company[label]?.length) {
              const [cleanString, _] = HtmlHelper.removeHtmlTags(
                company[label]
              );
              company[label] = cleanString;
            }
          });

        return successResponse(res, 'CRM data fetched successfully.', {
          contact,
          company,
        });
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE: {
        // * Fetch candidate from bullhorn
        const [candidateData, errForCandidateData] =
          await v2GrpcClients.hiringIntegration.getCandidate({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              candidate_id: lead.integration_id,
              access_token,
              instance_url,
            },
          });
        if (errForCandidateData)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch candidate',
            error: `Error while fetching candidate: ${errForCandidateData}`,
          });

        return successResponse(res, 'CRM data fetched successfully.', {
          candidate: candidateData,
        });
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT: {
        let contactPromise = null,
          accountPromise = null;
        // * Fetch contact from bullhorn, if contact id present
        if (lead.integration_id)
          contactPromise = v2GrpcClients.hiringIntegration.getContact({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              contact_id: lead.integration_id,
              access_token,
              instance_url,
            },
          });

        // * Fetch account from bullhorn, if account id present
        if (lead?.Account?.integration_id)
          accountPromise = v2GrpcClients.hiringIntegration.getAccount({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              corporation_id: lead.Account?.integration_id,
              access_token,
              instance_url,
            },
          });

        // both promiseData will be of form [data,err] if promises are not null
        // so after resolving check if any promiseData has [1] element to check for error
        // if no error present then required data will be [0] element of promiseData
        const [contactPromiseData, accountPromiseData] = await Promise.all([
          contactPromise,
          accountPromise,
        ]);
        if (contactPromiseData?.[1])
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: `Error while fetching contact: ${contactPromiseData?.[1]}`,
          });
        if (accountPromiseData?.[1])
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch account',
            error: `Error while fetching account: ${accountPromiseData?.[1]}`,
          });

        return successResponse(res, 'CRM data fetched successfully.', {
          contact: contactPromiseData?.[0],
          account: accountPromiseData?.[0],
        });
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD: {
        let leadPromise = null,
          accountPromise = null;
        // * Fetch lead from bullhorn, if lead id present
        if (lead.integration_id)
          leadPromise = v2GrpcClients.hiringIntegration.getLead({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              lead_id: lead.integration_id,
              access_token,
              instance_url,
            },
          });

        // * Fetch account from bullhorn, if account id present
        if (lead?.Account?.integration_id)
          accountPromise = v2GrpcClients.hiringIntegration.getAccount({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              corporation_id: lead.Account?.integration_id,
              access_token,
              instance_url,
            },
          });

        // both promiseData will be of form [data,err] if promises are not null
        // so after resolving check if any promiseData has [1] element to check for error
        // if no error present then required data will be [0] element of promiseData
        const [leadPromiseData, accountPromiseData] = await Promise.all([
          leadPromise,
          accountPromise,
        ]);
        if (leadPromiseData?.[1])
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead',
            error: `Error while fetching lead: ${leadPromiseData?.[1]}`,
          });
        if (accountPromiseData?.[1])
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch account',
            error: `Error while fetching account: ${accountPromiseData?.[1]}`,
          });

        return successResponse(res, 'CRM data fetched successfully.', {
          lead: leadPromiseData?.[0],
          account: accountPromiseData?.[0],
        });
      }

      default: {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Unsupported integration type. Please try again later or contact support',
        });
      }
    }
  } catch (err) {
    logger.error('Error while fetching lead info from crm: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead info from crm: ${err.message}`,
    });
  }
};

const getLeadDuplicates = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (lead_id == null || lead_id == '')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch duplicate leads',
        error: 'Lead id cannot be null',
      });

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch duplicate leads',
        error: `Error while fetching lead: ${errForLead}`,
      });
    if (!lead)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: 'Lead not found',
      });

    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD:
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT: {
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (
          [
            'Kindly log in with salesforce.',
            'Please log in with salesforce',
            'expired access/refresh token',
          ].includes(errForAccessToken)
        )
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please sign in with Salesforce to fetch duplicates',
          });

        const [duplicates, errForDuplicates] =
          await v2GrpcClients.crmIntegration.getDuplicate({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            integration_data: {
              access_token,
              instance_url,
              id: lead.integration_id,
            },
          });
        if (errForDuplicates) {
          if (errForDuplicates.includes('not found'))
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to fetch duplicate leads',
              error: `Error while fetching duplicate data via grpc: ${errForDuplicates}`,
            });
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch duplicate leads',
            error: `Error while fetching duplicate data via grpc: ${errForDuplicates}`,
          });
        }

        return successResponse(
          res,
          'Duplicates fetched successfully.',
          duplicates
        );
      }
      case LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Not applicable for Pipedrive',
        });
      default:
        return badRequestResponseWithDevMsg({
          res,
          error:
            'Invalid integration type. Please try again later or contact support',
        });
    }
  } catch (err) {
    logger.error('Error while fetching lead duplicates from salesforce: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead duplicates from salesforce: ${err.message}`,
    });
  }
};

// * Disqualify Lead
const disqualifyLead = async (req, res) => {
  try {
    // * Validation
    let body = leadSchema.disqualifyConvertLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // * Check is this is a salesforce lead or contact
    const [lead, errFetchingLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        integration_id: body.integration_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name', 'integration_type', 'integration_id'],
        },
        [DB_TABLES.USER]: {
          where: { company_id: req.user.company_id },
          required: true,
        },
      },
      extras: {
        attributes: [
          'lead_id',
          'integration_type',
          'integration_id',
          'lead_warmth',
          'lead_score',
          'integration_status',
          'user_id',
        ],
      },
    });
    let previous_status = lead?.integration_status;
    if (errFetchingLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to disqualify lead',
        error: errFetchingLead,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to disqualify lead',
        error: 'Lead not found',
      });

    let integrationFieldMap, errForIntegrationFieldMap;

    // * Fetch disqualification webhook
    const [company, errFetchingDisqualifyWebhook] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.WEBHOOK]: {
            where: {
              webhook_type: WEBHOOK_TYPE.DISQUALIFY,
            },
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errFetchingDisqualifyWebhook)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to disqualify lead',
        error: errFetchingDisqualifyWebhook,
      });

    if (!company?.Company_Setting?.Webhooks.length)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Webhook to disqualify is not set',
      });

    let disqualifyWebhookEndpoint = company?.Company_Setting?.Webhooks[0];
    let config = {};

    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD:
        // * Disqualify using lead logic
        config = {
          method: disqualifyWebhookEndpoint.http_method,
          url: disqualifyWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${disqualifyWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: SALESFORCE_SOBJECTS.LEAD,
            Id: lead.integration_id,
            status: body.status,
            reason: body.disqualification_reason,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await SalesforceHelper.getFieldMapForCompanyFromCompany(
            req.user.company_id,
            SALESFORCE_SOBJECTS.LEAD
          );
        break;
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT:
        // * Disqualify using lead logic
        config = {
          method: disqualifyWebhookEndpoint.http_method,
          url: disqualifyWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${disqualifyWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: body.model_type,
            Id: lead.Account.integration_id,
            ContactId: lead.integration_id,
            status: body.status,
            reason: body.disqualification_reason,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await SalesforceHelper.getFieldMapForCompanyFromCompany(
            req.user.company_id,
            SALESFORCE_SOBJECTS.ACCOUNT
          );
        break;
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT:
        // * Disqualify using lead logic
        config = {
          method: disqualifyWebhookEndpoint.http_method,
          url: disqualifyWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${disqualifyWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: HUBSPOT_ENDPOINTS.CONTACT,
            ContactId: lead.integration_id,
            status: body.status,
            reason: body.disqualification_reason,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.contact_map;
        break;
      case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE:
        // * Disqualify using lead logic
        config = {
          method: disqualifyWebhookEndpoint.http_method,
          url: disqualifyWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${disqualifyWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: BULLHORN_ENDPOINTS.CANDIDATE,
            Id: lead.integration_id,
            status: body.status,
            reason: body.disqualification_reason,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.candidate_map;
        break;
      case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT:
        // * Disqualify using lead logic
        config = {
          method: disqualifyWebhookEndpoint.http_method,
          url: disqualifyWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${disqualifyWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: BULLHORN_ENDPOINTS.CONTACT,
            Id: lead.integration_id,
            status: body.status,
            reason: body.disqualification_reason,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.contact_map;
        break;
      case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD:
        // * Disqualify using lead logic
        config = {
          method: disqualifyWebhookEndpoint.http_method,
          url: disqualifyWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${disqualifyWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: BULLHORN_ENDPOINTS.LEAD,
            Id: lead.integration_id,
            status: body.status,
            reason: body.disqualification_reason,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.lead_map;
        break;
      default:
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Cannot disqualify this lead',
        });
    }
    // Score the lead
    let [leadScore, errForLeadScore] = await LeadScoreHelper.updateLeadScore({
      lead,
      rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
      current_status: body.status,
      previous_status,
      field_map: integrationFieldMap,
    });
    if (errForLeadScore)
      logger.error(
        'An error occured while scoring lead during status update ',
        errForLeadScore
      );

    return successResponse(res, 'Successfully disqualified lead');
  } catch (err) {
    if (err?.response?.data) {
      logger.error(
        `An error occurred while attempting to disqualify lead: ${JSON.stringify(
          err?.response?.data
        )}`,
        {
          user_id: req.user.user_id,
        }
      );

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to disqualify lead, please check disqualify webhook endpoint or contact support',
        error: `Error from CRM: ${JSON.stringify(err?.response?.data)}`,
      });
    }
    logger.error(
      'An error occurred while attempting to disqualify lead: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Unable to disqualify lead, please check disqualify webhook endpoint or contact support',
      error: `Error while disqualifying lead: ${err.message}`,
    });
  }
};

/*
 * Reassigns both leads and contacts
 * expected to have type key in each of lead or contact object
 */
const reassign = async (req, res) => {
  try {
    const params = leadSchema.reassignSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    if (req.user.integration_type !== INTEGRATION_TYPE.SALESFORCE)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Reassignment is only allowed for Salesforce ',
      });
    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        user_id: req.user.user_id,
        integration_type: req.user.integration_type,
      });

    if (errForAccessToken) {
      if (errForAccessToken === 'Kindly log in with salesforce.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Kindly connect with Salesforce',
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to reassign',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    if (req?.body?.leads?.length == 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Please select at least one lead to reassign',
      });

    let data = {
      leads: req.body.leads.filter(() =>
        [
          SALESFORCE_DATA_IMPORT_TYPES.LEAD,
          SALESFORCE_DATA_IMPORT_TYPES.LEAD_LIST,
        ].includes(req.body.type)
      ),
      contacts: req.body.leads.filter(() =>
        [
          SALESFORCE_DATA_IMPORT_TYPES.CONTACT,
          SALESFORCE_DATA_IMPORT_TYPES.CONTACT_LIST,
        ].includes(req.body.type)
      ),
      access_token,
      instance_url,
      contact_reassignment_rule: req.body.contact_reassignment_rule,
      reassignToForLeads: req.body.reassignTo,
      reassignToForContacts: req.body.reassignTo,
    };

    const [msg, errForReassign] = await reassignLeadsOnSalesforce(data);
    if (errForReassign)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to reassign',
        error: `Error while reassigning leads: ${errForReassign}`,
      });
    return successResponse(res, 'Successfully reassigned leads');
  } catch (err) {
    logger.error(`An Error occured while attempting to reassign: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while reassigning leads: ${err.message}`,
    });
  }
};

// * Convert lead
const convertLead = async (req, res) => {
  try {
    // * Validation
    let body = leadSchema.disqualifyConvertLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // * Check is this is a salesforce lead or contact
    const [lead, errFetchingLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        integration_id: body.integration_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name', 'integration_type', 'integration_id'],
        },
        [DB_TABLES.USER]: {
          where: { company_id: req.user.company_id },
          required: true,
        },
      },
      extras: {
        attributes: [
          'lead_id',
          'integration_type',
          'integration_id',
          'integration_status',
          'lead_warmth',
          'lead_score',
          'user_id',
        ],
      },
    });
    if (errFetchingLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to convert lead',
        error: errFetchingLead,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to convert lead',
        error: 'Lead not found',
      });
    let previous_status = lead?.integration_status;
    // * Fetch convert webhook
    const [company, errFetchingConvertWebhook] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.WEBHOOK]: {
            where: {
              webhook_type: WEBHOOK_TYPE.CONVERT,
            },
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errFetchingConvertWebhook)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to convert lead',
        error: errFetchingConvertWebhook,
      });

    if (!company?.Company_Setting?.Webhooks.length)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Webhook to convert is not set',
      });

    let convertWebhookEndpoint = company?.Company_Setting?.Webhooks[0];
    let config = {};

    let integrationFieldMap, errForIntegrationFieldMap;

    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD:
        // * convert using lead logic
        config = {
          method: convertWebhookEndpoint.http_method,
          url: convertWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${convertWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: SALESFORCE_SOBJECTS.LEAD,
            Id: lead.integration_id,
            status: body.status,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await SalesforceHelper.getFieldMapForCompanyFromCompany(
            req.user.company_id,
            SALESFORCE_SOBJECTS.LEAD
          );
        break;
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT:
        // * convert using lead logic
        config = {
          method: convertWebhookEndpoint.http_method,
          url: convertWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${convertWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: body.model_type,
            Id: lead.Account.integration_id,
            ContactId: lead.integration_id,
            status: body.status,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await SalesforceHelper.getFieldMapForCompanyFromCompany(
            req.user.company_id,
            SALESFORCE_SOBJECTS.ACCOUNT
          );
        break;
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT:
        // * convert using lead logic
        config = {
          method: convertWebhookEndpoint.http_method,
          url: convertWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${convertWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: HUBSPOT_ENDPOINTS.CONTACT,
            ContactId: lead.integration_id,
            status: body.status,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.contact_map;
        break;
      case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE:
        // * Convert using lead logic
        config = {
          method: convertWebhookEndpoint.http_method,
          url: convertWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${convertWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: BULLHORN_ENDPOINTS.CANDIDATE,
            Id: lead.integration_id,
            status: body.status,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.candidate_map;
        break;
      case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT:
        // * Disqualify using lead logic
        config = {
          method: convertWebhookEndpoint.http_method,
          url: convertWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${convertWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: BULLHORN_ENDPOINTS.CONTACT,
            Id: lead.integration_id,
            status: body.status,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.contact_map;
        break;
      case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD:
        // * Convert using lead logic
        config = {
          method: convertWebhookEndpoint.http_method,
          url: convertWebhookEndpoint.url,
          headers: {
            Authorization: `Bearer ${convertWebhookEndpoint.auth_token}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            type: BULLHORN_ENDPOINTS.LEAD,
            Id: lead.integration_id,
            status: body.status,
          }),
        };
        await axios(config);
        [integrationFieldMap, errForIntegrationFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: lead.user_id,
          });
        integrationFieldMap = integrationFieldMap.lead_map;
        break;
      default:
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Cannot convert this lead',
        });
    }
    // Score the lead
    let [leadScore, errForLeadScore] = await LeadScoreHelper.updateLeadScore({
      lead,
      rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
      current_status: body.status,
      previous_status,
      field_map: integrationFieldMap,
    });
    if (errForLeadScore)
      logger.error(
        'An error occured while scoring lead during status update ',
        errForLeadScore
      );
    return successResponse(res, 'Successfully converted lead');
  } catch (err) {
    if (err?.response?.data) {
      logger.error(
        `An error occurred while attempting to convert lead: ${JSON.stringify(
          err?.response?.data
        )}`,
        {
          user_id: req.user.user_id,
        }
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to convert lead, please check convert webhook endpoint or contact support',
        error: `Error from CRM: ${JSON.stringify(err?.response?.data)}`,
      });
    }

    logger.error('An error occurred while attempting to convert lead: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Unable to convert lead, please check convert webhook endpoint or contact support',
      error: `Error while converting lead: ${err.message}`,
    });
  }
};

// * Delete leads
const deleteLeads = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Validation
    let body = leadSchema.deleteLeadsSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    body = body.value;
    if (body.option === BULK_OPTIONS.ALL) {
      body.lead_ids = [];
      body.account_ids = [];

      const [fetchLeadsInCadence, errForFetchingLeadsInCadence] =
        await Repository.fetchAll({
          tableName: DB_TABLES.LEADTOCADENCE,
          query: {
            cadence_id: body.cadence_id,
          },
          include: {
            [DB_TABLES.LEAD]: {
              where: {
                company_id: req.user.company_id,
              },
              required: true,
            },
          },
        });

      if (errForFetchingLeadsInCadence)
        logger.error(
          'Err for fetching leads from cadence',
          errForFetchingLeadsInCadence
        );

      fetchLeadsInCadence.forEach((element) => {
        body.lead_ids.push(element.lead_id);
        body.account_ids.push(element?.Leads?.[0]?.account_id);
      });
    } else {
      // * Ensure all leads exist in the same company
      let [leads, errFetchingLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          lead_id: {
            [Op.in]: body.lead_ids,
          },
          company_id: req.user.company_id,
        },
        extras: {
          attributes: ['lead_id', 'account_id'],
        },
      });
      if (errFetchingLeads) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete leads',
          error: errFetchingLeads,
        });
      }

      body.lead_ids = [];
      body.account_ids = [];
      leads.forEach((element) => {
        body.lead_ids.push(element.lead_id);
        body.account_ids.push(element.account_id);
      });
    }

    let leadCadences, errForleadCadences;
    if (body.cadence_option === CADENCE_OPTIONS.ALL) {
      if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS) {
        [leadCadences, errForleadCadences] =
          await CadenceHelper.getCadencesOfLeads({
            lead_ids: body.lead_ids,
          });
        if (errForleadCadences)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete leads',
            error: `Error while fetching cadences of leads: ${errForleadCadences}`,
          });
      }

      if (req.user.integration_type === CRM_INTEGRATIONS.SALESFORCE) {
        // * If Salesforce. Fetch integration_ids of all leads along with integration_type.
        let [salesforceLeads, errFetchingSalesforceLeads] =
          await Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: {
                [Op.in]: body.lead_ids,
              },
              company_id: req.user.company_id,
            },
            extras: {
              attributes: ['integration_id', 'integration_type'],
            },
          });
        if (errFetchingSalesforceLeads) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete leads',
            error: errFetchingSalesforceLeads,
          });
        }

        // * Fetch salesforce tokens from CRM Admin
        const [{ access_token, instance_url }, errFetchingAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (errFetchingAccessToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please login with Salesforce',
            error: errFetchingAccessToken,
          });
        }

        for (let salesforceLead of salesforceLeads) {
          if (
            salesforceLead.integration_type ===
            LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD
          )
            SalesforceService.updateLead(
              salesforceLead.integration_id,
              {
                RingoverCadence__Has_Active_Cadence__c: false,
              },
              access_token,
              instance_url
            );
          else if (
            salesforceLead.integration_type ===
            LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT
          )
            SalesforceService.updateContact(
              salesforceLead.integration_id,
              {
                RingoverCadence__Has_Active_Cadence__c: false,
              },
              access_token,
              instance_url
            );
        }
      }

      const [deletedAllLeadInfo, errForDeletedAllLeadInfo] =
        await LeadHelper.deleteAllLeadInfo({
          leadIds: body.lead_ids,
          accountIds: body.account_ids,
          t,
        });
      if (errForDeletedAllLeadInfo) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete leads',
          error: `Error while deleting all leads info: ${errForDeletedAllLeadInfo}`,
        });
      }
    } else if (body.cadence_option === CADENCE_OPTIONS.SELECTED) {
      if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS) {
        const [cadence, errForCadence] = await Repository.fetchOne({
          tableName: DB_TABLES.CADENCE,
          query: {
            cadence_id: body.cadence_id,
          },
        });
        if (errForCadence)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete leads',
            error: `Error while fetching cadence: ${errForCadence}`,
          });
        leadCadences = [cadence];
      }
      const [deletedLeads, errDeletingLeads] =
        await LeadHelper.deleteCadenceLeadInfo(body.lead_ids, body.cadence_id);
      if (errDeletingLeads) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete leads',
          error: `Error while deleting all leads info: ${errDeletingLeads}`,
        });
      }
      const [danglingLeads, errForDanglingLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          lead_id: {
            [Op.in]: body.lead_ids,
          },
          $and: sequelize.literal(
            `NOT EXISTS (SELECT lead_id FROM lead_to_cadence WHERE lead.lead_id = lead_to_cadence.lead_id)`
          ),
        },
      });

      if (req.user.integration_type === CRM_INTEGRATIONS.SALESFORCE) {
        // * Fetch salesforce tokens from CRM Admin
        const [{ access_token, instance_url }, errFetchingAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (errFetchingAccessToken) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please login with Salesforce',
            error: errFetchingAccessToken,
          });
        }

        for (let salesforceLead of danglingLeads) {
          if (
            salesforceLead.integration_type ===
            LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD
          )
            SalesforceService.updateLead(
              salesforceLead.integration_id,
              {
                RingoverCadence__Has_Active_Cadence__c: false,
              },
              access_token,
              instance_url
            );
          else if (
            salesforceLead.integration_type ===
            LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT
          )
            SalesforceService.updateContact(
              salesforceLead.integration_id,
              {
                RingoverCadence__Has_Active_Cadence__c: false,
              },
              access_token,
              instance_url
            );
        }
      }

      let leadIdsToDelete = [];
      let accountIdsToDelete = [];
      danglingLeads.map((lead) => {
        leadIdsToDelete.push(lead.lead_id);
        accountIdsToDelete.push(lead.account_id);
      });

      if (danglingLeads.length > 0) {
        const [deletedAllLeadInfo, errForDeletedAllLeadInfo] =
          await LeadHelper.deleteAllLeadInfo({
            leadIds: leadIdsToDelete,
            accountIds: accountIdsToDelete,
            t,
          });
        if (errForDeletedAllLeadInfo) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete leads',
            error: `Error while deleting all leads info: ${errForDeletedAllLeadInfo}`,
          });
        }
      }
    }
    t.commit();

    successResponse(
      res,
      req.user.integration_type === CRM_INTEGRATIONS.GOOGLE_SHEETS
        ? 'Deleted all leads successfully from cadence, leads will be deleted from google sheets after some time.'
        : 'Deleted all leads successfully.'
    );
    if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS) {
      //fetch google sheets lead field map

      const sheetsDeletePromises = leadCadences.map((cadence) => {
        if (cadence.integration_type === SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS)
          return GoogleSheetsHelper.bulkLeadDeleteByCadence({
            cadence,
            lead_ids: body.lead_ids,
          });
      });

      let [leadsInCadence, errForLeadsInCadence] = await Repository.count({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { cadence_id: body.cadence_id },
      });
      if (errForLeadsInCadence)
        logger.error(
          'Error while fetching lead to cadnce',
          errForLeadsInCadence
        );

      if (!leadsInCadence) {
        let [updateCadenceType, errForCadenceType] = await Repository.update({
          tableName: DB_TABLES.CADENCE,
          query: { cadence_id: body.cadence_id },
          updateObject: { integration_type: null },
        });
        if (errForCadenceType)
          logger.error('Error while updating cadence type', errForCadenceType);
      }

      const [cadence, errForCadence] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: body.cadence_id,
        },
      });
      if (errForCadence) logger.error('Failed to fetch cadence', errForCadence);
      if (
        cadence?.integration_type === SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS
      ) {
        const settledPromises = await Promise.allSettled(sheetsDeletePromises);
        for (let settledPromise of settledPromises) {
          if (settledPromise.status == 'rejected')
            logger.error('lead deletion failed :', settledPromise.reason);
          else {
            const [cadence, _] = settledPromise?.value;
            if (cadence)
              logger.info(
                `google sheet ${cadence.salesforce_cadence_id} updated successfully`
              );
          }
        }
      }
    }
    //TODO: If Salesforce. Update all deleted leads in salesforce to - Lead Active = false
  } catch (err) {
    t.rollback();
    logger.error(`Error while deleting leads: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting leads: ${err.message}`,
    });
  }
};

// * Integration status update
const updateLeadIntegrationStatus = async (req, res) => {
  try {
    // * Validation
    let body = leadSchema.updateIntegrationStatus.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // * Fetch lead from database
    let [lead, errFetchingLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id: req.params.lead_id,
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'timezone',
            'company_id',
            'integration_type',
            'email',
          ],
        },
      },
      extras: {
        attributes: [
          'lead_id',
          'integration_type',
          'integration_id',
          'user_id',
          'lead_score',
          'lead_warmth',
          'integration_type',
          'integration_status',
        ],
      },
    });

    let previous_status = lead?.integration_status;
    if (errFetchingLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update integration status',
        error: `Error while fetching lead: ${errFetchingLead}`,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update integration status',
        error: 'Lead not found',
      });

    // * Handle different leads
    switch (lead.integration_type) {
      case LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT: {
        // * Fetch access token
        const [{ instance_url, access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return successResponse(
            res,
            'Please sign in with salesforce to update lead status.'
          );

        // * Fetch hubspot field map
        let [companyFieldMap, errFetchingCompanyFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingCompanyFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: errFetchingCompanyFieldMap,
          });

        let contact_map = companyFieldMap.contact_map;

        if (!contact_map?.integration_status?.name)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please set integration status in field map',
          });

        let statusUpdate = {};
        statusUpdate[contact_map?.integration_status?.name] = body.status;

        let [_, errUpdatingContact] =
          await v2GrpcClients.crmIntegration.updateContact({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            integration_data: {
              sfContactId: lead.integration_id,
              contact: statusUpdate,
              access_token,
              instance_url,
            },
          });
        if (errUpdatingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: errUpdatingContact,
          });

        break;
      }
      case LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT: {
        // * Fetch access token
        const [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return successResponse(
            res,
            'Please sign in with hubspot to update lead status.'
          );

        // * Fetch hubspot field map
        let [hubspotFieldMap, errFetchingHubspotFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingHubspotFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while fetching Salesforce fieldmap: ${errFetchingHubspotFieldMap}`,
          });

        let hubspotContactMap = hubspotFieldMap.contact_map;

        if (!hubspotContactMap?.integration_status?.name)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please set integration status in field map',
          });

        let statusUpdate = {};
        statusUpdate[hubspotContactMap?.integration_status?.name] = body.status;

        let [_, errUpdatingContactHubspot] =
          await v2GrpcClients.crmIntegration.updateContact({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            integration_data: {
              contact_id: lead.integration_id,
              data: statusUpdate,
              access_token,
            },
          });
        if (errUpdatingContactHubspot)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating contact: ${errUpdatingContactHubspot}`,
          });

        // * Lead has been disqualified
        if (
          body.status ===
            hubspotContactMap?.integration_status?.disqualified?.value &&
          hubspotContactMap?.integration_status?.disqualified?.value !==
            undefined
        ) {
          // * Mark lead_status as trash
          await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: lead.lead_id },
            updateObject: {
              status: LEAD_STATUS.TRASH,
              integration_status: body.status,
            },
          });
          await Repository.create({
            tableName: DB_TABLES.STATUS,
            createObject: {
              lead_id: lead.lead_id,
              status: LEAD_STATUS.TRASH,
            },
          });

          // * Stopping all tasks for lead
          await Repository.update({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: { lead_id: lead.lead_id },
            updateObject: {
              status: CADENCE_LEAD_STATUS.STOPPED,
            },
          });

          //get present date as per timezone
          const today = new Date().toLocaleDateString('en-GB', {
            timeZone: lead.User.timezone,
          });

          // * Generate acitvity
          const [activityFromTemplate, errForActivityFromTemplate] =
            ActivityHelper.getActivityFromTemplates({
              type: ACTIVITY_TYPE.LEAD_DISQUALIFIED,
              variables: {
                today,
              },
              activity: {
                lead_id: lead.lead_id,
                incoming: null,
              },
            });

          ActivityHelper.activityCreation(activityFromTemplate, lead.user_id);
          TaskHelper.recalculateDailyTasksForUsers([lead.user_id]);

          // Lead Score
          let [leadScore, errForLeadScore] =
            await LeadScoreHelper.updateLeadScore({
              lead,
              rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
              current_status: body.status,
              previous_status,
              field_map: hubspotContactMap,
            });
          if (errForLeadScore)
            logger.error(
              'An error occured while scoring lead during status update ',
              errForLeadScore
            );
        }

        // * Lead has been converted
        else if (
          body.status ===
            hubspotContactMap?.integration_status?.converted?.value &&
          hubspotContactMap?.integration_status?.converted?.value !== undefined
        ) {
          // * Update lead status
          await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: lead.lead_id },
            updateObject: {
              status: LEAD_STATUS.CONVERTED,
              integration_status: body.status,
            },
          });

          await Repository.create({
            tableName: DB_TABLES.STATUS,
            createObject: {
              lead_id: lead.lead_id,
              status: LEAD_STATUS.CONVERTED,
            },
          });

          await Repository.update({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: { lead_id: lead.lead_id },
            updateObject: {
              status: CADENCE_LEAD_STATUS.STOPPED,
            },
          });

          //get present date as per timezone
          const today = new Date().toLocaleDateString('en-GB', {
            timeZone: lead.User.timezone,
          });

          const [activityFromTemplate, errForActivityFromTemplate] =
            ActivityHelper.getActivityFromTemplates({
              type: ACTIVITY_TYPE.LEAD_CONVERTED,
              variables: {
                today,
              },
              activity: {
                lead_id: lead.lead_id,
                incoming: null,
              },
            });

          ActivityHelper.activityCreation(activityFromTemplate, lead.user_id);
          TaskHelper.recalculateDailyTasksForUsers([lead.user_id]);
          // ResetLead Score
          let [leadScore, errForLeadScore] =
            await LeadScoreHelper.updateLeadScore({
              lead,
              rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
              current_status: body.status,
              previous_status,
              resetScore: true,
            });
          if (errForLeadScore)
            logger.error(
              'An error occured while scoring lead during status update ',
              errForLeadScore
            );
        } else {
          // Update Lead Integration Status
          let [updatedLead, errForUpdatedLead] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: { lead_id: lead.lead_id },
            updateObject: {
              integration_status: body.status,
            },
          });

          if (errForUpdatedLead) {
            logger.error(
              'Error while updating lead integration status',
              errForUpdatedLead
            );
          }

          // Increase the lead score
          let [leadScore, errForLeadScore] =
            await LeadScoreHelper.updateLeadScore({
              lead,
              rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
              current_status: body.status,
              previous_status,
              field_map: hubspotContactMap,
            });
          if (errForLeadScore)
            logger.error(
              'An error occured while scoring lead during status update ',
              errForLeadScore
            );
        }

        break;
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT: {
        // * Fetch access token
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please sign in with bullhorn to update lead status.',
            error: `Error while fetching bullhorn access token: ${errForAccessToken}`,
          });

        // * Fetch hubspot field map
        let [bullhornFieldMap, errFetchingBullhornFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingBullhornFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while fetching bullhorn fieldmap: ${errFetchingBullhornFieldMap}`,
          });

        let fieldMap = bullhornFieldMap.contact_map;

        if (!fieldMap?.integration_status?.name)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please set integration status in field map',
          });

        let statusUpdate = {};
        statusUpdate[fieldMap?.integration_status?.name] = body.status;

        let [_, errUpdatingContactBullhorn] =
          await v2GrpcClients.hiringIntegration.updateContact({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              contact_id: lead.integration_id,
              contact: statusUpdate,
              access_token,
              instance_url,
            },
          });
        if (errUpdatingContactBullhorn)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating contact: ${errUpdatingContactBullhorn}`,
          });
        let [leadIntegrationStatusUpdate, errForLeadIntegrationStatus] =
          await LeadHelper.leadIntegrationStatusHelper({
            fieldMap,
            lead,
            body,
            previous_status,
          });
        if (errForLeadIntegrationStatus)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating integration status: ${errForLeadIntegrationStatus}`,
          });
        break;
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE: {
        // * Fetch access token
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please sign in with bullhorn to update lead status.',
            error: `Error while fetching bullhorn access token: ${errForAccessToken}`,
          });

        // * Fetch hubspot field map
        let [bullhornFieldMap, errFetchingBullhornFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingBullhornFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while fetching bullhorn fieldmap: ${errFetchingBullhornFieldMap}`,
          });

        let fieldMap = bullhornFieldMap.candidate_map;

        if (!fieldMap?.integration_status?.name)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please set integration status in field map',
          });

        let statusUpdate = {};
        statusUpdate[fieldMap?.integration_status?.name] = body.status;

        let [_, errUpdatingCandidateBullhorn] =
          await v2GrpcClients.hiringIntegration.updateCandidate({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              candidate_id: lead.integration_id,
              candidate: statusUpdate,
              access_token,
              instance_url,
            },
          });
        if (errUpdatingCandidateBullhorn)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating candidate: ${errUpdatingCandidateBullhorn}`,
          });
        let [leadIntegrationStatusUpdate, errForLeadIntegrationStatus] =
          await LeadHelper.leadIntegrationStatusHelper({
            fieldMap,
            lead,
            body,
            previous_status,
          });
        if (errForLeadIntegrationStatus)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating integration status: ${errForLeadIntegrationStatus}`,
          });

        break;
      }
      case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD: {
        // * Fetch access token
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please sign in with bullhorn to update lead status.',
            error: `Error while fetching bullhorn access token: ${errForAccessToken}`,
          });

        // * Fetch hubspot field map
        let [bullhornFieldMap, errFetchingBullhornFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingBullhornFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while fetching bullhorn fieldmap: ${errFetchingBullhornFieldMap}`,
          });

        let fieldMap = bullhornFieldMap.lead_map;

        if (!fieldMap?.integration_status?.name)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please set integration status in field map',
          });

        let statusUpdate = {};
        statusUpdate[fieldMap?.integration_status?.name] = body.status;
        let [_, errUpdatingLeadBullhorn] =
          await v2GrpcClients.hiringIntegration.updateLead({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              lead_id: lead.integration_id,
              lead: statusUpdate,
              access_token,
              instance_url,
            },
          });
        if (errUpdatingLeadBullhorn)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating lead: ${errUpdatingLeadBullhorn}`,
          });

        let [leadIntegrationStatusUpdate, errForLeadIntegrationStatus] =
          await LeadHelper.leadIntegrationStatusHelper({
            fieldMap,
            lead,
            body,
            previous_status,
          });
        if (errForLeadIntegrationStatus)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating integration status: ${errForLeadIntegrationStatus}`,
          });
        break;
      }
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Invalid integration type. Please try again later or contact support',
        });
    }
    return successResponse(res, 'Status updated successfully');
  } catch (err) {
    logger.error(`Error while updating lead integration status: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating lead integration status: ${err.message}`,
    });
  }
};

const updateAccountIntegrationStatus = async (req, res) => {
  try {
    // * Validation
    let body = leadSchema.updateIntegrationStatus.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // * Fetch account from database
    let [account, errFetchingAccount] = await Repository.fetchOne({
      tableName: DB_TABLES.ACCOUNT,
      query: {
        account_id: req.params.account_id,
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'timezone',
            'company_id',
            'integration_type',
            'email',
          ],
        },
      },
    });

    if (errFetchingAccount)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update integration status',
        error: `Error while fetching account: ${errFetchingAccount}`,
      });
    if (!account)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update integration status',
        error: 'Account not found',
      });
    let previous_status = account?.integration_status;

    // * Handle different leads
    switch (account.integration_type) {
      case ACCOUNT_INTEGRATION_TYPES.BULLHORN_ACCOUNT: {
        // * Fetch access token
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            user_id: req.user.user_id,
          });
        if (errForAccessToken)
          return successResponse(
            res,
            'Please sign in with bullhorn to update account status.'
          );

        // * Fetch bullhorn field map
        let [bullhornFieldMap, errFetchingBullhornFieldMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: req.user.user_id,
          });
        if (errFetchingBullhornFieldMap)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while fetching bullhorn fieldmap: ${errFetchingBullhornFieldMap}`,
          });

        let fieldMap = bullhornFieldMap.account_map;

        if (!fieldMap?.integration_status?.name)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please set integration status in field map',
          });

        let statusUpdate = {};
        statusUpdate[fieldMap?.integration_status?.name] = body.status;

        let [_, errUpdatingAccountBullhorn] =
          await v2GrpcClients.hiringIntegration.updateAccount({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              corporation_id: account.integration_id,
              corporation: statusUpdate,
              access_token,
              instance_url,
            },
          });
        if (errUpdatingAccountBullhorn)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update integration status',
            error: `Error while updating account: ${errUpdatingAccountBullhorn}`,
          });

        break;
      }
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Invalid integration type. Please try again later or contact support',
        });
    }
    return successResponse(res, 'Status updated successfully');
  } catch (err) {
    logger.error(`Error while updating lead integration status: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating lead integration status: ${err.message}`,
    });
  }
};

const removeHotLeadStatus = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { lead_id } = req.params;

    // Get original lead score
    let [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      extras: {
        attributes: ['lead_score'],
      },
      t,
    });

    //Reset Lead Score and Warmth
    let [updatedLead, errForUpdatedLead] = await Repository.update({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      updateObject: {
        lead_score: 0,
        lead_warmth: LEAD_WARMTH.COLD,
        reset_period: null,
      },
    });

    if (errForUpdatedLead) {
      t.rollback();
      logger.error(
        `Error while updating lead score status: `,
        errForUpdatedLead
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to remove hot lead status',
        error: `Error while updating lead: ${errForUpdatedLead}`,
      });
    }

    const [leadResetReason, errForLeadResetReason] = await Repository.create({
      tableName: DB_TABLES.LEAD_SCORE_REASONS,
      createObject: {
        lead_id: lead_id,
        reason: LEAD_SCORE_RUBRIKS.MANUAL_RESET,
        lead_warmth: LEAD_WARMTH.COLD,
        has_warmth_changed: true,
        score_delta: lead?.lead_score,
      },
    });

    if (errForLeadResetReason)
      logger.error(
        'An error occured while adding reason for lead score reset',
        errForLeadResetReason
      );

    t.commit();
    return successResponse(res, 'Successfully reset lead status');
  } catch (err) {
    t.rollback();
    logger.error(`Error while removing hot lead status: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while removing hot lead status: ${err.message}`,
    });
  }
};

const getLeadScoreReasonsForLead = async (req, res) => {
  try {
    const { lead_id } = req.params;
    const { limit, offset } = req.query;

    // fetch lead score reasons
    const [leadScoreReasons, errForLeadScoreReasons] =
      await Repository.fetchAll({
        tableName: DB_TABLES.LEAD_SCORE_REASONS,
        query: {
          lead_id,
        },
        include: {
          [DB_TABLES.ACTIVITY]: {},
        },
        extras: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          order: [['created_at', 'DESC']],
        },
      });
    if (errForLeadScoreReasons) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Could not fetch lead score reasons, please try again later',
        error: errForLeadScoreReasons,
      });
    }
    logger.info('Successfully fetched lead score reasons for lead: ', lead_id);

    return successResponse(
      res,
      `Successfully fetched lead score reasons for lead: ${lead_id}`,
      leadScoreReasons
    );
  } catch (err) {
    logger.error('An error occured while fetching lead score reasons for lead');
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Could not fetch lead score reasons, please try again later',
      error: err?.message,
    });
  }
};

const getLeadScore = async (req, res) => {
  try {
    const { lead_id } = req.params;
    const [leadScore, errForLeadScore] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      extras: {
        attributes: ['lead_score'],
      },
    });
    if (errForLeadScore) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Could not fetch lead score, please try again later',
        error: errForLeadScore,
      });
    }
    logger.info('Successfully fetched lead score for lead: ', lead_id);
    return successResponse(
      res,
      `Successfully fetched lead score for lead: ${lead_id}`,
      leadScore
    );
  } catch (err) {
    logger.error('An error occured while fetching lead score for lead: ');
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Could not fetch lead score, please try again later',
      error: err?.message,
    });
  }
};

const sendWhatsappMessageToLead = async (req, res) => {
  try {
    let [lead, errForFetchingLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id: req.body.lead_id },
    });
    if (errForFetchingLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to track whatsapp message',
        error: `Error while fetching lead: ${errForFetchingLead}`,
      });
    let [activity, errForActivity] =
      await ActivityHelper.createWhatsappActivity({
        lead: lead,
        cadence_id: null,
        type: ACTIVITY_TYPE.WHATSAPP,
        node_id: null,
        message: req.body.message,
      });
    if (errForActivity) {
      logger.error(`Error while creating activity:`, errForActivity);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create whatsapp activity',
        error: `Error while creating whatsapp activity: ${errForActivity}`,
      });
    }

    if (activity) {
      logger.info('Created activity' + JSON.stringify(activity));
      logToIntegration.logWhatsappToIntegration({
        lead_id: req.body.lead_id,
        activity,
      });
    }
    return successResponse(res, 'Whatsapp activity created successfully');
  } catch (err) {
    logger.error('Error while creating whatsapp activity:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating whatsapp activity: ${err.message}`,
    });
  }
};

const getLeadAddresses = async (req, res) => {
  try {
    const { account_id, integration_type } = req.query;
    let accountAddresses, errForAccountAddresses;
    switch (integration_type) {
      case CRM_INTEGRATIONS.SELLSY:
        const [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            user_id: req.user.user_id,
          });
        if (errForAccessToken) {
          if (errForAccessToken === 'Kindly log in with sellsy.')
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Please connect with sellsy',
              error: `Error while fetching sellsy access token: ${errForAccessToken}`,
            });

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead addresses',
            error: `Error while fetching sellsy access token: ${errForAccessToken}`,
          });
        }

        [accountAddresses, errForAccountAddresses] =
          await v2GrpcClients.crmIntegration.getAccount({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: {
              access_token,
              company_id: account_id,
              isAddresses: true,
            },
          });
        if (errForAccountAddresses)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead addresses',
            error: `Error while fetching lead addresses from sellsy: ${errForAccountAddresses}`,
          });
        break;
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch lead addresses',
          error: 'Invalid CRM integration type',
        });
    }
    return successResponse(
      res,
      'Account addresses fetched successfully',
      accountAddresses
    );
  } catch (err) {
    logger.error('Error while fetching lead addresses:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead addresses: ${err.message}`,
    });
  }
};

const getLeadFieldMap = async (req, res) => {
  try {
    const integration_type = req.user.integration_type;

    let fieldMapTable;
    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        fieldMapTable = DB_TABLES.SALESFORCE_FIELD_MAP;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        fieldMapTable = DB_TABLES.PIPEDRIVE_FIELD_MAP;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        fieldMapTable = DB_TABLES.HUBSPOT_FIELD_MAP;
        break;
      case CRM_INTEGRATIONS.GOOGLE_SHEETS:
        fieldMapTable = DB_TABLES.GOOGLE_SHEETS_FIELD_MAP;
        break;
      case CRM_INTEGRATIONS.EXCEL:
        fieldMapTable = DB_TABLES.EXCEL_FIELD_MAP;
        break;
      case CRM_INTEGRATIONS.ZOHO:
        fieldMapTable = DB_TABLES.ZOHO_FIELD_MAP;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        fieldMapTable = DB_TABLES.SELLSY_FIELD_MAP;
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        fieldMapTable = DB_TABLES.BULLHORN_FIELD_MAP;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        fieldMapTable = DB_TABLES.DYNAMICS_FIELD_MAP;
        break;
      default: {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch lead field map',
          error: 'Invalid integration type',
        });
      }
    }

    const [fieldMap, errForFieldMap] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.user.company_id },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [fieldMapTable]: {},
          [DB_TABLES.WEBHOOK]: {},
        },
      },
      extras: {
        attributes: ['name', 'company_id'],
      },
    });
    if (errForFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead field map',
        error: `Error while fetching lead field map: ${errForFieldMap}`,
      });

    return successResponse(
      res,
      `Successfully fetched lead field map`,
      fieldMap
    );
  } catch (err) {
    logger.error('Error while fetching lead field map:', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead field map: ${err.message}`,
    });
  }
};

// * Run custom action - trigger webhook
const executeWebhook = async (req, res) => {
  try {
    // * Validation
    let body = leadSchema.executeWebhookLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // * Fetch lead of company
    const [lead, errFetchingLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id: body.lead_id,
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name', 'integration_type', 'integration_id'],
        },
        [DB_TABLES.USER]: {
          required: true,
        },
      },
      extras: {
        attributes: [
          'lead_id',
          'integration_type',
          'integration_id',
          'lead_warmth',
          'lead_score',
          'integration_status',
        ],
      },
    });
    if (errFetchingLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead status via webhook',
        error: errFetchingLead,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update lead status via webhook',
        error: 'Lead not found',
      });

    // * Fetch custom webhook
    const [company, errFetchingWebhook] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.WEBHOOK]: {
            where: {
              webhook_type: WEBHOOK_TYPE.CUSTOM,
              object_type: body.model_type,
              integration_status: body.integration_status,
            },
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errFetchingWebhook)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead status via webhook',
        error: errFetchingWebhook,
      });

    if (!company?.Company_Setting?.Webhooks.length)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Webhook for this action is not set',
      });

    let webhookEndpoint = company?.Company_Setting?.Webhooks[0];

    console.log('Log for debug: ', {
      method: webhookEndpoint.http_method,
      url: webhookEndpoint.url,
      headers: {
        Authorization: `Bearer ${webhookEndpoint.auth_token}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        type: webhookEndpoint.object_type,
        Id: lead.integration_id,
        AccountId: lead?.Account?.integration_id,
        status: body.integration_status.value,
        reason: body.reason,
      }),
    });
    // * Execute webhook
    config = {
      method: webhookEndpoint.http_method,
      url: webhookEndpoint.url,
      headers: {
        Authorization: `Bearer ${webhookEndpoint.auth_token}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        type: webhookEndpoint.object_type,
        Id: lead.integration_id,
        AccountId: lead?.Account?.integration_id,
        status: body.integration_status.value,
        reason: body.reason,
      }),
    };
    await axios(config);

    return successResponse(res, 'Successfully updated lead status');
  } catch (err) {
    if (err?.response?.data) {
      logger.error(
        `An error occurred while attempting to update lead status via webhook: ${JSON.stringify(
          err?.response?.data
        )}`,
        { user_id: req.user.user_id }
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to update lead status, please check webhook endpoint or contact support',
        error: `Error from CRM: ${JSON.stringify(err?.response?.data)}`,
      });
    }

    logger.error(
      'An error occurred while attempting to update lead status via webhook: ',
      { err, user_id: req.user.user_id }
    );

    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Unable to update lead status, please check webhook endpoint or contact support',
      error: err.message,
    });
  }
};

// * fetch all resume of lead
const getLeadResume = async (req, res) => {
  try {
    // * Validation
    let body = leadSchema.getLeadResume.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    const { id, type } = body;

    if (type !== LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Resume is not supported for this lead',
      });
    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (
        errForAccessToken.toLowerCase().includes('kindly sign in') ||
        errForAccessToken.toLowerCase().includes('Kindly log in')
      ) {
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with ${HIRING_INTEGRATIONS.BULLHORN}`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }
    let [resumes, errFetchingResume] =
      await v2GrpcClients.hiringIntegration.getAllResumeOfCandidate({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        integration_data: {
          candidate_id: id,
          access_token,
          instance_url,
        },
      });
    if (errFetchingResume)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching resume: ${errFetchingResume}`,
        msg: 'Failed to fetch resume',
      });

    return successResponse(res, 'Successfully fetched resume', resumes);
  } catch (err) {
    logger.error('An error occurred while attempting to fetch resume: ', {
      err,
      user_id: req.user.user_id,
    });

    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Unable to fetch resume',
      error: err.message,
    });
  }
};

// * parse the resume of lead
const parseResume = async (req, res) => {
  try {
    // * Validation
    let body = leadSchema.parseResume.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    const { id, type, resume_id } = body;

    if (type !== LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Resume is not supported for this lead',
      });
    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (
        errForAccessToken.toLowerCase().includes('kindly sign in') ||
        errForAccessToken.toLowerCase().includes('Kindly log in')
      ) {
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with ${HIRING_INTEGRATIONS.BULLHORN}`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }
    let [resumes, errFetchingResume] =
      await v2GrpcClients.hiringIntegration.parseResume({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        integration_data: {
          candidate_id: id,
          resume_id,
          access_token,
          instance_url,
        },
      });
    if (errFetchingResume)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while parsing resume: ${errFetchingResume}`,
        msg: 'Failed to parse resume',
      });

    return successResponse(res, 'Successfully fetched resume', resumes);
  } catch (err) {
    logger.error('An error occurred while attempting to parse resume: ', {
      err,
      user_id: req.user.user_id,
    });

    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Unable to parse resume',
      error: err.message,
    });
  }
};

const LeadController = {
  getLeadInfo,
  updateLeadAndAccountDetailsNew,
  getLeadsListViewForUser,
  getLeadToCadenceLinksForLead,
  getLeadsCountForUser,
  fetchLeadsForDropdown,
  enrichLeadWithLusha,
  enrichLeadWithKaspr,
  enrichLeadWithHunter,
  enrichLeadWithDropcontact,
  enrichLeadWithSnov,
  getRelatedLeads,
  getLeadInfoFromCRM,
  getLeadDuplicates,
  disqualifyLead,
  convertLead,
  reassign,
  deleteLeads,
  updateLeadIntegrationStatus,
  removeHotLeadStatus,
  getLeadScoreReasonsForLead,
  getLeadScore,
  sendWhatsappMessageToLead,
  getLeadAddresses,
  getLeadActivities,
  getLeadCadences,
  getLeadFieldMap,
  executeWebhook,
  updateAccountIntegrationStatus,
  getLeadResume,
  parseResume,
};

module.exports = LeadController;
