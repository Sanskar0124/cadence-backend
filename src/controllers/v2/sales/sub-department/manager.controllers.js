// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  NODE_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');

// Models
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');
const ActivityRepository = require('../../../../../../Cadence-Brain/src/repository/activity.repository');

// Helpers and Services
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');

const getTasksForAnySdUser = async (req, res) => {
  try {
    let { filters, user_id } = req.body;

    if (!user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks for user',
        error: `User not provided`,
      });

    const managerPromise = UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    const userPromise = UserRepository.findUserByQuery({
      user_id,
    });

    const [[manager, errForManager], [user, errForUser]] = await Promise.all([
      managerPromise,
      userPromise,
    ]);

    if (errForManager)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks for user',
        error: `Error while fetching user by query: ${errForAdmin}`,
      });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks for user',
        error: `Error while fetching user by query: ${errForUser}.`,
      });

    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks for user',
        error: `Requested user not found`,
      });
    if (!manager)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks for user',
        error: `Manager not found`,
      });

    if (user.sd_id !== manager.sd_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `User does not belong to same sub-department`,
      });

    const [tasks, errForTasks] = await TaskHelper.getPendingTasksV2(
      filters,
      user_id
    );
    if (errForTasks)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch tasks for user',
        error: `Error while fetching users's tasks for manager: ${errForTasks}`,
      });

    return successResponse(res, `Fetched Tasks Successfully for user.`, tasks);
  } catch (err) {
    logger.error('Error while fetching tasks for any sd user: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching tasks for any sd user: ${err.message}.`,
    });
  }
};

const getCountSummaryForTasksViewForAnySdUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary for task view for user',
        error: `No user provided`,
      });

    const managerPromise = UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    const userPromise = UserRepository.findUserByQuery({
      user_id,
    });

    const [[manager, errForManager], [user, errForUser]] = await Promise.all([
      managerPromise,
      userPromise,
    ]);

    if (errForManager)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary for task view for user',
        error: `Error while fetching user by query: ${errForAdmin}.`,
      });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary for task view for user',
        error: `Error while fetching user by query: ${errForUser}.`,
      });

    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary for task view for user',
        error: `Requested user not found`,
      });
    if (!manager)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary for task view for user',
        error: `Manager not found`,
      });

    if (user.sd_id !== manager.sd_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `User does not belong to same sub-department`,
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
        msg: 'Failed to fetch count summary for task view for user',
        error: `Error while fetching count summary in task view for sub-department user: ${errForCompletedTasks}.`,
      });

    if (errForActivitiesCount)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch count summary for task view for user',
        error: `Error while fetching count summary in task view for sub-department user: ${errForActivitiesCount}).`,
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
      'Error while fetching count summary in task view for any sub-department user: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching count summary in task view for any sub-department user: ${err.message}.`,
    });
  }
};
const MangerController = {
  getTasksForAnySdUser,
  getCountSummaryForTasksViewForAnySdUser,
};

module.exports = MangerController;
