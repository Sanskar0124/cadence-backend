// Utils
const logger = require('../../../utils/winston');
const { successResponse } = require('../../../utils/response');
const {
  CRM_INTEGRATIONS,
  ACCOUNT_INTEGRATION_TYPES,
  LEAD_INTEGRATION_TYPES,
  USER_INTEGRATION_TYPES,
  CADENCE_LEAD_STATUS,
  WORKFLOW_TRIGGERS,
  ACTIVITY_TYPE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const SellsyHelper = require('../../../../../Cadence-Brain/src/helper/sellsy');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../Cadence-Brain/src/helper/email');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const WorkflowHelper = require('../../../../../Cadence-Brain/src/helper/workflow');
const ActivityHelper = require('../../../../../Cadence-Brain/src/helper/activity');

// GRPC
const v2GrpcClients = require('../../../../../Cadence-Brain/src/grpc/v2');
const deleteAllLeadInfo = require('../../../../../Cadence-Brain/src/helper/lead/deleteAllLeadInfo');

const updateSellsyContact = async (req, res) => {
  try {
    successResponse(res);

    const { notif } = req.body;
    // Parse the notification payload as JSON
    const payload = JSON.parse(notif);

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: payload.ownerid,
        integration_type: USER_INTEGRATION_TYPES.SELLSY_OWNER,
      },
      include: {
        [DB_TABLES.COMPANY]: {
          where: {
            integration_id: payload.corpid,
            integration_type: CRM_INTEGRATIONS.SELLSY,
          },
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['user_id'],
          },
        },
      },
      extras: {
        attributes: ['user_id', 'company_id', 'sd_id', 'integration_id'],
      },
    });
    if (errForUser) {
      logger.error(`Error while fetching user: ${errForUser}`);
      return;
    }

    if (!user) {
      logger.error('Sellsy user not found.');
      return;
    }

    switch (payload.event) {
      case 'updated':
        const crmAdminUserId = user?.Company?.Company_Setting?.user_id;
        if (!crmAdminUserId) {
          logger.error('CRM Admin not found');
          return;
        }

        const [sellsyMap, errForSellsyMap] =
          await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
            user_id: crmAdminUserId,
          });
        if (errForSellsyMap) {
          logger.error(
            'Error while fetching sellsy field map: ',
            errForSellsyMap
          );
          return;
        }

        let contactMap = sellsyMap?.contact_map;
        let companyMap = sellsyMap?.company_map;
        let access_token, errForAccessToken;

        switch (payload.relatedtype) {
          case 'people':
            const [lead, errForLead] = await Repository.fetchOne({
              tableName: DB_TABLES.LEAD,
              query: {
                integration_type: LEAD_INTEGRATION_TYPES.SELLSY_CONTACT,
                integration_id: payload.relatedid,
                company_id: user.company_id,
              },
              include: {
                [DB_TABLES.USER]: {
                  attributes: [
                    'user_id',
                    'sd_id',
                    'company_id',
                    'integration_id',
                  ],
                },
              },
            });
            if (errForLead) {
              logger.error(
                'Error while fetching lead from sellsy: ',
                errForLead
              );
              return;
            }

            if (!lead) {
              v2GrpcClients.advancedWorkflow.updateSellsyContact({
                integration_data: {
                  contact: payload,
                  fetched_lead_id: lead?.lead_id,
                },
              });
              logger.error('The Sellsy lead is not found');
              return;
            }

            // * Fetch access token  token and instance URL
            [{ access_token }, errForAccessToken] =
              await AccessTokenHelper.getAccessToken({
                integration_type: CRM_INTEGRATIONS.SELLSY,
                user_id: crmAdminUserId,
              });
            if (errForAccessToken) {
              if (errForAccessToken === 'Kindly log in with sellsy.') {
                logger.error('Sellsy account is not connected.');
                return;
              }

              logger.error(
                'Error while fetching tokens for sellsy: ',
                errForAccessToken
              );
              return;
            }

            const [contact, errFetchingContact] =
              await v2GrpcClients.crmIntegration.getContact({
                integration_type: CRM_INTEGRATIONS.SELLSY,
                integration_data: {
                  contact_id: lead.integration_id,
                  access_token,
                },
              });
            if (errFetchingContact) {
              logger.error(
                'Error while fetching contact from sellsy: ',
                errFetchingContact
              );
              return;
            }

            const [updatedContact, errForUpdatedContact] =
              SellsyHelper.mapSellsyField(contact, contactMap);
            if (errForUpdatedContact) {
              logger.error(
                'Error while mapping sellsy fields: ',
                errForUpdatedContact
              );
              return;
            }

            // Updating lead and account info db
            updatedContact.full_name =
              updatedContact?.first_name + ' ' + updatedContact?.last_name;

            // check for owner change of contact
            if (updatedContact?.owner) {
              const [newOwner, errForNewOwner] = await Repository.fetchOne({
                tableName: DB_TABLES.USER,
                query: {
                  integration_id: updatedContact?.owner.toString(),
                  integration_type: USER_INTEGRATION_TYPES.SELLSY_OWNER,
                  company_id: user.company_id,
                },
                extras: {
                  attributes: [
                    'user_id',
                    'integration_id',
                    'company_id',
                    'sd_id',
                  ],
                },
              });
              if (errForNewOwner) {
                logger.error(
                  'Error while fetching sellsy owner: ',
                  errForNewOwner
                );
                return;
              }

              // if new owner does not exist in our db
              if (!newOwner) {
                logger.error(
                  'The new owner of the lead does not exist in the cadence tool.'
                );
                // mark all lead_to_cadence links as stopped
                await Repository.update({
                  tableName: DB_TABLES.LEADTOCADENCE,
                  query: { lead_id: lead.lead_id },
                  updateObject: { status: CADENCE_LEAD_STATUS.STOPPED },
                });
                // create and send activity
                const [activityFromTemplate, errForActivityFromTemplate] =
                  ActivityHelper.getActivityFromTemplates({
                    type: ACTIVITY_TYPE.OWNER_CHANGE,
                    variables: {
                      crm: CRM_INTEGRATIONS.SELLSY,
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
              }

              if (newOwner?.user_id !== lead?.User?.user_id) {
                // apply owner change workflow
                const [workflow, errForWorkflow] =
                  await WorkflowHelper.applyWorkflow({
                    trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
                    lead_id: lead.lead_id,
                    extras: {
                      crm: CRM_INTEGRATIONS.SELLSY,
                      integration_id: newOwner.integration_id,
                      new_user_id: newOwner.user_id,
                      oldOwnerSdId: lead?.User?.sd_id,
                    },
                  });
                // if workflow is applied successfully then apply skip reply task logic for owner change
                if (!errForWorkflow)
                  await TaskHelper.skipReplyTaskOwnerChange({
                    lead,
                    newOwner,
                    oldOwner: lead?.User,
                  });
              }
            }

            await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: lead.lead_id,
              },
              updateObject: updatedContact,
            });

            if (updatedContact?.phone_numbers?.length)
              for (let phone of updatedContact?.phone_numbers) {
                PhoneNumberHelper.updatePhoneNumber(
                  phone.phone_number,
                  phone.type,
                  lead.lead_id
                );
              }

            if (updatedContact?.emails?.length)
              for (let email of updatedContact?.emails) {
                LeadEmailHelper.updateEmail(
                  email.email_id,
                  email.type,
                  lead.lead_id
                );
              }

            v2GrpcClients.advancedWorkflow.updateSellsyContact({
              integration_data: {
                contact: payload,
                fetched_lead_id: lead?.lead_id,
                extras: {
                  contact,
                  access_token,
                  sellsyMap,
                },
              },
            });

            logger.info('Sellsy contact updated successfully.');
            return;

          case 'third':
            const [account, errForAccount] = await Repository.fetchOne({
              tableName: DB_TABLES.ACCOUNT,
              query: {
                integration_type: ACCOUNT_INTEGRATION_TYPES.SELLSY_COMPANY,
                integration_id: payload.relatedid,
                company_id: user.company_id,
              },
            });
            if (errForAccount) {
              logger.error(
                'Error while fetching account from sellsy: ',
                errForAccount
              );
              return;
            }

            if (!account) {
              logger.error('The account is not found');
              return;
            }

            // * Fetch access token  token and instance URL
            [{ access_token }, errForAccessToken] =
              await AccessTokenHelper.getAccessToken({
                integration_type: CRM_INTEGRATIONS.SELLSY,
                user_id: crmAdminUserId,
              });
            if (errForAccessToken) {
              if (errForAccessToken === 'Access token has been revoked') {
                logger.error('Please log in with sellsy');
                return;
              }
              logger.error(
                'Error while fetching tokens for sellsy: ',
                errForAccessToken
              );
              return;
            }

            const [company, errFetchingCompany] =
              await v2GrpcClients.crmIntegration.getAccount({
                integration_type: CRM_INTEGRATIONS.SELLSY,
                integration_data: {
                  company_id: account.integration_id,
                  access_token,
                },
              });
            if (errFetchingCompany) {
              logger.error(
                'Error while fetching organization from sellsy: ',
                errFetchingCompany
              );
              return;
            }

            const [fieldSchema, errForFieldSchema] =
              SellsyHelper.companyFieldSchema(companyMap);
            if (errForFieldSchema) {
              logger.error(
                'Error while fetching sellsy field schema: ',
                errForFieldSchema
              );
              return;
            }

            const [updatedCompany, errForUpdatedCompany] =
              SellsyHelper.mapSellsyField(company, fieldSchema);
            if (errForUpdatedCompany) {
              logger.error(
                'Error while mapping sellsy fields: ',
                errForUpdatedCompany
              );
              return;
            }

            // check for owner change of account
            const [sellsyOwner, errForSellsyOwner] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                integration_id: updatedCompany?.owner.toString(),
                integration_type: USER_INTEGRATION_TYPES.SELLSY_OWNER,
                company_id: user.company_id,
              },
            });
            if (errForSellsyOwner) {
              logger.error(
                'Error while fetching sellsy owner: ',
                errForSellsyOwner
              );
              return;
            }

            if (sellsyOwner) updatedCompany.user_id = sellsyOwner.user_id;

            await Repository.update({
              tableName: DB_TABLES.ACCOUNT,
              query: {
                account_id: account.account_id,
              },
              updateObject: updatedCompany,
            });

            logger.info('Sellsy account updated successfully.');
            return;
        }
        return;

      case 'deleted':
        switch (payload.relatedtype) {
          case 'people':
            const [lead, errForLead] = await Repository.fetchOne({
              tableName: DB_TABLES.LEAD,
              query: {
                integration_type: LEAD_INTEGRATION_TYPES.SELLSY_CONTACT,
                integration_id: payload.relatedid,
                company_id: user.company_id,
              },
            });
            if (errForLead) {
              logger.error(
                'Error while fetching lead from sellsy: ',
                errForLead
              );
              return;
            }

            if (!lead) {
              logger.error('The lead is not found');
              return;
            }

            const [deletedLeadMsg, errForDeletedLeadMsg] =
              await deleteAllLeadInfo({
                leadIds: [lead?.lead_id],
                accountIds: [lead?.account_id],
              });
            if (errForDeletedLeadMsg) {
              logger.error(
                'Error while deleting lead data: ',
                errForDeletedLeadMsg
              );
              return;
            }

            logger.info('Successfully removed sellsy lead from Cadence');
            return;

          case 'third':
            const [account, errForAccount] = await Repository.fetchOne({
              tableName: DB_TABLES.ACCOUNT,
              query: {
                integration_type: ACCOUNT_INTEGRATION_TYPES.SELLSY_COMPANY,
                integration_id: payload.relatedid,
                company_id: user.company_id,
              },
            });
            if (errForAccount) {
              logger.error(
                'Error while fetching account from sellsy: ',
                errForAccount
              );
              return;
            }

            if (!account) {
              logger.error('Sellsy account is not found');
              return;
            }

            const [deletableAccount, errForDeletableAccount] =
              await Repository.destroy({
                tableName: DB_TABLES.ACCOUNT,
                query: {
                  account_id: account.account_id,
                },
              });

            if (errForDeletableAccount) {
              logger.error(
                'Error while deleting sellsy account:',
                errForDeletableAccount
              );
              return;
            }

            const [updateLead, errForUpdateLead] = await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                account_id: account.account_id,
              },
              updateObject: {
                account_id: null,
              },
            });
            if (errForUpdateLead) {
              logger.error(
                'Error while updating sellsy lead',
                errForUpdateLead
              );
              return;
            }

            logger.info('Successfully removed sellsy account from Cadence');
            return;
        }
        return;

      case 'created':
        switch (payload.relatedtype) {
          case 'people' || 'third': {
            v2GrpcClients.advancedWorkflow.addSellsyContact({
              integration_data: {
                contact: payload,
              },
            });
          }
        }
        return;

      default:
        logger.info('Action not supported for sellsy');
        return;
    }
  } catch (err) {
    logger.error('Error while updating contact via Sellsy: ', err);
    return;
  }
};

const SellsyController = {
  updateSellsyContact,
};

module.exports = SellsyController;
