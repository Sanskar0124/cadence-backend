// Utils
const logger = require('../../../utils/winston');
const {
  serverErrorResponseWithDevMsg,
  successResponse,
  notFoundResponseWithDevMsg,
  forbiddenResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  unauthorizedResponseWithDevMsg,
  paymentRequiredResponseWithDevMsg,
} = require('../../../utils/response');
const {
  USER_ROLE,
  USER_DELETE_OPTIONS,
  COMPANY_CONTACT_REASSIGNMENT_OPTIONS,
  SETTING_TYPES,
  CRM_INTEGRATIONS,
  INTEGRATION_TYPE,
  SALESFORCE_DATA_IMPORT_TYPES,
  CADENCE_PRIORITY,
  CADENCE_TYPES,
  CADENCE_STATUS,
  NODE_TYPES,
  COMPANY_STATUS,
  PRODUCT_TOUR_STATUSES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  SALT_ROUNDS,
  FRONTEND_URL,
  MARKETPLACE_URL,
  DEV_AUTH,
} = require('../../../utils/config');
const {
  RINGOVER_OAUTH,
} = require('../../../../../Cadence-Brain/src/utils/config');
const {
  PREFIX_FOR_PRODUCT_TOUR_DUMMY_LEAD_INTEGRATION_ID,
  INTEGRATION_ID_FOR_PRODUCT_TOUR_CADENCE,
  REDIS_RINGOVER_ACCESS_TOKEN,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// Db
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Packages
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const axios = require('axios');
var FormData = require('form-data');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const LeadHelper = require('../../../../../Cadence-Brain/src/helper/lead');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const AmazonService = require('../../../../../Cadence-Brain/src/services/Amazon');
const MarketplaceHelper = require('../../../../../Cadence-Brain/src/helper/marketplace');
const token = require('../../../controllers/v1/user/authentication/token');
const HtmlHelper = require('../../../../../Cadence-Brain/src/helper/html');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const RedisHelper = require('../../../../../Cadence-Brain/src/helper/redis');
const UserTokensHelper = require('../../../../../Cadence-Brain/src/helper/userTokens');
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const CadenceHelper = require('../../../../../Cadence-Brain/src/helper/cadence');

// Joi
const userSchema = require('../../../joi/v2/user/user.joi');
const subDepartmentSchema = require('../../../joi/v2/sales/sub-department/sub-department.joi');

// Other
const getUsers = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'User does not exist',
        error: 'User not found',
      });

    let users = null,
      errForUsers = null;

    switch (user.role) {
      case USER_ROLE.SUPER_ADMIN:
      case USER_ROLE.ADMIN:
        // Fetch all users of the company
        [users, errForUsers] = await Repository.fetchAll({
          tableName: DB_TABLES.USER,
          query: { company_id: user.company_id },
        });
        break;

      case USER_ROLE.SALES_MANAGER_PERSON:
      case USER_ROLE.SALES_MANAGER:
      case USER_ROLE.SALES_PERSON:
        // Fetch all users of the user's sub-dept
        [users, errForUsers] = await Repository.fetchAll({
          tableName: DB_TABLES.USER,
          query: { sd_id: user.sd_id },
        });
        break;

      default:
        return forbiddenResponseWithDevMsg({
          res,
          msg: 'You do not have permission to access this',
        });
    }

    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching users: ${errForUsers}`,
      });

    return successResponse(res, 'Successfully fetched users.', users);
  } catch (err) {
    logger.error('Error while fetching users: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching users: ${err.message}`,
    });
  }
};

const getAllCompanyUsers = async (req, res) => {
  try {
    let [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { company_id: req.user.company_id },
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: {},
      },
      extras: {
        attributes: [
          'user_id',
          'first_name',
          'last_name',
          'is_profile_picture_present',
          'profile_picture',
          'sd_id',
        ],
      },
    });

    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users',
        error: `Error while fetching users: ${errForUsers}`,
      });

    return successResponse(res, 'Successfully fetched users.', users);
  } catch (err) {
    logger.error('Error while fetching users: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching users: ${err.message}`,
    });
  }
};

const deleteUser = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const params = userSchema.deleteUserBodySchema.validate(req.body);
    if (params.error)
      return badRequestResponseWithDevMsg({ res, error: params.error.message });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.body.user_id,
      },
      //include: {
      //[DB_TABLES.COMPANY]: {
      //[DB_TABLES.COMPANY_SETTINGS]: {},
      //},
      //},
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete user',
        error: `Error while fetching user details: ${err.message}.`,
      });
    }
    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
        error: `User not found`,
      });
    }

    let access_token, instance_url, errForAccessToken;
    if (req.body.option === USER_DELETE_OPTIONS.REASSIGN) {
      // * Get access token and instance url
      [{ access_token, instance_url }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: req.user.integration_type,
          user_id: req.user.user_id,
        });
      if (errForAccessToken) {
        t.rollback();
        if (
          [
            'Kindly log in with salesforce.',
            'Kindly log in with pipedrive.',
            'Kindly log in with hubspot.',
            'Kindly log in with sellsy.',
            'Kindly log in with zoho.',
            'Kindly log in with bullhorn.',
            'Kindly log in with dynamics.',
          ].includes(errForAccessToken)
        )
          return badRequestResponseWithDevMsg({
            res,
            msg: `${errForAccessToken} to reassign`,
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete user',
          error: `Error while fetching tokens: ${errForAccessToken}.`,
        });
      }
    }

    let [leads, errForLead] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        user_id: req.body.user_id,
        salesforce_lead_id: {
          [Op.ne]: null,
        },
      },
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['account_id'],
        },
      },
      t,
    });
    if (errForLead) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete user',
        error: `Error while fetching leads: ${errForLead}.`,
      });
    }

    let [contacts, errForContacts] = await Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        user_id: req.body.user_id,
        salesforce_contact_id: {
          [Op.ne]: null,
        },
      },
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['account_id', 'salesforce_account_id'],
        },
      },
      t,
    });
    if (errForContacts) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete user',
        error: `Error while fetching contacts: ${errForContacts}.`,
      });
    }

    const [deletedUser, errForDeletedUser] = await UserHelper.deleteAllUserInfo(
      req.body.user_id,
      t
    );
    if (errForDeletedUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete user',
        error: `Error while deleting all user info: ${errForDeletedUser}`,
      });
    }

    successResponse(res, 'Started process to delete user...');

    /**
     * * To delete all leads - delete all leads,tasks,leadToCadences,status etc.
     * * To re-assign all leads -  chnage user id from all leads, tasks,leadToCadences,status, etc.
     * * To un-assign all leads - delete user id from all leads, and delete all related tasks,leadToCadences,status
     */

    // * No leads for user, so no additional tasks needs to be done
    if (leads.concat(contacts).length === 0) {
      t.commit();
      logger.info(`No leads and contact found, so only deleted user.`);
      return;
    }

    if (req.body.option === USER_DELETE_OPTIONS.REASSIGN) {
      // * re-assign to other user

      let i = 0;
      // * store previous user count to get range for next user
      let previousUserCount = 0;

      let leadsForUser = [];
      let accountsForUser = [];

      // reassignment for leads
      // reassign in sf
      // if successful, reassign leads and task in our db
      for (let reassignToData of req.body.reassignToForLeads) {
        const [reassignToUser, errForReassignToUser] =
          await Repository.fetchOne({
            tableName: DB_TABLES.USER,
            query: {
              user_id: reassignToData?.user_id,
            },
            t,
          });
        if (errForReassignToUser) {
          logger.error(`Could not reassign for ${reassignToData?.user_id}`);
          i++;
          continue;
        }
        if (!reassignToUser) {
          logger.error(`Could not find user: ${reassignToData?.user_id}`);
          i++;
          continue;
        }

        if (i === 0) {
          leadsForUser = leads.slice(0, reassignToData?.count);
        } else if (i === req.body.reassignToForLeads?.length) {
          leadsForUser = leads.slice(
            reassignToData?.count,
            req.body.reassignToForLeads?.length
          );
        } else {
          leadsForUser = leads.slice(
            previousUserCount,
            previousUserCount + reassignToData?.count
          );
        }

        //update previousUserCount
        previousUserCount += reassignToData?.count;

        const [updatedLeads, errForUpdatedLeads] =
          await SalesforceService.bulkUpdateLeadOwner(
            leadsForUser,
            reassignToUser.salesforce_owner_id,
            access_token,
            instance_url
          );

        //updatedLeads = leadsForUser.map((lead) => lead.lead_id);

        if (updatedLeads?.length) {
          logger.info(
            `Successfully updated leads in salesforce, now updating in our db.`
          );
          let data = '',
            err = '';
          [data, err] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: {
                [Op.in]: updatedLeads,
              },
            },
            updateObject: {
              user_id: reassignToData?.user_id,
            },
            t,
          });

          if (req.body.reassignTasksForLeads) {
            [data, err] = await Repository.update({
              tableName: DB_TABLES.TASK,
              query: {
                user_id: req.body.user_id,
                lead_id: {
                  [Op.in]: updatedLeads,
                },
              },
              updateObject: {
                user_id: reassignToData?.user_id,
              },
              t,
            });
          }
        }

        i++;
      }

      let contactsForUser = [];
      accountsForUser = [];
      previousUserCount = 0;
      i = 0; // re-initialiaze

      // reassignment for contacts
      for (let reassignToData of req.body.reassignToForContacts) {
        const [reassignToUser, errForReassignToUser] =
          await Repository.fetchOne({
            tableName: DB_TABLES.USER,
            query: {
              user_id: reassignToData?.user_id,
            },
            t,
          });
        if (errForReassignToUser) {
          logger.error(`Could not reassign for ${reassignToData?.user_id}`);
          i++;
          continue;
        }
        if (!reassignToUser) {
          logger.error(`Could not find user: ${reassignToData?.user_id}`);
          i++;
          continue;
        }

        if (i === 0) {
          contactsForUser = contacts.slice(0, reassignToData?.count);
        } else if (i === req.body.reassignToForContacts?.length) {
          contactsForUser = contacts.slice(
            reassignToData?.count,
            req.body.reassignToForContacts?.length
          );
        } else {
          contactsForUser = contacts.slice(
            previousUserCount,
            previousUserCount + reassignToData?.count
          );
        }

        //console.log(
        //previousUserCount,
        //leadsForUser,
        //accountsForUser,
        //reassignToData?.user_id
        //);
        //
        //update previousUserCount
        previousUserCount += reassignToData?.count;

        let data = '',
          err = '';

        let updatedContacts = '',
          errForUpdatedContacts = '';

        let updatedAccounts = '',
          errForUpdatedAccounts = '';

        // if true, then update contact
        if (
          [
            COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_ONLY,
            COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_AND_ACCOUNT,
          ].includes(req.body.contact_reassignment_rule)
        ) {
          let tempContactsForUser = [...contactsForUser]; // make copy

          [updatedContacts, errForUpdatedContacts] =
            await SalesforceService.bulkUpdateContactOwner(
              tempContactsForUser,
              reassignToUser.salesforce_owner_id,
              access_token,
              instance_url
            );

          //updatedContacts = contactsForUser.map((contact) => contact.lead_id);

          if (updatedContacts?.length)
            logger.info(
              `Successfully updated contacts in salesforce, now updating in our db.`
            );
          [data, err] = await Repository.update({
            tableName: DB_TABLES.LEAD,
            query: {
              lead_id: {
                [Op.in]: updatedContacts,
              },
            },
            updateObject: {
              user_id: reassignToData?.user_id,
            },
            t,
          });
        }

        // if true, then update accounts as well
        if (
          [
            COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_AND_ACCOUNT,
            COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_ACCOUNT_AND_OTHER_CONTACTS,
          ].includes(req.body.contact_reassignment_rule)
        ) {
          accountsForUser = contactsForUser.map((contact) => contact?.Account);

          [updatedAccounts, errForUpdatedAccounts] =
            await SalesforceService.bulkUpdateAccountOwner(
              accountsForUser,
              reassignToUser.salesforce_owner_id,
              access_token,
              instance_url
            );

          //let updatedAccounts = accountsForUser.map(
          //(account) => account.account_id
          //);

          // if updated from sf, update in our db
          if (updatedAccounts?.length) {
            logger.info(
              `Successfully updated accounts in salesforce, now updating in our db.`
            );
            [data, err] = await Repository.update({
              tableName: DB_TABLES.ACCOUNT,
              query: {
                user_id: req.body.user_id,
                account_id: {
                  [Op.in]: updatedAccounts,
                },
              },
              updateObject: {
                user_id: reassignToData?.user_id,
              },
              t,
            });
          }

          // if true, update other contacts of accounts as well
          if (
            req.body.contact_reassignment_rule ===
            COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_ACCOUNT_AND_OTHER_CONTACTS
          ) {
            const [accountContacts, errForAccountContacts] =
              await Repository.fetchAll({
                tableName: DB_TABLES.LEAD,
                query: {
                  account_id: {
                    [Op.in]: updatedAccounts,
                  },
                },
                t,
              });

            if (errForAccountContacts) {
              logger.error(
                `Error while fetching account contacts: ${errForAccountContacts}.`
              );
              i++;
              continue;
            }

            [updatedContacts, errForUpdatedContacts] =
              await SalesforceService.bulkUpdateContactOwner(
                accountContacts,
                reassignToUser?.salesforce_owner_id,
                access_token,
                instance_url
              );

            //updatedContacts = accountContacts.map((contact) => contact.lead_id);

            if (updatedContacts?.length)
              logger.info(
                `Successfully updated contacts in salesforce, now updating in our db.`
              );
            [data, err] = await Repository.update({
              tableName: DB_TABLES.LEAD,
              query: {
                lead_id: {
                  [Op.in]: updatedContacts,
                },
              },
              updateObject: {
                user_id: reassignToData?.user_id,
              },
              t,
            });
          }
        }

        if (req.body.reassignTasksForContacts) {
          [data, err] = await Repository.update({
            tableName: DB_TABLES.TASK,
            query: {
              user_id: req.body.user_id,
              lead_id: {
                [Op.in]: updatedContacts,
              },
            },
            updateObject: {
              user_id: reassignToData?.user_id,
            },
            t,
          });
        }

        i++;
      }
    } else if (req.body.option === USER_DELETE_OPTIONS.DELETE_ALL) {
      // make array with ids
      let leadIds = [];
      let contactIds = [];
      let accountIds = [];

      leads.map((lead) => {
        leadIds.push(lead?.lead_id);
        accountIds.push(lead?.account_id);
      });

      contacts.map((contact) => {
        contactIds.push(contact?.lead_id);
        accountIds.push(contact?.account_id);
      });
      const [data, err] = await LeadHelper.deleteAllLeadInfo({
        leadIds: leadIds.concat(contactIds),
        accountIds: accountIds,
        t,
      });
      if (err) {
        logger.error(`Error while deleting leads/contacts info: ${err}`);
        return t.rollback();
      }
    }

    t.commit();
  } catch (err) {
    t.rollback();
    logger.error(`Error while deleting user: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting user: ${err.message}`,
    });
  }
};

const adminLoginAsUser = async (req, res) => {
  try {
    const { user_id } = req.user;

    const [requestUser, errForRequestUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['is_subscription_active', 'is_trial_active'],
        },
      },
    });
    if (errForRequestUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login as user',
        error: `Error while fetching user: ${errForRequestUser}`,
      });

    if (![USER_ROLE.SUPER_ADMIN, USER_ROLE.ADMIN].includes(requestUser.role)) {
      return forbiddenResponseWithDevMsg({
        res,
        msg: 'You do not have permission to access this',
      });
    }

    const { email } = req.body;
    if (!email)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not have an email',
      });

    let tokens;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokens = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokens = DB_TABLES.SELLSY_TOKENS;
        break;
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { email },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: [
            'is_subscription_active',
            'is_trial_active',
            'integration_type',
            'name',
            'ringover_team_id',
          ],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['phone_system', 'mail_integration_type'],
          },
        },
        [tokens]: {},
        [DB_TABLES.RINGOVER_TOKENS]: {
          order: [['created_at', 'DESC']],
          limit: 1,
        },
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login as user',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'No user found for the email',
      });

    // check if user belongs to the same company as admin
    if (requestUser.company_id !== user.company_id) {
      return forbiddenResponseWithDevMsg({
        res,
        msg: 'You do not have permission to access this',
      });
    }

    if (
      user?.Company?.is_subscription_active ||
      user?.Company?.is_trial_active
    ) {
      // * Check if there are any Ringover Tokens available
      if (!user.Ringover_Tokens.length)
        return unauthorizedResponseWithDevMsg({
          res,
          msg: `Please ask ${user.first_name} ${user.last_name} to login to cadence to use this functionality`,
        });

      // * Generate new access token
      const requestBody = new FormData();
      requestBody.append(
        'refresh_token',
        user.Ringover_Tokens[0].refresh_token
      );
      requestBody.append('grant_type', 'refresh_token');
      requestBody.append('client_id', RINGOVER_OAUTH.RINGOVER_CLIENT_ID_EU);

      const { data: ringover_tokens } = await axios.post(
        'https://auth.ringover.com/oauth2/access_token',
        requestBody,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...requestBody.getHeaders(),
          },
        }
      );

      // * Encrypting tokens
      [encryptedAccessToken, errAccessToken] = CryptoHelper.encrypt(
        ringover_tokens.id_token
      );
      if (errAccessToken)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to get access to account',
          error: `Error while encrypting access token: ${errAccessToken}`,
        });
      const [encryptedRefreshToken, errRefreshToken] = CryptoHelper.encrypt(
        ringover_tokens.refresh_token
      );
      if (errRefreshToken)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to get access to account',
          error: `Error while encrypting refresh token: ${errRefreshToken}`,
        });

      // * Calculate expires_in
      let expires_at = new Date();
      const milliseconds = ringover_tokens.expires_in * 1000;
      expires_at = new Date(expires_at.getTime() + milliseconds);

      // * Update token
      let [_, errUpdatingRingoverTokens] = await Repository.update({
        tableName: DB_TABLES.RINGOVER_TOKENS,
        query: {
          ringover_token_id: user.Ringover_Tokens[0].ringover_token_id,
        },
        updateObject: {
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          expires_at: expires_at,
        },
      });
      if (errUpdatingRingoverTokens)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to refresh session. Contact support',
          error: errUpdatingRingoverTokens,
        });

      // * Store Ringover Token in Redis
      const [redisStatus, redisError] = await RedisHelper.setWithExpiry(
        `${REDIS_RINGOVER_ACCESS_TOKEN}${encryptedAccessToken}`,
        `${user.user_id}:${user.Ringover_Tokens[0].region}`,
        3600
      );
      if (redisError)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to refresh session. Contact support',
          error: redisError,
        });

      let instance_url = '';
      switch (req.user.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          instance_url = user?.Salesforce_Token?.instance_url || '';
          break;
        case CRM_INTEGRATIONS.PIPEDRIVE:
          instance_url = user?.Pipedrive_Token?.instance_url || '';
          break;
        default:
          instance_url = '';
      }

      return successResponse(res, 'Successfully logged in.', {
        ringover_tokens,
        user_id: user.user_id,
        sd_id: user.sd_id,
        company_id: user.company_id,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        email: user.email,
        primary_email: user.primary_email,
        linkedin_url: user.linkedin_url,
        primary_phone_number: user.primary_phone_number,
        timezone: user.timezone,
        profile_picture: user.profile_picture,
        is_call_iframe_fixed: user.is_call_iframe_fixed,
        is_trial_active: user?.Company?.is_trial_active,
        company_name: user.Company.name,
        ringover_team_id: user.Company.ringover_team_id,
        created_at: user?.created_at,
        language: user.language,
        integration_type: user?.Company?.integration_type,
        instance_url,
        phone_system: user.Company.Company_Setting.phone_system,
        mail_integration_type:
          user.Company.Company_Setting.mail_integration_type,
      });
    }
  } catch (err) {
    logger.error(`Error while logging in user: `, err);

    if (err.response?.status === 401)
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Please ask user to login to cadence to use this functionality',
      });

    serverErrorResponseWithDevMsg({
      res,
      error: `Error while logging as user: ${err.message}`,
    });
  }
};

const forgotPasswordClick = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Email cannot be empty',
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { email },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'A user with this email does not exist',
      });

    const userToken = token.generateToken({ user_id: user.user_id });

    const [mail, err] = await AmazonService.sendHtmlMails({
      subject: 'Ringover Cadence Password Change.',
      body: HtmlHelper.changePassword(
        `${FRONTEND_URL}/crm/user/changePassword?token=${userToken}`
      ),
      emailsToSend: [user.email],
    });
    if (err) {
      if (err.includes('Sending paused for this account.'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'There is an issue with sending mails. Please try again after sometime or contact support',
          error: `Error while sending mails: ${err}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while sending mails: ${err}`,
      });
    }

    return successResponse(
      res,
      'Kindly check your email for the password reset link.'
    );
  } catch (err) {
    logger.error(`Error while trying forgot password: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while trying forget password: ${err.message}`,
    });
  }
};

const changeForgottenPassword = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = subDepartmentSchema.setUpPasswordSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'The password must be at least 8 characters long and contain at least one uppercase letter and one special character and must have no spaces',
      });
    }

    const { a_token } = req.query;
    const { language } = req.body;

    const { valid, user_id } = token.access.verify(a_token);
    if (!valid)
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Unauthorized',
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: [
            'is_subscription_active',
            'is_trial_active',
            'integration_type',
          ],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['phone_system', 'mail_integration_type'],
          },
        },
      },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change password',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `User does not exist`,
        error: 'User not found',
      });
    }

    if (
      user?.Company?.is_subscription_active === 0 &&
      user?.Company?.is_trial_active === 0
    ) {
      if (!user?.Company?.is_subscription_active) {
        t.rollback();
        return paymentRequiredResponseWithDevMsg({ res });
      } else if (!user?.Company?.is_trial_active) {
        t.rollback();
        return paymentRequiredResponseWithDevMsg({
          res,
          msg: 'Your trial period has ended',
        });
      }
    }

    const hashedPassword = bcrypt.hashSync(req.body.password, SALT_ROUNDS);

    // Step: set up update object for user
    let updateObjectForUser = {
      password: hashedPassword,
    };
    // Step: If language was passed then update it
    if (language) updateObjectForUser.language = language;

    const [updatedUser, errForUpdateUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: updateObjectForUser,
      t,
    });
    if (errForUpdateUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change password',
        error: `Error while updating user: ${errForUpdateUser}`,
      });
    }
    // Step: If language was passed, then it was updated, so updated language should be returned
    user.language = language || user.language;

    let tokens;
    switch (user.Company?.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokens = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        tokens = DB_TABLES.HUBSPOT_TOKENS;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokens = DB_TABLES.SELLSY_TOKENS;
        break;
    }

    let instanceUrl = {};
    if (tokens) {
      const [instanceUrlObj, errForInstanceUrl] = await Repository.fetchOne({
        tableName: tokens,
        query: { user_id },
        t,
      });
      if (errForInstanceUrl) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to change password',
          error: `Error while fetching tokens: ${errForInstanceUrl}`,
        });
      }
      instanceUrl = instanceUrlObj;
    }

    if (user.role === USER_ROLE.SUPER_ADMIN) {
      // update password in marketplace
      const [marketplaceUpdate, errForMarketplaceUpdate] =
        await MarketplaceHelper.updatePassword(user_id, hashedPassword);
      if (errForMarketplaceUpdate) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to change password',
          error: `Error occured while updating password: ${errForMarketplaceUpdate}`,
        });
      }
    }

    t.commit();

    if (
      user?.Company?.is_subscription_active ||
      user?.Company?.is_trial_active
    ) {
      const accessToken = token.access.generate(
        user.user_id,
        user.email,
        user.first_name,
        user.role,
        user.sd_id
      );

      const [_, errForValidToken] = await UserTokensHelper.setValidAccessToken(
        accessToken,
        user.user_id
      );
      if (errForValidToken)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to change password',
          error: `Error while setting valid access token: ${errForValidToken}`,
        });

      return successResponse(res, 'Successfully logged in.', {
        accessToken,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        linkedin_url: user.linkedin_url,
        primary_phone_number: user.primary_phone_number,
        timezone: user.timezone,
        columns: user.columns,
        profile_picture: user.profile_picture,
        smart_action: user.smart_action,
        smart_action_type: user.smart_action_type,
        language: user.language,
        integration_type: user?.Company?.integration_type,
        instance_url: instanceUrl?.instance_url ?? '',
        phone_system: user.Company.Company_Setting.phone_system,
        mail_integration_type:
          user.Company.Company_Setting.mail_integration_type,
      });
    }
  } catch (err) {
    t.rollback();
    logger.error(`Error while changing forgot password: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while changing forget password: ${err.message}`,
    });
  }
};

const fetchAutomatedTasksDelay = async (req, res) => {
  try {
    const [setting, errForSetting] = await UserHelper.getSettingsForUser({
      user_id: req.params.user_id,
      setting_type: SETTING_TYPES.AUTOMATED_TASK_SETTINGS,
    });
    if (errForSetting)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch automated task delay',
        error: `Error while fetching settings for user: ${errForSetting}`,
      });
    if (!setting)
      return serverErrorResponseWithDevMsg({ res, msg: `Setting not found` });
    let automatedSetting = setting?.Automated_Task_Setting;
    if (!automatedSetting)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Automated task setting not found`,
      });

    return successResponse(res, `Fetched delay successfully.`, {
      is_wait_time_random: automatedSetting.is_wait_time_random,
      wait_time_upper_limit: automatedSetting.wait_time_upper_limit,
      wait_time_lower_limit: automatedSetting.wait_time_lower_limit,
      delay: automatedSetting.delay,
    });
  } catch (err) {
    logger.error(`Error while fetching delay for automated tasks: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching delay for automated tasks: ${err.message}`,
    });
  }
};

const checkIfOnboardingComplete = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['is_onboarding_complete'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to check onboarding status',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
        error: 'User not found',
      });

    return successResponse(res, 'Fetched onboarding value.', { ...user });
  } catch (err) {
    logger.error(`Error while checking if onboarding is complete: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking if onboarding is complete: ${err.message}`,
    });
  }
};

const updateOnboardingValue = async (req, res) => {
  try {
    const { is_onboarding_complete } = req.body;
    if (![0, 1, true, false].includes(is_onboarding_complete))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update onboarding value',
        error: 'Send an appropriate value for onboarding',
      });

    // Update company status and create mock cadences for super admin
    if (req.user.role === USER_ROLE.SUPER_ADMIN && is_onboarding_complete) {
      // * Check if the email is unique
      //let config = {
      //method: 'post',
      //url: `${MARKETPLACE_URL}/v1/integrations/onboarded`,
      //headers: {
      //Authorization: `Bearer ${DEV_AUTH}`,
      //'Content-Type': 'application/json',
      //},
      //data: JSON.stringify({
      //type: req.user.integration_type,
      //company_id: req.user.company_id,
      //}),
      //};
      //await axios(config);
      // * Create mock cadences

      CadenceHelper.createMockCadences({
        company_id: req.user.company_id,
        user_id: req.user.user_id,
        integration_type: req.user.integration_type,
      });

      // set company status to configured
      Repository.update({
        tableName: DB_TABLES.COMPANY,
        query: { company_id: req.user.company_id },
        updateObject: { status: COMPANY_STATUS.CONFIGURED },
      });
    }

    const [updateUser, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      updateObject: { is_onboarding_complete },
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update onboarding value',
        error: `Error while updating user: ${errForUpdate}`,
      });

    return successResponse(res, 'Updated onboarding value.');
  } catch (err) {
    logger.error(`Error while updating onboarding value: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating onboarding value: ${err.message}`,
    });
  }
};

// * Check if user with email exist
const checkIfUserWithEmailExist = async (req, res) => {
  try {
    let [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        email: req.body.email,
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to check if user with email exist',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    if (user)
      return successResponse(res, 'User exists', {
        exists: true,
      });

    return successResponse(res, 'User does not exist', {
      exists: false,
    });
  } catch (err) {
    logger.error(`An error occurred while checking user with email : `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking if user with email exist: ${err.message}`,
    });
  }
};

const disconnectUser = async (req, res) => {
  try {
    const accessToken = req.headers.authorization.split(' ')[1];
    let [validTokens, errForValidTokens] = await RedisHelper.getValue(
      'accessToken_' + req.user.user_id
    );
    if (errForValidTokens)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to disconnect user',
        error: `Error while disconnecting user: ${errForValidTokens}`,
      });
    validTokens = JSON.parse(validTokens);

    let index = -1;

    for (let i in validTokens) {
      let validToken = validTokens[i];
      validToken = validToken.split('$expiry=')?.[0];
      if (validToken === accessToken) {
        index = i;
        break;
      }
    }

    //const i = validTokens.indexOf(accessToken);
    //validTokens.splice(i, 1);
    if (index === -1)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Can't disconnect user`,
      });
    validTokens.splice(index, 1);
    const [_, errForUpdate] = await RedisHelper.setValue(
      'accessToken_' + req.user.user_id,
      JSON.stringify(validTokens)
    );
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to disconnect user',
        error: `Error while storing value in reddis: ${errForUpdate}`,
      });
    return successResponse(res, 'User disconnected successfully');
  } catch (err) {
    logger.error(`Error while disconnecting user: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while disconnecting user: ${err.message}`,
    });
  }
};

const getChangeOwner = async (req, res) => {
  try {
    const query = {};
    const role = req.user.role;

    switch (role) {
      case USER_ROLE.SUPER_ADMIN:
      case USER_ROLE.ADMIN:
        query.company_id = req.user.company_id;
        break;
      case USER_ROLE.SALES_MANAGER:
        query.sd_id = req.user.sd_id;
        query.role = [USER_ROLE.SALES_PERSON, USER_ROLE.SALES_MANAGER];
        break;
      default:
        return forbiddenResponseWithDevMsg({
          res,
          msg: 'You do not have permission to access this resource.',
        });
    }

    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query,
      extras: {
        attributes: [
          [
            sequelize.fn(
              'CONCAT',
              sequelize.col('first_name'),
              ' ',
              sequelize.col('last_name')
            ),
            'full_name',
          ],
          'user_id',
        ],
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error fetching users: ${errForUsers}`,
      });

    return successResponse(res, 'fetched owner change to successfully', users);
  } catch (err) {
    logger.error('Error while fetching users to share: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching users to share: ${err.message}`,
    });
  }
};

const getCompanyAutomatedTaskSettings = async (req, res) => {
  try {
    let [userSpecificSetting, errForUserSpecificSetting] =
      await UserHelper.getSettingsForUser({
        user_id: req.user.user_id,
        setting_type: SETTING_TYPES.AUTOMATED_TASK_SETTINGS,
      });
    if (errForUserSpecificSetting)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user settings',
        error: `Error while fetching user settings: ${errForUserSpecificSetting}`,
      });

    return successResponse(
      res,
      'Automated task settings fetched successfully',
      {
        settings_id: userSpecificSetting?.settings_id,
        at_settings_id:
          userSpecificSetting?.Automated_Task_Setting?.at_settings_id,
        start_hour: userSpecificSetting?.Automated_Task_Setting?.start_hour,
        end_hour: userSpecificSetting?.Automated_Task_Setting?.end_hour,
        working_days: userSpecificSetting?.Automated_Task_Setting?.working_days,
      }
    );
  } catch (err) {
    logger.error('Error while fetching automated task settings: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching automated task settings: ${err.message}`,
    });
  }
};

/**
 * creates dummy leads for product tour of any user
 * */
const createDummyLeadsForProductTour = async (req, res) => {
  try {
    // Destructure req.user
    const { user_id, company_id } = req.user;
    logger.info(`Creating dummy leads for product tour...`, { user_id });

    // Step: JOI Validation
    const params = userSchema.createDummyLeadsForProductTourSchema.validate(
      req.body
    );
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: `Failed to import leads`,
        error: params.error.message,
      });

    // Step: fetch cadence and node
    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id: req.body.cadence_id },
      include: {
        [DB_TABLES.NODE]: {
          where: { is_first: 1, step_number: 1 }, // fetch first node only
          attributes: ['node_id', 'type', 'wait_time', 'next_node_id', 'data'],
          required: false,
        },
      },
      extras: {
        attributes: ['cadence_id', 'status', 'salesforce_cadence_id'],
      },
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to import leads`,
        error: `Error while creating leads: ${errForCadence}`,
      });
    if (!cadence)
      return badRequestResponseWithDevMsg({ res, msg: `Cadence not found` });
    // if cadence is not a product tour cadence, don't import
    if (
      cadence.salesforce_cadence_id !== INTEGRATION_ID_FOR_PRODUCT_TOUR_CADENCE
    )
      return badRequestResponseWithDevMsg({
        res,
        msg: `Failed to import leads`,
        error: `Not a product tour cadence`,
      });
    // Destructure node
    const node = cadence?.Nodes?.[0];
    // if cadence is in progress and first node is not found, then return error
    if (cadence.status === CADENCE_STATUS.IN_PROGRESS && !node)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to import leads`,
        error: `Node not found`,
      });

    // Step: Create dummy leads
    const [data, err] = await LeadHelper.createDummyLeads({
      user_id,
      company_id,
      cadence,
      node,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to import leads`,
        error: `Error while creating leads: ${err}`,
      });
    logger.info(`Created dummy leads for product tour.`, { user_id });
    return successResponse(res, `Created leads successfully`, data);
  } catch (err) {
    logger.error(`Error while creating dummy leads for product tour`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      msg: `Failed to import leads`,
      error: `Error while creating dummy leads for product tour: ${err.message}`,
    });
  }
};

/**
 * marks product tour status to PRODUCT_TOUR_STATUSES.AFTER_ONBOARDGING_COMPLETED for the user who is calling the route
 * */
const markProductTourCompleted = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Destructure req.user
    const { user_id, product_tour_status } = req.user;
    logger.info(`Updating product tour status...`, { user_id });

    // Step: Validation checks
    // check if already completed
    if (
      product_tour_status === PRODUCT_TOUR_STATUSES.AFTER_ONBOARDGING_COMPLETED
    ) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `Product tour already completed`,
      });
    }

    // Step: mark product tour as completed
    const [data, err] = await UserHelper.markProductTourAsCompleted({
      user_id,
      t,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Error occured while completing product tour`,
        error: err,
      });
    }

    // Step: Commit the transaction
    t.commit();

    TaskHelper.recalculateDailyTasksForUsers([user_id]);

    return successResponse(res, `Marked product tour as completed`);
  } catch (err) {
    t.rollback();
    logger.error(`Error while updating product tour status: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating product tour status: ${err.message}`,
    });
  }
};

const UserControllers = {
  getUsers,
  getAllCompanyUsers,
  deleteUser,
  forgotPasswordClick,
  changeForgottenPassword,
  fetchAutomatedTasksDelay,
  checkIfOnboardingComplete,
  updateOnboardingValue,
  adminLoginAsUser,
  checkIfUserWithEmailExist,
  disconnectUser,
  getChangeOwner,
  getCompanyAutomatedTaskSettings,
  createDummyLeadsForProductTour,
  markProductTourCompleted,
};

module.exports = UserControllers;
