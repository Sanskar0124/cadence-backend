// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  NODE_TYPES,
  USER_ROLE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { Op } = require('sequelize');

// Models
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Joi
const LogoutJoi = require('../../../joi/v2/admin/logout.joi');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');
const TaskRepository = require('../../../../../Cadence-Brain/src/repository/task.repository');
const ActivityRepository = require('../../../../../Cadence-Brain/src/repository/activity.repository');

// Helpers and Services
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const RandomHelper = require('../../../../../Cadence-Brain/src/helper/random');
const RedisHelper = require('../../../../../Cadence-Brain/src/helper/redis');

const getTasksForAnyCompanyUser = async (req, res) => {
  try {
    let { filters, user_id } = req.body;

    if (!user_id)
      return badRequestResponseWithDevMsg({ res, msg: `User not provided` });

    const adminPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    const userPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
    });
    const [[admin, errForAdmin], [user, errForUser]] = await Promise.all([
      adminPromise,
      userPromise,
    ]);

    if (errForAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks',
        error: `Error while fetching admin: ${errForAdmin}.`,
      });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks',
        error: `Error while fetching user: ${errForUser}.`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: `Requested user not found`,
      });
    if (!admin)
      return notFoundResponseWithDevMsg({ res, msg: `Admin not found` });

    if (user.company_id !== admin.company_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `User does not belong to your company`,
      });

    const [tasks, errForTasks] = await TaskHelper.getPendingTasksV2(
      filters,
      user_id
    );
    if (errForTasks)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks',
        error: `Error while fetching users's tasks for manager: ${errForTasks}`,
      });

    return successResponse(res, `Fetched Tasks Successfully for user.`, tasks);
  } catch (err) {
    logger.error(`Error while fetching tasks for any sd user: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching tasks for any sd user: ${err.message}.`,
    });
  }
};

const getCountSummaryForTasksViewForAnyCompanyUser = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id)
      return badRequestResponseWithDevMsg({ res, msg: `User not provided` });

    const adminPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    const userPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
    });

    const [[admin, errForAdmin], [user, errForUser]] = await Promise.all([
      adminPromise,
      userPromise,
    ]);

    if (errForAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary',
        error: `Error while fetching admin: ${errForAdmin}.`,
      });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary',
        error: `Error while fetching user: ${errForUser}.`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: `Requested user not found`,
      });
    if (!admin)
      return notFoundResponseWithDevMsg({ res, msg: `Admin not found` });

    if (user.company_id !== admin.company_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `User does not belong to your company`,
      });

    // fetch time range in unix for today for user
    const timeRangeForToday = [
      UserHelper.setHoursForTimezone(0, new Date().getTime(), user.timezone),
      UserHelper.setHoursForTimezone(24, new Date().getTime(), user.timezone),
    ];
    //console.log(timeRangeForToday.map((t) => new Date(t).toLocaleString()));

    // promise to fetch completed tasks in time range
    const completedTasksPromise = TaskRepository.getCountForUserTasks(
      {
        user_id, // belongs to the requested user
        completed: 1,
        complete_time: {
          // was completed today
          [Op.between]: timeRangeForToday,
        },
      },
      {
        type: {
          [Op.notIn]: [NODE_TYPES.AUTOMATED_MAIL, NODE_TYPES.AUTOMATED_MESSAGE],
        },
      }
    );

    // promise to fetch count of activities by type in time range
    const activitiesCountPromise = ActivityRepository.getActivitiesByType(
      {
        // activity query
        incoming: 0, // * we should only count outgoing activities
        created_at: sequelize.where(
          sequelize.literal('unix_timestamp(Activity.created_at)*1000'),
          {
            [Op.between]: timeRangeForToday,
          }
        ),
      },
      {
        // lead query
        user_id,
      }
    );

    // resolve all promises
    const [
      [completedTasks, errForCompletedTasks],
      [activitiesCount, errForActivitiesCount],
    ] = await Promise.all([completedTasksPromise, activitiesCountPromise]);

    if (errForCompletedTasks)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary',
        error: `Error while fetching completed tasks: ${errForCompletedTasks}.`,
      });

    if (errForActivitiesCount)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary',
        error: `Error while fetching activities count: ${errForActivitiesCount}).`,
      });

    const data = {
      tasks: completedTasks || 0,
      activities: activitiesCount,
    };

    return successResponse(
      res,
      `Fetched count summary in task view for sub-department user successfully.`,
      data
    );
  } catch (err) {
    logger.error(
      `Error while fetching count summary in task view for any sub-department user: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching count summary in task view for any sub-department user: ${err.message}.`,
    });
  }
};

const getAllCadences = async (req, res) => {
  try {
    const [admin, errForAdmin] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching user by query: ${errForAdmin}`,
      });
    if (!admin)
      return badRequestResponseWithDevMsg({ res, msg: `Admin not found` });

    const [cadences, errForCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      include: {
        [DB_TABLES.SUB_DEPARTMENT]: {
          [DB_TABLES.DEPARTMENT]: {
            where: {
              company_id: admin.company_id,
            },
            include: [],
          },
          attributes: ['name'],
          required: true,
        },
        [DB_TABLES.USER]: {
          attributes: ['first_name', 'last_name'],
        },
        [DB_TABLES.NODE]: {
          attributes: ['node_id'],
        },
        [DB_TABLES.TAG]: {
          attributes: ['tag_name'],
        },
      },
    });
    if (errForCadences)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching cadences: ${errForCadences}`,
      });
    if (!cadences) return successResponse(res, 'No cadences found.');

    return successResponse(
      res,
      `Fetched cadences for admin successfully.`,
      cadences
    );
  } catch (err) {
    logger.error(`Error while fetching all cadences for admin: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching all cadences for admin: ${err.message}.`,
    });
  }
};

const updateSdUser = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    if (!req.body.user_id) {
      t.rollback();
      return badRequestResponseWithDevMsg({ res, msg: 'Enter user id' });
    }

    if (req.body.role && !Object.values(USER_ROLE).includes(req.body.role)) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Invalid role provided',
      });
    }

    // * Process Ringover User ID
    if (req.body.ringover_user_id) {
      if (!/^\d+$/.test(req.body.ringover_user_id))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Ringover User ID is not correct',
          error: 'Make sure your User ID is an integer',
        });

      req.body.ringover_user_id = parseInt(req.body.ringover_user_id);

      // if (req.body.ringover_user_id <= 10000)
      //   return badRequestResponseWithDevMsg({
      //     res,
      //     msg: 'Ringover User ID is not correct',
      //   });

      // * Subtract 10000
      // req.body.ringover_user_id = req.body.ringover_user_id - 10000;
    }

    const [admin, errForAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      t,
    });
    if (errForAdmin) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update user',
        error: `Error while fetching admin: ${errForAdmin}`,
      });
    }
    if (!admin) {
      t.rollback();
      return badRequestResponseWithDevMsg({ res, msg: `User not found` });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.body.user_id },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update user',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({ res, msg: `No user found` });
    }
    if (admin.company_id !== user.company_id) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'This user does not belong to your company.',
      });
    }

    // Check if the user being updated is same as requesting user
    if (req.body.user_id !== admin.user_id)
      if (req.body.role === USER_ROLE.SUPER_ADMIN) {
        // user whose role is being updated to super admin should be an admin
        if (user.role !== USER_ROLE.ADMIN) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Only admins can be a superadmin',
          });
        }
        // user modifying the role must be a Super Admin
        if (admin.role !== USER_ROLE.SUPER_ADMIN) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Only superadmin has access to change superadmin',
          });
        }
        // updating the previous Super Admin to Admin, as there can only be one Super Admin in a company
        const [updatedSuperAdmin, errForUpdatedSuperAdmin] =
          await Repository.update({
            tableName: DB_TABLES.USER,
            query: { user_id: admin.user_id },
            updateObject: { role: USER_ROLE.ADMIN },
            t,
          });
        if (errForUpdatedSuperAdmin) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update user',
            error: `Error while updating user: ${errForUpdatedSuperAdmin}`,
          });
        }
      }

    const { ringover_api_key } = req.body;

    const [updatedUser, errForUpdatedUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id: req.body.user_id },
      updateObject: req.body,
      t,
    });
    if (errForUpdatedUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update user',
        error: `Error while updating user: ${errForUpdatedUser}`,
      });
    }
    if (ringover_api_key) {
      const [encryptedRingoverKey, errForEncryptedRingoverKey] =
        CryptoHelper.encrypt(ringover_api_key);

      if (!errForEncryptedRingoverKey && encryptedRingoverKey)
        [updateToken, errForUpdateToken] = await Repository.update({
          tableName: DB_TABLES.USER_TOKEN,
          query: { user_id: req.body.user_id },
          updateObject: { encrypted_ringover_api_key: encryptedRingoverKey },
          t,
        });
      if (errForUpdateToken) {
        t.rollback();
        if (
          errForUpdateToken.includes('unique') ||
          errForUpdateToken.includes('duplicate')
        ) {
          errForUpdateToken = errForUpdateToken.replace('encrypted_', '');
          return badRequestResponseWithDevMsg({
            res,
            msg: 'User already exist in tool',
            error: `Error while updating user token: ${errForUpdateToken}`,
          });
        }
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update user',
          error: `Error while updating user token: ${errForUpdateToken}`,
        });
      }
    }

    t.commit();

    return successResponse(res, 'User Updated successfully.');
  } catch (err) {
    t.rollback();
    logger.error(`Error while updating sd user by admin: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating sd user by admin: ${err.message}`,
    });
  }
};

const fetchApiToken = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {
            attributes: ['encrypted_api_token', 'api_token'],
          },
        },
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch api token',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({ res, msg: `No user found` });

    if (user?.Company?.Company_Token?.encrypted_api_token === null)
      return successResponse(res, 'Kindly generate an api token.');

    return successResponse(
      res,
      'Fetched api token.',
      user?.Company?.Company_Token?.api_token
    );
  } catch (err) {
    logger.error(`Error while fetching api token: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching api token: ${err.message}`,
    });
  }
};

const generateApiToken = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to generate api token',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({ res, msg: `No user found` });

    // Generate random 64 character string
    const [apiToken, errForApiToken] = RandomHelper.getRandomString(64);
    if (errForApiToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to generate api token',
        error: `Error while generating token: ${errForApiToken}`,
      });

    // Encrypt the above randomly generated string
    const [encryptedApiToken, errForEncryptedApiToken] =
      CryptoHelper.encrypt(apiToken);
    if (errForEncryptedApiToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to generate api token',
        error: `Error while encrypting api token: ${errForEncryptedApiToken}`,
      });

    await Repository.update({
      tableName: DB_TABLES.COMPANY_TOKENS,
      query: { company_id: user.company_id },
      updateObject: { encrypted_api_token: encryptedApiToken },
    });

    return successResponse(res, 'Generated api token.', apiToken);
  } catch (err) {
    logger.error(`Error while generating api token: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while generating api token: ${err.message}`,
    });
  }
};

const logoutUser = async (req, res) => {
  try {
    let body = LogoutJoi.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: body.error.message,
      });
    body = body.value;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: { attributes: ['role'] },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to logout user',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({ res, msg: `User not found` });

    // salespersons check
    if (user.role === USER_ROLE.SALES_PERSON) {
      if (req.body.sd_id)
        return badRequestResponseWithDevMsg({
          res,
          msg: `You do not have persission to logout all sub-department users`,
        });
      if (!req.body.user_id)
        return badRequestResponseWithDevMsg({
          res,
          msg: `You need to provide user id`,
        });
    }

    // sales managers check
    if (
      [USER_ROLE.SALES_MANAGER, USER_ROLE.SALES_MANAGER_PERSON].includes(
        user.role
      ) &&
      !req.body.user_id &&
      !req.body.sd_id
    )
      return badRequestResponseWithDevMsg({
        res,
        msg: `You need to provide sd_id or user_id`,
      });

    let query = {
      company_id: req.user.company_id,
    };

    if (body.user_id) {
      let user_id_array = [].concat(body.user_id);
      query.user_id = {
        [Op.in]: user_id_array,
      };
    }
    if (body.sd_id) {
      const sd_id_array = [].concat(body.sd_id);
      query.sd_id = {
        [Op.in]: sd_id_array,
      };
    }

    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: query,
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        err,
        msg: 'Failed to logout user',
        error: `Error while fetching users: ${errForUsers}`,
      });

    let user_ids = users.map((user) => user.user_id);
    await user_ids.forEach(async (user_id) => {
      await RedisHelper.removeValue('accessToken_' + user_id);
    });
    return successResponse(res, 'Users logged out successfully');
  } catch (err) {
    logger.error(`Error while logging out users: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while logging out users: ${err.message}`,
    });
  }
};

const logoutAllUsers = async (req, res) => {
  try {
    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to logout all users',
        error: `Error while fetching users: ${errForUsers}`,
      });

    let user_ids = users.map((user) => user.user_id);
    await user_ids.forEach(async (user_id) => {
      await RedisHelper.removeValue('accessToken_' + user_id);
    });
    return successResponse(res, 'All Users logged out successfully');
  } catch (err) {
    logger.error(`Error while logging out all users: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while logging out all users: ${err.message}`,
    });
  }
};
const paymentData = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch payment details',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({ res, msg: `User not found` });

    const [company, errForCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: user.company_id },
      extras: {
        attributes: [
          'number_of_licences',
          'is_subscription_active',
          'is_trial_active',
          'trial_valid_until',
        ],
      },
    });
    if (errForCompany)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch payment details',
        error: `Error while fetching company: ${errForCompany}`,
      });
    if (!company)
      return badRequestResponseWithDevMsg({ res, msg: `Company not found` });
    return successResponse(
      res,
      `Fetched payment details successfully.`,
      company
    );
  } catch (err) {
    logger.error(`Error while finding payment details of company: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while finding payment details of company: ${err.message}`,
    });
  }
};

const AdminController = {
  getTasksForAnyCompanyUser,
  getCountSummaryForTasksViewForAnyCompanyUser,
  getAllCadences,
  updateSdUser,
  fetchApiToken,
  generateApiToken,
  logoutUser,
  logoutAllUsers,
  paymentData,
};

module.exports = AdminController;
