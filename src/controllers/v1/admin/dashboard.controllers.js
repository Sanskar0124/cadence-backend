// Utils
const logger = require('../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
  badRequestResponse,
  notFoundResponse,
} = require('../../../utils/response');
const {
  LEAD_STATUS,
  ACTIVITY_TYPE,
  LEADERBOARD_DATE_FILTERS,
  USER_ROLE,
  MONITORING_LEAD_STATUS,
  NODE_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const LeadRepository = require('../../../../../Cadence-Brain/src/repository/lead.repository');
const SubDepartmentRepository = require('../../../../../Cadence-Brain/src/repository/sub-department.repository');
const ActivityRepository = require('../../../../../Cadence-Brain/src/repository/activity.repository');
const TaskRepository = require('../../../../../Cadence-Brain/src/repository/task.repository');
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');

// Helpers
const LeaderboardHelper = require('../../../../../Cadence-Brain/src/helper/leaderboard');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const LeadsHelper = require('../../../../../Cadence-Brain/src/helper/lead');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const SubDepartmentHelper = require('../../../../../Cadence-Brain/src/helper/subDepartment');

const getMonitoringForDashboard = async (req, res) => {
  try {
    const [admin, errForAdmin] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    const department_id = admin.department_id;

    // * retreive sales persons for all sub departments
    // let [subDepartments, errForSubDepartments] =
    //   await SubDepartmentRepository.getAllSubDepartmentsSalesPersonForDashboard(
    //     { department_id }
    //   );

    let [subDepartments, errForSubDepartments] =
      await SubDepartmentRepository.getSubDepartmentByQueryWithAttributes(
        {
          department_id,
        },
        ['sd_id', 'name', 'profile_picture', 'is_profile_picture_present']
      );

    if (errForSubDepartments)
      return serverErrorResponse(res, errForSubDepartments);

    subDepartments = JSON.parse(JSON.stringify(subDepartments));
    let data = [];

    const [result, errForResult] =
      await SubDepartmentHelper.getMonitoringForSubDepartment(subDepartments);

    if (errForResult) return serverErrorResponse(res, errForResult);

    return successResponse(
      res,
      `Successfully Fetched monitoring for admin dashboard.`,
      result
    );

    // let monitoringPromises = [];

    // // * loop through sub departments
    // for (let subDepartment of subDepartments) {
    //   // subDepartment = JSON.parse(JSON.stringify(subDepartment));

    //   let sdUsers = subDepartment.Users;

    //   // subDepartment.monitoring = {
    //   //   in_queue: 0,
    //   //   in_progress: 0,
    //   // };
    //   console.time('F');
    //   // const [result, errForResult] = await UserHelper.getMonitoringForUser(
    //   //   sdUsers
    //   // );

    //   monitoringPromises.push(UserHelper.getMonitoringForUser(sdUsers));
    //   console.timeEnd('F');

    //   // if (!errForResult) {
    //   //   // * add results of all users
    //   //   for (let user of result) {
    //   //     subDepartment.monitoring.in_queue += user.monitoring.in_queue;
    //   //     subDepartment.monitoring.in_progress += user.monitoring.in_progress;
    //   //   }
    //   // }

    //   // delete subDepartment.Users;

    //   // // * push to result
    //   // data.push(subDepartment);
    // }
    // console.time('F');

    // const monitoringPromisesResolved = await Promise.all(monitoringPromises);
    // console.timeEnd('F');
    // let i = 0;

    // console.time('F');

    // for (let monitoringPromiseResolved of monitoringPromisesResolved) {
    //   let [result, errForResult] = monitoringPromiseResolved;

    //   if (errForResult) return serverErrorResponse(res, errForResult);

    //   let subDepartment = subDepartments[i];

    //   subDepartment.monitoring = {
    //     in_queue: 0,
    //     in_progress: 0,
    //   };
    //   for (let user of result) {
    //     subDepartment.monitoring.in_queue += user.monitoring.in_queue;
    //     subDepartment.monitoring.in_progress += user.monitoring.in_progress;
    //   }

    //   delete subDepartment.Users;

    //   // * push to result
    //   data.push(subDepartment);

    //   i++;
    // }
    // console.timeEnd('F');
    // return successResponse(
    //   res,
    //   'Fetched monitoring for admin dashboard.',
    //   data
    // );
  } catch (err) {
    logger.error(`Error while fetching monitoring for dashboard: `, err);
    return serverErrorResponse(res);
  }
};

//const oldGetMonitoringForDashboard = async (req, res) => {
//try {
//// * retreive department id
//const { filter } = req.params;

//const [admin, errForAdmin] = await UserRepository.findUserByQuery({
//user_id: req.user.user_id,
//});

//const department_id = admin.department_id;

//// * fetch date filter
//const dateRange = LeaderboardHelper.dateFilters[filter](admin?.timezone);

//// * retreive sales persons for all sub departments
//const [sdSalesPersons, errForSdSalesPersons] =
//await SubDepartmentRepository.getAllSubDepartmentsSalesPersonForDashboard(
//{ department_id },
//dateRange
//);

//if (errForSdSalesPersons) {
//return serverErrorResponse(res, errForSdSalesPersons);
//}

//// * result to be returned
//let result = [];

//// * loop through sub departments
//for (let subDepartment of sdSalesPersons) {
//subDepartment = JSON.parse(JSON.stringify(subDepartment));

//let sdUsers = [];

//subDepartment.Users.map((user) => sdUsers.push(user.user_id));

//subDepartment.monitoring = {};

//// *  get leads count by status
//const [userMetrics, errForUserMetrics] =
//await LeadRepository.getLeadsCountByStatus({
//user_id: {
//[Op.in]: sdUsers,
//},
//[Op.or]: [
//// * filter by first_contact_time, but if it is null filter by created_at
//{
//first_contact_time: sequelize.where(
//sequelize.literal('unix_timestamp(first_contact_time)*1000'),
//{
//[Op.between]: dateRange,
//}
//),
//},
//{
//created_at: sequelize.where(
//sequelize.literal('unix_timestamp(created_at)*1000'),
//{
//[Op.between]: dateRange,
//}
//),
//},
//],
//});

//if (!errForUserMetrics) {
//userMetrics.map((metric) => {
//// * store count for status of lead that is present
//subDepartment.monitoring[metric.status] = metric.count;
//});
//}

//const [newLeadsCount, errForNewLeads] =
//await LeadRepository.getNewLeadsCount({
//user_id: {
//[Op.in]: sdUsers,
//},
//created_at: sequelize.where(
//sequelize.literal('unix_timestamp(created_at)*1000'),
//{
//[Op.between]: dateRange,
//}
//),
//});

//subDepartment.monitoring['total'] = newLeadsCount;

//delete subDepartment.Users;

//// * push to result
//result.push(subDepartment);
//}

//return successResponse(
//res,
//'Fetched monitoring for admin dashboard.',
//result
//);
//} catch (err) {
//logger.error(
//`Error while fetching monitoring for dashboard: ${err.message}`
//);
//return serverErrorResponse(res);
//}
//};

const getMetricsForDashboard = async (req, res) => {
  try {
    // * retreive filter
    const { filter } = req.params;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return serverErrorResponse(res, 'Invalid filter.');

    const [admin, errForAdmin] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForAdmin) return serverErrorResponse(res, errForAdmin);
    if (!admin) return badRequestResponse(res, `User not found`);

    // * fetch date filter
    const dateRange = LeaderboardHelper.dateFilters[filter](admin?.timezone);

    if (dateRange?.length !== 2)
      return serverErrorResponse(
        res,
        `Error while processing getting date range for filter.`
      );
    // * retreive sales persons for all sub departments

    let [subDepartments, errForSubDepartments] =
      await SubDepartmentRepository.getAllSubDepartmentsSalesPersonForDashboard(
        { department_id: req.params.department_id },
        {
          created_at: {
            [Op.between]: [
              new Date(dateRange[0])
                .toISOString()
                .slice(0, 19)
                .replace('T', ' '),
              new Date()
                .toISOString(dateRange[1])
                .slice(0, 19)
                .replace('T', ' '),
            ],
          },
        }
      );
    if (errForSubDepartments)
      return serverErrorResponse(res, errForSubDepartments);

    subDepartments = JSON.parse(JSON.stringify(subDepartments));

    let result = [],
      metricsPromises = [];

    for (let subDepartment of subDepartments) {
      // subDepartment = JSON.parse(JSON.stringify(subDepartment));

      let sdUsers = subDepartment.Users;

      // * get metrics for sd users
      // const [userMetrics, errForUserMetrics] =
      //   await UserHelper.getMetricsForUser(
      //     JSON.parse(JSON.stringify(sdUsers)),
      //     filter
      //   );

      // if (errForUserMetrics) return serverErrorResponse(res, errForUserMetrics);
      metricsPromises.push(
        UserHelper.getMetricsForUser(
          JSON.parse(JSON.stringify(sdUsers)),
          filter
        )
      );
    }

    const metricsPromisesResolved = await Promise.all(metricsPromises);

    let i = 0;

    for (let metricPromiseResolved of metricsPromisesResolved) {
      let [userMetrics, errForUserMetrics] = metricPromiseResolved;

      if (errForUserMetrics) return serverErrorResponse(res, errForUserMetrics);
      let subDepartment = subDepartments[i];
      subDepartment.metric = {
        no_of_calls: 0,
        no_of_mails: 0,
        no_of_messages: 0,
        no_of_tasks: 0,
        completed_tasks: 0,
      };

      subDepartment.noOfConverted = 0;
      subDepartment.noOfDisqualified = 0;
      subDepartment.avg_time_till_first_call = 0;

      for (let user of userMetrics) {
        subDepartment.metric.no_of_calls += user?.metric?.no_of_calls || 0;
        subDepartment.metric.no_of_mails += user?.metric?.no_of_mails || 0;
        subDepartment.metric.no_of_messages +=
          user?.metric?.no_of_messages || 0;
        subDepartment.metric.no_of_tasks += user?.metric?.no_of_tasks || 0;
        subDepartment.metric.completed_tasks +=
          user?.metric?.completed_tasks || 0;
        // * noOfConverted for each user is in percentage form, so for team take avg of all percentages.
        // * Here we are only adding the percentages, outside loop divide by no of users
        subDepartment.noOfConverted += user.noOfConverted;
        subDepartment.noOfDisqualified += user.noOfDisqualified;
        // * Here we are only adding the avg_time_till_first_call for individual users , outside loop divide by no of users
        subDepartment.avg_time_till_first_call += user.avg_time_till_first_call;
      }

      // * dividing by no of users
      // subDepartment.noOfConverted =
      //   (subDepartment.noOfConverted / (userMetrics.length || 1)).toFixed(2) ||
      //   0;

      // * dividing by no of users
      subDepartment.avg_time_till_first_call = (
        subDepartment.avg_time_till_first_call / (userMetrics.length || 1)
      ).toFixed(2);

      delete subDepartment.Users;

      result.push({
        ...JSON.parse(JSON.stringify(subDepartment)),
      });

      i++;
    }

    return successResponse(res, 'Fetched metrics for admin dashboard.', result);
  } catch (err) {
    logger.error(`Error while fetching metrics for dashboard: `, err);
    return serverErrorResponse(res);
  }
};

const getSubDepartmentUsers = async (req, res) => {
  try {
    // * retreive sub_department id
    const { sd_id } = req.params;

    // * retreive sales persons for all sub departments
    const [sdSalesPersons, errForSdSalesPersons] =
      await SubDepartmentRepository.getAllSubDepartmentsSalesPersonForDashboard(
        { sd_id }
      );
    if (errForSdSalesPersons)
      return serverErrorResponse(res, errForSdSalesPersons);

    // * result to be returned
    let result = [];

    // * for all sales persons of sub department
    for (let salesPerson of sdSalesPersons[0].Users) {
      let leadsResult = {};
      // * retreive lead by their status
      for (let status in LEAD_STATUS) {
        const leadCountRow = salesPerson.Leads.filter(
          (l) => l.status === LEAD_STATUS[status]
        );
        if (!leadCountRow) {
          leadsResult[LEAD_STATUS[status]] = 0;
        } else {
          leadsResult[LEAD_STATUS[status]] = leadCountRow.length;
        }
      }

      let noOfMessages = 0;
      let noOfEmails = 0;

      // * get number of messages
      salesPerson.Leads.map((l) => {
        noOfMessages += l.Conversations.length;
      });

      // * for all leads of sales person
      for (let lead of salesPerson.Leads) {
        // GETIING ACTIVITY FOR LEAD

        // * get call activity
        const [callActivity, errForCallActivity] =
          await ActivityRepository.getActivitiesByQuery({
            lead_id: lead.lead_id,
            type: ACTIVITY_TYPE.CALL,
          });

        // * get message activity
        const [messageActivity, errForMessageActivity] =
          await ActivityRepository.getActivitiesByQuery({
            lead_id: lead.lead_id,
            type: ACTIVITY_TYPE.MESSAGE,
          });

        // * get mail activity
        const [mailActivity, errForMailActivity] =
          await ActivityRepository.getActivitiesByQuery({
            lead_id: lead.lead_id,
            type: 'mail',
          });

        noOfEmails = mailActivity.length; // calculating all email activity of the salesperson

        logger.info('Call activity: ' + callActivity.length);
        logger.info('Message activity: ' + messageActivity.length);
        logger.info('Mail activity: ' + mailActivity.length);

        // * Setting call activity and message activity
        lead.dataValues.callActivity = callActivity.length;
        lead.dataValues.messageActivity = messageActivity.length;
        lead.dataValues.mailActivity = mailActivity.length;
      }

      // * average for time_limit_for_first_call
      let avgTimeLimitForFirstCall = 0;

      // * If leads are assigned to sales person then update avgTimeLimitForFirstCall
      if (salesPerson.Leads.length) {
        const [timeLimitForFirstCall, errForTimeLimitForFirstCall] =
          await LeadsHelper.getTimeLimitTillFirstCall(
            salesPerson.Leads,
            salesPerson.user_id
          );

        if (errForTimeLimitForFirstCall) {
          return serverErrorResponse(res, errForTimeLimitForFirstCall);
        }

        avgTimeLimitForFirstCall += timeLimitForFirstCall;

        try {
          avgTimeLimitForFirstCall =
            Math.round(
              (timeLimitForFirstCall / salesPerson.Leads.length) * 100
            ) / 100;
        } catch (e) {
          logger.error('No leads assigned');
        }
      }

      // * store sales persons stats
      result.push({
        sd_name: sdSalesPersons[0].name,
        ...JSON.parse(JSON.stringify(salesPerson)),
        statistics: {
          monitoring: leadsResult,
          metrics: {
            number_of_calls: 0,
            number_of_mails: noOfEmails,
            number_of_messages: noOfMessages,
            '%_of_leads_converted':
              (leadsResult?.converted / salesPerson?.Leads?.length) * 100 || 0,
            time_limit_till_first_call: avgTimeLimitForFirstCall,
          },
        },
      });
    }

    return successResponse(res, 'Fetched dashboard data successfully.', result);
  } catch (err) {
    logger.error(
      `Error while fetching sub department users for admin dashboard: `,
      err
    );
    return serverErrorResponse(res, err.message);
  }
};

const getMonitoringForSubDepartment = async (req, res) => {
  try {
    // * retreive filter
    const { sd_id } = req.params;

    const [subDepartment, errForSubDepartment] =
      await SubDepartmentRepository.getSubDepartment({ sd_id });
    if (errForSubDepartment)
      return serverErrorResponse(
        res,
        `Error while fetching sub department: ${errForSubDepartment}`
      );
    if (!subDepartment)
      return badRequestResponse(
        res,
        `No sub-department found with id ${sd_id}.`
      );

    // * fetch users with their lead,activity
    const [result, errForResult] =
      await UserRepository.getAllSubDepartmentUsersWithLeads(
        {
          sd_id,
          role: {
            [Op.notIn]: [USER_ROLE.ADMIN, USER_ROLE.SALES_MANAGER],
          },
        },
        [],
        'monitoring'
      );
    if (errForResult) return serverErrorResponse(res, errForResult);

    const [data, errForData] = await UserHelper.getMonitoringForUser(result);
    if (errForData) return serverErrorResponse(res, errForData);

    return successResponse(
      res,
      'Fetched monitoring for sub department for admin.',
      { subDepartment, data }
    );
  } catch (err) {
    logger.error(
      `Error while fetching monitoring for sub department in admin: `,
      err
    );
    return serverErrorResponse(res, err.message);
  }
};

const getLeadsActivtiesForMonitoring = async (req, res) => {
  try {
    // * retreive user_id,status of leads to be fetched and filter
    const { status, user_id } = req.params;
    const { limit, offset } = req.query;

    if (!Object.values(MONITORING_LEAD_STATUS).includes(status))
      return badRequestResponse(res, `Invalid status: ${status}.`);

    let taskQuery = {};
    let userQuery = {
      user_id: user_id,
    };

    if (status === MONITORING_LEAD_STATUS.IN_QUEUE)
      userQuery = {
        ...userQuery,
        // '$Tasks.task_id$': null,
        status: LEAD_STATUS.NEW_LEAD,
        [Op.or]: [
          {
            '$Tasks.task_id$': null,
          },
          {
            '$Tasks.completed$': 0,
          },
        ],
      };
    else if (status === MONITORING_LEAD_STATUS.IN_PROGRESS)
      taskQuery = {
        completed: 1,
      };

    // * fetch leads with activties
    let [leads, errForLeads] = await LeadRepository.getLeadsWithActivities(
      {
        ...userQuery,
      },
      taskQuery
    );

    if (errForLeads) serverErrorResponse(res, errForLeads);

    // * apply offset
    if (offset) leads = leads.slice(offset);

    // * apply limit
    if (limit) leads = leads.slice(0, limit);

    return successResponse(
      res,
      'Leads fetched with activities for monitoring of subdepartment for admin.',
      leads
    );
  } catch (err) {
    logger.error(
      `Error while fetching lead activities for monitoring of subdepartment for admin: `,
      err
    );
    return serverErrorResponse(res, err.message);
  }
};

const getMetricsForSubDepartment = async (req, res) => {
  try {
    // * retreive filter
    const { filter, sd_id } = req.params;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      return serverErrorResponse(res, 'Invalid filter.');
    }

    const [admin, errForAdmin] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    // * fetch date filter
    const dateRange = LeaderboardHelper.dateFilters[filter](admin?.timezone);

    const [subDepartment, errForSubDepartment] =
      await SubDepartmentRepository.getSubDepartment({ sd_id });
    if (errForSubDepartment)
      return serverErrorResponse(
        res,
        `Error while fetching sub department: ${errForSubDepartment}`
      );
    if (!subDepartment)
      return badRequestResponse(
        res,
        `No sub-department found with id ${sd_id}.`
      );

    // * fetch users with their lead,activity
    const [result, errForResult] =
      await UserRepository.getAllSubDepartmentUsersWithLeads(
        {
          sd_id,
          role: {
            [Op.notIn]: [USER_ROLE.ADMIN, USER_ROLE.SALES_MANAGER],
          },
        },
        dateRange,
        'metrics'
      );
    if (errForResult) return serverErrorResponse(res, errForResult);

    const [userMetrics, errForUserMetrics] = await UserHelper.getMetricsForUser(
      result,
      filter
    );
    if (errForUserMetrics) return serverErrorResponse(res, errForUserMetrics);

    return successResponse(
      res,
      'Fetched metrics successfully for subdepartment for admin.',
      { subDepartment, data: userMetrics }
    );
  } catch (err) {
    logger.error(
      `Error while fetching metrics for subdepartment for admin: `,
      err
    );
    return serverErrorResponse(res, err.message);
  }
};
const getAllSubdepartments = async (req, res) => {
  try {
    // Fetch admin info
    let [admin, errForAdmin] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForAdmin) return serverErrorResponse(res, errForAdmin);

    // query subdepartment-> include department -> include company where company id is admin company id
    let [subDepartments, errForSubDepartments] =
      await SubDepartmentRepository.getAllSubdepartmentsByCompanyId(
        admin.company_id
      );
    if (errForSubDepartments)
      return serverErrorResponse(res, errForSubDepartments);
    if (subDepartments.length === 0)
      return notFoundResponse(res, 'No sub departments found');

    return successResponse(
      res,
      'Fetched subdepartments successfully.',
      subDepartments
    );
  } catch (err) {
    logger.error(`Error while fetching subdepartments for admin: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const getAllUsersOfSubdepartmentWithTaskCount = async (req, res) => {
  try {
    const { sd_id } = req.params;

    const [admin, errForAdmin] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForAdmin) return serverErrorResponse(res);

    // Get admin timezone 12am in unix timestamp
    const currentStartTime = new Date().getTime();
    const adminStartTime = UserHelper.setHoursForTimezone(
      0,
      currentStartTime,
      admin?.timezone
    );

    let [users, errForUsers] =
      await UserRepository.getAllSubDepartmentUsersWithTaskCount(
        sd_id,
        adminStartTime
      );
    if (errForUsers)
      return serverErrorResponse(
        res,
        `Error while fetching users with completed tasks count: ${errForUsers}`
      );

    users = users.filter((n) => n.user_id !== null);
    if (users.length === 0)
      return successResponse(res, 'No users present in this sub department');

    return successResponse(
      res,
      'Fetched all salespersons with completed tasks.',
      users
    );
    /*
    // get users of subdepartment
    const [users, err] = await UserRepository.findUsersByQuery({
      sd_id: req.params.sd_id,
      role: {
        // role is not admin or sales_manager
        [Op.notIn]: [USER_ROLE.ADMIN, USER_ROLE.SALES_MANAGER],
      },
    });
    if (err) return serverErrorResponse(res);

    let promises = [];
    users.forEach((user) => {
      let query = {
        user_id: user.user_id,
        // start time in last 24 hours
        // check if logic needs optimization <>
        start_time: {
          [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      };
      promises.push(TaskRepository.countTasks({ ...query, completed: 1 })); // completed tasks
      promises.push(TaskRepository.countTasks(query)); // all tasks
    });

    let resolvedPromises = await Promise.all(promises);
    for (let i = 0; i < resolvedPromises.length; i += 2) {
      users[i / 2].completed_tasks = resolvedPromises[i][0];
      users[i / 2].total_tasks = resolvedPromises[i + 1][0];
    }

    return successResponse(res, 'Fetched all employees.', users);
    */
  } catch (err) {
    logger.error(`Error while fetching all salespersons: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const getTasksOfUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { status } = req.query;
    if (status === 'in_progress') {
      const [tasks, err] = await TaskHelper.getPendingTasks(user_id, '', '');
      if (err) return serverErrorResponse(res);
      if (tasks.length === 0)
        return successResponse(res, 'User does not have any pending tasks.');

      return successResponse(res, 'Fetched all pending tasks.', tasks);
    } else {
      // Fetch manager info
      let [user, errForUser] = await UserRepository.findUserByQuery({
        user_id,
      });
      if (errForUser) return serverErrorResponse(res, errForUser);

      // Get user timezone 12am in unix timestamp
      const currentStartTime = new Date().getTime();
      const userStartTime = UserHelper.setHoursForTimezone(
        0,
        currentStartTime,
        user?.timezone
      );
      const [tasks, err] = await TaskRepository.getTasksByQuery(
        {
          completed: 1,
          complete_time: {
            [Op.gte]: userStartTime,
          },
          user_id,
        },
        {
          type: {
            [Op.notIn]: [
              NODE_TYPES.AUTOMATED_MAIL,
              NODE_TYPES.AUTOMATED_MESSAGE,
            ],
          },
        }
      );
      if (err) return serverErrorResponse(res);
      if (tasks.length === 0)
        return successResponse(res, 'User does not have any completed tasks.');

      return successResponse(res, 'Fetched all completed tasks.', tasks);
    }
  } catch (err) {
    logger.error(`Error while fetching employee tasks by admin: `, err);
    return serverErrorResponse(res);
  }
};

const DashboardController = {
  getSubDepartmentUsers,
  getMonitoringForDashboard,
  getMetricsForDashboard,
  getMonitoringForSubDepartment,
  getLeadsActivtiesForMonitoring,
  getMetricsForSubDepartment,
  getAllSubdepartments,
  getAllUsersOfSubdepartmentWithTaskCount,
  getTasksOfUser,
};

module.exports = DashboardController;
