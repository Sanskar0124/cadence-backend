// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  NODE_TYPES,
  LEADERBOARD_DATE_FILTERS,
  CADENCE_STATUS,
  LEAD_STATUS,
  TAG_NAME,
  CADENCE_LEAD_STATUS,
  HEATMAP_OPTIONS,
  CUSTOM_TASK_NODE_ID,
  INTEGRATION_TYPE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  URGENT_TIME_DIFF_FOR_INBOUND,
  URGENT_TIME_DIFF_FOR_OUTBOUND,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// Packages
const moment = require('moment');
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const TaskRepository = require('../../../../../Cadence-Brain/src/repository/task.repository');
const ActivityRepository = require('../../../../../Cadence-Brain/src/repository/activity.repository');
const LeadToCadenceRepository = require('../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const StatusRepository = require('../../../../../Cadence-Brain/src/repository/status.repository');
const EmailRepository = require('../../../../../Cadence-Brain/src/repository/email.repository');
const CadenceRepository = require('../../../../../Cadence-Brain/src/repository/cadence.repository');
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');
const LeadRepository = require('../../../../../Cadence-Brain/src/repository/lead.repository');
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers
const LeaderboardHelper = require('../../../../../Cadence-Brain/src/helper/leaderboard');
const getCompleteTasksInInterval = require('../../../../../Cadence-Brain/src/helper/statistics/getCompleteTasksInInterval');
const StatisticsHelper = require('../../../../../Cadence-Brain/src/helper/statistics/');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const SalesforceHelpers = require('../../../../../Cadence-Brain/src/helper/salesforce');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');

const salesDailyActivityFollowUp = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sales activity statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, user_ids, cadence_ids } = req.body;
    let { start_date, end_date } = req.body;
    let start_date_epoch, end_date_epoch;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Invalid filter',
        });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }
    const activityStatisticsPromise =
      ActivityRepository.getActivityStatisticsByUserid({
        user_id: user_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch ?? null,
        end_date: end_date_epoch ?? null,
      });

    const customTaskStatisticsPromise = TaskRepository.getCustomTaskForUser({
      user_id: user_ids,
      cadence_id: cadence_ids,
      start_date: start_date_epoch,
      end_date: end_date_epoch,
    });

    const [
      [activityStatistics, errForActivityStatistics],
      [customTaskStatistics, errForCustomTaskStatistics],
    ] = await Promise.all([
      activityStatisticsPromise,
      customTaskStatisticsPromise,
    ]);

    let statistics = {};

    for (let activity of activityStatistics) {
      if (statistics.hasOwnProperty(activity.cadence_id)) {
        statistics[activity.cadence_id][
          `${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`
        ] = activity.activity_count;
        statistics[activity.cadence_id]['cadence_id'] = activity.cadence_id;
        statistics[activity.cadence_id]['cadence_name'] = activity.cadence_name;
      } else {
        statistics[activity.cadence_id] = {
          [`${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`]: activity.activity_count,
          cadence_id: activity.cadence_id,
          name: activity?.Cadence?.name ?? activity.cadence_id,
        };
      }
    }

    for (let customTask of customTaskStatistics) {
      if (statistics.hasOwnProperty(customTask.cadence_id)) {
        statistics[customTask.cadence_id]['custom_task_count'] =
          customTask.count;

        statistics[customTask.cadence_id]['cadence_id'] = customTask.cadence_id;
      } else {
        statistics[customTask.cadence_id] = {
          custom_task_count: customTask.count,
          cadence_id: customTask.cadence_id,
          name: customTask?.Cadence?.name ?? customTask.cadence_id,
        };
      }
    }

    if (errForActivityStatistics || errForCustomTaskStatistics)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sales activity statistics',
        error: `${errForActivityStatistics || errForCustomTaskStatistics}`,
      });

    return successResponse(res, 'Fetched Statistics', statistics);
  } catch (err) {
    logger.error(`Error while fetching sales activity statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching sales activity statistics: ${err.message}`,
    });
  }
};

const salesGroupActivityFollowUp = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch group activity follow up',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, sd_ids, cadence_ids } = req.body;
    let { start_date, end_date } = req.body;
    let start_date_epoch, end_date_epoch;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }

    const activityStatisticsPromise =
      ActivityRepository.getActivityStatisticsByGroupId({
        sd_id: sd_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch ?? null,
        end_date: end_date_epoch ?? null,
      });

    const customTaskStatisticsPromise =
      TaskRepository.getCustomTaskForCadenceByGroup({
        sd_id: sd_ids,
        cadence_id: cadence_ids,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const [
      [activityStatistics, errForActivityStatistics],
      [customTaskStatistics, errForCustomTaskStatistics],
    ] = await Promise.all([
      activityStatisticsPromise,
      customTaskStatisticsPromise,
    ]);

    let statistics = {};

    for (let activity of activityStatistics) {
      if (statistics.hasOwnProperty(activity.cadence_id)) {
        statistics[activity.cadence_id][
          `${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`
        ] = activity.activity_count;
        statistics[activity.cadence_id]['cadence_id'] = activity.cadence_id;
        statistics[activity.cadence_id]['cadence_name'] = activity.cadence_name;
      } else {
        statistics[activity.cadence_id] = {
          [`${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`]: activity.activity_count,
          cadence_id: activity.cadence_id,
          name: activity?.Cadence?.name ?? activity.cadence_id,
        };
      }
    }

    for (let customTask of customTaskStatistics) {
      if (statistics.hasOwnProperty(customTask.cadence_id)) {
        statistics[customTask.cadence_id]['custom_task_count'] =
          customTask.count;

        statistics[customTask.cadence_id]['cadence_id'] = customTask.cadence_id;
      } else {
        statistics[customTask.cadence_id] = {
          custom_task_count: customTask.count,
          cadence_id: customTask.cadence_id,
          name: customTask?.Cadence?.name ?? customTask.cadence_id,
        };
      }
    }

    if (errForActivityStatistics || errForCustomTaskStatistics)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch group activity follow up',
        error: errForActivityStatistics || errForCustomTaskStatistics,
      });

    return successResponse(res, 'Fetched Statistics', statistics);
  } catch (err) {
    logger.error(`Error while fetching sales activity statistics:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching sales group activity follow up: ${err.message}`,
    });
  }
};

const userActivityStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user activity statistics',
        error: `Error while fetching user activity statistics: ${err}`,
      });

    const { filter, user_ids, cadence_ids } = req.body;
    let { start_date, end_date } = req.body;
    let start_date_epoch, end_date_epoch;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }

    const activityStatisticsPromise =
      ActivityRepository.getAllActivityStatisticsForUser({
        user_id: user_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch ?? null,
        end_date: end_date_epoch ?? null,
      });

    const customTaskStatisticsPromise =
      TaskRepository.getCompletedCustomTaskCountForUser({
        user_id: user_ids,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const [
      [activityStatistics, errForActivityStatistics],
      [customTaskStatistics, errForCustomTaskStatistics],
    ] = await Promise.all([
      activityStatisticsPromise,
      customTaskStatisticsPromise,
    ]);

    if (errForActivityStatistics || errForCustomTaskStatistics)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user activity statistics',
        error: `${errForActivityStatistics || errForCustomTaskStatistics}`,
      });

    let statistics = {};
    for (let activity of activityStatistics) {
      if (statistics.hasOwnProperty(activity.user_id)) {
        if (activity.type === 'call') {
          statistics[activity.user_id][
            `${activity.type}_${
              activity.incoming === true ? 'incoming' : 'outgoing'
            }_count`
          ] = activity.activity_count;
          statistics[activity.user_id]['user_id'] = activity.user_id;
          statistics[activity.user_id]['first_name'] = activity?.first_name;
          statistics[activity.user_id]['last_name'] = activity?.last_name;
        } else {
          if (statistics.hasOwnProperty(activity.user_id)) {
            statistics[activity.user_id][
              `${activity.type}_${
                activity.incoming ? 'incoming' : 'outgoing'
              }_count`
            ] = activity.activity_count;
            statistics[activity.user_id]['user_id'] = activity.user_id;
            statistics[activity.user_id]['first_name'] = activity?.first_name;
            statistics[activity.user_id]['last_name'] = activity?.last_name;
          }
        }
      } else {
        if (activity.type === 'call') {
          statistics[activity.user_id] = {
            [`${activity.type}_${
              activity.incoming === true ? 'incoming' : 'outgoing'
            }_count`]: activity.activity_count,
            user_id: activity.user_id,
            first_name: activity?.first_name,
            last_name: activity?.last_name,
          };
        } else {
          statistics[activity.user_id] = {
            [`${activity.type}_${
              activity.incoming ? 'incoming' : 'outgoing'
            }_count`]: activity.activity_count,
            user_id: activity.user_id,
            first_name: activity?.first_name,
            last_name: activity?.last_name,
          };
        }
      }
    }
    if (activityStatistics.length !== 0)
      statistics[activityStatistics?.[0]?.user_id]['custom_task_count'] =
        customTaskStatistics;

    return successResponse(res, 'Fetched Statistics', statistics);
  } catch (err) {
    logger.error(`Error while fetching user activity statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching user activity statistics: ${err.message}`,
    });
  }
};

// Sales group activity followup
const groupActivityStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch group activity statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, sd_ids, cadence_ids } = req.body;
    let { start_date, end_date } = req.body;
    let start_date_epoch, end_date_epoch;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }

    const activityStatisticsPromise =
      ActivityRepository.getAllActivityStatisticsForGroup({
        sd_id: sd_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch ?? null,
        end_date: end_date_epoch ?? null,
      });

    const customTaskStatisticsPromise =
      TaskRepository.getCompletedCustomTaskCountForGroup({
        sd_id: sd_ids,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const [
      [activityStatistics, errForActivityStatistics],
      [customTaskStatistics, errForCustomTaskStatistics],
    ] = await Promise.all([
      activityStatisticsPromise,
      customTaskStatisticsPromise,
    ]);

    if (errForActivityStatistics || errForCustomTaskStatistics)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch group activity statistics',
        error: errForActivityStatistics || errForCustomTaskStatistics,
      });

    let statistics = {};
    for (let activity of activityStatistics) {
      if (statistics.hasOwnProperty(activity.user_id)) {
        statistics[activity.user_id][
          `${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`
        ] = activity.activity_count;
        statistics[activity.user_id]['user_id'] = activity.user_id;
        statistics[activity.user_id]['first_name'] = activity?.first_name;
        statistics[activity.user_id]['last_name'] = activity?.last_name;
      } else {
        statistics[activity.user_id] = {
          [`${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`]: activity.activity_count,
          user_id: activity.user_id,
          first_name: activity?.first_name,
          last_name: activity?.last_name,
        };
      }
    }

    for (let customTask of customTaskStatistics) {
      if (statistics.hasOwnProperty(customTask.user_id)) {
        statistics[customTask.user_id]['custom_task_count'] = customTask.count;
      } else {
        statistics[customTask.user_id] = {
          custom_task_count: customTask.count,
          user_id: customTask.user_id,
          first_name: customTask?.first_name,
          last_name: customTask?.last_name,
        };
      }
    }

    return successResponse(res, 'Fetched Statistics', statistics);
  } catch (err) {
    logger.error(`Error while fetching user activity statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching user activity statistics: ${err.message}`,
    });
  }
};
const cadenceTaskStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence task statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, user_ids, cadence_ids } = req.body;
    let { start_date, end_date } = req.body;
    let start_date_epoch, end_date_epoch;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }

    const statusStatisticsPromise = StatusRepository.cadenceLeadStatusCount({
      user_ids: user_ids ?? null,
      cadence_id: cadence_ids,
      start_date: start_date_epoch,
      end_date: end_date_epoch,
    });

    const completedTaskStatisticsPromise =
      TaskRepository.getCompletedTaskCountByUserForCadence({
        user_id: user_ids ?? null,
        cadence_id: cadence_ids,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const [
      [statusStatistics, errForStatusStatistics],
      [completedTaskStatistics, errForCompletedTaskStatistics],
    ] = await Promise.all([
      statusStatisticsPromise,
      completedTaskStatisticsPromise,
    ]);

    if (errForStatusStatistics || errForCompletedTaskStatistics)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence task statistics',
        error: errForStatusStatistics || errForCompletedTaskStatistics,
      });

    let statistics = {};
    for (let status of statusStatistics) {
      if (statistics.hasOwnProperty(status.user_id)) {
        statistics[status.user_id][`${status.status}_count`] =
          status.status_count;
        statistics[status.user_id]['first_name'] = status?.first_name;
        statistics[status.user_id]['last_name'] = status?.last_name;
      } else {
        statistics[status.user_id] = {
          [`${status.status}_count`]: status.status_count,
          first_name: status?.first_name,
          last_name: status?.last_name,
        };
      }
    }

    for (let task of completedTaskStatistics) {
      if (statistics.hasOwnProperty(task.user_id)) {
        statistics[task.user_id]['completed_task_count'] =
          task.completed_task_count;
        if (!statistics[task.user_id].hasOwnProperty('first_name')) {
          statistics[task.user_id]['first_name'] = task.first_name;
          statistics[task.user_id]['last_name'] = task.last_name;
        }
      } else {
        statistics[task.user_id] = {
          completed_task_count: task.completed_task_count,
          first_name: task.first_name,
          last_name: task.last_name,
        };
      }
    }

    return successResponse(res, 'Fetched Cadence Task Statistics', statistics);
  } catch (err) {
    logger.error(`Error while fetching cadence task statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence task statistics: ${err.message}`,
    });
  }
};

const cadenceContactStatistics = async (req, res) => {
  try {
    const { cadence_id } = req.body;

    const StatusCountPromise = StatusRepository.cadenceLeadStatusCountWithTotal(
      { cadence_id }
    );

    // const totalContactsPromise =
    //   LeadToCadenceRepository.getTotalContactsCountByCadenceId({
    //     cadence_id,
    //   });

    // const activeContactsPromise =
    //   LeadToCadenceRepository.getActiveContactsCountByCadenceId({
    //     cadence_id,
    //   });

    const activeLeadsPromise = LeadRepository.getActiveLeadCountByCadenceId({
      cadence_id,
    });

    const [
      [cadenceContacts, errForCadenceContacts],
      [activeLeads, errForActiveLeads],
    ] = await Promise.all([StatusCountPromise, activeLeadsPromise]);
    if (errForCadenceContacts || errForActiveLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence contact statistics',
        error: errForCadenceContacts || errForActiveLeads,
      });

    let statistics = {};

    for (let cadenceContact of cadenceContacts) {
      if (statistics.hasOwnProperty(cadenceContact.user_id)) {
        statistics[cadenceContact.user_id][`${cadenceContact.status}_count`] =
          cadenceContact.count;

        statistics[cadenceContact.user_id]['first_name'] =
          cadenceContact?.first_name;
        statistics[cadenceContact.user_id]['last_name'] =
          cadenceContact?.last_name;
        statistics[cadenceContact.user_id]['user_id'] = cadenceContact?.user_id;
      } else if (cadenceContact.user_id && cadenceContact.user_id != 'null') {
        statistics[cadenceContact.user_id] = {
          [`${cadenceContact.status}_count`]: cadenceContact.count,
          first_name: cadenceContact?.first_name,
          last_name: cadenceContact?.last_name,
          user_id: cadenceContact?.user_id,
        };
      }
    }

    for (let statusContact of activeLeads) {
      if (statistics.hasOwnProperty(statusContact.user_id)) {
        if ((statusContact.status = 'in_progress')) {
          statistics[statusContact.user_id]['first_name'] =
            statusContact?.first_name;
          statistics[statusContact.user_id]['last_name'] =
            statusContact?.last_name;
          statistics[statusContact.user_id]['ongoing_count'] =
            statusContact.count;
        }
      } else if (statusContact.user_id && statusContact.user_id != 'null') {
        statistics[statusContact.user_id] = {
          ongoing_count: statusContact.count,
          first_name: statusContact?.first_name,
          last_name: statusContact?.last_name,
        };
      }
    }

    // for (let totalContact of totalContacts) {
    //   if (statistics.hasOwnProperty(totalContact.user_id)) {
    //     statistics[totalContact.user_id]['new_lead_count'] = totalContact.count;
    //     statistics[totalContact.user_id]['first_name'] =
    //       totalContact?.first_name;
    //     statistics[totalContact.user_id]['last_name'] = totalContact?.last_name;
    //   } else if (totalContact.user_id && totalContact.user_id !== 'null') {
    //     statistics[totalContact.user_id] = {
    //       total_lead_count: totalContact.count,
    //       first_name: totalContact?.first_name,
    //       last_name: totalContact?.last_name,
    //     };
    //   }
    // }

    return successResponse(res, 'Fetched Cadence Contacts', statistics);
  } catch (err) {
    logger.error(`Error while fetching cadence contact statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence contact statistics: ${err.message}`,
    });
  }
};

const cadenceActivityStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence activity statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, user_ids, cadence_ids } = req.body;
    let start_date_epoch, end_date_epoch;
    let { start_date, end_date } = req.body;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }

    const emailActivityStatisticsPromise =
      EmailRepository.getEmailStatusCountForUserAndCadence({
        user_id: user_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const unsubscribeLeadStatisticsPromise =
      LeadToCadenceRepository.getUnsubscribeLeadCountForUserByCadence({
        user_id: user_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const ConvertionsStatisticsPromise =
      StatusRepository.userCadenceConvertionsCount({
        user_id: user_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const completetedCustomTaskStatisticsPromise =
      TaskRepository.getCompletedCustomTaskCountForCadence({
        user_id: user_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const activityStatisticsPromise =
      ActivityRepository.getActivityStatisticsByUserid({
        user_id: user_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch ?? null,
        end_date: end_date_epoch ?? null,
      });

    const [
      [emailActivityStatistics, errForEmailActivityStatistics],
      [unsubscribeLeadStatistics, errForUnsubscribeLeadStatistics],
      [ConvertionsStatistics, errForConvertionsStatistics],
      [completetedCustomTaskStatistics, errForCompletedCustomTaskStatistics],
      [activityStatistics, errForActivityStatistics],
    ] = await Promise.all([
      emailActivityStatisticsPromise,
      unsubscribeLeadStatisticsPromise,
      ConvertionsStatisticsPromise,
      completetedCustomTaskStatisticsPromise,
      activityStatisticsPromise,
    ]);

    if (
      errForEmailActivityStatistics ||
      errForUnsubscribeLeadStatistics ||
      errForConvertionsStatistics ||
      errForCompletedCustomTaskStatistics ||
      errForActivityStatistics
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence activity statistics',
        error:
          errForEmailActivityStatistics ||
          errForUnsubscribeLeadStatistics ||
          errForConvertionsStatistics ||
          errForCompletedCustomTaskStatistics ||
          errForActivityStatistics,
      });

    let statistics = {};

    for (let emailActivity of emailActivityStatistics) {
      // statistics[emailActivity.cadence_id] = {
      //   [`${emailActivity.status}_count`]: emailActivity.count,
      // };

      if (statistics.hasOwnProperty(emailActivity.cadence_id)) {
        statistics[emailActivity.cadence_id][`${emailActivity.status}_count`] =
          emailActivity.count;

        statistics[emailActivity.cadence_id]['name'] = emailActivity?.name;
        statistics[emailActivity.cadence_id]['cadence_id'] =
          emailActivity?.cadence_id;
      } else {
        statistics[emailActivity.cadence_id] = {
          [`${emailActivity.status}_count`]: emailActivity.count,
          name: emailActivity?.name,
          cadence_id: emailActivity?.cadence_id,
        };
      }
    }

    for (let completedCustomTask of completetedCustomTaskStatistics) {
      if (statistics.hasOwnProperty(completedCustomTask.cadence_id)) {
        statistics[completedCustomTask.cadence_id]['completed_task_count'] =
          completedCustomTask.completed_task_count;
        statistics[completedCustomTask.cadence_id]['name'] =
          completedCustomTask?.name;
        statistics[completedCustomTask.cadence_id]['cadence_id'] =
          completedCustomTask?.cadence_id;
      } else {
        statistics[completedCustomTask.cadence_id] = {
          completed_task_count: completedCustomTask.completed_task_count,
          name: completedCustomTask?.name,
          cadence_id: completedCustomTask?.cadence_id,
        };
      }
    }

    for (let unsubscribeLead of unsubscribeLeadStatistics) {
      if (statistics.hasOwnProperty(unsubscribeLead.cadence_id)) {
        statistics[unsubscribeLead.cadence_id]['unsubscribe_lead_count'] =
          unsubscribeLead.unsubscribe_count;

        statistics[unsubscribeLead.cadence_id]['name'] = unsubscribeLead.name;
        statistics[unsubscribeLead.cadence_id]['cadence_id'] =
          unsubscribeLead.cadence_id;
      } else {
        statistics[unsubscribeLead.cadence_id] = {
          unsubscribe_lead_count: unsubscribeLead.unsubscribe_count,
          name: unsubscribeLead.name,
          cadence_id: unsubscribeLead.cadence_id,
        };
      }
    }

    for (let Convertion of ConvertionsStatistics) {
      if (statistics.hasOwnProperty(Convertion.cadence_id)) {
        statistics[Convertion.cadence_id][
          `${Convertion.status}_conversion_count`
        ] = Convertion.count;
        if (!statistics[Convertion.cadence_id].hasOwnProperty('name')) {
          statistics[Convertion.cadence_id]['name'] = Convertion.name;
          statistics[Convertion.cadence_id]['cadence_id'] =
            Convertion.cadence_id;
        }
      } else {
        statistics[Convertion.cadence_id] = {
          [`${Convertion.status}_conversion_count`]: Convertion.count,
          name: Convertion.name,
          cadence_id: Convertion.cadence_id,
        };
      }
    }

    for (let activity of activityStatistics) {
      if (statistics.hasOwnProperty(activity.cadence_id)) {
        statistics[activity.cadence_id][
          `${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`
        ] = activity.activity_count;
        statistics[activity.cadence_id]['cadence_id'] = activity.cadence_id;
        statistics[activity.cadence_id]['cadence_name'] = activity.cadence_name;
      } else {
        statistics[activity.cadence_id] = {
          [`${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`]: activity.activity_count,
          cadence_id: activity.cadence_id,
          name: activity?.Cadence?.name ?? activity.cadence_id,
        };
      }
    }

    // const result = {
    //   emailActivityStatistics,
    //   unsubscribeLeadStatistics,
    //   ConvertionsStatistics,
    //   completetedCustomTaskStatistics,
    //   statistics,
    // };

    return successResponse(
      res,
      'Fetched Cadence Activity statistics',
      statistics
    );
  } catch (err) {
    logger.error(`Error while fetching cadence activity statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence activity statistics: ${err.message}`,
    });
  }
};

const cadenceActivityStatisticsForGroup = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence activity statistics for group',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, sd_ids, cadence_ids } = req.body;
    let start_date_epoch, end_date_epoch;
    let { start_date, end_date } = req.body;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }
    const emailActivityStatisticsPromise =
      EmailRepository.getEmailStatusCountForGroupAndCadence({
        sd_id: sd_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const unsubscribeLeadStatisticsPromise =
      LeadToCadenceRepository.getUnsubscribeLeadCountForGroupByCadence({
        sd_id: sd_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const ConvertionsStatisticsPromise =
      StatusRepository.groupCadenceConvertionsCount({
        sd_id: sd_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const completetedCustomTaskStatisticsPromise =
      TaskRepository.getCompletedCustomTaskCountForGroupByCadence({
        sd_id: sd_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch,
        end_date: end_date_epoch,
      });

    const activityStatisticsPromise =
      ActivityRepository.getActivityStatisticsByGroupId({
        sd_id: sd_ids,
        cadence_id: cadence_ids ?? null,
        start_date: start_date_epoch ?? null,
        end_date: end_date_epoch ?? null,
      });

    const [
      [emailActivityStatistics, errForEmailActivityStatistics],
      [unsubscribeLeadStatistics, errForUnsubscribeLeadStatistics],
      [ConvertionsStatistics, errForConvertionsStatistics],
      [completetedCustomTaskStatistics, errForCompletedCustomTaskStatistics],
      [activityStatistics, errForActivityStatistics],
    ] = await Promise.all([
      emailActivityStatisticsPromise,
      unsubscribeLeadStatisticsPromise,
      ConvertionsStatisticsPromise,
      completetedCustomTaskStatisticsPromise,
      activityStatisticsPromise,
    ]);

    if (
      errForEmailActivityStatistics ||
      errForUnsubscribeLeadStatistics ||
      errForConvertionsStatistics ||
      errForCompletedCustomTaskStatistics ||
      errForActivityStatistics
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence activity statistics for group',
        error:
          errForEmailActivityStatistics ||
          errForUnsubscribeLeadStatistics ||
          errForConvertionsStatistics ||
          errForCompletedCustomTaskStatistics ||
          errForActivityStatistics,
      });

    let statistics = {};

    for (let emailActivity of emailActivityStatistics) {
      // statistics[emailActivity.cadence_id] = {
      //   [`${emailActivity.status}_count`]: emailActivity.count,
      // };

      if (statistics.hasOwnProperty(emailActivity.cadence_id)) {
        statistics[emailActivity.cadence_id][`${emailActivity.status}_count`] =
          emailActivity.count;

        statistics[emailActivity.cadence_id]['name'] = emailActivity?.name;
        statistics[emailActivity.cadence_id]['cadence_id'] =
          emailActivity?.cadence_id;
      } else if (
        emailActivity.cadence_id &&
        emailActivity.cadence_id != 'null'
      ) {
        statistics[emailActivity.cadence_id] = {
          [`${emailActivity.status}_count`]: emailActivity.count,
          name: emailActivity?.name,
          cadence_id: emailActivity?.cadence_id,
        };
      }
    }

    for (let completedCustomTask of completetedCustomTaskStatistics) {
      if (statistics.hasOwnProperty(completedCustomTask.cadence_id)) {
        statistics[completedCustomTask.cadence_id]['completed_task_count'] =
          completedCustomTask.completed_task_count;
        statistics[completedCustomTask.cadence_id]['name'] =
          completedCustomTask?.name;
        statistics[completedCustomTask.cadence_id]['cadence_id'] =
          completedCustomTask?.cadence_id;
      } else if (
        completedCustomTask.cadence_id &&
        completedCustomTask.cadence_id != 'null'
      ) {
        statistics[completedCustomTask.cadence_id] = {
          completed_task_count: completedCustomTask.completed_task_count,
          name: completedCustomTask?.name,
          cadence_id: completedCustomTask?.cadence_id,
        };
      }
    }

    for (let unsubscribeLead of unsubscribeLeadStatistics) {
      if (statistics.hasOwnProperty(unsubscribeLead.cadence_id)) {
        statistics[unsubscribeLead.cadence_id]['unsubscribe_lead_count'] =
          unsubscribeLead.unsubscribe_count;

        statistics[unsubscribeLead.cadence_id]['name'] = unsubscribeLead.name;
        statistics[unsubscribeLead.cadence_id]['cadence_id'] =
          unsubscribeLead.cadence_id;
      } else if (
        unsubscribeLead.cadence_id &&
        unsubscribeLead.cadence_id != 'null'
      ) {
        statistics[unsubscribeLead.cadence_id] = {
          unsubscribe_lead_count: unsubscribeLead.unsubscribe_count,
          name: unsubscribeLead.name,
          cadence_id: unsubscribeLead.cadence_id,
        };
      }
    }

    for (let Convertion of ConvertionsStatistics) {
      if (statistics.hasOwnProperty(Convertion.cadence_id)) {
        statistics[Convertion.cadence_id][
          `${Convertion.status}_conversion_count`
        ] = Convertion.count;
        if (!statistics[Convertion.cadence_id].hasOwnProperty('name')) {
          statistics[Convertion.cadence_id]['name'] = Convertion.name;
          statistics[Convertion.cadence_id]['cadence_id'] =
            Convertion.cadence_id;
        }
      } else if (Convertion.cadence_id && Convertion.cadence_id != 'null') {
        statistics[Convertion.cadence_id] = {
          [`${Convertion.status}_conversion_count`]: Convertion.count,
          name: Convertion.name,
          cadence_id: Convertion.cadence_id,
        };
      }
    }

    for (let activity of activityStatistics) {
      if (statistics.hasOwnProperty(activity.cadence_id)) {
        statistics[activity.cadence_id][
          `${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`
        ] = activity.activity_count;
        statistics[activity.cadence_id]['cadence_id'] = activity.cadence_id;
        statistics[activity.cadence_id]['cadence_name'] = activity.cadence_name;
      } else if (activity.cadence_id && activity.cadence_id != 'null') {
        statistics[activity.cadence_id] = {
          [`${activity.type}_${
            activity.incoming ? 'incoming' : 'outgoing'
          }_count`]: activity.activity_count,
          cadence_id: activity.cadence_id,
          name: activity?.Cadence?.name ?? activity.cadence_id,
        };
      }
    }

    return successResponse(
      res,
      'Fetched Cadence Activity statistics',
      statistics
    );
  } catch (err) {
    logger.error(`Error while fetching cadence activity statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence activity statistics: ${err.message}`,
    });
  }
};

const cadenceNodeStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence steps statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, user_ids, node_id, type } = req.body;
    let { start_date, end_date } = req.body;
    let start_date_epoch, end_date_epoch;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date_epoch = dateRange[0];
      end_date_epoch = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });

      start_date_epoch = moment(start_date).valueOf();
      end_date_epoch = moment(end_date).valueOf();
    }

    // Currently we only have data for node type of email so we are hardcoding it
    // TODO: Handle other node types
    let statistics = {};

    if (type === NODE_TYPES.AUTOMATED_MAIL || type === NODE_TYPES.MAIL) {
      const emailStatisticsPromise =
        EmailRepository.getEmailStatusCountForUserByNode({
          user_id: user_ids ?? null,
          node_id: node_id,
          start_date: start_date_epoch,
          end_date: end_date_epoch,
        });

      const unsubscribeLeadStatisticsPromise =
        LeadToCadenceRepository.getUnsubscribeLeadCountForUserByNode({
          user_id: user_ids ?? null,
          node_id,
          start_date: start_date_epoch,
          end_date: end_date_epoch,
        });

      const [
        [emailStatistics, errForEmailStatistics],
        [unsubscribeLeadStatistics, errForUnsubscribeLeadStatistics],
      ] = await Promise.all([
        emailStatisticsPromise,
        unsubscribeLeadStatisticsPromise,
      ]);

      if (errForEmailStatistics || errForUnsubscribeLeadStatistics)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch cadence steps statistics',
          error: errForEmailStatistics || errForUnsubscribeLeadStatistics,
        });

      for (let emailActivity of emailStatistics) {
        if (statistics.hasOwnProperty('email')) {
          statistics['email'][`${emailActivity.status}_count`] =
            emailActivity.count;
        } else {
          statistics['email'] = {
            [`${emailActivity.status}_count`]: emailActivity.count,
          };
        }
      }

      for (let unsubscribeLead of unsubscribeLeadStatistics) {
        if (statistics.hasOwnProperty('email')) {
          statistics['email']['unsubscribe_lead_count'] =
            unsubscribeLead.unsubscribe_count;
        } else {
          statistics['email'] = {
            unsubscribe_lead_count: unsubscribeLead.unsubscribe_count,
          };
        }
      }
    } else if (
      type === NODE_TYPES.CALL ||
      type === NODE_TYPES.MESSAGE ||
      type === NODE_TYPES.LINKEDIN_CONNECTION ||
      type === NODE_TYPES.LINKEDIN_INTERACT ||
      type === NODE_TYPES.LINKEDIN_MESSAGE ||
      type === NODE_TYPES.LINKEDIN_PROFILE ||
      type === NODE_TYPES.AUTOMATED_MESSAGE
    ) {
      const completedTaskStatisticsQuery =
        await TaskRepository.getCompletedTaskByNode({
          user_id: user_ids ?? null,
          node_id,
          node_type: type,
          start_date: start_date_epoch,
          end_date: end_date_epoch,
        });
      const completedTaskStatistics = completedTaskStatisticsQuery[0];
      for (let task of completedTaskStatistics) {
        if (statistics.hasOwnProperty(type)) {
          statistics[type] = task?.completed_task_count;
        } else {
          statistics = {
            [type]: task.completed_task_count,
          };
        }
      }
    }
    return successResponse(res, 'Fetched Cadence Node Statistics', statistics);
  } catch (err) {
    logger.error(`Error while fetching cadence node statistics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence node statistics: ${err.message}`,
    });
  }
};

const disqualificationStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch disqualification statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    const { filter, user_ids, cadence_ids, sd_ids } = req.body;
    let { start_date, end_date } = req.body;

    if (Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
      start_date = dateRange[0];
      end_date = dateRange[1];
    } else {
      if (!start_date || !end_date)
        return serverErrorResponseWithDevMsg({ res, msg: 'Invalid filter' });
      start_date = null;
      end_date = null;
    }

    const [disqualificationStatistics, errForDisqualificationStatistics] =
      await StatusRepository.disqualificationByCadence({
        cadence_ids,
        user_ids: user_ids ?? null,
        sd_ids: sd_ids ?? null,
        start_date: start_date,
        end_date: end_date,
      });

    if (errForDisqualificationStatistics)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch disqualification statistics',
        error: `Error while fetching disqualification by cadence: ${errForDisqualificationStatistics}`,
      });

    const result = {
      ...disqualificationStatistics,
    };

    return successResponse(res, 'Fetched disqualification statistics', result);
  } catch (err) {
    logger.error(`Error while fetching disqualification statistics:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching disqualification statistics: ${err.message}`,
    });
  }
};

const pendingTaskStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending task statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending task statistics',
        error: 'Invalid filter',
      });

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

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
        { [Op.ne]: null },
        { company_id: user.company_id },
        lateSettings
      );
    if (errForPendingTaskStatistics) {
      logger.error('Error while fetching count', errForPendingTaskStatistics);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending task statistics',
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

    const [completedTasks, errForCompletedTasks] = await Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        cadence_id: cadence_id ?? { [Op.ne]: null },
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
                NODE_TYPES.AUTOMATED_REPLY_TO,
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
        error: `Error while fetching completed tasks: ${errForCompletedTasks}`,
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
    const completedTasksPromise = Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        cadence_id: cadence_id ?? { [Op.ne]: null },
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
                NODE_TYPES.AUTOMATED_REPLY_TO,
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
        cadence_id: cadence_id ?? { [Op.ne]: null },
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
                NODE_TYPES.AUTOMATED_REPLY_TO,
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
        error: errForCompletedTasks || errForContactedPeople,
      });
    }

    // Get opportunities

    let opportunityMetrics = {},
      errForOpportunityMetrics;

    if (req.user.integration_type === INTEGRATION_TYPE.SALESFORCE) {
      const [{ access_token, instance_url }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          user_id: req.user.user_id,
          integration_type: INTEGRATION_TYPE.SALESFORCE,
        });
      if (errForAccessToken) {
        logger.error(
          `Error while fetching opportunity metrics: `,
          errForOpportunityMetrics
        );
      } else {
        [opportunityMetrics, errForOpportunityMetrics] =
          await SalesforceHelpers.getOpportunityMetrics({
            instance_url,
            access_token,
          });

        if (errForOpportunityMetrics) {
          logger.error(
            `Error while fetching opportunity metrics: `,
            errForOpportunityMetrics
          );
          opportunityMetrics = {};
        }
      }

      if (opportunityMetrics && !errForOpportunityMetrics) {
        for (
          let cadenceCount = 0;
          cadenceCount < opportunityMetrics?.['cadence_repartition']?.length ??
          0;
          cadenceCount++
        ) {
          if (
            !opportunityMetrics?.['cadence_repartition']?.[cadenceCount]?.[
              'cadence_id'
            ]
          )
            continue;

          const [cadence, _] = await Repository.fetchOne({
            tableName: DB_TABLES.CADENCE,
            query: {
              salesforce_cadence_id:
                opportunityMetrics?.['cadence_repartition']?.[cadenceCount]?.[
                  'cadence_id'
                ],
            },
          });
          opportunityMetrics.cadence_repartition[cadenceCount].cadence_id =
            cadence.cadence_id;

          for (
            let userCount = 0;
            userCount <
            opportunityMetrics?.['cadence_repartition']?.[cadenceCount]?.[
              'user_repartition'
            ].length;
            userCount++
          ) {
            const [cadenceUser, __] = await Repository.fetchOne({
              tableName: DB_TABLES.USER,
              query: {
                salesforce_owner_id:
                  opportunityMetrics?.['cadence_repartition']?.[cadenceCount]?.[
                    'user_repartition'
                  ][userCount].user_id,
              },
            });
            opportunityMetrics.cadence_repartition[
              cadenceCount
            ].user_repartition[userCount].user_id = cadenceUser.user_id;
          }
        }
      }
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

    result.opportunityMetrics = opportunityMetrics;

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
            typesForQuery = [
              NODE_TYPES.AUTOMATED_MAIL,
              NODE_TYPES.AUTOMATED_REPLY_TO,
            ];
          else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

          const [tasks, errForTasks] =
            await StatisticsHelper.getMailTasksForHistoryGraph(
              user,
              start_date,
              end_date,
              user_ids,
              cadence_id,
              { [Op.ne]: null },
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
                NODE_TYPES.AUTOMATED_REPLY_TO,
              ],
            };

          const [tasks, errForTasks] =
            await StatisticsHelper.getTasksForHistoryGraph(
              user,
              start_date,
              end_date,
              user_ids,
              cadence_id,
              { [Op.ne]: null },
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
              error: `Error while fetching tasks for history graph: ${errForTasks}`,
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
            if (node_type === NODE_TYPES.AUTOMATED_MAIL)
              typesForQuery = [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_REPLY_TO,
              ];
            else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

            const [tasks, errForTasks] =
              await StatisticsHelper.getMailTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                { [Op.ne]: null },
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
                  NODE_TYPES.AUTOMATED_REPLY_TO,
                ],
              };

            const [tasks, errForTasks] =
              await StatisticsHelper.getTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                { [Op.ne]: null },
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
                error: `Error while fetching tasks for history graph: ${errForTasks}`,
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
            if (node_type === NODE_TYPES.AUTOMATED_MAIL)
              typesForQuery = [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_REPLY_TO,
              ];
            else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

            const [tasks, errForTasks] =
              await StatisticsHelper.getMailTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                { [Op.ne]: null },
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
                  NODE_TYPES.AUTOMATED_REPLY_TO,
                ],
              };

            const [tasks, errForTasks] =
              await StatisticsHelper.getTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                { [Op.ne]: null },
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
                error: `Error while fetching tasks for history graph: ${errForTasks}`,
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
              typesForQuery = [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_REPLY_TO,
              ];
            else typesForQuery = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];

            const [tasks, errForTasks] =
              await StatisticsHelper.getMailTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                { [Op.ne]: null },
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
                  NODE_TYPES.AUTOMATED_REPLY_TO,
                ],
              };

            const [tasks, errForTasks] =
              await StatisticsHelper.getTasksForHistoryGraph(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                { [Op.ne]: null },
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
                error: `Error while fetching tasks for history graph: ${errForTasks}`,
              });
            }

            for (let task of tasks) {
              let taskMonth = new Date(task.complete_time).getMonth();
              if (taskMonth > maxMonth) taskMap[maxMonth].push(task);
              else taskMap[taskMonth].push(task);
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

// Routes for Filter

const getCadencesByUserid = async (req, res) => {
  try {
    const { user_id } = req.body;
    const [cadences, errForCadences] =
      await CadenceRepository.getCadenceByUserQuery({
        user_id,
      });
    if (errForCadences)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching cadence by user query: ${errForCadences}`,
      });
    return successResponse(res, 'Fetched cadences', cadences);
  } catch (err) {
    logger.error(`Error while fetching cadences: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadences: ${err.message}`,
    });
  }
};

const getUserByCadence = async (req, res) => {
  try {
    const { cadence_ids } = req.body;
    const [cadenceLeads, errForCadenceLeads] = await Repository.fetchAll({
      tableName: DB_TABLES.LEADTOCADENCE,
      query: {
        cadence_id: cadence_ids,
      },
      include: {
        [DB_TABLES.LEAD]: {
          attributes: ['lead_id', 'user_id'],
          required: true,
          [DB_TABLES.USER]: {
            required: true,
            attributes: [
              'first_name',
              'last_name',
              'profile_picture',
              'is_profile_picture_present',
              'user_id',
            ],
          },
        },
      },
      extras: {
        group: ['Leads.User.user_id'],
        attributes: [],
      },
    });
    if (errForCadenceLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users by cadence',
        error: `Error while fetching lead to cadence: ${errForCadenceLeads}`,
      });
    let users = [];

    for (let link of cadenceLeads) users.push(link?.Leads?.[0]?.User);

    return successResponse(res, users);
  } catch (error) {
    logger.error(`Error while fetching users`, error);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching users by cadence: ${error.message}`,
    });
  }
};

const getCadencesForAdmin = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching user by query: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: 'User not found',
      });
    const [cadences, errForCadences] =
      await CadenceRepository.getAllCadencesForAdminByQuery({
        company_id: user.company_id,
      });
    if (errForCadences)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching cadences for admin by query: ${errForCadences}`,
      });

    return successResponse(res, 'Fetched cadences', cadences);
  } catch (err) {
    logger.error(`Error while fetching cadences: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadences: ${err.message}`,
    });
  }
};

const getAllNodesForCadence = async (req, res) => {
  try {
    const { cadence_id } = req.body;
    const [cadence, errForCadence] =
      await CadenceRepository.getNodesForCadenceStatistics({
        cadence_id,
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch steps for cadence',
        error: `Error while fetching node for cadence statistics: ${errForCadence}`,
      });
    if (!cadence)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch all nodes for cadence',
        error: 'Cadence not found',
      });

    return successResponse(res, 'Fetched nodes', cadence.Nodes);
  } catch (err) {
    logger.error(`Error while fetching nodes: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching nodes: ${err.message}`,
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
        msg: 'Failed to fetch heat map statistics',
        error: `Error while fetching user by query: ${err}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch heat map statistics',
        error: 'User not found',
      });

    let { filter, user_ids, cadence_id, node_type } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch heat map statistics',
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
          msg: 'Failed to fetch heat map statistics',
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
            msg: 'Failed to fetch heat map statistics',
            error: `Error while fetching completed tasks in interval: ${errResult}`,
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
            msg: 'Failed to fetch heat map statistics',
            error: `Error while fetching completed tasks in interval: ${errResult}`,
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
            msg: 'Failed to fetch heat map statistics',
            error: `Error while fetching completed tasks in interval: ${errResult}`,
          });

        return successResponse(res, 'Fetched heatmap', heatMapResult);
      }
    }
  } catch (err) {
    logger.error(`Error while fetching heatmap statistics`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching heatmap statistics: ${err.message}`,
    });
  }
};

const getAllUsersForStats = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users for statistics',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users for stats',
        error: 'User not found',
      });

    // Fetch all users of the company
    const [users, errForUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        company_id: user.company_id,
      },
      extras: {
        attributes: [
          'first_name',
          'last_name',
          'profile_picture',
          'is_profile_picture_present',
          'user_id',
          'sd_id',
          'role',
          'company_id',
        ],
      },
    });
    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch users for statistics',
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

const StatisticsController = {
  salesDailyActivityFollowUp,
  userActivityStatistics,
  cadenceTaskStatistics,
  cadenceContactStatistics,
  cadenceActivityStatistics,
  cadenceNodeStatistics,
  disqualificationStatistics,
  getCadencesByUserid,
  getCadencesForAdmin,
  getAllNodesForCadence,
  groupActivityStatistics,
  cadenceActivityStatisticsForGroup,
  salesGroupActivityFollowUp,
  pendingTaskStatistics,
  completedTaskStatistics,
  historyTableStatistics,
  historyGraphStatistics,
  getUserByCadence,
  heatmapStatistics,
  getAllUsersForStats,
};

module.exports = StatisticsController;
