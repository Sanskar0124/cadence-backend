// Utils
const logger = require('../../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
  notFoundResponse,
  badRequestResponse,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  LEADERBOARD_DATE_FILTERS,
  ACTIVITY_TYPE,
  USER_ROLE,
  MONITORING_LEAD_STATUS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const SubDepartmentRepository = require('../../../../../../Cadence-Brain/src/repository/sub-department.repository');
const ActivityRepository = require('../../../../../../Cadence-Brain/src/repository/activity.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');

// Helpers and services
const LeadsHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const LeaderboardHelper = require('../../../../../../Cadence-Brain/src/helper/leaderboard');
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');

const getDashboardData = async (req, res) => {
  // req.params.id ==> manager's user_id
  try {
    // const [dashboardData, err] =
    //   await SubDepartmentRepository.getManagerDashboardData(req.user.user_id);
    // // if error is present, send response appropriately
    // if (err) {
    //   if (err === 'Manager not found.') {
    //     return notFoundResponse(res, 'Manager not found.');
    //   } else if (err === 'No Salespersons present.') {
    //     return notFoundResponse(res, 'No Salespersons present.');
    //   }
    //   if (err === 'Sub department not found.') {
    //     return badRequestResponse(res, err);
    //   } else {
    //     return serverErrorResponse(res);
    //   }
    // }
    // return successResponse(res, 'Data fetched successfully.', dashboardData);

    // * retreive filter
    const { filter } = req.params;

    const [user] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    // * retreive sales persons for all sub departments
    const [sdSalesPersons, errForSdSalesPersons] =
      await SubDepartmentRepository.getAllSubDepartmentsSalesPersonForDashboard(
        { sd_id: user.sd_id }
      );

    if (errForSdSalesPersons) {
      return serverErrorResponse(res, errForSdSalesPersons);
    }

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
      let noOfCalls = 0;

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

        noOfEmails += mailActivity.length; // calculating all email activity of the salesperson
        noOfCalls += callActivity.length;

        // logger.info('Call activity: ' + callActivity.length);
        // logger.info('Message activity: ' + messageActivity.length);
        // logger.info('Mail activity: ' + mailActivity.length);

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
            number_of_calls: noOfCalls,
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
    // console.log(err);
    logger.info(err.message);
    return serverErrorResponse(res);
  }
};

const getMonitoringForManager = async (req, res) => {
  try {
    const [manager, errForManager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    // * fetch users with their lead,activity
    const [result, errForResult] =
      await UserRepository.getAllSubDepartmentUsersWithLeads(
        {
          sd_id: manager.sd_id,
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

    return successResponse(res, `Fetched monitoring for manager.`, data);
  } catch (err) {
    logger.error(
      `Error while fetching monitoring for manager: ${err.message}.`
    );
    return serverErrorResponse(res, err.message);
  }
};

const oldGetMonitoringForManager = async (req, res) => {
  try {
    // * retreive filter
    const { filter } = req.params;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter)) {
      return serverErrorResponse(res, 'Invalid filter.');
    }

    const [manager, errForManager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    // * fetch date filter
    const dateRange = LeaderboardHelper.dateFilters[filter](manager?.timezone);

    // * fetch users with their lead,activity
    const [result, errForResult] =
      await UserRepository.getAllSubDepartmentUsersWithLeads(
        {
          sd_id: manager.sd_id,
          role: {
            [Op.notIn]: [USER_ROLE.ADMIN, USER_ROLE.SALES_MANAGER],
          },
        },
        dateRange,
        'monitoring'
      );

    if (errForResult) {
      return serverErrorResponse(res, errForResult);
    }

    // *  to return the data in response
    let data = [];

    // * loop through users
    for (let user of result) {
      // * parse the user
      user = JSON.parse(JSON.stringify(user));

      // *  get lead count by status
      const [userMetrics, errForUserMetrics] =
        await LeadRepository.getLeadsCountByStatus({
          user_id: user.user_id,
          [Op.or]: [
            // * filter by first_contact_time, but if it is null filter by created_at
            {
              first_contact_time: sequelize.where(
                sequelize.literal('unix_timestamp(first_contact_time)*1000'),
                {
                  [Op.between]: dateRange,
                }
              ),
            },
            {
              created_at: sequelize.where(
                sequelize.literal('unix_timestamp(created_at)*1000'),
                {
                  [Op.between]: dateRange,
                }
              ),
            },
          ],
        });

      /**
       * * If no lead is present for a status, its count will not be fetched,
       * * so assume 0 for status whose count is absent in  user metrics and display accordingly in frontend
       */

      user.monitoring = {};

      userMetrics.map((metric) => {
        // * store count for status of lead that is present
        user.monitoring[metric.status] = metric.count;
      });

      const [newLeadsCount, errForNewLeadsCount] =
        await LeadRepository.getNewLeadsCount({
          user_id: user.user_id,
          created_at: sequelize.where(
            sequelize.literal('unix_timestamp(created_at)*1000'),
            {
              [Op.between]: dateRange,
            }
          ),
        });

      user.monitoring['total'] = newLeadsCount || 0;

      // * dont need leads data in response
      delete user.Leads;

      // * push into user
      data.push(user);
    }

    return successResponse(res, 'Fetched monitoring for manager.', data);
  } catch (err) {
    logger.error(
      `Error while fetching monitoring for manager: ${err.message}.`
    );
    return serverErrorResponse(res, err.message);
  }
};

const getLeadsActivtiesForMonitoring = async (req, res) => {
  try {
    // * retreive user_id,status of leads to be fetched and filter
    const { status, user_id } = req.params;

    let { limit, offset } = req.query;

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
    return successResponse(res, 'Leads fetched with activities.', leads);
  } catch (err) {
    logger.error(
      `Error while fetching lead activities for monitoring: ${err.message}.`
    );
    return serverErrorResponse(res, err.message);
  }
};

const getMetricsForManager = async (req, res) => {
  try {
    // * retreive filter
    const { filter } = req.params;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return serverErrorResponse(res, 'Invalid filter.');

    const [manager, errForManager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    if (errForManager) return badRequestResponse(res, `No manager found.`);

    // * fetch date filter
    const dateRange = LeaderboardHelper.dateFilters[filter](manager?.timezone);

    // * fetch users with their lead,activity
    const [result, errForResult] =
      await UserRepository.getAllSubDepartmentUsersWithLeads(
        {
          sd_id: manager.sd_id,
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

    return successResponse(res, 'Fetched metrics successfully.', userMetrics);
  } catch (err) {
    // console.log(err);
    logger.error(`Error while fetching metrics for manager: ${err.message}.`);
    return serverErrorResponse(res, err.message);
  }
};

const ManagerDashboard = {
  getDashboardData,
  getMonitoringForManager,
  getLeadsActivtiesForMonitoring,
  getMetricsForManager,
};

module.exports = ManagerDashboard;
