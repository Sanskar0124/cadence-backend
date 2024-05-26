// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  NODE_TYPES,
  LEADERBOARD_DATE_FILTERS,
  CADENCE_STATUS,
  LEAD_STATUS,
  TAG_NAME,
  CADENCE_LEAD_STATUS,
  CUSTOM_TASK_NODE_ID,
  HEATMAP_OPTIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  URGENT_TIME_DIFF_FOR_INBOUND,
  URGENT_TIME_DIFF_FOR_OUTBOUND,
} = require('../../../../../../Cadence-Brain/src/utils/constants');

// Packages
const moment = require('moment');
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers
const LeaderboardHelper = require('../../../../../../Cadence-Brain/src/helper/leaderboard');
const getCompleteTasksInInterval = require('../../../../../../Cadence-Brain/src/helper/statistics/manager/getCompleteTasksInInterval');
const StatisticsHelper = require('../../../../../../Cadence-Brain/src/helper/statistics');
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');

const pendingTaskStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending tasks statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending tasks statistics',
        error: 'Invalid filter',
      });

    if (!user_ids || user_ids.length === 0) user_ids = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);

    let [start_date, end_date] = dateRange;

    if (
      [
        LEADERBOARD_DATE_FILTERS.THIS_WEEK,
        LEADERBOARD_DATE_FILTERS.THIS_MONTH,
        LEADERBOARD_DATE_FILTERS.TODAY,
      ].includes(filter)
    )
      end_date = new Date().getTime();

    let cadence_ids_array = [];

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    if (!cadence_id || cadence_id.length === 0) {
      const [personalAndTeamCadences, errForPersonalCadenceId] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['team', 'personal'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                sd_id: user.sd_id,
              },
              required: true,
            },
          },
        });
      if (errForPersonalCadenceId) {
        logger.error(
          `Error while fetching personal cadence for user`,
          errForPersonalCadenceId
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch pending tasks statistics',
          error: `Error while fetching personal cadence for user: ${errForPersonalCadenceId}`,
        });
      }

      const [companyCadences, errForCompanyCadences] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['company'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                company_id: user.company_id,
              },
              required: true,
            },
          },
        });
      if (errForCompanyCadences) {
        logger.error(
          `Error while fetching company cadences for user`,
          errForCompanyCadences
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch pending tasks statistics',
          error: `Error while fetching company cadences for user: ${errForCompanyCadences}`,
        });
      }

      for (let cadence of personalAndTeamCadences)
        cadence_ids_array.push(cadence.cadence_id);

      for (let cadence of companyCadences)
        cadence_ids_array.push(cadence.cadence_id);
    }
    if (!cadence_ids_array || cadence_ids_array.length === 0)
      cadence_ids_array = null;

    let [settings, errForSettings] = await UserHelper.getSettingsForUser({
      user_id: user.user_id,
      setting_type: DB_TABLES.TASK_SETTINGS,
    });

    let lateSettings = settings?.Task_Setting?.late_settings || {};

    const [pendingTaskStatistics, errForPendingTaskStatistics] =
      await StatisticsHelper.getPendingTasks(
        user,
        start_date,
        end_date,
        user_ids,
        cadence_id,
        cadence_ids_array,
        {
          company_id: user.company_id,
        },
        lateSettings
      );
    if (errForPendingTaskStatistics) {
      logger.error('Error while fetching count', errForPendingTaskStatistics);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending tasks statistics',
        error: `Error while fetching pending tasks: ${errForPendingTaskStatistics}`,
      });
    }

    return successResponse(
      res,
      'Fetched pending task statistics',
      pendingTaskStatistics
    );
  } catch (err) {
    logger.error(`Error while fetching pending task statistics:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching pending task statistics: ${err.message}`,
    });
  }
};

const completedTaskStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch completed task statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch completed task statistics',
        error: 'Invalid filter',
      });

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);

    const [start_date, end_date] = dateRange;

    let cadence_ids_array = [];

    if (!cadence_id || cadence_id.length === 0) {
      const [personalAndTeamCadences, errForPersonalCadenceId] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['team', 'personal'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                sd_id: user.sd_id,
              },
              required: true,
            },
          },
        });
      if (errForPersonalCadenceId) {
        logger.error(
          `Error while fetching personal cadence for user`,
          errForPersonalCadenceId
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch completed task statistics',
          error: `Error while fetching cadences: ${errForPersonalCadenceId}`,
        });
      }

      const [companyCadences, errForCompanyCadences] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['company'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                company_id: user.company_id,
              },
              required: true,
            },
          },
        });
      if (errForCompanyCadences) {
        logger.error(
          `Error while fetching company cadences for user`,
          errForCompanyCadences
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch completed task statistics',
          error: `Error while fetching company cadences: ${errForCompanyCadences}`,
        });
      }

      for (let cadence of personalAndTeamCadences)
        cadence_ids_array.push(cadence.cadence_id);

      for (let cadence of companyCadences)
        cadence_ids_array.push(cadence.cadence_id);
    }
    if (!cadence_ids_array || cadence_ids_array.length === 0)
      cadence_ids_array = null;

    const [completedTasks, errForCompletedTasks] = await Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        cadence_id: cadence_id ?? cadence_ids_array,
        user_id: user_ids ?? { [Op.ne]: null },
      },

      include: {
        [DB_TABLES.CADENCE]: {
          attributes: [],
          required: true,
        },
        [DB_TABLES.NODE]: {
          attributes: ['type'],
          required: true,
          where: {
            type: {
              [Op.notIn]: [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_MESSAGE,
              ],
            },
          },
        },
        [DB_TABLES.USER]: {
          attributes: [],
          where: {
            company_id: user.company_id,
          },
          required: true,
        },
      },
      extras: {
        subQuery: false,
        group: ['Node.type'],
        attributes: [
          [
            sequelize.literal(`COUNT(CASE
                WHEN complete_time BETWEEN ${start_date} AND ${end_date} AND completed=1
                THEN 1
                ELSE NULL
            END ) `),
            'complete_task_count',
          ],
          [
            sequelize.literal(`COUNT(CASE
                WHEN skip_time BETWEEN ${start_date} AND ${end_date} AND is_skipped=1
                THEN 1
                ELSE NULL
            END ) `),
            'skipped_task_count',
          ],
        ],
      },
    });
    if (errForCompletedTasks) {
      logger.error('Error while fetching count', errForCompletedTasks);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch completed task statistics',
        error: `Error while fetching tasks: ${errForCompletedTasks}`,
      });
    }

    return successResponse(
      res,
      'Fetched completed task statistics',
      completedTasks
    );
  } catch (err) {
    logger.error(`Error while fetching completed task statistics:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching completed task statistics: ${err.message}`,
    });
  }
};

const historyTableStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history table statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history table statistics',
        error: 'Invalid filter',
      });

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);

    const [start_date, end_date] = dateRange;

    let cadence_ids_array = [];

    if (!cadence_id || cadence_id.length === 0) {
      const [personalAndTeamCadences, errForPersonalCadenceId] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['team', 'personal'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                sd_id: user.sd_id,
              },
              required: true,
            },
          },
        });
      if (errForPersonalCadenceId) {
        logger.error(
          `Error while fetching personal cadence for user`,
          errForPersonalCadenceId
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch history table statistics',
          error: `Error while fetching cadences: ${errForPersonalCadenceId}`,
        });
      }

      const [companyCadences, errForCompanyCadences] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['company'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                company_id: user.company_id,
              },
              required: true,
            },
          },
        });
      if (errForCompanyCadences) {
        logger.error(
          `Error while fetching company cadences for user`,
          errForCompanyCadences
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch history table statistics',
          error: `Error while fetching company cadences for user: ${errForCompanyCadences}`,
        });
      }

      for (let cadence of personalAndTeamCadences)
        cadence_ids_array.push(cadence.cadence_id);

      for (let cadence of companyCadences)
        cadence_ids_array.push(cadence.cadence_id);
    }
    if (!cadence_ids_array || cadence_ids_array.length === 0)
      cadence_ids_array = null;

    const completedTasksPromise = Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        cadence_id: cadence_id ?? cadence_ids_array,
        user_id: user_ids ?? { [Op.ne]: null },
        complete_time: {
          [Op.between]: [start_date, end_date],
        },
        completed: true,
      },

      include: {
        [DB_TABLES.CADENCE]: {
          attributes: ['cadence_id', 'name'],
          required: true,
        },
        [DB_TABLES.NODE]: {
          attributes: ['type'],
          required: true,
          where: {
            type: {
              [Op.notIn]: [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_MESSAGE,
              ],
            },
          },
        },
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'first_name',
            'last_name',
            'role',
            'profile_picture',
            'is_profile_picture_present',
          ],
          required: true,
          where: {
            company_id: user.company_id,
          },
        },
      },
      extras: {
        subQuery: false,
        group: ['Node.type', 'Task.user_id', 'Task.cadence_id'],
        attributes: [
          [
            sequelize.literal(`COUNT(DISTINCT task_id ) `),
            'completed_task_count',
          ],
          [sequelize.literal(`COUNT(DISTINCT task.lead_id ) `), 'people_count'],
          'user_id',
          'task_id',
        ],
      },
    });
    const contactedPeoplePromise = Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        cadence_id: cadence_id ?? cadence_ids_array,
        user_id: user_ids ?? { [Op.ne]: null },
        complete_time: {
          [Op.between]: [start_date, end_date],
        },
        completed: true,
      },

      include: {
        [DB_TABLES.CADENCE]: {
          attributes: ['cadence_id'],
          required: true,
        },
        [DB_TABLES.NODE]: {
          attributes: [],
          required: true,
          where: {
            type: {
              [Op.notIn]: [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_MESSAGE,
              ],
            },
          },
        },
        [DB_TABLES.USER]: {
          attributes: [],
          required: true,
          where: {
            company_id: user.company_id,
          },
        },
      },
      extras: {
        subQuery: false,
        group: ['Task.user_id', 'Task.cadence_id'],
        attributes: [
          [sequelize.literal(`COUNT(DISTINCT task.lead_id ) `), 'people_count'],
          [sequelize.literal(`COUNT(DISTINCT task_id ) `), 'done_task_count'],
          'user_id',
        ],
      },
    });
    const [
      [completedTasks, errForCompletedTasks],
      [contactedPeople, errForContactedPeople],
    ] = await Promise.all([completedTasksPromise, contactedPeoplePromise]);
    if (errForCompletedTasks || errForContactedPeople) {
      logger.error(
        'Error while fetching history table count',
        errForCompletedTasks || errForContactedPeople
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history table statistics',
        error: `Error while fetching history table count: ${
          errForCompletedTasks || errForContactedPeople
        }`,
      });
    }

    let result = {};

    for (let task of completedTasks) {
      if (result.hasOwnProperty(task.Cadence.cadence_id)) {
        if (result[task.Cadence.cadence_id].hasOwnProperty(task.user_id)) {
          result[task.Cadence.cadence_id][task.user_id][
            `${task.Node.type}_count`
          ] = task.completed_task_count;
          result[task.Cadence.cadence_id][task.user_id].people_count +=
            task.people_count;
        } else {
          result[task.Cadence.cadence_id][task.user_id] = {
            [`${task.Node.type}_count`]: task.completed_task_count,
            people_count: task.people_count,
            user_id: task.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
          };
        }
      } else {
        result[task.Cadence.cadence_id] = {
          cadence_id: task.Cadence.cadence_id,
          name: task.Cadence.name,
          [task.user_id]: {
            people_count: task.people_count,
            user_id: task.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
            [`${task.Node.type}_count`]: task.completed_task_count,
          },
        };
      }
    }

    for (let task of contactedPeople) {
      result[task.Cadence.cadence_id][task.user_id].people_count =
        task.people_count;
      result[task.Cadence.cadence_id][task.user_id].done_task_count =
        task.done_task_count;
    }

    for (let cadence in result) {
      result[cadence].total_email_count = 0;
      result[cadence].total_message_count = 0;
      result[cadence].total_linkedin_count = 0;
      result[cadence].total_data_check_count = 0;
      result[cadence].total_done_task_count = 0;
      result[cadence].total_people_count = 0;
      result[cadence].total_call_count = 0;
      result[cadence].total_user_count = 0;
      result[cadence].total_cadence_custom_count = 0;

      for (let user in result[cadence]) {
        result[cadence][user].email_count =
          (result[cadence][user]?.[`${NODE_TYPES.MAIL}_count`] ?? 0) +
          (result[cadence][user]?.[`${NODE_TYPES.REPLY_TO}_count`] ?? 0);

        result[cadence][user].linkedin_count =
          (result[cadence][user]?.[`${NODE_TYPES.LINKEDIN_MESSAGE}_count`] ??
            0) +
          (result[cadence][user]?.[`${NODE_TYPES.LINKEDIN_CONNECTION}_count`] ??
            0) +
          (result[cadence][user]?.[`${NODE_TYPES.LINKEDIN_PROFILE}_count`] ??
            0) +
          (result[cadence][user]?.[`${NODE_TYPES.LINKEDIN_INTERACT}_count`] ??
            0);

        result[cadence].total_email_count +=
          result[cadence][user]?.email_count ?? 0;
        result[cadence].total_linkedin_count +=
          result[cadence][user]?.linkedin_count ?? 0;
        result[cadence].total_data_check_count +=
          result[cadence][user]?.data_check_count ?? 0;
        result[cadence].total_done_task_count +=
          result[cadence][user]?.done_task_count ?? 0;
        result[cadence].total_people_count +=
          result[cadence][user]?.people_count ?? 0;
        result[cadence].total_call_count +=
          result[cadence][user]?.call_count ?? 0;
        result[cadence].total_message_count +=
          result[cadence][user]?.message_count ?? 0;
        result[cadence].total_cadence_custom_count +=
          result[cadence][user]?.cadence_custom_count ?? 0;

        if (result[cadence][user].hasOwnProperty('user_id'))
          result[cadence].total_user_count++;
      }
    }

    return successResponse(res, 'Fetched history table statistics', result);
  } catch (error) {
    logger.error(`Error while fetching history table statistics:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching history table statistics: ${error.message}`,
    });
  }
};

const historyGraphStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history graph statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    let { filter, user_ids, cadence_id, node_type } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history graph statistics',
        error: 'Invalid filter',
      });

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);

    const [start_date, end_date] = dateRange;

    let cadence_ids_array = [];

    if (!cadence_id || cadence_id.length === 0) {
      const [personalAndTeamCadences, errForPersonalCadenceId] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['team', 'personal'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                sd_id: user.sd_id,
              },
              required: true,
            },
          },
        });
      if (errForPersonalCadenceId) {
        logger.error(
          `Error while fetching personal cadence for user`,
          errForPersonalCadenceId
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch history graph statistics',
          error: `Error while fetching personal cadence for user: ${errForPersonalCadenceId}`,
        });
      }

      const [companyCadences, errForCompanyCadences] =
        await Repository.fetchAll({
          tableName: DB_TABLES.CADENCE,
          query: {
            type: ['company'],
          },
          include: {
            [DB_TABLES.USER]: {
              where: {
                company_id: user.company_id,
              },
              required: true,
            },
          },
        });
      if (errForCompanyCadences) {
        logger.error(
          `Error while fetching company cadences for user`,
          errForCompanyCadences
        );
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch history graph statistics',
          error: `Error while fetching company cadences for user: ${errForCompanyCadences}`,
        });
      }

      for (let cadence of personalAndTeamCadences)
        cadence_ids_array.push(cadence.cadence_id);

      for (let cadence of companyCadences)
        cadence_ids_array.push(cadence.cadence_id);
    }
    if (!cadence_ids_array || cadence_ids_array.length === 0)
      cadence_ids_array = null;

    let taskMap = {};

    switch (filter) {
      case LEADERBOARD_DATE_FILTERS.TODAY:

      case LEADERBOARD_DATE_FILTERS.YESTERDAY: {
        let processingTimeHour = dateRange[0];

        while (processingTimeHour <= dateRange[1]) {
          let timeToAdd = new Date(processingTimeHour).getHours();
          taskMap[timeToAdd] = [];
          processingTimeHour = processingTimeHour + 60 * 60 * 1000;
        }

        if (
          node_type === NODE_TYPES.MAIL ||
          node_type === NODE_TYPES.AUTOMATED_MAIL
        ) {
          let typesForQuery;

          if (node_type === NODE_TYPES.AUTOMATED_MAIL)
            typesForQuery = [NODE_TYPES.AUTOMATED_MAIL];
          else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

          const [tasks, errForTasks] =
            await StatisticsHelper.getMailTasksForHistoryGraph(
              user,
              start_date,
              end_date,
              user_ids,
              cadence_id,
              cadence_ids_array,
              typesForQuery,
              {
                company_id: user.company_id,
              }
            );
          if (errForTasks) {
            logger.error('Error while fetching graph', errForTasks);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch history graph statistics',
              error: `Error while fetching mail tasks for history graph: ${errForTasks}`,
            });
          }
          for (let task of tasks) {
            let timeToAdd = moment(new Date(task.complete_time))
              .tz(user.timezone)
              .hour();
            taskMap[timeToAdd].push(task);
          }
          return successResponse(res, 'Fetched graph', taskMap);
        } else {
          if (node_type === HEATMAP_OPTIONS.DONE_TASKS)
            node_type = {
              [Op.notIn]: [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_MESSAGE,
              ],
            };

          const [tasks, errForTasks] =
            await StatisticsHelper.getTasksForHistoryGraph(
              user,
              start_date,
              end_date,
              user_ids,
              cadence_id,
              cadence_ids_array,
              node_type,
              {
                company_id: user.company_id,
              }
            );
          if (errForTasks) {
            logger.error('Error while fetching graph', errForTasks);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch history graph statistics',
              error: `Error while fetching graph: ${errForTasks}`,
            });
          }

          for (let task of tasks) {
            let timeToAdd = moment(new Date(task.complete_time))
              .tz(user.timezone)
              .hour();
            taskMap[timeToAdd].push(task);
          }
          return successResponse(res, 'Fetched graph', taskMap);
        }
      }
      case LEADERBOARD_DATE_FILTERS.LAST_WEEK:
      case LEADERBOARD_DATE_FILTERS.THIS_WEEK: {
        {
          let range = LeaderboardHelper.getDates(
            new Date(start_date),
            new Date(end_date)
          );
          range.forEach((date) => {
            taskMap[date.getDay()] = [];
          });

          if (
            node_type === NODE_TYPES.MAIL ||
            node_type === NODE_TYPES.AUTOMATED_MAIL
          ) {
            let typesForQuery;
            if (node_type === NODE_TYPES.AUTOMATED_MAIL)
              typesForQuery = [NODE_TYPES.AUTOMATED_MAIL];
            else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

            const [tasks, errForTasks] =
              await StatisticsHelper.getMailTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                cadence_ids_array,
                typesForQuery,
                {
                  company_id: user.company_id,
                }
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistics',
                error: `Error while fetching mail tasks for history graph: ${errForTasks}`,
              });
            }

            for (let task of tasks) {
              let dayOfWeek = new Date(task.complete_time).getDay();
              taskMap[dayOfWeek].push(task);
            }
            return successResponse(res, 'Fetched graph', taskMap);
          } else {
            if (node_type === HEATMAP_OPTIONS.DONE_TASKS)
              node_type = {
                [Op.notIn]: [
                  NODE_TYPES.AUTOMATED_MAIL,
                  NODE_TYPES.AUTOMATED_MESSAGE,
                ],
              };

            const [tasks, errForTasks] =
              await StatisticsHelper.getTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                cadence_ids_array,
                node_type,
                {
                  company_id: user.company_id,
                }
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistics',
                error: `Error while fetching graph: ${errForTasks}`,
              });
            }

            for (let task of tasks) {
              let dayOfWeek = new Date(task.complete_time).getDay();
              taskMap[dayOfWeek].push(task);
            }
            return successResponse(res, 'Fetched graph', taskMap);
          }
        }
      }
      case LEADERBOARD_DATE_FILTERS.LAST_MONTH:
      case LEADERBOARD_DATE_FILTERS.THIS_MONTH: {
        {
          let range = LeaderboardHelper.getDates(
            new Date(start_date),
            new Date(end_date)
          );
          range.forEach((date) => {
            taskMap[date.getDate()] = [];
          });
          if (
            node_type === NODE_TYPES.MAIL ||
            node_type === NODE_TYPES.AUTOMATED_MAIL
          ) {
            let typesForQuery;
            if (node_type === NODE_TYPES.AUTOMATED_MAIL)
              typesForQuery = [NODE_TYPES.AUTOMATED_MAIL];
            else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

            const [tasks, errForTasks] =
              await StatisticsHelper.getMailTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                cadence_ids_array,
                typesForQuery,
                {
                  company_id: user.company_id,
                }
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistics',
                error: `Error while fetching graph: ${errForTasks}`,
              });
            }

            for (let task of tasks) {
              let dayOfWeek = new Date(task.complete_time).getDate();
              taskMap[dayOfWeek].push(task);
            }
            return successResponse(res, 'Fetched graph', taskMap);
          } else {
            if (node_type === HEATMAP_OPTIONS.DONE_TASKS)
              node_type = {
                [Op.notIn]: [
                  NODE_TYPES.AUTOMATED_MAIL,
                  NODE_TYPES.AUTOMATED_MESSAGE,
                ],
              };

            const [tasks, errForTasks] =
              await StatisticsHelper.getTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                cadence_ids_array,
                node_type,
                {
                  company_id: user.company_id,
                }
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistics',
                error: `Error while fetching graph: ${errForTasks}`,
              });
            }

            for (let task of tasks) {
              let dayOfMonth = new Date(task.complete_time).getDate();
              taskMap[dayOfMonth].push(task);
            }
            return successResponse(res, 'Fetched graph', taskMap);
          }
        }
      }
      case LEADERBOARD_DATE_FILTERS.LAST_3_MONTHS:
      case LEADERBOARD_DATE_FILTERS.LAST_6_MONTHS: {
        {
          let range = LeaderboardHelper.getDates(
            new Date(start_date),
            new Date(end_date)
          );

          let maxMonth = 0;

          range.forEach((date) => {
            taskMap[date.getMonth()] = [];
            if (date.getMonth() > maxMonth) maxMonth = date.getMonth();
          });

          if (
            node_type === NODE_TYPES.MAIL ||
            node_type === NODE_TYPES.AUTOMATED_MAIL
          ) {
            let typesForQuery;
            if (node_type === NODE_TYPES.AUTOMATED_MAIL)
              typesForQuery = [NODE_TYPES.AUTOMATED_MAIL];
            else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

            const [tasks, errForTasks] =
              await StatisticsHelper.getMailTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                cadence_ids_array,
                typesForQuery,
                {
                  sd_id: user.sd_id,
                }
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistics',
                error: `Error while fetching graph: ${errForTasks}`,
              });
            }

            for (let task of tasks) {
              if (task?.Lead?.Emails?.length != 0) {
                let taskMonth = new Date(task.complete_time).getMonth();
                if (taskMonth > maxMonth) taskMap[maxMonth].push(task);
                else taskMap[taskMonth].push(task);
              }
            }
            return successResponse(res, 'Fetched graph', taskMap);
          } else {
            if (node_type === HEATMAP_OPTIONS.DONE_TASKS)
              node_type = {
                [Op.notIn]: [
                  NODE_TYPES.AUTOMATED_MAIL,
                  NODE_TYPES.AUTOMATED_MESSAGE,
                ],
              };

            const [tasks, errForTasks] =
              await StatisticsHelper.getTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                cadence_ids_array,
                node_type,
                {
                  company_id: user.company_id,
                }
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistics',
                error: `Error while fetching graph: ${errForTasks}`,
              });
            }

            for (let task of tasks) {
              if (task?.Lead?.Emails?.length != 0) {
                let taskMonth = new Date(task.complete_time).getMonth();
                if (taskMonth > maxMonth) taskMap[maxMonth].push(task);
                else taskMap[taskMonth].push(task);
              }
            }
            return successResponse(res, 'Fetched graph', taskMap);
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Error while fetching history graph:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching history graph: ${error.message}`,
    });
  }
};

const heatmapStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch heatmap statistics',
        error: `Error while fetching user by query: ${err}`,
      });
    if (!user) return notFoundResponse(res, 'User not found');

    let { filter, user_ids, cadence_id, node_type } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch heatmap statistics',
        error: 'Invalid filter',
      });

    node_type = [node_type];
    node_type = node_type.flat();

    const possibleNodeTypes = Object.values(NODE_TYPES).concat(
      Object.values(HEATMAP_OPTIONS)
    );

    node_type.forEach((type) => {
      if (!possibleNodeTypes.includes(type)) {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch heatmap statistics',
          error: 'Invalid node type',
        });
      }
    });

    // checking for node_type array if it has a single element ( possible for every value except linkedin )
    if (node_type.length === 1) node_type = node_type[0];

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user?.timezone);
    const [start_date, end_date] = dateRange;

    let heatMap = {};

    const clientQueryParams = { node_type, cadence_id, user_ids };
    const dbQueryParams = {
      start_date,
      end_date,
      user,
    };

    const currentDate = new Date();
    let todaysDay = new Date(
      currentDate.toLocaleString('en-US', {
        timeZone: user?.timezone || 'Asia/Kolkata',
      })
    ).getDay();

    switch (filter) {
      case LEADERBOARD_DATE_FILTERS.YESTERDAY: {
        const yesterdayDay = (todaysDay + 5) % 7;
        heatMap[yesterdayDay] = {};
        for (let j = 0; j < 24; j++) {
          heatMap[yesterdayDay][j] = [];
        }
        const [heatMapResult, errResult] = await getCompleteTasksInInterval(
          clientQueryParams,
          dbQueryParams,
          heatMap
        );

        if (errResult)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch heatmap statistics',
            error: `Error while fetching complete tasks in interval": ${errResult}`,
          });

        return successResponse(res, 'Fetched heatmap', heatMapResult);
      }
      case LEADERBOARD_DATE_FILTERS.TODAY: {
        todaysDay = (todaysDay + 6) % 7;
        heatMap[todaysDay] = {};
        for (let j = 0; j < 24; j++) {
          heatMap[todaysDay][j] = [];
        }
        const [heatMapResult, errResult] = await getCompleteTasksInInterval(
          clientQueryParams,
          dbQueryParams,
          heatMap
        );

        if (errResult)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch heatmap statistics',
            error: `Error while fetching complete tasks in interval: ${errResult}`,
          });

        return successResponse(res, 'Fetched heatmap', heatMapResult);
      }
      case LEADERBOARD_DATE_FILTERS.LAST_WEEK:
      case LEADERBOARD_DATE_FILTERS.THIS_WEEK:
      case LEADERBOARD_DATE_FILTERS.LAST_MONTH:
      case LEADERBOARD_DATE_FILTERS.LAST_3_MONTHS:
      case LEADERBOARD_DATE_FILTERS.LAST_6_MONTHS:
      case LEADERBOARD_DATE_FILTERS.THIS_MONTH: {
        for (let i = 0; i < 7; i++) {
          heatMap[i] = {};
          for (let j = 0; j < 24; j++) {
            heatMap[i][j] = [];
          }
        }
        const [heatMapResult, errResult] = await getCompleteTasksInInterval(
          clientQueryParams,
          dbQueryParams,
          heatMap
        );

        if (errResult)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch heatmap statistics',
            error: `Error while fetching complete tasks in interval: ${errResult}`,
          });

        return successResponse(res, 'Fetched heatmap', heatMapResult);
      }
    }
  } catch (err) {
    logger.error(`Error while fetching heatmap statistics`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching heatmap statistics: ${err}`,
    });
  }
};

const StatisticsController = {
  pendingTaskStatistics,
  completedTaskStatistics,
  historyTableStatistics,
  historyGraphStatistics,
  heatmapStatistics,
};

module.exports = StatisticsController;
