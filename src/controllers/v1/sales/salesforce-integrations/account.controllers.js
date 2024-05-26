// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponse,
  badRequestResponse,
  serverErrorResponse,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  CADENCE_LEAD_STATUS,
  ACTIVITY_TYPE,
  SALESFORCE_SOBJECTS,
  ACTIVITY_SUBTYPES,
  ACCOUNT_INTEGRATION_TYPES,
  USER_INTEGRATION_TYPES,
  LEAD_INTEGRATION_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  SERVER_URL,
} = require('../../../../../../Cadence-Brain/src/utils/config');

// Packages
const { Op } = require('sequelize');
const axios = require('axios');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const SalesforceHelper = require('../../../../../../Cadence-Brain/src/helper/salesforce');
const CompanyFieldMapHelper = require('../../../../../../Cadence-Brain/src/helper/company-field-map');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');
const {
  deleteAllLeadInfo,
} = require('../../../../../../Cadence-Brain/src/helper/lead');

const getAccount = async (req, res) => {
  try {
    const { id: salesforce_account_id } = req.params;

    const [account, errForAccount] = await Repository.fetchOne({
      tableName: DB_TABLES.ACCOUNT,
      //query: { salesforce_account_id },
      query: {
        integration_id: salesforce_account_id,
        integration_type: ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT,
      },
      include: {
        [DB_TABLES.USER]: {
          //attributes: ['first_name', 'last_name', 'salesforce_owner_id'],
          attributes: [
            'first_name',
            'last_name',
            'integration_id',
            'integration_type',
          ],
          [DB_TABLES.COMPANY]: {
            attributes: ['name'],
            where: { company_id: req.company_id },
            required: true,
          },
          required: true,
        },
      },
    });
    if (errForAccount) return serverErrorResponse(res);
    if (!account) return badRequestResponse(res, 'Account not found.');

    return successResponse(res, 'Account fetched successfully', account);
  } catch (err) {
    logger.error('Error while fetching account: ', err);
    return serverErrorResponse(res);
  }
};

const updateAccounts = async (req, res) => {
  try {
    axios.put(`${SERVER_URL}/webhook/v1/salesforce/account`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Accounts updated successfully`);
    const { accounts } = req.body;
    if (accounts === undefined || accounts.length === 0)
      return badRequestResponse(res, 'Array cannot be empty.');
    let i = 0;

    // * Fetch salesforce field map
    let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
      await SalesforceHelper.getFieldMapForCompanyFromCompany(
        req.company_id,
        SALESFORCE_SOBJECTS.ACCOUNT
      );
    if (errFetchingSalesforceFieldMap)
      return badRequestResponse(res, errFetchingSalesforceFieldMap);

    while (i < accounts.length) {
      if (i === accounts.length)
        return successResponse(res, 'Accounts updated successfully');
      let account = accounts[i];

      const [fetchedAccount, errForFetch] = await Repository.fetchOne({
        tableName: DB_TABLES.ACCOUNT,
        //query: { salesforce_account_id: account.salesforce_account_id },
        query: {
          integration_id: account.salesforce_account_id,
          integration_type: ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT,
        },
        include: {
          [DB_TABLES.USER]: {
            [DB_TABLES.COMPANY]: {
              where: { company_id: req.company_id },
              required: true,
            },
            required: true,
          },
        },
      });
      if (errForFetch || !fetchedAccount) {
        i++;
        continue;
      }

      let zipcode = null;
      try {
        zipcode = parseInt(account?.[salesforceFieldMap?.zip_code]);
        if (isNaN(zipcode)) zipcode = null;
      } catch (err) {
        logger.error('Unable to parse zipcode of account');
      }

      const [updatedAccount, err] = await Repository.update({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          account_id: fetchedAccount.account_id,
        },
        updateObject: {
          name: account?.[salesforceFieldMap?.name],
          size: account?.[
            CompanyFieldMapHelper.getCompanySize({
              size: salesforceFieldMap?.size,
            })[0]
          ],
          url: account?.[salesforceFieldMap?.url],
          country: account?.[salesforceFieldMap?.country],
          zipcode,
          linkedin_url: account?.[salesforceFieldMap?.linkedin_url],
          phone_number: account?.[salesforceFieldMap?.phone_number],
          integration_status:
            account?.[salesforceFieldMap?.integration_status?.name],
        },
      });

      // If account status is marked as disqualified
      if (
        account?.[salesforceFieldMap?.integration_status.name] ===
          salesforceFieldMap?.integration_status?.disqualified?.value &&
        salesforceFieldMap?.integration_status?.disqualified?.value !==
          undefined
      ) {
        // Fetch all the lead ids and do this for all
        const [accountLeads, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            account_id: fetchedAccount.account_id,
            status: {
              [Op.ne]: LEAD_STATUS.TRASH,
            },
          },
        });
        for (let lead of accountLeads) {
          await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: lead.lead_id,
            },
            updateObject: {
              status: LEAD_STATUS.TRASH,
              status_update_timestamp: new Date(),
            },
          });

          await Repository.create({
            tableName: DB_TABLES.STATUS,
            createObject: {
              lead_id: lead.lead_id,
              status: LEAD_STATUS.TRASH,
            },
          });

          // * Fetch latest task for lead
          const [task, errForTask] = await Repository.fetchOne({
            tableName: DB_TABLES.TASK,
            query: {
              lead_id: lead.lead_id,
              completed: false,
              is_skipped: false,
            },
          });
          if (errForTask)
            logger.error(`Error while fetching latest task: `, errForTask);

          await Repository.update({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: { lead_id: lead.lead_id },
            updateObject: {
              status: CADENCE_LEAD_STATUS.STOPPED,
              status_node_id: task?.node_id ?? null,
            },
          });

          const [activityFromTemplate, errForActivityFromTemplate] =
            ActivityHelper.getActivityFromTemplates({
              type: ACTIVITY_TYPE.LEAD_DISQUALIFIED,
              sub_type: ACTIVITY_SUBTYPES.ACCOUNT,
              activity: {
                lead_id: lead.lead_id,
                incoming: null,
              },
            });

          ActivityHelper.activityCreation(activityFromTemplate, lead.user_id);
        }
      } else if (
        account?.[salesforceFieldMap?.integration_status.name] !==
          salesforceFieldMap?.integration_status?.disqualified?.value &&
        account?.[salesforceFieldMap?.integration_status.name] !== undefined
      ) {
        // * Fetch all the lead ids and do this for all
        const [accountLeads, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            account_id: fetchedAccount.account_id,
            status: LEAD_STATUS.TRASH,
          },
        });

        // * These leads should be in progress
        for (let lead of accountLeads) {
          await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: lead.lead_id,
            },
            updateObject: {
              status: LEAD_STATUS.ONGOING,
              status_update_timestamp: new Date(),
            },
          });

          await Repository.create({
            tableName: DB_TABLES.STATUS,
            createObject: {
              lead_id: lead.lead_id,
              message: `Account status updated in salesforce to ${
                account?.[salesforceFieldMap?.integration_status.name]
              }`,
              status: LEAD_STATUS.ONGOING,
            },
          });
        }

        if (accountLeads.length > 0)
          TaskHelper.recalculateDailyTasksForUsers([fetchedAccount.user_id]);
      }

      // If account status is changed to converted
      if (
        account?.[salesforceFieldMap?.integration_status.name] ===
          salesforceFieldMap?.integration_status?.converted?.value &&
        salesforceFieldMap?.integration_status?.converted?.value !== undefined
      ) {
        await Repository.update({
          tableName: DB_TABLES.LEAD,
          query: { account_id: fetchedAccount.account_id },
          updateObject: {
            status: LEAD_STATUS.CONVERTED,
            status_update_timestamp: new Date(),
          },
        });

        // Fetch all the lead ids and do this for all
        const [accountLeads, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: { account_id: fetchedAccount.account_id },
        });

        for (let lead of accountLeads) {
          Repository.create({
            tableName: DB_TABLES.STATUS,
            createObject: {
              lead_id: lead.lead_id,
              status: LEAD_STATUS.CONVERTED,
            },
          });

          // * Fetch latest task for lead
          const [task, errForTask] = await Repository.fetchOne({
            tableName: DB_TABLES.TASK,
            query: {
              lead_id: lead.lead_id,
              completed: false,
              is_skipped: false,
            },
          });
          if (errForTask)
            logger.error(`Error while fetching latest task: `, errForTask);

          Repository.update({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: { lead_id: lead.lead_id },
            createObject: {
              status: CADENCE_LEAD_STATUS.STOPPED,
              status_node_id: task?.node_id ?? null,
            },
          });

          const [activityFromTemplate, errForActivityFromTemplate] =
            ActivityHelper.getActivityFromTemplates({
              type: ACTIVITY_TYPE.LEAD_CONVERTED,
              sub_type: ACTIVITY_SUBTYPES.ACCOUNT,
              activity: {
                lead_id: lead.lead_id,
                incoming: null,
              },
            });

          ActivityHelper.activityCreation(activityFromTemplate, lead.user_id);
        }
      } else if (
        account?.[salesforceFieldMap?.integration_status.name] !==
          salesforceFieldMap?.integration_status?.converted?.value &&
        account?.[salesforceFieldMap?.integration_status.name] !== undefined
      ) {
        // * Fetch all the lead ids and do this for all
        const [accountLeads, errForLeads] = await Repository.fetchAll({
          tableName: DB_TABLES.LEAD,
          query: {
            account_id: fetchedAccount.account_id,
            status: LEAD_STATUS.CONVERTED,
          },
        });

        // * These leads should be in progress
        for (let lead of accountLeads) {
          await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: lead.lead_id,
            },
            updateObject: {
              status: LEAD_STATUS.ONGOING,
              status_update_timestamp: new Date(),
            },
          });

          await Repository.create({
            tableName: DB_TABLES.STATUS,
            createObject: {
              lead_id: lead.lead_id,
              message: `Account status updated in salesforce to ${
                account?.[salesforceFieldMap?.integration_status.name]
              }`,
              status: LEAD_STATUS.ONGOING,
            },
          });
        }

        if (accountLeads.length > 0)
          TaskHelper.recalculateDailyTasksForUsers([fetchedAccount.user_id]);
      }

      i++;
      if (i === accounts.length)
        return successResponse(res, 'Accounts updated successfully.');
    }
    return successResponse(res, 'Accounts updated successfully.');
  } catch (err) {
    logger.error('Error while updating salesforce accounts: ', err);
    return serverErrorResponse(res);
  }
};

const updateAccountOwnerId = async (req, res) => {
  try {
    axios.put(`${SERVER_URL}/webhook/v1/salesforce/account/owner`, req.body, {
      headers: req.headers,
    });
    return successResponse(res, `Account owner successfully updated`);
    const { accounts } = req.body;
    let i = 0;
    while (i <= accounts.length) {
      if (i === accounts.length)
        return successResponse(res, 'Account owner successfully updated.');

      let account = accounts[i];
      const { salesforce_account_id, salesforce_owner_id } = account;

      // Fetching account
      const [fetchedAccount, errForAccount] = await Repository.fetchOne({
        tableName: DB_TABLES.ACCOUNT,
        //query: { salesforce_account_id },
        query: {
          integration_id: salesforce_account_id,
          integration_type: ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT,
        },
        include: {
          [DB_TABLES.USER]: {
            [DB_TABLES.COMPANY]: {
              where: { company_id: req.company_id },
              required: true,
            },
            required: true,
          },
        },
      });
      if (errForAccount || !fetchedAccount) {
        logger.info('Account not found or error for account');
        i++;
        continue;
      }

      // Fetching user
      let [newOwner, errForNewOwner] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          integration_id: salesforce_owner_id,
          integration_type: USER_INTEGRATION_TYPES.SALESFORCE_OWNER,
        },
      });
      if (errForNewOwner || !newOwner) {
        logger.info('Error for owner or owner not found.');
        i++;
        continue;
      }

      if (fetchedAccount.user_id === newOwner.user_id) {
        logger.info('New owner and old owner cannot be same.');
        i++;
        continue;
      }

      await Repository.update({
        tableName: DB_TABLES.ACCOUNT,
        query: { account_id: fetchedAccount.account_id },
        updateObject: { user_id: newOwner.user_id },
      });

      i++;
      if (i === accounts.length)
        return successResponse(res, 'Account owner successfully updated.');
    }

    return;

    // Fetching new owner
    //const [oldOwner, errForOldOwner] = await UserRepository.findUserByQuery({
    //user_id: account.user_id,
    //});
    //if (errForOldOwner)
    //return serverErrorResponse(res, 'Error finding old user.');
    //if (!oldOwner)
    //return notFoundResponse(
    //res,
    //'The current owner does not exist in the cadence tool.'
    //);

    //// Fetching new owner
    //const [newOwner, errForNewOwner] = await UserRepository.findUserByQuery({
    //salesforce_owner_id,
    //});
    //if (errForNewOwner)
    //return serverErrorResponse(res, 'Error finding new user.');
    //if (!newOwner)
    //return notFoundResponse(
    //res,
    //'The new owner does not exist in the cadence tool.'
    //);

    //// Check if the old and new owner is the same
    //if (oldOwner.user_id === newOwner.user_id)
    //return badRequestResponse(res, 'The old and new owner is the same.');

    //// Check if the sub department for both the owners is the same
    //if (oldOwner.sd_id !== newOwner.sd_id)
    //return badRequestResponse(
    //res,
    //'You cannot reassign this contact to an owner outside the sub department the old owner is current a part of.'
    //);

    //const [companySettings, errForCompanySettings] =
    //await CompanySettingsRepository.getCompanySettingsByQuery({
    //company_id: oldOwner.company_id,
    //});
    //if (errForCompanySettings)
    //return serverErrorResponse(
    //res,
    //`Error while fetching company settings: ${errForCompanySettings}`
    //);
    //if (!companySettings)
    //return serverErrorResponse(
    //res,
    //`Company settings not found. Contact support`
    //);

    //// Updating all the account owner in our db
    //const [updateAccount, errForAccountUpdate] =
    //await AccountRepository.updateAccountByQuery(
    //{ account_id: account.account_id },
    //{
    //user_id: newOwner.user_id,
    //}
    //);

    //// Updating the account owner in salesforce
    //await SalesforceService.updateAccountOwner(
    //salesforce_account_id,
    //salesforce_owner_id,
    //access_token,
    //instance_url
    //);

    //// If the setting for change contact owner when account changes is true
    //if (companySettings.change_contact_owners_when_account_change) {
    //// Updating all the contacts of the account in our db
    //const [lead, errForLead] = await LeadRepository.updateLeads(
    //{
    //account_id: account.account_id,
    //},
    //{
    //user_id: newOwner.user_id,
    //}
    //);

    //// Updating the contacts in salesforce
    //const [contacts, errForContacts] = await LeadRepository.getLeadsByQuery({
    //account_id: account.account_id,
    //});
    //for (let contact of contacts) {
    //await SalesforceService.updateContactOwner(
    //contact.salesforce_contact_id,
    //salesforce_owner_id,
    //access_token,
    //instance_url
    //);

    //await TaskRepository.updateTask(
    //{ lead_id: contact.lead_id },
    //{ user_id: newOwner.user_id }
    //);
    //}

    //return successResponse(
    //res,
    //'Account owner and their contacts successfully updated.'
    //);
    //}

    //return successResponse(res, 'Account owner successfully updated.');
  } catch (err) {
    logger.error('Error while updating account owner id: ', err);
    return serverErrorResponse(res, err.message);
  }
};

/**
 * @param {*} req
 * @param {*} res
 * @description with the deletion of Account
 * Delete the following records:
 * 1. Contacts
 * 2. Opportunities
 * 3. Activities with contacts
 * 4. Notes with contacts
 * @returns HTTP Response
 */
const deleteAccount = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    let count = 0;
    let { accounts } = req.body;
    let accountSfIds = accounts?.map(
      (account) => account?.salesforce_account_id
    );

    // Fetch all accounts
    let [fetchedAccounts, errForFetchedAccounts] = await Repository.fetchAll({
      tableName: DB_TABLES.ACCOUNT,
      query: {
        integration_id: {
          [Op.in]: accountSfIds,
        },
        integration_type: ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT,
      },
      extras: {
        attributes: ['account_id'],
      },
      t,
    });

    if (errForFetchedAccounts) {
      t.rollback();
      logger.error(
        'An error occured while fetching accounts',
        errForFetchedAccounts
      );
      return serverErrorResponse(res, errForFetchedAccounts);
    }

    let accountIds = fetchedAccounts?.map((account) => account?.account_id);

    // Fetch Contacts and delete them
    let [fetchedContacts, errForFetchedContacts] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        account_id: {
          [Op.in]: accountIds,
        },
        integration_type: LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
      },
      extras: {
        attributes: ['lead_id'],
      },
      t,
    });
    if (errForFetchedContacts) {
      t.rollback();
      logger.error(
        'An error occured while fetching contacts',
        errForFetchedContacts
      );
      return serverErrorResponse(res, errForFetchedContacts);
    }
    let contactIds = fetchedContacts?.map((contact) => contact?.lead_id);
    let [deletedContacts, errForDeletedContacts] = await deleteAllLeadInfo({
      leadIds: contactIds,
      accountIds,
      t,
    });
    if (errForDeletedContacts) {
      t.rollback();
      logger.error(
        'An error occured while deleting contacts',
        errForDeletedContacts
      );
      return serverErrorResponse(res, errForDeletedContacts);
    }

    // Delete the accounts
    let [deletedAccounts, errForDeletedAccounts] = await Repository.destroy({
      tableName: DB_TABLES.ACCOUNT,
      query: {
        account_id: {
          [Op.in]: accountIds,
        },
      },
      t,
    });

    if (errForDeletedAccounts) {
      t.rollback();
      logger.error(
        'An error occured while deleting accounts',
        errForDeletedAccounts
      );
      return serverErrorResponse(res, errForDeletedAccounts);
    }

    t.commit();
    logger.info('Deleted accounts and associated data');
    return successResponse(res, 'success');
  } catch (err) {
    t.rollback();
    logger.info('An error has occured', err?.message);
    return serverErrorResponse(res, 'An error occured in delete account');
  }
};

module.exports = {
  getAccount,
  updateAccounts,
  updateAccountOwnerId,
  deleteAccount,
};
