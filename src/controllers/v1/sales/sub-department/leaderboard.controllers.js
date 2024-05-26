// Utils
const logger = require('../../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
} = require('../../../../utils/response');
const {
  NODE_TYPES,
  LEADERBOARD_DATE_FILTERS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const assignRank = require('../../../../utils/assignRank');

// Packages
const { Op } = require('sequelize');

// Repositories
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const SubDepartmentRepository = require('../../../../../../Cadence-Brain/src/repository/sub-department.repository');
const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');

// Helpers and services
const LeaderboardHelper = require('../../../../../../Cadence-Brain/src/helper/leaderboard');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');

const getLeaderboardData = async (req, res) => {
  try {
    // * retreive filter
    const { filter } = req.params;
    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return serverErrorResponse(res, 'Invalid filter.');

    let result = [];
    // * fetch manager
    const [manager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    // * fetch manager's all users
    const [users, errForUsers] = await SubDepartmentRepository.getEmployees(
      manager.sd_id
    );
    if (errForUsers) return serverErrorResponse(res, errForUsers);

    // * fetch task's metric for all users
    const [taskMetrics, errForTaskMetrics] =
      await TaskHelper.getTasksCountByType(users, filter);
    if (errForTaskMetrics) return serverErrorResponse(res, errForTaskMetrics);

    result = taskMetrics;

    // * sort results by noOfTasksDone in Descending order
    result = result.sort((a, b) => {
      return b.tasks.noOfTasksDone - a.tasks.noOfTasksDone;
    });

    // * assign rank
    result = assignRank(result);

    return successResponse(res, 'Fetched leaderboard data', result);
  } catch (err) {
    logger.error(`Error while fetching leaderboatrd data: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const getLeaderboardGraph = async (req, res) => {
  try {
    let start_limit;
    let end_limit;

    // * retreive filter
    const { filter, user_id } = req.params;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return serverErrorResponse(res, 'Invalid filter.');

    // * fetch manager
    const [manager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    /*
    	// Fetch user with user_id and manager.sd_id (to ensure manager can view this user)
		- If no user found, reject.
	*/

    let [user, userErr] = await UserRepository.findUserByQuery({ user_id });
    if (userErr || user.sd_id !== manager.sd_id)
      return serverErrorResponse(res, userErr);

    const dateRange = LeaderboardHelper.dateFilters[filter](user?.timezone);
    let taskMap = {};
    let datesToFetch = [];

    let i = 0;
    if (
      filter === LEADERBOARD_DATE_FILTERS.TODAY ||
      filter === LEADERBOARD_DATE_FILTERS.YESTERDAY
    ) {
      if (filter === LEADERBOARD_DATE_FILTERS.TODAY) {
        var start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        var end = new Date();
        end.setUTCHours(23, 59, 59, 999);
        start_limit = start.getTime();
        end_limit = end.getTime();
      } else {
        var start = new Date();
        start.setDate(new Date().getDate() - 1);
        start.setUTCHours(0, 0, 0, 0);
        var end = new Date();
        end.setDate(new Date().getDate() - 1);
        end.setUTCHours(23, 59, 59, 999);

        start_limit = start.getTime();
        end_limit = end.getTime();
      }

      let processingTimeHour = start_limit;
      while (processingTimeHour <= end_limit) {
        let timeToAdd = new Date(processingTimeHour).getHours();
        taskMap[timeToAdd] = [];
        processingTimeHour = processingTimeHour + 60 * 60 * 1000;
      }

      // * fetch completed tasks
      let [tasks, errForTasks] =
        await TaskRepository.getTasksForLeaderboardGraph({
          user_id: user_id,
          completed: true,
          complete_time: {
            [Op.between]: dateRange,
          },
        });
      tasks = tasks.filter(
        (t) =>
          t['Node.type'] === NODE_TYPES.CALL ||
          t['Node.type'] === NODE_TYPES.MAIL ||
          t['Node.type'] === NODE_TYPES.MESSAGE
      );

      tasks.forEach((t) => {
        let timeToAdd = new Date(
          LeaderboardHelper.roundToHour(t['complete_time'])
        ).getHours();
        if (taskMap[timeToAdd]) taskMap[timeToAdd].push(t);
        else taskMap[timeToAdd] = [t];
      });
    } else {
      if (filter === LEADERBOARD_DATE_FILTERS.LAST_WEEK) {
        // * Generate last week dates
        let today = new Date(new Date());
        let x = new Date(
          new Date().setDate(today.getDate() - today.getDay() - 7)
        );
        x.setHours(24, 0, 0, 0);

        let y = new Date(new Date().setDate(today.getDate() - today.getDay()));
        y.setHours(24, 0, 0, 0);

        var range = LeaderboardHelper.getDates(x, y);

        range.forEach((date) => {
          let start = new Date(date);
          start.setUTCHours(0, 0, 0, 0);
          let end = new Date(date);
          end.setDate(date.getDate());
          end.setUTCHours(23, 59, 59, 999);
          datesToFetch.push([start, end]);
        });
      } else if (filter === LEADERBOARD_DATE_FILTERS.LAST_MONTH) {
        // * Generate last week dates (Date(today) - 14) to  (Date(today) - 7)

        let firstDayOfLastMonth = new Date();
        // * setting date to 1
        firstDayOfLastMonth.setDate(1);
        // * setting month as previous month
        firstDayOfLastMonth.setMonth(firstDayOfLastMonth.getMonth() - 1);
        // * setting time to start of day
        firstDayOfLastMonth.setHours(0, 0, 0, 0);

        // * to store lastDayOfLastMonth
        let lastDayOfLastMonth = new Date();
        lastDayOfLastMonth.setDate(0);

        lastDayOfLastMonth.setHours(24, 0, 0, 0);
        lastDayOfLastMonth = new Date(lastDayOfLastMonth.getTime() - 1);

        var range = LeaderboardHelper.getDates(
          firstDayOfLastMonth,
          lastDayOfLastMonth
        );

        range.forEach((date) => {
          let start = new Date(date);
          start.setUTCHours(0, 0, 0, 0);
          let end = new Date(date);
          end.setDate(date.getDate());
          end.setUTCHours(23, 59, 59, 999);

          datesToFetch.push([start, end]);
        });
      } else if (filter === LEADERBOARD_DATE_FILTERS.THIS_WEEK) {
        let today = new Date(new Date());
        let startOfThisweek = new Date(
          new Date().setDate(today.getDate() - today.getDay() + 1)
        );
        startOfThisweek.setHours(0, 0, 0, 0);
        let endOfThisWeek = new Date(
          new Date().setDate(today.getDate() - today.getDay() + 7)
        );
        endOfThisWeek.setHours(24, 0, 0, 0);

        var range = LeaderboardHelper.getDates(startOfThisweek, endOfThisWeek);

        range.forEach((date) => {
          let start = new Date(date);
          start.setUTCHours(0, 0, 0, 0);
          let end = new Date(date);
          end.setDate(date.getDate());
          end.setUTCHours(23, 59, 59, 999);

          datesToFetch.push([start, end]);
        });
      } else if (filter === LEADERBOARD_DATE_FILTERS.THIS_MONTH) {
        // * to store firstDayOfLastMonth
        let firstDayOfLastMonth = new Date();
        // * setting date to 1
        firstDayOfLastMonth.setDate(1);
        // * setting time to start of day
        firstDayOfLastMonth.setHours(0, 0, 0, 0);

        // * to store lastDayOfLastMonth
        let lastDayOfLastMonth = new Date();
        // * setting date to first date of this month
        lastDayOfLastMonth.setDate(1);
        // * setting month as next month
        lastDayOfLastMonth.setMonth(lastDayOfLastMonth.getMonth() + 1);
        // * setting date to last day of previous month
        lastDayOfLastMonth.setDate(0);
        // * setting time to start of day
        lastDayOfLastMonth.setHours(24, 0, 0, 0);
        lastDayOfLastMonth = new Date(lastDayOfLastMonth.getTime() - 1);

        var range = LeaderboardHelper.getDates(
          firstDayOfLastMonth,
          lastDayOfLastMonth
        );

        range.forEach((date) => {
          let start = new Date(date);
          start.setUTCHours(0, 0, 0, 0);
          let end = new Date(date);
          end.setDate(date.getDate());
          end.setUTCHours(23, 59, 59, 999);

          datesToFetch.push([start, end]);
        });
      }
      for (const d of datesToFetch) {
        let [tasks, errForTasks] =
          await TaskRepository.getTasksForLeaderboardGraph({
            user_id: user_id,
            completed: true,
            complete_time: {
              [Op.between]: [d[0].getTime(), d[1].getTime()],
            },
          });
        tasks = tasks.filter(
          (t) =>
            t['Node.type'] === NODE_TYPES.CALL ||
            t['Node.type'] === NODE_TYPES.MAIL ||
            t['Node.type'] === NODE_TYPES.MESSAGE
        );
        taskMap[d[0].toUTCString()] = tasks;
      }
    }

    return successResponse(res, 'Fetched leaderboard graph for user', {
      start_limit,
      end_limit,
      taskMap,
    });
  } catch (err) {
    logger.error(`Error while fetching leaderboatrd data: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const LeaderboardController = {
  getLeaderboardData,
  getLeaderboardGraph,
};

module.exports = LeaderboardController;
