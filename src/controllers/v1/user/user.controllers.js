// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const { SALT_ROUNDS } = require('../../../utils/config');
const {
  USER_DELETE_OPTIONS,
  LEAD_STATUS,
  CRM_INTEGRATIONS,
  USER_ROLE,
  HIRING_INTEGRATIONS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');

// Models
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');
const UserTokenRepository = require('../../../../../Cadence-Brain/src/repository/user-token.repository');
const LeadRepository = require('../../../../../Cadence-Brain/src/repository/lead.repository');
const TaskRepository = require('../../../../../Cadence-Brain/src/repository/task.repository');
const StatusRepository = require('../../../../../Cadence-Brain/src/repository/status.repository');
const LeadToCadenceRepository = require('../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const EmailRepository = require('../../../../../Cadence-Brain/src/repository/email.repository');
const AccountRepository = require('../../../../../Cadence-Brain/src/repository/account.repository');
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers
const Storage = require('../../../../../Cadence-Brain/src/services/Google/Storage');
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const LeadHelper = require('../../../../../Cadence-Brain/src/helper/lead');
const MarketplaceHelper = require('../../../../../Cadence-Brain/src/helper/marketplace');
const StatisticsHelper = require('../../../../../Cadence-Brain/src/helper/statistics');

const getUser = async (req, res) => {
  try {
    let { integration_type } = req.user;

    let tokensToFetch = null;
    let attributes = [
      'is_logged_out',
      'encrypted_instance_url',
      'instance_url',
    ];
    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokensToFetch = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokensToFetch = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        tokensToFetch = DB_TABLES.HUBSPOT_TOKENS;
        break;
      case CRM_INTEGRATIONS.SHEETS:
        tokensToFetch = null;
        break;
      case CRM_INTEGRATIONS.ZOHO:
        tokensToFetch = DB_TABLES.ZOHO_TOKENS;
        attributes.push('data_center');
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokensToFetch = DB_TABLES.SELLSY_TOKENS;
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        tokensToFetch = DB_TABLES.BULLHORN_TOKENS;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        tokensToFetch = DB_TABLES.DYNAMICS_TOKENS;
        break;
      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch user. Please try again later or contact support',
          error: 'Bad Integration type',
        });
    }

    let [user, err] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: [
            'encrypted_ringover_api_key',
            'ringover_api_key',
            'encrypted_linkedin_cookie',
            'linkedin_cookie',
            'is_google_token_expired',
            'is_outlook_token_expired',
            'lusha_service_enabled',
            'kaspr_service_enabled',
            'hunter_service_enabled',
            'dropcontact_service_enabled',
            'snov_service_enabled',
            'extension_version',
          ],
        },
        // [DB_TABLES.RINGOVER_TOKENS]: {
        //   attributes: ['ringover_token_id', 'region'],
        // },
        [tokensToFetch]: {
          attributes,
        },
        [DB_TABLES.COMPANY]: {
          //[DB_TABLES.COMPANY_TOKENS]: {
          //attributes: ['encrypted_api_token', 'api_token'],
          //},
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: [
              'mail_integration_type',
              'phone_system',
              'email_scope_level',
            ],
          },
          attributes: [
            'integration_id',
            'name',
            'ringover_team_id',
            'is_trial_active',
          ],
        },
      },
      extras: {
        attributes: [
          'user_id',
          'profile_picture',
          'first_name',
          'last_name',
          'email',
          'primary_email',
          'role',
          'primary_phone_number',
          'timezone',
          'language',
          'integration_id',
          'create_agendas_from_custom_task',
          'calendly_url',
          'is_call_iframe_fixed',
          'is_onboarding_complete',
          'callback_device',
          'company_id',
          'sd_id',
          'department_id',
          'product_tour_status',
          'product_tour_step',
          'created_at',
          'focus_delay',
        ],
      },
    });
    if (user === null)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
      });
    if (err)
      return badRequestResponseWithDevMsg({
        res,
        error: `Error while fetching user: ${err}`,
      });

    if (!user?.User_Token)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user',
        error: `Error while fetching user tokens.`,
      });

    user.api_token = user?.Company?.Company_Token?.api_token;
    user.mail_integration_type =
      user?.Company?.Company_Setting?.mail_integration_type;
    user.phone_system = user?.Company?.Company_Setting?.phone_system;
    user.email_scope_level = user?.Company?.Company_Setting?.email_scope_level;
    user.company_integration_id = user?.Company?.integration_id;
    user.company_name = user.Company.name;
    user.ringover_team_id = user.Company.ringover_team_id;
    user.is_trial_active = user?.Company?.is_trial_active;
    user.is_google_token_expired = user?.User_Token?.is_google_token_expired;
    user.is_outlook_token_expired = user?.User_Token?.is_outlook_token_expired;
    user.ringover_api_key = user?.User_Token?.ringover_api_key;
    user.linkedin_cookie = user?.User_Token?.linkedin_cookie;

    // delete encrypted fields and fields which should not be sent to frontend
    delete user?.Company;
    //delete user?.User_Token;
    delete user?.User_Token?.encrypted_ringover_api_key;
    delete user?.User_Token?.encrypted_linkedin_cookie;
    delete user?.[tokensToFetch]?.encrypted_instance_url;

    // merge User_Token in user
    user = { ...user, ...user?.User_Token };

    // delete user token
    // not deleted above since we first delete unwanted things from User_Token then merged it in user and then deleted it so User_Token does not go in frontend
    delete user?.User_Token;

    return successResponse(res, 'Fetched user successfully', {
      user,
    });
  } catch (err) {
    logger.error(`Error while fetching user: `, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching user: ${err}`,
    });
  }
};

const updateUser = async (req, res) => {
  try {
    if (req.body.ringover_api_key) {
      const [encryptedRingoverApiKey, errForEncryptedRingoverApiKey] =
        CryptoHelper.encrypt(req.body.ringover_api_key);
      const [userToken, errForUserToken] =
        await UserTokenRepository.updateUserTokenByQuery(
          { user_id: req.user.user_id },
          { encrypted_ringover_api_key: encryptedRingoverApiKey }
        );

      if (errForUserToken)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update user',
          error: `Error while updating user token by query: ${errForUserToken}`,
        });
      delete req.body.ringover_api_key;
    }

    if (req.body.linkedin_cookie) {
      const [encryptedLinkedinCookie, errForEncryptedLinkedinCookie] =
        CryptoHelper.encrypt(req.body.linkedin_cookie);

      const [, errForLinkedCookie] = await Repository.update({
        tableName: DB_TABLES.USER_TOKEN,
        query: {
          user_id: req.user.user_id,
        },
        updateObject: {
          encrypted_linkedin_cookie: encryptedLinkedinCookie,
        },
      });
      if (errForLinkedCookie)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update user',
          error: `Error while updating user token: ${errForLinkedCookie}`,
        });

      delete req.body.linkedin_cookie;
    }

    const [updatedUser, err] = await UserRepository.updateUserById(
      req.body,
      req.user.user_id
    );

    if (err)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update user',
        error: `Error while updating user by id: ${err}`,
      });

    if (updatedUser === null)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'User does not exist',
      });

    if (
      (req.body.first_name || req.body.last_name) &&
      !req.user.is_profile_picture_present
    ) {
      const first_name =
        typeof req.body.first_name == 'string'
          ? req.body.first_name
          : req.user.first_name;
      const last_name =
        typeof req.body.last_name == 'string'
          ? req.body.last_name
          : req.user.last_name;

      const [profileUrl, errForProfileUrl] = await UserHelper.createAvatar({
        user_id: req.user.user_id,
        first_name,
        last_name,
      });
      logger.info(`profileUrl for user_id ${req.user.user_id} : ${profileUrl}`);
    }

    if (req.body.timezone)
      StatisticsHelper.recalculateStatisticsForUserRoute({
        company_id: req.user.company_id,
        timezone: req.body.timezone,
      });

    return successResponse(res, 'Updated user successfully');
  } catch (err) {
    logger.error(`Error while updating user: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating user: ${err.message}`,
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    if (!Object.values(USER_DELETE_OPTIONS).includes(req.body?.option))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete user',
        error: `Invalid option`,
      });

    let [leads, errForLead] = await LeadRepository.getLeadsIdFromQuery({
      user_id: req.body.user_id,
    });

    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete user',
        error: `Error while fetching leads ids from query: ${errForLeadIds}`,
      });

    const [deletedUser, errForDeletedUser] = await UserHelper.deleteAllUserInfo(
      req.body.user_id
    );

    if (errForDeletedUser) {
      if (errForDeletedUser === 'User does not exist.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to delete user',
          error: `Error while deleting all user info: ${errForDeletedUser}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete user',
        error: `Error while deleting all user info: ${errForDeletedUser}`,
      });
    }

    /**
     * * To delete all leads - delete all leads,tasks,leadToCadences,status etc.
     * * To re-assign all leads -  chnage user id from all leads, tasks,leadToCadences,status, etc.
     * * To un-assign all leads - delete user id from all leads, and delete all related tasks,leadToCadences,status
     */

    // * No leads for user, so no additional tasks needs to be done
    if (leads.length === 0)
      return successResponse(res, `Successfully deleted user.`);

    // * make array with lead ids
    let leadIds = [];

    let accountIds = [];
    leads.map((lead) => {
      leadIds.push(lead?.lead_id);
      accountIds.push(lead?.account_id);
    });

    if (req.body.option === USER_DELETE_OPTIONS.UNASSIGN) {
      // * update leads of the user and delete user_id
      await LeadRepository.updateLeads(
        {
          user_id: req.body.user_id,
        },
        {
          user_id: null,
          status: LEAD_STATUS.UNASSIGNED,
        }
      );

      // * delete all emails
      await EmailRepository.deleteEmailsByQuery({
        lead_id: {
          [Op.in]: leadIds,
        },
      });

      // * delete all tasks
      await TaskRepository.deleteTasksByQuery({
        user_id: req.body.user_id,
      });

      // * delete all status
      await StatusRepository.deleteStatusByQuery({
        lead_id: {
          [Op.in]: leadIds,
        },
      });

      // * delete all LeadtoCadences
      await LeadToCadenceRepository.deleteLeadToCadenceLink({
        lead_id: {
          [Op.in]: leadIds,
        },
      });
    } else if (req.body.option === USER_DELETE_OPTIONS.REASSIGN) {
      // * re-assign to other user

      let i = 0;
      // * store previous user count to get range for next user
      let previousUserCount = 0;

      let leadsForUser = [];
      let accountsForUser = [];

      for (let reassignToData of req.body.reassignTo) {
        if (i === 0) {
          leadsForUser = leadIds.slice(0, reassignToData?.count);
          accountsForUser = accountIds.slice(0, reassignToData?.count);
        } else if (i === req.body.reassignTo?.length) {
          leadsForUser = leadIds.slice(
            reassignToData?.count,
            req.body.reassignTo?.length
          );
          accountsForUser = accountIds.slice(
            reassignToData?.count,
            req.body.reassignTo?.length
          );
        } else {
          leadsForUser = leadIds.slice(
            previousUserCount,
            previousUserCount + reassignToData?.count
          );
          accountsForUser = accountIds.slice(
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

        // * update all leads
        await LeadRepository.updateLeads(
          {
            lead_id: {
              [Op.in]: leadsForUser,
            },
          },
          {
            user_id: reassignToData?.user_id,
          }
        );

        // * update all tasks
        await TaskRepository.updateTask(
          {
            user_id: req.body.user_id,
            lead_id: {
              [Op.in]: leadsForUser,
            },
          },
          {
            user_id: reassignToData?.user_id,
          }
        );

        await AccountRepository.updateAccountByQuery(
          {
            user_id: req.body.user_id,
            account_id: {
              [Op.in]: accountsForUser,
            },
          },
          {
            user_id: reassignToData?.user_id,
          }
        );
        i++;
      }
    } else if (req.body.option === USER_DELETE_OPTIONS.DELETE_ALL)
      await LeadHelper.deleteAllLeadInfo({ leadIds });

    return successResponse(res, 'User deleted successfully.');
  } catch (err) {
    logger.error(`Error while deleting user: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting user: ${err.message}`,
    });
  }
};

const updatePassword = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
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
      });
    }

    if (!bcrypt.compareSync(req.body.currentPassword, user.password)) {
      t.rollback();
      logger.info('Password does not match.');
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Password does not match',
      });
    }
    logger.info('Password matches.');

    const newHashedPassword = bcrypt.hashSync(
      req.body.newPassword,
      SALT_ROUNDS
    );

    const [data, err] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      updateObject: { password: newHashedPassword },
      t,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to change password',
        error: `Error occured while updating password: ${err}`,
      });
    }
    logger.info('Updated password successfully.');

    if (user.role === USER_ROLE.SUPER_ADMIN) {
      // update password in marketplace
      const [marketplaceUpdate, errForMarketplaceUpdate] =
        await MarketplaceHelper.updatePassword(
          req.user.user_id,
          newHashedPassword
        );
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
    return successResponse(res, 'Password changed successfully.');
  } catch (err) {
    t.rollback();
    logger.error(`Error while updating password: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating password: ${err.message}`,
    });
  }
};

const updateProfilePicture = async (req, res) => {
  try {
    console.log(req.file);
    const [url, err] = await Storage.Bucket.upload(
      req.file.buffer,
      req.user.user_id
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update profile picture',
        error: `Error while uploading profile picture: ${err}`,
      });

    // -----------------------------------------------------------------------------

    const [data, e] = await UserRepository.updateUserById(
      {
        is_profile_picture_present: true,
      },
      req.user.user_id
    );

    // -----------------------------------------------------------------------------
    if (e)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update profile picture',
        error: `Error while updating user by id: ${e}`,
      });

    return successResponse(res, 'Updated profile image');
  } catch (err) {
    logger.error(`Error while updating profile picture: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating profile picture: ${err.message}`,
    });
  }
};

const areTokensExpired = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: ['is_google_token_expired', 'is_outlook_token_expired'],
        },
        [DB_TABLES.SALESFORCE_TOKENS]: { attributes: ['is_logged_out'] },
        [DB_TABLES.PIPEDRIVE_TOKENS]: { attributes: ['is_logged_out'] },
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to check if token is expired',
        error: `Error while fetching user tokens: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'User does not exist',
      });

    const { is_google_token_expired, is_outlook_token_expired } =
      user?.User_Token;
    let is_logged_out;
    if (user?.Salesforce_Token !== null)
      is_logged_out = user?.Salesforce_Token?.is_logged_out;
    else if (user?.Pipedrive_Token !== null)
      is_logged_out = user?.Pipedrive_Token?.is_logged_out;
    else is_logged_out = false;

    return successResponse(res, 'Fetched token status', {
      is_google_token_expired,
      is_outlook_token_expired,
      is_logged_out,
    });
  } catch (err) {
    logger.error('Error while checking tokens expired: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking tokens expired: ${err.message}`,
    });
  }
};

const UserController = {
  getUser,
  updateUser,
  deleteUser,
  updatePassword,
  updateProfilePicture,
  areTokensExpired,
};

module.exports = UserController;
