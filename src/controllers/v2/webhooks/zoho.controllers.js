const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  LEAD_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  USER_INTEGRATION_TYPES,
  WORKFLOW_TRIGGERS,
  ACTIVITY_TYPE,
  CADENCE_LEAD_STATUS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../Cadence-Brain/src/utils/constants');
const { SERVER_URL } = require('../../../../../Cadence-Brain/src/utils/config');

// Packages
const { Op } = require('sequelize');
const axios = require('axios');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const ActivityHelper = require('../../../../../Cadence-Brain/src/helper/activity');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const WorkflowHelper = require('../../../../../Cadence-Brain/src/helper/workflow');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');
const LeadToCadenceRepository = require('../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const JsonHelper = require('../../../../../Cadence-Brain/src/helper/json');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const PhoneNumberHelper = require('../../../../../Cadence-Brain/src/helper/phone-number');
const deleteAllLeadInfo = require('../../../../../Cadence-Brain/src/helper/lead/deleteAllLeadInfo');
const LeadEmailHelper = require('../../../../../Cadence-Brain/src/helper/email');

// GRPC
const v2GrpcClients = require('../../../../../Cadence-Brain/src/grpc/v2');

const updateZohoContact = async (req, res) => {
  try {
    axios.post(`${SERVER_URL}/webhook/v1/zoho/contact`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Contact updated successfully`);
    const [webhook, errForWebhook] = await Repository.fetchOne({
      tableName: DB_TABLES.ZOHO_WEBHOOK,
      query: {
        channel_id: req.body.channel_id,
      },
    });
    if (errForWebhook) {
      logger.error(`Error while fetching Zoho webhook: ${errForWebhook}`);
      return;
    }
    if (!webhook) {
      logger.info('webhook not found for this channel_id');
      return;
    }
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: webhook.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin) {
      logger.error(`Error while fetching company: ${errCrmAdmin}`);
      return;
    }

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId) return;

    switch (req.body.operation) {
      case 'update':
        // * Fetch access token  token and instance URL
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            user_id: crmAdminUserId,
          });
        if (errForAccessToken) {
          if (errForAccessToken === 'Please log in with zoho') return;
          logger.error(
            `Error while fetching tokens for zoho: ${errForAccessToken}.`
          );
          return;
        }
        let [zohoMap, errForZohoMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: crmAdminUserId,
          });
        if (errForZohoMap) {
          logger.error(
            `Error while fetching fieldmap for company from user: ${errForZohoMap}`
          );
          return;
        }

        let contactMap = zohoMap?.contact_map;
        let accountMap = zohoMap?.account_map;
        let ids = req.body.ids;

        for (let id of ids) {
          let contactToUpdate = {};
          const [lead, errForLead] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_type: LEAD_INTEGRATION_TYPES.ZOHO_CONTACT,
              company_id: webhook.company_id,
              integration_id: id,
            },
            include: {
              [DB_TABLES.USER]: {
                where: {
                  company_id: webhook.company_id,
                },
                required: true,
              },
              [DB_TABLES.ACCOUNT]: {},
            },
          });
          if (errForLead) {
            logger.error(`Error while updating Zoho contact: ${errForLead}`);
            return;
          }
          if (!lead) return;
          v2GrpcClients.advancedWorkflow.updateZohoContact({
            integration_data: {
              contact: {
                user_id: crmAdminUserId,
                company_id: webhook.company_id,
                contact_id: id,
              },
              fetched_lead_id: lead.lead_id,
            },
          });

          // * Fetch contact from zoho
          let [zohoContact, errFetchingZohoAccount] =
            await v2GrpcClients.crmIntegration.getContact({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                contact_id: id,
                access_token,
                instance_url,
              },
            });
          if (lead?.User?.integration_id !== zohoContact?.Owner?.id) {
            const oldOwner = lead.User;
            if (oldOwner === undefined) {
              logger.info('Error while finding old lead owner');
              continue;
            }

            // Fetching new owner
            const [newOwner, errForNewOwner] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                integration_id: zohoContact?.Owner?.id,
                company_id: webhook.company_id,
                integration_type: USER_INTEGRATION_TYPES.ZOHO_USER,
              },
            });
            if (errForNewOwner) {
              logger.info('Error while finding new lead owner');
              continue;
            }
            if (!newOwner) {
              logger.info('The new owner does not exist in the cadence tool.');
              await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
                {
                  lead_id: lead.lead_id,
                },
                {
                  status: CADENCE_LEAD_STATUS.STOPPED,
                }
              );

              const [activityFromTemplate, errForActivityFromTemplate] =
                ActivityHelper.getActivityFromTemplates({
                  type: ACTIVITY_TYPE.OWNER_CHANGE,
                  variables: {
                    crm: CRM_INTEGRATIONS.ZOHO,
                  },
                  activity: {
                    lead_id: lead.lead_id,
                    incoming: null,
                  },
                });
              await ActivityHelper.activityCreation(
                activityFromTemplate,
                lead.user_id
              );
            } else {
              const [workflow, errForWorkflow] =
                await WorkflowHelper.applyWorkflow({
                  trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
                  lead_id: lead.lead_id,
                  extras: {
                    crm: CRM_INTEGRATIONS.ZOHO,
                    integration_id: newOwner.integration_id,
                    new_user_id: newOwner.user_id,
                    oldOwnerSdId: oldOwner.sd_id,
                  },
                });
              if (!errForWorkflow)
                await TaskHelper.skipReplyTaskOwnerChange({
                  lead_id: lead.lead_id,
                  new_user_id: newOwner.user_id,
                  oldOwnerSdId: oldOwner.sd_id,
                });
            }
          }
          if (
            (!lead.account_id && zohoContact?.Account_Name?.id) ||
            (lead.account_id &&
              zohoContact?.Account_Name?.id &&
              lead?.Account.integration_id !== zohoContact?.Account_Name?.id)
          ) {
            logger.info('Account has been linked with the contact');

            // * Check if organization exists in database
            let [account, errForAccount] = await Repository.fetchOne({
              tableName: DB_TABLES.ACCOUNT,
              query: {
                integration_id: zohoContact.Account_Name.id,
                integration_type: ACCOUNT_INTEGRATION_TYPES.ZOHO_ACCOUNT,
                company_id: webhook.company_id,
              },
              include: {
                [DB_TABLES.USER]: {
                  where: { company_id: webhook.company_id },
                  required: true,
                },
              },
            });
            if (errForAccount) {
              logger.error(`Error while fetching account: ${errForAccount}`);
              return;
            }

            // * Account not found, Create account
            if (!account) {
              // * Fetch account from zoho
              let [zohoAccount, errFetchingOrganization] =
                await v2GrpcClients.crmIntegration.getAccount({
                  integration_type: CRM_INTEGRATIONS.ZOHO,
                  integration_data: {
                    account_id: zohoContact.Account_Name.id,
                    access_token,
                    instance_url,
                  },
                });

              [account, errForAccount] = await Repository.create({
                tableName: DB_TABLES.ACCOUNT,
                createObject: {
                  name: zohoAccount[accountMap.name],
                  size: zohoAccount[accountMap.size],
                  url: zohoAccount[accountMap.url],
                  country: zohoAccount[accountMap.country],
                  linkedin_url: zohoAccount[accountMap.linkedin_url],
                  integration_type: ACCOUNT_INTEGRATION_TYPES.ZOHO_ACCOUNT,
                  integration_id: zohoAccount.id,
                  zipcode: zohoAccount[accountMap.zipcode],
                  phone_number: zohoAccount[accountMap.phone_number],
                  user_id: lead.user_id,
                  company_id: webhook.company_id,
                },
              });
            }

            await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: lead.lead_id,
              },
              updateObject: {
                account_id: account.account_id,
              },
            });
          }

          // * If the lead has been unlinked with the company
          if (lead.account_id && !zohoContact?.Account_Name?.id) {
            logger.info('Lead has been unlinked with an account');
            await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: lead.lead_id,
              },
              updateObject: {
                account_id: null,
              },
            });
          }

          for (let key in contactMap) {
            if (
              !['emails', 'phone_numbers', 'size'].includes(key) &&
              zohoContact[contactMap[key]] !== lead[key]
            )
              contactToUpdate[key] = zohoContact[contactMap[key]];
            if (key == 'emails') {
              contactMap?.emails.forEach((email) => {
                if (zohoContact[email] === null) zohoContact[email] = '';
                LeadEmailHelper.updateEmail(
                  zohoContact[email],
                  email,
                  lead.lead_id
                );
              });
            }
            if (key == 'phone_numbers') {
              contactMap?.phone_numbers.forEach((phone) => {
                if (zohoContact[phone] === null) zohoContact[phone] = '';
                PhoneNumberHelper.updatePhoneNumber(
                  zohoContact[phone],
                  phone,
                  lead.lead_id
                );
              });
            }
          }
          if (Object.keys(contactToUpdate).length > 0) {
            contactToUpdate.full_name = `${
              zohoContact[contactMap?.first_name]
            } ${zohoContact[contactMap?.last_name]}`;
            const [updatedLead, errForUpdatedLead] = await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: lead.lead_id,
              },
              updateObject: contactToUpdate,
            });
            if (errForUpdatedLead) {
              logger.error(`Error while updating lead: ${errForUpdatedLead}`);
              return;
            }
          }
        }
        break;
      case 'delete':
        let deletedIds = req.body.ids;
        for (let lead_id of deletedIds) {
          const [fetchedLead, errForLead] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: lead_id,
              integration_type: LEAD_INTEGRATION_TYPES.ZOHO_CONTACT,
              company_id: webhook.company_id,
            },
          });
          if (errForLead) continue;
          if (!fetchedLead) continue;

          const [deletedLead, errForDeletedLead] = await deleteAllLeadInfo({
            leadIds: [fetchedLead.lead_id],
            accountIds: [fetchedLead?.account_id],
          });
        }
        break;

      case 'insert':
        let insertedIds = req.body.ids;
        for (let id of insertedIds) {
          v2GrpcClients.advancedWorkflow.addZohoContact({
            integration_data: {
              contact: {
                company_id: webhook.company_id,
                contact_id: id,
                user_id: crmAdminUserId,
              },
            },
          });
        }
        break;
    }

    return;
  } catch (err) {
    logger.error('Error while updating zoho contact: ', err);
    return;
  }
};
const updateZohoLead = async (req, res) => {
  try {
    axios.post(`${SERVER_URL}/webhook/v1/zoho/lead`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `lead updated successfully`);
    const [webhook, errForWebhook] = await Repository.fetchOne({
      tableName: DB_TABLES.ZOHO_WEBHOOK,
      query: {
        channel_id: req.body.channel_id,
      },
    });
    if (errForWebhook) {
      logger.error(`Error while fetching Zoho lead: ${errForWebhook}`);
      return;
    }
    if (!webhook) {
      logger.info('webhook not found for this channel_id');
      return;
    }
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: webhook.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin) {
      logger.error(`Error while fetching company: ${errCrmAdmin}`);
      return;
    }

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId) return;
    switch (req.body.operation) {
      case 'update':
        // * Fetch access token  token and instance URL
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            user_id: crmAdminUserId,
          });
        if (errForAccessToken) {
          if (errForAccessToken === 'Please log in with zoho') return;
          logger.error(
            `Error while fetching tokens for zoho: ${errForAccessToken}.`
          );
          return;
        }
        let [zohoMap, errForZohoMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: crmAdminUserId,
          });
        if (errForZohoMap) {
          logger.error(
            `Error while fetching fieldmap for company from user: ${errForZohoMap}`
          );
          return;
        }

        let leadMap = zohoMap?.lead_map;
        let ids = req.body.ids;

        for (let id of ids) {
          let leadToUpdate = {};
          const [lead, errForLead] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_type: LEAD_INTEGRATION_TYPES.ZOHO_LEAD,
              company_id: webhook.company_id,
              integration_id: id,
            },
            include: {
              [DB_TABLES.USER]: {
                where: {
                  company_id: webhook.company_id,
                },
                required: true,
              },
              [DB_TABLES.ACCOUNT]: {},
            },
          });
          if (errForLead) {
            logger.error(`Error while fetching lead: ${errForLead}`);
            return;
          }
          if (!lead) return;
          v2GrpcClients.advancedWorkflow.updateZohoLead({
            integration_data: {
              lead: {
                user_id: crmAdminUserId,
                company_id: webhook.company_id,
                lead_id: id,
              },
              fetched_lead_id: lead.lead_id,
            },
          });

          // * Fetch lead from zoho
          let [zohoLead, errFetchingZohoAccount] =
            await v2GrpcClients.crmIntegration.getLead({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                lead_id: id,
                access_token,
                instance_url,
              },
            });
          if (lead?.User?.integration_id !== zohoLead?.Owner?.id) {
            const oldOwner = lead.User;
            if (oldOwner === undefined) {
              logger.info('Error while finding old lead owner');
              continue;
            }

            // Fetching new owner
            const [newOwner, errForNewOwner] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                integration_id: zohoLead?.Owner?.id,
                company_id: webhook.company_id,
                integration_type: USER_INTEGRATION_TYPES.ZOHO_USER,
              },
            });
            if (errForNewOwner) {
              logger.info('Error while finding new lead owner');
              continue;
            }
            if (!newOwner) {
              logger.info('The new owner does not exist in the cadence tool.');
              await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
                {
                  lead_id: lead.lead_id,
                },
                {
                  status: CADENCE_LEAD_STATUS.STOPPED,
                }
              );

              const [activityFromTemplate, errForActivityFromTemplate] =
                ActivityHelper.getActivityFromTemplates({
                  type: ACTIVITY_TYPE.OWNER_CHANGE,
                  variables: {
                    crm: CRM_INTEGRATIONS.ZOHO,
                  },
                  activity: {
                    lead_id: lead.lead_id,
                    incoming: null,
                  },
                });
              await ActivityHelper.activityCreation(
                activityFromTemplate,
                lead.user_id
              );
            } else {
              const [workflow, errForWorkflow] =
                await WorkflowHelper.applyWorkflow({
                  trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
                  lead_id: lead.lead_id,
                  extras: {
                    crm: CRM_INTEGRATIONS.ZOHO,
                    integration_id: newOwner.integration_id,
                    new_user_id: newOwner.user_id,
                    oldOwnerSdId: oldOwner.sd_id,
                  },
                });
              if (!errForWorkflow)
                await TaskHelper.skipReplyTaskOwnerChange({
                  lead_id: lead.lead_id,
                  new_user_id: newOwner.user_id,
                  oldOwnerSdId: oldOwner.sd_id,
                });
            }
          }

          for (let key in leadMap) {
            if (
              !['emails', 'phone_numbers'].includes(key) &&
              zohoLead[leadMap[key]] !== lead[key]
            )
              leadToUpdate[key] = zohoLead[leadMap[key]];
            if (key == 'emails') {
              leadMap?.emails.forEach((email) => {
                if (zohoLead[email] === null) zohoLead[email] = '';
                LeadEmailHelper.updateEmail(
                  zohoLead[email],
                  email,
                  lead.lead_id
                );
              });
            }
            if (key == 'phone_numbers') {
              leadMap?.phone_numbers.forEach((phone) => {
                if (zohoLead[phone] === null) zohoLead[phone] = '';
                PhoneNumberHelper.updatePhoneNumber(
                  zohoLead[phone],
                  phone,
                  lead.lead_id
                );
              });
            }
          }
          let accountObject = {
            name: zohoLead?.[leadMap?.company],
            size:
              zohoLead?.[
                CompanyFieldMapHelper.getCompanySize({
                  size: leadMap?.size,
                })[0]
              ] ?? null,
            url: zohoLead?.[leadMap?.url] ?? null,
            country: zohoLead?.[leadMap?.country] ?? null,
            zipcode: zohoLead?.[leadMap?.zip_code] ?? null,
          };
          accountObject = JsonHelper.clean(accountObject);
          if (Object.keys(accountObject).length)
            await Repository.update({
              tableName: DB_TABLES.ACCOUNT,
              query: { account_id: lead.account_id },
              updateObject: accountObject,
            });

          if (Object.keys(leadToUpdate).length > 0) {
            leadToUpdate.full_name = `${zohoLead[leadMap?.first_name]} ${
              zohoLead[leadMap?.last_name]
            }`;
            const [updatedLead, errForUpdatedLead] = await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: lead.lead_id,
              },
              updateObject: leadToUpdate,
            });
            if (errForUpdatedLead) {
              logger.error(`Error while updating lead: ${errForUpdatedLead}`);
              return;
            }
          }
        }
        break;
      case 'delete':
        let deletedIds = req.body.ids;
        for (let lead_id of deletedIds) {
          const [fetchedLead, errForLead] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: lead_id,
              integration_type: LEAD_INTEGRATION_TYPES.ZOHO_LEAD,
              company_id: webhook.company_id,
            },
          });
          if (errForLead) continue;
          if (!fetchedLead) continue;

          const [deletedLead, errForDeletedLead] = await deleteAllLeadInfo({
            leadIds: [fetchedLead.lead_id],
            accountIds: [fetchedLead?.account_id],
          });
        }
        break;
      case 'insert':
        let insertedIds = req.body.ids;
        for (let id of insertedIds) {
          v2GrpcClients.advancedWorkflow.addZohoLead({
            integration_data: {
              lead: {
                company_id: webhook.company_id,
                lead_id: id,
                user_id: crmAdminUserId,
              },
            },
          });
        }
        break;
    }

    return;
  } catch (err) {
    logger.error('Error while updating zoho lead: ', err);
    return;
  }
};

const updateZohoAccount = async (req, res) => {
  try {
    axios.post(`${SERVER_URL}/webhook/v1/zoho/account`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Account updated successfully`);
    const [webhook, errForWebhook] = await Repository.fetchOne({
      tableName: DB_TABLES.ZOHO_WEBHOOK,
      query: {
        channel_id: req.body.channel_id,
      },
    });
    if (errForWebhook) {
      logger.error(`Error while fetching Zoho webhook: ${errForWebhook}`);
      return;
    }
    if (!webhook) {
      logger.info('webhook not found for this channel_id');
      return;
    }
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: webhook.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin) {
      logger.error(`Error while fetching company: ${errCrmAdmin}`);
      return;
    }

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId) return;
    switch (req.body.operation) {
      case 'update':
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            user_id: crmAdminUserId,
          });
        if (errForAccessToken) {
          if (errForAccessToken === 'Please log in with zoho') return;
          logger.error(
            `Error while fetching tokens for zoho: ${errForAccessToken}.`
          );
          return;
        }
        let [zohoMap, errForZohoMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: crmAdminUserId,
          });
        if (errForZohoMap) {
          logger.error(
            `Error while fetching fieldmap for company from user: ${errForZohoMap}`
          );
          return;
        }

        let accountMap = zohoMap?.account_map;
        let ids = req.body.ids;

        for (let id of ids) {
          let accountToUpdate = {};
          const [account, errForAccount] = await Repository.fetchOne({
            tableName: DB_TABLES.ACCOUNT,
            query: {
              integration_type: ACCOUNT_INTEGRATION_TYPES.ZOHO_ACCOUNT,
              company_id: webhook.company_id,
              integration_id: id,
            },
          });
          if (errForAccount) {
            logger.error(`Error while fetching account: ${errForAccount}`);
            return;
          }
          if (!account) {
            logger.error('Account not found');
            return;
          }
          // * Fetch account from zoho
          let [zohoAccount, errFetchingZohoAccount] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                account_id: id,
                access_token,
                instance_url,
              },
            });
          for (let key in accountMap) {
            if (
              !['emails', 'phone_numbers', 'size'].includes(key) &&
              zohoAccount[accountMap[key]] !== account[key]
            )
              accountToUpdate[key] = zohoAccount[accountMap[key]];
            if ('size' === key) {
              accountToUpdate[key] =
                zohoAccount[
                  CompanyFieldMapHelper.getCompanySize({
                    size: accountMap?.size,
                  })[0]
                ];
            }
          }
          if (Object.keys(accountToUpdate).length > 0) {
            const [updatedAccount, errForUpdatedAccount] =
              await Repository.update({
                tableName: DB_TABLES.ACCOUNT,
                query: {
                  account_id: account.account_id,
                },
                updateObject: accountToUpdate,
              });
            if (errForUpdatedAccount) {
              logger.error(
                `Error while updating account: ${errForUpdatedAccount}`
              );
              return;
            }
          }
        }
        break;
      case 'delete':
        let deletedIds = req.body.ids;
        for (let acccount_id of deletedIds) {
          await Repository.destroy({
            tableName: DB_TABLES.ACCOUNT,
            query: {
              integration_id: acccount_id,
              integration_type: ACCOUNT_INTEGRATION_TYPES.ZOHO_ACCOUNT,
              company_id: webhook.company_id,
            },
          });
          logger.info('Successfully deleted zoho account');
        }
        break;
      case 'insert':
    }
    return;
  } catch (err) {
    logger.error('Error while updating zoho account: ', err);
    return;
  }
};

const ZohoController = {
  updateZohoContact,
  updateZohoLead,
  updateZohoAccount,
};

module.exports = ZohoController;
