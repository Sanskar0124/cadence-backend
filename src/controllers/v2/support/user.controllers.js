// Utils
const logger = require('../../../utils/winston');
const {
  serverErrorResponseWithDevMsg,
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  badRequestResponseWithDevMsg,
} = require('../../../utils/response');
const {
  USER_ROLE,
  ONBOARDING_MAIL_STATUS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const { FRONTEND_URL } = require('../../../utils/config');

// * Packages
const { Op } = require('sequelize');

// * Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');

// * Helper Imports
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');
const AmazonService = require('../../../../../Cadence-Brain/src/services/Amazon');
const HtmlHelper = require('../../../../../Cadence-Brain/src/helper/html');
const OnboardingHelper = require('../../../../../Cadence-Brain/src/helper/onboarding');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');

// * Joi import
const userSchema = require('../../../joi/v2/support/user.joi');

const addSupportAgent = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { value, error } = userSchema.addSupportAgentSchema.validate(
      req.body
    );
    if (error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: error.message,
      });
    }

    const ringoverUserIds = value.map((user) => user.ringover_user_id);

    const [user, errForUser] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        ringover_user_id: {
          [Op.in]: ringoverUserIds,
        },
      },
      extras: {
        attributes: ['user_id', 'ringover_user_id'],
      },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const existingRingoverUserIds =
      user?.map((user) => user.ringover_user_id) || [];
    const newUsers = value.filter(
      (user) => !existingRingoverUserIds.includes(user.ringover_user_id)
    );

    // Set default roles for new users
    newUsers.forEach((newUser) => {
      newUser.role = USER_ROLE.SUPPORT_AGENT;
      newUser.support_role = USER_ROLE.SUPPORT_AGENT;
    });

    if (newUsers?.length) {
      const [_, errForCreateUser] = await Repository.bulkCreate({
        tableName: DB_TABLES.USER,
        createObject: newUsers,
        t,
      });
      if (errForCreateUser) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while creating user: ${errForCreateUser}`,
        });
      }
    }

    if (existingRingoverUserIds?.length) {
      const [__, errForUpdateUser] = await Repository.update({
        tableName: DB_TABLES.USER,
        updateObject: {
          support_role: USER_ROLE.SUPPORT_AGENT,
        },
        query: { ringover_user_id: { [Op.in]: existingRingoverUserIds } },
        t,
      });
      if (errForUpdateUser) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating user: ${errForUpdateUser}`,
        });
      }
    }

    t.commit();
    return successResponse(res, 'Successfully added support agent');
  } catch (err) {
    t.rollback();
    logger.error(`An error occurred while adding support agent`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

const removerSupportUser = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { user_id } = req.params;
    if (!user_id) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: 'User id is required',
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
      extras: {
        attributes: ['role'],
      },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: errForUser,
      });
    }

    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: 'User not found',
      });
    }

    if (
      [USER_ROLE.SUPPORT_AGENT, USER_ROLE.SUPPORT_ADMIN]?.includes(user?.role)
    ) {
      const [_, errForDeleteUser] = await Repository.destroy({
        tableName: DB_TABLES.USER,
        query: { user_id },
        t,
      });
      if (errForDeleteUser) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          error: errForDeleteUser,
        });
      }
    }

    const [__, errForUpdateUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: {
        support_role: null,
      },
      t,
    });
    if (errForUpdateUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: errForUpdateUser,
      });
    }

    t.commit();
    return successResponse(res, 'Successfully removed support agent');
  } catch (err) {
    t.rollback();
    logger.error(`An error occurred while removing support agent`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

const updateSupportUserRole = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { user_id } = req.params;
    const { support_role } = req.query;

    if (!user_id) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: 'User id is required',
      });
    }

    if (!support_role) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: 'Support role is required',
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
      extras: {
        attributes: ['support_role'],
      },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: errForUser,
      });
    }

    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: 'User not found',
      });
    }

    const [_, errForUpdateUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: {
        support_role,
      },
      t,
    });
    if (errForUpdateUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: errForUpdateUser,
      });
    }

    t.commit();
    return successResponse(res, 'Successfully updated support user role');
  } catch (err) {
    t.rollback();
    logger.error(`An error occurred while updating support user role`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

const sendMailToSuperAdmin = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to send mail',
        error: 'User ID is required',
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
      extras: {
        attributes: ['email', 'role', 'language', 'first_name'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to send mail',
        error: errForUser,
      });

    if (!user || user?.role !== USER_ROLE.SUPER_ADMIN)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to send mail',
        error: 'User does not exist or is not a super admin',
      });

    const [mail, errForMail] = await AmazonService.sendHtmlMails({
      subject: OnboardingHelper.getSubjectForProductTourCadence({
        language: user?.language,
      }),
      body: HtmlHelper.inviteMailForSuperAdmin({
        url: `${FRONTEND_URL}/crm/welcome`,
        user_first_name: user?.first_name || '',
        language: user?.language,
      }),
      emailsToSend: [user.email],
      tracking: true,
    });
    if (errForMail) {
      t.rollback();
      if (errForMail.includes('Sending paused for this account.'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Failed to send mail`,
          error:
            'There is an issue with sending mails. Please try again after sometime or contact support',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to send mail`,
        error: `Error while sending mail: ${errForMail}`,
      });
    }

    await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id },
      updateObject: {
        onboarding_mail_message_id: mail?.MessageId,
        onboarding_mail_status: ONBOARDING_MAIL_STATUS.PROCESSING,
      },
    });

    return successResponse(res, 'Mail sent successfully');
  } catch (err) {
    logger.error(`Error while sending mail: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Failed to send email',
      error: `Error while sending mail: ${err.message}`,
    });
  }
};

/**
 * marks product tour status to PRODUCT_TOUR_STATUSES.AFTER_ONBOARDGING_COMPLETED for the user who is calling the route
 * */
const markProductTourAsCompleted = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    // user_id whose product tour needs to be skipped
    const { user_id } = req.params;

    // Check if user_id is present in our db
    const [paramUser, errForParamUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id },
      extras: {
        attributes: ['user_id'],
      },
      t,
    });
    if (errForParamUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching user: ${errForParamUser}`,
      });
    }
    if (!paramUser) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `User not found`,
      });
    }

    // mark product tour as complete
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
    // commit the transaction
    t.commit();

    TaskHelper.recalculateDailyTasksForUsers([user_id]);
    return successResponse(res, `Marked product tour as completed`);
  } catch (err) {
    t.rollback();
    logger.error(`Error while skipping product tour: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while skipping product tour: ${err.message}`,
    });
  }
};

const userControllers = {
  addSupportAgent,
  removerSupportUser,
  updateSupportUserRole,
  sendMailToSuperAdmin,
  markProductTourAsCompleted,
};

module.exports = userControllers;
