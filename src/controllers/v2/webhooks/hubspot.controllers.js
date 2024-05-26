const logger = require('../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  LEAD_INTEGRATION_TYPES,
  USER_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  HUBSPOT_CONTACT_IMPORT_STATUS,
  CADENCE_LEAD_STATUS,
  ACTIVITY_TYPE,
  WORKFLOW_TRIGGERS,
  CRM_INTEGRATIONS,
  LEAD_STATUS,
  LEAD_SCORE_RUBRIKS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');
const LeadToCadenceRepository = require('../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');

// Helpers and Services
const ActivityHelper = require('../../../../../Cadence-Brain/src/helper/activity');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../Cadence-Brain/src/helper/email');
const WorkflowHelper = require('../../../../../Cadence-Brain/src/helper/workflow');
const leadHelper = require('../../../../../Cadence-Brain/src/helper/lead');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const LeadScoreHelper = require('../../../../../Cadence-Brain/src/helper/lead-score/');

// * GRPC
const v2GrpcClients = require('../../../../../Cadence-Brain/src/grpc/v2');
const deleteAllLeadInfo = require('../../../../../Cadence-Brain/src/helper/lead/deleteAllLeadInfo');

const updateHubspot = async (req, res) => {
  successResponse(res);
  try {
    let contactCreated = req.body.filter(
      (el) => el.subscriptionType === 'contact.creation'
    );
    if (contactCreated.length) req.body = contactCreated;

    switch (req.body[0].subscriptionType) {
      case 'contact.creation': {
        try {
          v2GrpcClients.advancedWorkflow.addHubspotContact({
            integration_data: {
              contact: req.body[0],
            },
          });
          return;
        } catch (err) {
          logger.error('Error while creating hubspot person: ', err);
          return;
        }
      }
      case 'contact.propertyChange': {
        let t = await sequelize.transaction();
        try {
          const contacts = req.body;
          const [fetchUser, errForUser] = await leadHelper.getUserDetails(
            req.body[0]
          );
          if (errForUser) {
            t.rollback();
            return;
          }
          const [fetchedLead, errForLead] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: fetchUser.lead_id,
              integration_type: LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT,
            },
            include: {
              [DB_TABLES.USER]: {
                required: true,
              },
            },
            t,
          });

          v2GrpcClients.advancedWorkflow.updateHubspotContact({
            integration_data: {
              contact: req.body[0],
              fetched_lead_id: fetchedLead.lead_id,
            },
          });

          if (errForLead) {
            t.rollback();
            logger.error('error in fetching lead');
            return;
          }
          if (!fetchedLead) {
            t.rollback();
            logger.info('no lead with that integration id');
            return;
          }
          let [hubspotMap, errForHubspotMap] =
            await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
              user_id: fetchedLead.user_id,
            });
          if (errForHubspotMap) {
            t.rollback();
            logger.info('error while getting map');
            return;
          }
          let hubspotContactMap = hubspotMap.contact_map;
          let personToUpdate = {};
          let i = 0;
          personToUpdate.first_name = fetchedLead.first_name;
          personToUpdate.last_name = fetchedLead.last_name;
          while (i < contacts.length) {
            let lead = contacts[i];
            if (lead.propertyName === 'hubspot_owner_id') {
              const oldOwner = fetchedLead.User;
              if (oldOwner === undefined) {
                logger.info('Error while finding old lead owner');
                i++;
                continue;
              }

              // Fetching new owner
              const [newOwner, errForNewOwner] = await Repository.fetchOne({
                tableName: DB_TABLES.USER,
                query: {
                  integration_id: lead.propertyValue,
                  integration_type: USER_INTEGRATION_TYPES.HUBSPOT_OWNER,
                },
              });
              if (errForNewOwner) {
                logger.info('Error while finding new lead owner');
                i++;
                continue;
              }
              if (!newOwner) {
                logger.info(
                  'The new owner does not exist in the cadence tool.'
                );
                await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
                  {
                    lead_id: fetchedLead.lead_id,
                  },
                  {
                    status: CADENCE_LEAD_STATUS.STOPPED,
                  }
                );

                const [activityFromTemplate, errForActivityFromTemplate] =
                  ActivityHelper.getActivityFromTemplates({
                    type: ACTIVITY_TYPE.OWNER_CHANGE,
                    variables: {
                      crm: CRM_INTEGRATIONS.HUBSPOT,
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

              const [workflow, errForWorkflow] =
                await WorkflowHelper.applyWorkflow({
                  trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
                  lead_id: fetchedLead.lead_id,
                  extras: {
                    crm: CRM_INTEGRATIONS.HUBSPOT,
                    integration_id: newOwner.integration_id,
                    new_user_id: newOwner.user_id,
                    oldOwnerSdId: oldOwner.sd_id,
                  },
                });
              if (!errForWorkflow)
                await TaskHelper.skipReplyTaskOwnerChange({
                  lead_id: fetchedLead.lead_id,
                  new_user_id: newOwner.user_id,
                  oldOwnerSdId: oldOwner.sd_id,
                });

              i++;
              continue;
            }
            for (let key in hubspotContactMap) {
              if (
                !['emails', 'phone_numbers'].includes(key) &&
                hubspotContactMap[key] == lead.propertyName
              )
                personToUpdate[key] = lead.propertyValue;
              if (key == 'emails') {
                hubspotContactMap?.emails.forEach((email) => {
                  if (email == lead.propertyName) {
                    LeadEmailHelper.updateEmail(
                      lead.propertyValue,
                      lead.propertyName,
                      fetchedLead.lead_id
                    );
                  }
                });
              }
              if (key == 'phone_numbers') {
                hubspotContactMap?.phone_numbers.forEach((phone) => {
                  if (phone == lead.propertyName) {
                    PhoneNumberHelper.updatePhoneNumber(
                      lead.propertyValue,
                      lead.propertyName,
                      fetchedLead.lead_id
                    );
                  }
                });
              }
              if (key == 'integration_status') {
                if (
                  hubspotContactMap.integration_status.name ===
                  req.body[0].propertyName
                ) {
                  // * Check if the lead has been disqualified
                  if (
                    req.body[0].propertyValue ===
                      hubspotContactMap?.integration_status?.disqualified
                        ?.value &&
                    hubspotContactMap?.integration_status?.disqualified
                      ?.value !== undefined
                  ) {
                    logger.info('Lead disqualified from hubspot');
                    // * Mark lead_status as trash
                    await Repository.update({
                      tableName: DB_TABLES.LEAD,
                      query: { lead_id: fetchedLead.lead_id },
                      updateObject: {
                        status: LEAD_STATUS.TRASH,
                        integration_status: req.body[0].propertyValue,
                      },
                    });
                    await Repository.create({
                      tableName: DB_TABLES.STATUS,
                      createObject: {
                        lead_id: fetchedLead.lead_id,
                        status: LEAD_STATUS.TRASH,
                      },
                    });

                    // * Stopping all tasks for lead
                    await Repository.update({
                      tableName: DB_TABLES.LEADTOCADENCE,
                      query: { lead_id: fetchedLead.lead_id },
                      updateObject: {
                        status: CADENCE_LEAD_STATUS.STOPPED,
                      },
                    });

                    //get present date as per timezone
                    const today = new Date().toLocaleDateString('en-GB', {
                      timeZone: fetchedLead.User.timezone,
                    });

                    // * Generate acitvity
                    const [activityFromTemplate, errForActivityFromTemplate] =
                      ActivityHelper.getActivityFromTemplates({
                        type: ACTIVITY_TYPE.LEAD_DISQUALIFIED,
                        variables: {
                          today,
                        },
                        activity: {
                          lead_id: fetchedLead.lead_id,
                          incoming: null,
                        },
                      });

                    ActivityHelper.activityCreation(
                      activityFromTemplate,
                      fetchedLead.user_id
                    );
                    TaskHelper.recalculateDailyTasksForUsers([
                      fetchedLead.user_id,
                    ]);

                    // Reset Lead Score
                    let [updatedLeadScore, errForUpdatedLeadScore] =
                      await LeadScoreHelper.updateLeadScore({
                        lead: fetchedLead,
                        rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
                        current_status: req?.body?.[0]?.propertyValue,
                        previous_status: fetchedLead.integration_status,
                        field_map: hubspotContactMap,
                      });
                    if (errForUpdatedLeadScore)
                      logger.error(
                        'An error occured while updating lead score',
                        errForUpdatedLeadScore
                      );
                  }
                  // * Check if the lead has been converted
                  else if (
                    req.body[0].propertyValue ===
                      hubspotContactMap?.integration_status?.converted?.value &&
                    hubspotContactMap?.integration_status?.converted?.value !==
                      undefined
                  ) {
                    // * Update lead status
                    await Repository.update({
                      tableName: DB_TABLES.LEAD,
                      query: { lead_id: fetchedLead.lead_id },
                      updateObject: {
                        status: LEAD_STATUS.CONVERTED,
                        integration_status: req.body[0].propertyValue,
                      },
                    });

                    await Repository.create({
                      tableName: DB_TABLES.STATUS,
                      createObject: {
                        lead_id: fetchedLead.lead_id,
                        status: LEAD_STATUS.CONVERTED,
                      },
                    });

                    await Repository.update({
                      tableName: DB_TABLES.LEADTOCADENCE,
                      query: { lead_id: fetchedLead.lead_id },
                      updateObject: {
                        status: CADENCE_LEAD_STATUS.STOPPED,
                      },
                    });

                    //get present date as per timezone
                    const today = new Date().toLocaleDateString('en-GB', {
                      timeZone: fetchedLead.User.timezone,
                    });

                    const [activityFromTemplate, errForActivityFromTemplate] =
                      ActivityHelper.getActivityFromTemplates({
                        type: ACTIVITY_TYPE.LEAD_CONVERTED,
                        variables: {
                          today,
                        },
                        activity: {
                          lead_id: fetchedLead.lead_id,
                          incoming: null,
                        },
                      });

                    ActivityHelper.activityCreation(
                      activityFromTemplate,
                      fetchedLead.user_id
                    );
                    TaskHelper.recalculateDailyTasksForUsers([
                      fetchedLead.user_id,
                    ]);

                    // Reset Lead Score
                    let [updatedLeadScore, errForUpdatedLeadScore] =
                      await LeadScoreHelper.updateLeadScore({
                        lead: fetchedLead,
                        rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
                        current_status: req?.body?.[0]?.propertyValue,
                        previous_status: fetchedLead.integration_status,
                        field_map: hubspotContactMap,
                      });
                    if (errForUpdatedLeadScore)
                      logger.error(
                        'An error occured while updating lead score',
                        errForUpdatedLeadScore
                      );
                  } else {
                    // Update Lead Integration Status
                    let [updatedLead, errForUpdatedLead] =
                      await Repository.update({
                        tableName: DB_TABLES.LEAD,
                        query: { lead_id: fetchedLead.lead_id },
                        updateObject: {
                          integration_status: req?.body?.[0]?.propertyValue,
                        },
                      });

                    if (errForUpdatedLead) {
                      logger.error(
                        'Error while updating lead integration status',
                        errForUpdatedLead
                      );
                    }

                    // Update Lead Score
                    let [updatedLeadScore, errForUpdatedLeadScore] =
                      await LeadScoreHelper.updateLeadScore({
                        lead: fetchedLead,
                        rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
                        current_status: req?.body?.[0]?.propertyValue,
                        previous_status: fetchedLead.integration_status,
                        field_map: hubspotContactMap,
                      });
                    if (errForUpdatedLeadScore)
                      logger.error(
                        'An error occured while updating lead score',
                        errForUpdatedLeadScore
                      );
                  }
                }
              }
            }
            i++;
          }
          personToUpdate.full_name = `${personToUpdate.first_name} ${personToUpdate.last_name}`;
          await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: fetchedLead.lead_id,
            },
            updateObject: personToUpdate,
            t,
          });
          if (i === contacts.length) {
            t.commit();
            return;
          } else {
            t.rollback();
            logger.error('Error while updating hubspot person: ');
            return;
          }
        } catch (err) {
          t.rollback();
          logger.error('Error while updating hubspot person: ', err);
          return;
        }
      }
      case 'contact.associationChange': {
        try {
          if (req.body[0].associationType !== 'CONTACT_TO_COMPANY') return;
          const [fetchedLead, errForLead] = await Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: req.body[0].fromObjectId,
              integration_type: LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT,
            },
            include: {
              [DB_TABLES.COMPANY]: {
                where: {
                  integration_id: req.body[0].portalId,
                  integration_type: CRM_INTEGRATIONS.HUBSPOT,
                },
                required: true,
              },
            },
          });
          if (errForLead) return;
          if (!fetchedLead) return;

          // * Company is removed
          if (req.body[0].associationRemoved) {
            await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: fetchedLead.lead_id,
              },
              updateObject: {
                account_id: null,
              },
            });
            return;
          }

          // * Company is not removed

          // * Fetch account from database
          let [account, errFetchingAccount] = await Repository.fetchOne({
            tableName: DB_TABLES.ACCOUNT,
            query: {
              integration_id: req.body[0].toObjectId,
              integration_type: ACCOUNT_INTEGRATION_TYPES.HUBSPOT_COMPANY,
            },
            include: {
              [DB_TABLES.COMPANY]: {
                where: {
                  integration_id: req.body[0].portalId,
                  integration_type: CRM_INTEGRATIONS.HUBSPOT,
                },
                required: true,
              },
            },
          });
          if (errFetchingAccount) return;
          if (!account) {
            // * Fetch CRM admin of the company
            const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
              tableName: DB_TABLES.COMPANY,
              query: {
                integration_id: req.body[0].portalId,
                integration_type: CRM_INTEGRATIONS.HUBSPOT,
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
            if (errCrmAdmin) return;

            let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
            if (!crmAdminUserId) return;

            // * Fetch access token  token and instance URL
            const [{ access_token }, errForAccessToken] =
              await AccessTokenHelper.getAccessToken({
                integration_type: CRM_INTEGRATIONS.HUBSPOT,
                user_id: crmAdminUserId,
              });
            if (errForAccessToken) return;

            const [hubspotFieldMap, errForHubspotFieldMap] =
              await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
                user_id: crmAdminUserId,
              });
            if (errForHubspotFieldMap) return;

            let hubspotCompanyMap = hubspotFieldMap.company_map;

            let account_properties_query = '';
            for (let value of Object.values(hubspotCompanyMap)) {
              if (typeof value === 'string')
                account_properties_query =
                  account_properties_query + `${value},`;
              else if (typeof value === 'object') {
                for (let v of value)
                  account_properties_query = account_properties_query + `${v},`;
              }
            }

            // * Fetch account from hubspot
            let [hubspotAccount, errFetchingAccount] =
              await v2GrpcClients.crmIntegration.getAccount({
                integration_type: CRM_INTEGRATIONS.HUBSPOT,
                integration_data: {
                  company_id: req.body[0].toObjectId,
                  access_token,
                  properties: account_properties_query,
                },
              });

            [account, errForAccount] = await Repository.create({
              tableName: DB_TABLES.ACCOUNT,
              createObject: {
                name: hubspotAccount.properties?.[hubspotCompanyMap.name],
                size: hubspotAccount.properties?.[hubspotCompanyMap.size],
                url: hubspotAccount.properties?.[hubspotCompanyMap.url],
                country: hubspotAccount.properties?.[hubspotCompanyMap.country],
                linkedin_url:
                  hubspotAccount.properties?.[hubspotCompanyMap.linkedin_url],
                integration_type: ACCOUNT_INTEGRATION_TYPES.HUBSPOT_COMPANY,
                integration_id: hubspotAccount.id,
                zipcode:
                  hubspotAccount.properties?.[hubspotCompanyMap.zip_code],
                phone_number:
                  hubspotAccount.properties?.[hubspotCompanyMap.phone_number],
                user_id: fetchedLead.user_id,
                company_id: fetchedLead.company_id,
              },
            });
          }

          // * Link lead with account
          await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: fetchedLead.lead_id,
            },
            updateObject: {
              account_id: account.account_id,
            },
          });

          return;
        } catch (err) {
          logger.error('Error while handling association changed: ', err);
          return;
        }
      }
      case 'contact.deletion': {
        let t = await sequelize.transaction();
        try {
          const [fetchUser, errForUser] = await leadHelper.getUserDetails(
            req.body[0]
          );
          if (errForUser) {
            t.rollback();
            return;
          }
          const [deletedLead, errForDeletedLead] = await deleteAllLeadInfo({
            leadIds: [fetchUser.lead_id],
            accountIds: [fetchUser?.account_id],
          });
          if (errForDeletedLead) {
            t.rollback();
            logger.error('error in fetching lead');
            return;
          }

          t.commit();
          return;
        } catch (err) {
          t.rollback();
          logger.error('An error occured while deleting contact', err);
          return;
        }
      }
      case 'company.propertyChange': {
        let t = await sequelize.transaction();
        try {
          const company = req.body;

          const [account, errForAccount] = await Repository.fetchOne({
            tableName: DB_TABLES.ACCOUNT,
            query: {
              integration_type: ACCOUNT_INTEGRATION_TYPES.HUBSPOT_COMPANY,
              integration_id: company[0].objectId,
            },
            t,
          });
          if (errForAccount) {
            t.rollback();
            logger.error('error in fetching account');
            return;
          }
          if (!account) {
            t.rollback();
            logger.info('no account find');
            return;
          }
          let [hubspotMap, errForHubspotMap] =
            await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
              user_id: account.user_id,
            });
          if (errForHubspotMap) {
            t.rollback();
            logger.info('Error in getting map');
            return;
          }
          let hubspotCompanyMap = hubspotMap.company_map;
          let i = 0;
          let companyToUpdate = {};
          while (i < company.length) {
            let acc = company[i];
            for (let key in hubspotCompanyMap) {
              if (hubspotCompanyMap[key] == acc.propertyName) {
                if (key === 'zip_code')
                  companyToUpdate.zipcode = acc.propertyValue;
                else companyToUpdate[key] = acc.propertyValue;
              }
            }
            i++;
          }

          await Repository.update({
            tableName: DB_TABLES.ACCOUNT,
            query: {
              account_id: account.account_id,
            },
            updateObject: companyToUpdate,
            t,
          });
          if (i === company.length) {
            t.commit();
            return;
          } else {
            t.rollback();
            logger.error('Error while updating hubspot company: ');
            return;
          }
        } catch (err) {
          t.rollback();
          logger.error('Error while updating hubspot company: ', err);
          return;
        }
      }
      case 'company.deletion': {
        let t = await sequelize.transaction();
        try {
          const company = req.body;
          const [account, errForAccount] = await Repository.destroy({
            tableName: DB_TABLES.ACCOUNT,
            query: {
              integration_type: ACCOUNT_INTEGRATION_TYPES.HUBSPOT_COMPANY,
              integration_id: company[0].objectId,
            },
            t,
          });
          if (errForAccount) {
            t.rollback();
            logger.error('error in fetching account');
            return;
          }
          t.commit();
          return;
        } catch (err) {
          t.rollback();
          logger.error('Error while updating hubspot company: ', err);
          return;
        }
      }
    }
  } catch (err) {
    logger.error(`Unable to process hubspot update webhook: `, err);
    return;
  }
};

const addHubspotContactsViaWorkflow = async (req, res) => {
  try {
    let companyProperties;
    let portal_id = req.body['portal-id'];
    let properties = req.body.properties;
    if (req.body['associated-company'])
      companyProperties = req.body['associated-company']?.properties;

    let hubspot_owner_id = req?.body?.properties?.hubspot_owner_id?.value;
    let status = '';

    successResponse(res, 'Request received.');

    if (!req.body.vid || !req.body.vid == null)
      return logger.info('No vid present.');

    const [company, _] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { integration_id: portal_id },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['company_settings_id'],
          [DB_TABLES.HUBSPOT_FIELD_MAP]: {},
        },
      },
      extras: { required: true, attributes: ['company_id', 'integration_id'] },
    });
    if (!company)
      return logger.info('No company found for hubspot contact addition.');

    let hubspotFieldMap = company?.Company_Setting?.Hubspot_Field_Map;
    if (hubspotFieldMap == null) return logger.info('Field map not set.');

    let hubspotContactMap = hubspotFieldMap.contact_map;
    let hubspotCompanyMap = hubspotFieldMap.company_map;

    const contact = {};
    const account = {};
    const owner = {};

    contact.first_name = properties[hubspotContactMap?.first_name]?.value;
    contact.last_name = properties[hubspotContactMap?.last_name]?.value;
    contact.job_position = properties[hubspotContactMap?.job_position]?.value;
    contact.linkedin_url = properties[hubspotContactMap?.linkedin_url]?.value;

    let emails = [];
    let phone_numbers = [];
    for (let emailProperty of hubspotContactMap?.emails) {
      emails.push({
        type: emailProperty,
        email_id: properties[emailProperty]?.value,
      });
    }
    for (let phoneProperty of hubspotContactMap?.phone_numbers)
      phone_numbers.push({
        type: phoneProperty,
        email_id: properties[phoneProperty]?.value,
      });

    contact.emails = emails;
    contact.phone_numbers = phone_numbers;

    // Company
    if (companyProperties) {
      account.integration_id = companyProperties?.hs_object_id.value;
      account.name = companyProperties[hubspotCompanyMap?.name]?.value;
      account.size = companyProperties[hubspotCompanyMap?.size]?.value;
      account.url = companyProperties[hubspotCompanyMap?.url]?.value;
      account.phone_number =
        companyProperties[hubspotCompanyMap?.phone_number]?.value;
      account.zip_code = companyProperties[hubspotCompanyMap?.zip_code]?.value;

      contact.account = account;
    }

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { integration_id: req.body.vid },
      include: {
        [DB_TABLES.USER]: {
          [DB_TABLES.COMPANY]: {
            where: {
              integration_id: portal_id,
            },
            required: true,
          },
        },
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['lead_cadence_id', 'cadence_id', 'status'],
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
          },
        },
      },
      extras: { required: true },
    });
    if (!hubspot_owner_id) {
      status = HUBSPOT_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
    } else {
      const [user, errForUser] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: { integration_id: hubspot_owner_id },
        include: {
          [DB_TABLES.COMPANY]: {
            where: {
              integration_id: portal_id,
            },
            required: true,
          },
        },
      });
      if (!user) status = HUBSPOT_CONTACT_IMPORT_STATUS.USER_NOT_PRESENT;
      else if (!lead)
        status = HUBSPOT_CONTACT_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
      else if (lead) {
        status = HUBSPOT_CONTACT_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        contact.lead_id = lead.lead_id;
        contact.cadences = lead?.LeadToCadences;
      }
    }

    if (!hubspot_owner_id) status = HUBSPOT_CONTACT_IMPORT_STATUS.UNASSIGNED;
    else {
      owner.integration_id = hubspot_owner_id;
      owner.first_name = req.body?.['associated-owner']?.['first-name'];
      owner.last_name = req.body?.['associated-owner']?.['last-name'];

      contact.owner = owner;
    }

    // if (!companyProperties)
    //   status = HUBSPOT_CONTACT_IMPORT_STATUS.COMPANY_NOT_PRESENT;

    const [createContact, errForCreate] = await Repository.create({
      tableName: DB_TABLES.HUBSPOT_IMPORTS,
      createObject: {
        contact,
        contact_id: req.body.vid,
        company_id: company.company_id,
        status,
      },
    });
  } catch (err) {
    logger.error('Error while adding hubspot contacts via workflow: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding hubspot contacts via workflow: ${err.message}`,
    });
  }
};

const HubspotController = {
  updateHubspot,
  addHubspotContactsViaWorkflow,
};

module.exports = HubspotController;
