// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
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
  CRM_INTEGRATIONS,
  LEAD_INTEGRATION_TYPES,
  AUTOMATED_NODE_TYPES_ARRAY,
  COMPARE_CADENCE_KPI_TYPE,
  COMPARE_CADENCE_VALUE_TYPE,
  COMPARE_CADENCE_COMPARISION_TYPE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  URGENT_TIME_DIFF_FOR_INBOUND,
  URGENT_TIME_DIFF_FOR_OUTBOUND,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// Joi
const statisticsSchema = require('../../../joi/v2/admin/statistics.joi');

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
const getCompleteTasksInIntervalV2 = require('../../../../../Cadence-Brain/src/helper/statistics/getCompleteTasksInIntervalV2');
const StatisticsHelper = require('../../../../../Cadence-Brain/src/helper/statistics/');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const SalesforceHelpers = require('../../../../../Cadence-Brain/src/helper/salesforce');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const { customRandom } = require('nanoid');

const cadenceStatisticsController = async (req, res) => {
  try {
    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: 'Invalid filter',
      });

    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);

    const [start_date, end_date] = dateRange;

    let cadencesCount, errForCadenceCounts;

    if (!user_ids)
      [cadencesCount, errForCadenceCounts] = await Repository.fetchAll({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: cadence_id ?? { [Op.ne]: null },
        },
        include: {
          [DB_TABLES.USER]: {
            required: true,
            where: {
              company_id: user.company_id,
            },
            attributes: [],
          },
        },
        extras: {
          group: ['status'],
          attributes: [
            'status',
            [
              sequelize.literal(`COUNT(DISTINCT cadence_id ) `),
              'cadence_count',
            ],
          ],
        },
      });
    // Find cadences of leads which belong to selected users
    else
      [cadencesCount, errForCadenceCounts] = await Repository.fetchAll({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: cadence_id ?? { [Op.ne]: null },
        },
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            attributes: [],
            required: true,
            [DB_TABLES.LEAD]: {
              attributes: [],
              where: {
                user_id: user_ids,
              },
            },
          },
        },
        extras: {
          group: ['status'],
          // logging: true,
          attributes: [
            'status',
            [
              sequelize.literal(`COUNT(DISTINCT cadence.cadence_id ) `),
              'cadence_count',
            ],
          ],
        },
      });
    if (errForCadenceCounts) {
      logger.error(`Error while fetching cadences: `, errForCadenceCounts);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: `Error while fetching cadences: ${errForCadenceCounts}`,
      });
    }
    return successResponse(res, `Fetched cadence statistics`, cadencesCount);
  } catch (err) {
    logger.error(`Error while fetching cadence statistics : `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadence statistics : ${err.message}`,
    });
  }
};

const taskStatisticsController = async (req, res) => {
  try {
    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch task statistics',
        error: 'Invalid filter',
      });

    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch task statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);

    const [start_date, end_date] = dateRange;

    let taskCounts, errForTaskCounts;

    [taskCounts, errForTaskCounts] = await Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        user_id: user_ids ?? { [Op.ne]: null },
        cadence_id: cadence_id ?? { [Op.ne]: null },

        [Op.or]: [
          {
            start_time: {
              [Op.between]: dateRange,
            },
            is_skipped: false,
            completed: false,
          },
          {
            complete_time: {
              [Op.between]: dateRange,
            },
            completed: true,
          },
          {
            skip_time: {
              [Op.between]: dateRange,
            },
            is_skipped: true,
          },
        ],
      },
      include: {
        [DB_TABLES.USER]: {
          where: {
            company_id: user.company_id,
          },
          attributes: [],
          required: true,
        },
        [DB_TABLES.CADENCE]: {
          attributes: [],
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
      },
      extras: {
        attributes: [
          [
            sequelize.literal(`COUNT(DISTINCT task_id,CASE
              WHEN complete_time BETWEEN ${start_date} AND ${end_date} AND completed = 1
              THEN 1
              ELSE NULL
          END ) `),
            'completed_count',
          ],
          [
            sequelize.literal(`COUNT(DISTINCT task_id,CASE
              WHEN skip_time BETWEEN ${start_date} AND ${end_date} AND is_skipped = 1
              THEN 1
              ELSE NULL
          END ) `),
            'skipped_count',
          ],
          [
            sequelize.literal(`COUNT(DISTINCT task_id,CASE
              WHEN start_time BETWEEN ${start_date} AND ${end_date} AND is_skipped = 0 AND completed=0
              THEN 1
              ELSE NULL
          END ) `),
            'pending_count',
          ],
        ],
      },
    });
    // Not to be used -> TBD from frontend.
    return successResponse(res, `Fetched cadence statistics`, taskCounts);
  } catch (err) {
    logger.error(`Error while fetching task stats: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching task stats: ${err.message}`,
    });
  }
};

const leadStatusCountController = async (req, res) => {
  try {
    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead status count',
        error: 'Invalid filter',
      });

    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead status count',
        error: `Error while fetching user by query: ${err}`,
      });

    let integrationType = [];

    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        integrationType = [
          LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT,
          LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
        ];
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        integrationType = LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        integrationType = LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT;
        break;
    }

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);

    let statusCounts, errForStatusCounts;

    if (!user_ids && !cadence_id)
      [statusCounts, errForStatusCounts] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          company_id: user.company_id,
          status_update_timestamp: {
            [Op.between]: dateRange,
          },
        },

        extras: {
          attributes: [
            [
              sequelize.literal(`COUNT(DISTINCT lead_id, 
              CASE WHEN lead.status = "${LEAD_STATUS.CONVERTED}" 
              THEN 1
              ELSE NULL
              END )`),
              'converted_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT lead_id, 
              CASE WHEN lead.status = "${LEAD_STATUS.TRASH}"
              THEN 1
              ELSE NULL
              END )`),
              'disqualified_count',
            ],
          ],
        },
      });
    else {
      let leadIncludeObject;

      if (cadence_id)
        leadIncludeObject = {
          [DB_TABLES.LEADTOCADENCE]: {
            where: {
              cadence_id: cadence_id,
            },
            attributes: [],
          },
        };

      [statusCounts, errForStatusCounts] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          company_id: user.company_id,
          user_id: user_ids ?? { [Op.ne]: null },
          status_update_timestamp: {
            [Op.between]: dateRange,
          },
        },
        include: leadIncludeObject,
        extras: {
          attributes: [
            [
              sequelize.literal(`COUNT(DISTINCT lead_id, 
            CASE WHEN lead.status = "${LEAD_STATUS.CONVERTED}" 
            THEN 1
            ELSE NULL
            END )`),
              'converted_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT lead_id, 
            CASE WHEN lead.status = "${LEAD_STATUS.TRASH}"
            THEN 1
            ELSE NULL
            END )`),
              'disqualified_count',
            ],
          ],
        },
      });
    }
    if (errForStatusCounts) {
      logger.error(`Error while fetching status count:`, errForStatusCounts);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead status count',
        error: `Error while fetching leads: ${errForStatusCounts}`,
      });
    }

    const [demosBooked, errForDemosBooked] = await Repository.fetchAll({
      tableName: DB_TABLES.DEMO,
      query: {
        created_at: {
          [Op.between]: dateRange,
        },
        cadence_id: cadence_id ?? { [Op.ne]: null },
      },
      include: {
        [DB_TABLES.LEAD]: {
          where: {
            user_id: user_ids ?? { [Op.ne]: null },
          },
          required: true,
          attributes: [],
          [DB_TABLES.USER]: {
            required: true,
            attributes: [],
            where: {
              company_id: user.company_id,
            },
          },
        },
      },
      extras: {
        attributes: [
          [sequelize.literal(`COUNT(DISTINCT demo.lead_id)`), 'demos_booked'],
        ],
        // logging: true,
      },
    });
    if (errForDemosBooked) {
      logger.error(`Error while fetching demo count:`, errForDemosBooked);
    }

    statusCounts[0].demos_booked = demosBooked[0]?.demos_booked;

    return successResponse(res, `Fetched lead status statistics`, statusCounts);
  } catch (err) {
    logger.error(`Error while fetching lead status count: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead status count: ${err.message}`,
    });
  }
};

const opportunityMetrics = async (req, res) => {
  try {
    let { filter, user_ids, cadence_id } = req.body;

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch opportunity metrics',
        error: 'Invalid filter',
      });

    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch opportunity metrics',
        error: `Error while fetching user by query: ${err}`,
      });

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
    const [start_date, end_date] = dateRange;

    const startDay = new Date().toISOString().slice(0, 19).replace('T', ' ');

    let opportunityCount, errForCount;

    if (!user_ids && !cadence_id)
      [opportunityCount, errForCount] = await Repository.fetchAll({
        tableName: DB_TABLES.OPPORTUNITY,
        query: {
          company_id: req.user.company_id,
          [Op.or]: [
            {
              created_at: {
                [Op.between]: dateRange,
              },
            },
            {
              close_date: {
                [Op.between]: dateRange,
              },
            },
          ],
        },
        extras: {
          attributes: [
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN created_at < "${startDay}"
                THEN 1
                ELSE NULL
              END ) `),
              'created_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN close_date < "${startDay}"
                THEN 1
                ELSE NULL
              END ) `),
              'closed_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN close_date < "${startDay}" AND status="won"
                THEN 1
                ELSE NULL
              END ) `),
              'won_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN close_date < "${startDay}" AND status="lost"
                THEN 1
                ELSE NULL
              END ) `),
              'lost_count',
            ],
          ],
          // logging: true,
        },
      });
    else
      [opportunityCount, errForCount] = await Repository.fetchAll({
        tableName: DB_TABLES.OPPORTUNITY,
        query: {
          company_id: req.user.company_id,

          cadence_id: cadence_id ?? { [Op.ne]: null },
          user_id: user_ids ?? { [Op.ne]: null },
          [Op.or]: [
            {
              created_at: {
                [Op.between]: dateRange,
              },
            },
            {
              close_date: {
                [Op.between]: dateRange,
              },
            },
          ],
        },

        extras: {
          attributes: [
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN created_at < "${startDay}"
                THEN 1
                ELSE NULL
              END ) `),
              'created_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN close_date < "${startDay}"
                THEN 1
                ELSE NULL
              END ) `),
              'closed_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN close_date < "${startDay}" AND status="won"
                THEN 1
                ELSE NULL
              END ) `),
              'won_count',
            ],
            [
              sequelize.literal(`COUNT(DISTINCT opportunity_id,CASE
                WHEN close_date < "${startDay}" AND status="lost"
                THEN 1
                ELSE NULL
              END ) `),
              'lost_count',
            ],
          ],
        },
      });
    return successResponse(
      res,
      `Fetched opportunity statistics`,
      opportunityCount
    );
  } catch (err) {
    logger.error(`Error while fetching opportunity metrics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching opportunity metrics: ${err.message}`,
    });
  }
};

const revenueMetricsController = async (req, res) => {
  try {
    let { filter, user_ids, cadence_id } = req.body;

    if (!user_ids || user_ids.length === 0) user_ids = null;

    if (!cadence_id || cadence_id.length === 0) cadence_id = null;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch revenue metrics',
        error: 'Invalid filter',
      });

    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch revenue metrics',
        error: `Error while fetching user by query: ${err}`,
      });

    const dateRange = LeaderboardHelper.dateFilters[filter](user.timezone);
    const [start_date, end_date] = dateRange;

    let revenue, errForRevenue;

    const offsetInMilliseconds = UserHelper.getTimezoneOffset(user.timezone);
    const offSetInMinutes = Math.ceil(offsetInMilliseconds / (1000 * 60));

    if (!user_ids && !cadence_id) {
      let sequelizeAttribute, groupBy;

      switch (filter) {
        case LEADERBOARD_DATE_FILTERS.TODAY:
        case LEADERBOARD_DATE_FILTERS.YESTERDAY: {
          sequelizeAttribute = [
            sequelize.cast(
              sequelize.fn(
                'DATE_FORMAT',
                sequelize.fn(
                  'DATE_ADD',
                  sequelize.col('close_date'),
                  sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
                ),
                '%H'
              ),
              'INTEGER'
            ),
            'hour',
          ];
          groupBy = ['hour'];
          break;
        }
        case LEADERBOARD_DATE_FILTERS.LAST_WEEK:
        case LEADERBOARD_DATE_FILTERS.THIS_WEEK: {
          sequelizeAttribute = [
            sequelize.fn(
              'DAYOFWEEK',
              sequelize.fn(
                'DATE_ADD',
                sequelize.col('close_date'),
                sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
              )
            ),
            'day_of_week',
          ];

          groupBy = ['day_of_week'];
          break;
        }
        case LEADERBOARD_DATE_FILTERS.LAST_MONTH:
        case LEADERBOARD_DATE_FILTERS.THIS_MONTH: {
          sequelizeAttribute = [
            sequelize.fn(
              'DAYOFMONTH',
              sequelize.fn(
                'DATE_ADD',
                sequelize.col('close_date'),
                sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
              )
            ),
            'day_of_month',
          ];
          groupBy = ['day_of_month'];
          break;
        }
      }

      [revenue, errForRevenue] = await Repository.fetchAll({
        tableName: DB_TABLES.OPPORTUNITY,
        query: {
          company_id: user.company_id,
          close_date: {
            [Op.between]: dateRange,
          },
        },
        extras: {
          attributes: [
            sequelizeAttribute,
            [
              sequelize.literal(
                `SUM(CASE WHEN status in ("open","closed") THEN amount ELSE 0 END) `
              ),
              'forcast',
            ],
            [
              sequelize.literal(
                `SUM(CASE WHEN status="closed" THEN amount ELSE 0 END) `
              ),
              'mrr',
            ],
          ],
          group: groupBy,
        },
      });
    }

    return successResponse(res, `Fetched revenue`, revenue);
  } catch (err) {
    logger.error(`Error while fetching revenue metrics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching revenue metrics: ${err.message}`,
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
      await StatisticsHelper.getPendingTasksV2(
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
        error: `Error while fetching pending tasks v2: ${errForPendingTaskStatistics}`,
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
        error: `Errror while fetching user by query: ${err}`,
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
        [Op.or]: [
          {
            skip_time: {
              [Op.between]: dateRange,
            },
          },
          {
            complete_time: {
              [Op.between]: dateRange,
            },
          },
        ],
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
                NODE_TYPES.END,
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
      error: `Error while fetching completed tasks statistics: ${err.message}`,
    });
  }
};

const skippedTaskStatistics = async (req, res) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch skipped task statistics',
        error: `Error while fetching user by query: ${err}`,
      });

    let { filter, user_ids, cadence_id } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch skipped task statistics',
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
        skip_time: {
          [Op.between]: [start_date, end_date],
        },
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
                NODE_TYPES.END,
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
        nest: true,
        // logging: true,
        group: ['Node.type', 'skip_reason'],
        attributes: [
          'skip_reason',
          [
            sequelize.literal(`COUNT(CASE
                WHEN skip_time BETWEEN ${start_date} AND ${end_date} AND is_skipped=1
                THEN 1
                ELSE NULL
            END ) `),
            'skipped_count',
          ],
        ],
      },
    });
    if (errForCompletedTasks) {
      logger.error('Error while fetching count', errForCompletedTasks);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch skipped task statistics',
        error: `Error while fetching completed tasks: ${errForCompletedTasks}`,
      });
    }

    return successResponse(
      res,
      'Fetched skipped task statistics',
      completedTasks
    );
  } catch (err) {
    logger.error(`Error while fetching skipped task statistics:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching skipped task statistics: ${err.message}`,
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
        msg: 'Failed to fetch history graph statistcs',
        error: `Error while fetching user by query: ${err}`,
      });

    let { filter, user_ids, cadence_id, node_type } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history graph statistcs',
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

          const offsetInMilliseconds = UserHelper.getTimezoneOffset(
            user.timezone
          );
          const offSetInMinutes = Math.ceil(offsetInMilliseconds / (1000 * 60));

          const [tasks, errForTasks] =
            await StatisticsHelper.getMailTasksForHistoryGraphV2(
              user,
              start_date,
              end_date,
              user_ids,
              cadence_id,
              typesForQuery,
              [
                sequelize.fn(
                  'HOUR',
                  sequelize.fn(
                    'DATE_ADD',
                    sequelize.literal(`FROM_UNIXTIME(complete_time / 1000)`),
                    sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
                  )
                ),
                'hour',
              ],
              ['hour']
            );

          if (errForTasks) {
            logger.error('Error while fetching graph', errForTasks);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch history graph statistcs',
              error: `Error while fetching mail tasks for history graph v2: ${errForTasks}`,
            });
          }
          // for (let task of tasks) {
          //   let timeToAdd = moment(new Date(task.complete_time))
          //     .tz(user.timezone)
          //     .hour();
          //   taskMap[timeToAdd].push(task);
          // }
          return successResponse(res, 'Fetched graph', tasks);
        } else {
          if (node_type === HEATMAP_OPTIONS.DONE_TASKS)
            node_type = {
              [Op.notIn]: [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_MESSAGE,
                NODE_TYPES.AUTOMATED_REPLY_TO,
              ],
            };

          const offsetInMilliseconds = UserHelper.getTimezoneOffset(
            user.timezone
          );
          const offSetInMinutes = Math.ceil(offsetInMilliseconds / (1000 * 60));

          const [tasks, errForTasks] =
            await StatisticsHelper.getTasksForHistoryGraphV2(
              user,
              start_date,
              end_date,
              user_ids,
              cadence_id,
              node_type,
              [
                sequelize.fn(
                  'HOUR',
                  sequelize.fn(
                    'DATE_ADD',
                    sequelize.literal(`FROM_UNIXTIME(complete_time / 1000)`),
                    sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
                  )
                ),
                'hour',
              ],
              ['hour']
            );
          if (errForTasks) {
            logger.error('Error while fetching graph', errForTasks);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch history graph statistcs',
              error: `Error while fetching tasks for history graph v2: ${errForTasks}`,
            });
          }

          return successResponse(res, 'Fetched graph', tasks);
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

            const offsetInMilliseconds = UserHelper.getTimezoneOffset(
              user.timezone
            );
            const offSetInMinutes = Math.ceil(
              offsetInMilliseconds / (1000 * 60)
            );

            const [tasks, errForTasks] =
              await StatisticsHelper.getMailTasksForHistoryGraphV2(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                typesForQuery,
                [
                  sequelize.fn(
                    'DAYOFWEEK',
                    sequelize.fn(
                      'DATE_ADD',
                      sequelize.literal(`FROM_UNIXTIME(complete_time / 1000)`),
                      sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
                    )
                  ),
                  'day_of_week',
                ],
                ['day_of_week']
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistcs',
                error: `Error while fetching mail tasks for history graph v2: ${errForTasks}`,
              });
            }

            return successResponse(res, 'Fetched graph', tasks);
          } else {
            if (node_type === HEATMAP_OPTIONS.DONE_TASKS)
              node_type = {
                [Op.notIn]: [
                  NODE_TYPES.AUTOMATED_MAIL,
                  NODE_TYPES.AUTOMATED_MESSAGE,
                  NODE_TYPES.AUTOMATED_REPLY_TO,
                ],
              };

            const offsetInMilliseconds = UserHelper.getTimezoneOffset(
              user.timezone
            );
            const offSetInMinutes = Math.ceil(
              offsetInMilliseconds / (1000 * 60)
            );

            const [tasks, errForTasks] =
              await StatisticsHelper.getTasksForHistoryGraphV2(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                node_type,
                [
                  sequelize.fn(
                    'DAYOFWEEK',
                    sequelize.fn(
                      'DATE_ADD',
                      sequelize.literal(`FROM_UNIXTIME(complete_time / 1000)`),
                      sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
                    )
                  ),
                  'day_of_week',
                ],
                ['day_of_week']
              );

            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistcs',
                error: `Error while fetching tasks for history graph v2: ${errForTasks}`,
              });
            }

            return successResponse(res, 'Fetched graph', tasks);
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

          const offsetInMilliseconds = UserHelper.getTimezoneOffset(
            user.timezone
          );
          const offSetInMinutes = Math.ceil(offsetInMilliseconds / (1000 * 60));

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
              await StatisticsHelper.getMailTasksForHistoryGraphV2(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                typesForQuery,
                [
                  sequelize.fn(
                    'DAYOFMONTH',
                    sequelize.fn(
                      'DATE_ADD',
                      sequelize.literal(`FROM_UNIXTIME(complete_time / 1000)`),
                      sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
                    )
                  ),
                  'day_of_month',
                ],
                ['day_of_month']
              );
            if (errForTasks) {
              logger.error('Error while fetching graph', errForTasks);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch history graph statistcs',
                error: `Error while fetching mail tasks for history graph v2: ${errForTasks}`,
              });
            }

            return successResponse(res, 'Fetched graph', tasks);
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
              await StatisticsHelper.getTasksForHistoryGraphV2(
                user,
                start_date,
                end_date,
                user_ids,
                cadence_id,
                node_type,
                [
                  sequelize.fn(
                    'DAYOFMONTH',
                    sequelize.fn(
                      'DATE_ADD',
                      sequelize.literal(`FROM_UNIXTIME(complete_time / 1000)`),
                      sequelize.literal(`INTERVAL ${offSetInMinutes} MINUTE`)
                    )
                  ),
                  'day_of_month',
                ],
                ['day_of_month']
              );

            return successResponse(res, 'Fetched graph', tasks);
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
              await StatisticsHelper.getMailTasksForHistoryGraphV2(
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
                msg: 'Failed to fetch history graph statistcs',
                error: `Error while fetching mail tasks for history graph v2: ${errForTasks}`,
              });
            }

            return successResponse(res, 'Fetched graph', tasks);
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
              await StatisticsHelper.getTasksForHistoryGraphV2(
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
                msg: 'Failed to fetch history graph statistcs',
                error: `Error while fetching tasks for history graph v2: ${errForTasks}`,
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
  } catch (err) {
    logger.error(`Error while fetching history graph:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching history graph statistics: ${err.message}`,
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
        msg: 'Failed to fetch hetmap statistics',
        error: 'User not found',
      });

    let { filter, user_ids, cadence_id, node_type } = req.body;

    if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch hetmap statistics',
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
          msg: 'Failed to fetch hetmap statistics',
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
          heatMap[yesterdayDay][j] = 0;
        }
        const [heatMapResult, errResult] = await getCompleteTasksInIntervalV2(
          clientQueryParams,
          dbQueryParams,
          heatMap
        );

        if (errResult)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch heat map statistics',
            error: `Error while fetching completed tasks in interval v2: ${errResult}`,
          });

        return successResponse(res, 'Fetched heatmap', heatMapResult);
      }
      case LEADERBOARD_DATE_FILTERS.TODAY: {
        todaysDay = (todaysDay + 6) % 7;
        heatMap[todaysDay] = {};
        for (let j = 0; j < 24; j++) {
          heatMap[todaysDay][j] = 0;
        }
        const [heatMapResult, errResult] = await getCompleteTasksInIntervalV2(
          clientQueryParams,
          dbQueryParams,
          heatMap
        );

        if (errResult)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch heat map statistics',
            error: `Error while fetching completed tasks in interval v2: ${errResult}`,
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
            heatMap[i][j] = 0;
          }
        }
        const [heatMapResult, errResult] = await getCompleteTasksInIntervalV2(
          clientQueryParams,
          dbQueryParams,
          heatMap
        );

        if (errResult)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch heat map statistics',
            error: `Error while fetching completed tasks in interval v2: ${errResult}`,
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

    const taskPromise = Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        user_id: user_ids ?? { [Op.ne]: null },
        cadence_id: cadence_id ?? { [Op.ne]: null },

        [Op.or]: [
          // {
          //   start_time: {
          //     [Op.between]: dateRange,
          //   },
          //   is_skipped: false,
          //   completed: false,
          // },
          {
            complete_time: {
              [Op.between]: dateRange,
            },
            completed: true,
          },
          {
            skip_time: {
              [Op.between]: dateRange,
            },
            is_skipped: true,
          },
        ],
      },
      include: {
        [DB_TABLES.USER]: {
          where: {
            company_id: user.company_id,
          },
          attributes: [
            'user_id',
            'first_name',
            'last_name',
            'profile_picture',
            'is_profile_picture_present',
          ],
          required: true,

          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: ['name'],
          },
        },
        [DB_TABLES.CADENCE]: {
          attributes: [
            'cadence_id',
            'name',
            'status',
            [
              sequelize.literal(
                '(SELECT COUNT(*) FROM lead_to_cadence INNER JOIN `lead` on lead_to_cadence.lead_id=`lead`.lead_id WHERE `lead`.user_id = Task.user_id AND lead_to_cadence.cadence_id=Task.cadence_id)'
              ),
              'total_lead_count',
            ],
            [
              sequelize.literal(
                '(SELECT COUNT(*) FROM node WHERE node.cadence_id=Task.cadence_id)'
              ),
              'node_count',
            ],
          ],
          required: true,
        },
        [DB_TABLES.NODE]: {
          attributes: ['type'],
          required: true,
          // where: {
          //   type: {
          //     [Op.notIn]: [
          //       NODE_TYPES.AUTOMATED_MAIL,
          //       NODE_TYPES.AUTOMATED_MESSAGE,
          //       NODE_TYPES.AUTOMATED_REPLY_TO,
          //     ],
          //   },
          // },
        },
      },
      extras: {
        // logging: true,
        group: ['Node.type', 'Task.user_id', 'Task.cadence_id'],
        attributes: [
          [
            sequelize.literal(`COUNT(DISTINCT task_id,CASE
              WHEN complete_time BETWEEN ${start_date} AND ${end_date} AND completed = 1 
              AND Node.type NOT IN ("${NODE_TYPES.AUTOMATED_MAIL}","${NODE_TYPES.AUTOMATED_MESSAGE}","${NODE_TYPES.AUTOMATED_REPLY_TO}")
              THEN 1
              ELSE NULL
          END ) `),
            'completed_task_count',
          ],
          [
            sequelize.literal(`COUNT(DISTINCT task_id,CASE
              WHEN skip_time BETWEEN ${start_date} AND ${end_date} AND is_skipped = 1
              AND Node.type NOT IN ("${NODE_TYPES.AUTOMATED_MAIL}","${NODE_TYPES.AUTOMATED_MESSAGE}","${NODE_TYPES.AUTOMATED_REPLY_TO}")
              THEN 1
              ELSE NULL
          END ) `),
            'skipped_task_count',
          ],
          [
            sequelize.literal(`COUNT(DISTINCT task_id,CASE
              WHEN complete_time BETWEEN ${start_date} AND ${end_date} AND completed = 1 
              AND Node.type IN ("${NODE_TYPES.AUTOMATED_MAIL}","${NODE_TYPES.AUTOMATED_MESSAGE}","${NODE_TYPES.AUTOMATED_REPLY_TO}")
              THEN 1
              ELSE NULL
          END ) `),
            'automated_task_count',
          ],
          [
            sequelize.literal(`SUM(CASE
              WHEN complete_time BETWEEN ${start_date} AND ${end_date} AND completed = 1 
              AND Node.type NOT IN ("${NODE_TYPES.AUTOMATED_MAIL}","${NODE_TYPES.AUTOMATED_MESSAGE}","${NODE_TYPES.AUTOMATED_REPLY_TO}")
              THEN task.complete_time/60000 - task.shown_time/60000
              ELSE 0
          END ) `),
            'total_completed_time',
          ],
        ],
      },
    });

    let pending_end_date;
    if (
      [
        LEADERBOARD_DATE_FILTERS.THIS_WEEK,
        LEADERBOARD_DATE_FILTERS.THIS_MONTH,
        LEADERBOARD_DATE_FILTERS.TODAY,
      ].includes(filter)
    )
      pending_end_date = new Date().getTime();
    else pending_end_date = end_date;

    const pendingTasksPromise = Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        user_id: user_ids ?? { [Op.ne]: null },
        cadence_id: cadence_id ?? { [Op.ne]: null },
        completed: false,
        is_skipped: false,
        // start_time: {
        //   [Op.between]: [start_date, pending_end_date],
        // },
        node_id: {
          [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
        },
      },
      include: {
        [DB_TABLES.CADENCE]: {
          where: {
            status: CADENCE_STATUS.IN_PROGRESS,
          },
          attributes: [
            'cadence_id',
            'name',
            [
              sequelize.literal(
                '(SELECT COUNT(*) FROM lead_to_cadence INNER JOIN `lead` on lead_to_cadence.lead_id=`lead`.lead_id WHERE `lead`.user_id = Task.user_id AND lead_to_cadence.cadence_id=Task.cadence_id)'
              ),
              'total_lead_count',
            ],
            [
              sequelize.literal(
                '(SELECT COUNT(*) FROM node WHERE node.cadence_id=Task.cadence_id)'
              ),
              'node_count',
            ],
          ],

          required: true,
        },
        [DB_TABLES.LEAD]: {
          where: {
            status: {
              [Op.in]: [LEAD_STATUS.NEW_LEAD, LEAD_STATUS.ONGOING], // * Tasks for leads with status of 'new_lead' and 'ongoing'
            },
          },
          required: true,
          attributes: [],
          [DB_TABLES.LEADTOCADENCE]: {
            where: {
              cadence_id: {
                [Op.eq]: sequelize.col('Task.cadence_id'),
              },
              status: CADENCE_LEAD_STATUS.IN_PROGRESS,
            },
            attributes: [],
          },
        },
        [DB_TABLES.NODE]: {
          where: {
            type: {
              [Op.notIn]: [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_MESSAGE,
                NODE_TYPES.AUTOMATED_REPLY_TO,
                NODE_TYPES.END,
              ],
            },
          },
          attributes: [],
          required: true,
        },

        [DB_TABLES.USER]: {
          where: {
            company_id: user.company_id,
          },
          attributes: [
            'user_id',
            'first_name',
            'last_name',
            'profile_picture',
            'is_profile_picture_present',
          ],
          required: true,

          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: ['name'],
          },
        },
      },
      extras: {
        group: ['Task.user_id', 'Task.cadence_id'],
        attributes: [
          [
            sequelize.literal(`COUNT(DISTINCT task_id,CASE
              WHEN start_time BETWEEN ${start_date} AND ${pending_end_date} 
              THEN 1
              ELSE NULL
            END ) `),
            'pending_task_count',
          ],
          // [
          //   sequelize.literal(`COUNT(DISTINCT task_id ) `),
          //   'pending_task_count',
          // ],
          [
            sequelize.literal(`COUNT(DISTINCT Task.lead_id ) `),
            'active_lead_count',
          ],
        ],
      },
    });

    const statusPromise = Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        company_id: user.company_id,
        user_id: user_ids ?? { [Op.ne]: null },
        status_update_timestamp: {
          [Op.between]: dateRange,
        },
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'first_name',
            'last_name',
            'profile_picture',
            'is_profile_picture_present',
          ],
          required: true,

          [DB_TABLES.SUB_DEPARTMENT]: {
            attributes: ['name'],
            required: true,
          },
        },
        [DB_TABLES.LEADTOCADENCE]: {
          required: true,
          attributes: ['cadence_id'],
          where: {
            cadence_id: cadence_id ?? { [Op.ne]: null },
          },

          [DB_TABLES.CADENCE]: {
            attributes: [
              'cadence_id',
              'name',

              [
                sequelize.literal(
                  '(SELECT COUNT(*) FROM lead_to_cadence where lead_to_cadence.lead_id=`lead`.lead_id )'
                ),
                'total_lead_count',
              ],
              [
                sequelize.literal(
                  '(SELECT COUNT(*) FROM node WHERE node.cadence_id=LeadToCadences.cadence_id)'
                ),
                'node_count',
              ],
            ],
            required: true,
          },
        },
      },
      extras: {
        // logging: true,
        group: ['Lead.user_id', 'LeadToCadences.cadence_id'],
        attributes: [
          [
            sequelize.literal(`COUNT(DISTINCT lead.lead_id, 
            CASE WHEN lead.status = "${LEAD_STATUS.CONVERTED}" 
            THEN 1
            ELSE NULL
            END )`),
            'converted_count',
          ],
          [
            sequelize.literal(`COUNT(DISTINCT lead.lead_id, 
            CASE WHEN lead.status = "${LEAD_STATUS.TRASH}"
            THEN 1
            ELSE NULL
            END )`),
            'disqualified_count',
          ],
        ],
      },
    });

    const demosPromise = Repository.fetchAll({
      tableName: DB_TABLES.DEMO,
      query: {
        created_at: {
          [Op.between]: dateRange,
        },
        cadence_id: cadence_id ?? { [Op.ne]: null },
      },
      include: {
        [DB_TABLES.LEAD]: {
          where: {
            user_id: user_ids ?? { [Op.ne]: null },
          },
          required: true,
          attributes: ['user_id'],
          [DB_TABLES.USER]: {
            required: true,

            where: {
              company_id: user.company_id,
            },
            attributes: [
              'user_id',
              'first_name',
              'last_name',
              'profile_picture',
              'is_profile_picture_present',
            ],
            required: true,

            [DB_TABLES.SUB_DEPARTMENT]: {
              attributes: ['name'],
              required: true,
            },
          },
        },
        [DB_TABLES.CADENCE]: {
          attributes: [
            'cadence_id',
            'name',
            [
              sequelize.literal(
                '(SELECT COUNT(*) FROM lead_to_cadence where demo.lead_id=`lead`.lead_id and lead_to_cadence.cadence_id=demo.cadence_id )'
              ),
              'total_lead_count',
            ],
            [
              sequelize.literal(
                '(SELECT COUNT(*) FROM node WHERE node.cadence_id=demo.cadence_id)'
              ),
              'node_count',
            ],
          ],
          required: true,
        },
      },
      extras: {
        group: ['demo.cadence_id', 'Lead.user_id'],
        attributes: [
          [sequelize.literal(`COUNT(DISTINCT demo.lead_id)`), 'demos_booked'],
        ],
      },
    });

    const [
      [completedTasks, errForCompletedTasks],
      [pendingTasks, errForPendingTasks],
      [statusCount, errForStatus],
      [demosCount, errForDemo],
    ] = await Promise.all([
      taskPromise,
      pendingTasksPromise,
      statusPromise,
      demosPromise,
    ]);
    if (
      errForCompletedTasks ||
      errForPendingTasks ||
      errForStatus ||
      errForDemo
    ) {
      logger.error(
        'Error while fetching history table count',
        errForCompletedTasks || errForPendingTasks || errForStatus || errForDemo
      );

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history table statistics',
        error:
          errForCompletedTasks ||
          errForPendingTasks ||
          errForStatus ||
          errForDemo,
      });
    }

    let result = {};

    for (let task of completedTasks) {
      if (result.hasOwnProperty(task.Cadence.cadence_id)) {
        if (result[task.Cadence.cadence_id].hasOwnProperty(task.User.user_id)) {
          // User id is present then we already have some other node count present -> add the total count

          result[task.Cadence.cadence_id][task.User.user_id][
            `${task.Node.type}_count`
          ] = task.completed_task_count;
          result[task.Cadence.cadence_id][task.User.user_id].people_count +=
            task.people_count;

          // done task count
          result[task.Cadence.cadence_id][task.User.user_id].done_task_count =
            parseInt(
              result[task.Cadence.cadence_id][task.User.user_id]
                .done_task_count,
              10
            ) + parseInt(task.completed_task_count, 10);

          // done time count for total time for user

          result[task.Cadence.cadence_id][task.User.user_id].done_time_count =
            parseInt(
              result[task.Cadence.cadence_id][task.User.user_id]
                .done_time_count,
              10
            ) + parseInt(task.total_completed_time, 10);

          result[task.Cadence.cadence_id][
            task.User.user_id
          ].skipped_task_count =
            parseInt(
              result[task.Cadence.cadence_id][task.User.user_id]
                .skipped_task_count,
              10
            ) + parseInt(task.skipped_task_count, 10);

          result[task.Cadence.cadence_id][task.User.user_id].total_task_count =
            parseInt(
              result[task.Cadence.cadence_id][task.User.user_id]
                .total_task_count,
              10
            ) +
            parseInt(task.skipped_task_count, 10) +
            parseInt(task.completed_task_count, 10);

          // Handle automated nodes
          if (AUTOMATED_NODE_TYPES_ARRAY.includes(task.Node.type)) {
            result[task.Cadence.cadence_id][task.User.user_id][
              `${task.Node.type}_count`
            ] = task.automated_task_count;
          }
        } else {
          // New user for present cadence

          result[task.Cadence.cadence_id][task.User.user_id] = {
            [`${task.Node.type}_count`]: task.completed_task_count,
            total_leads_in_cadence: task.Cadence.total_lead_count,
            user_id: task.User.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
            sub_department: task.User.Sub_Department.name,

            // task counts
            done_task_count: task.completed_task_count,
            done_time_count: parseInt(task.total_completed_time ?? 0, 10),

            skipped_task_count: task.skipped_task_count,
            // Total tasks
            total_task_count:
              task.completed_task_count + task.skipped_task_count,
            // task.pending_task_count,
          };
          if (AUTOMATED_NODE_TYPES_ARRAY.includes(task.Node.type)) {
            result[task.Cadence.cadence_id][task.User.user_id][
              `${task.Node.type}_count`
            ] = task.automated_task_count;
          }
        }
      } else {
        // New Cadence id and user id
        result[task.Cadence.cadence_id] = {
          cadence_id: task.Cadence.cadence_id,
          name: task.Cadence.name,
          node_length: task.Cadence.node_count,

          [task.User.user_id]: {
            total_leads_in_cadence: task.Cadence.total_lead_count,
            user_id: task.User.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
            sub_department: task.User.Sub_Department.name,

            [`${task.Node.type}_count`]: task.completed_task_count,
            [`${task.Node.type}_skipped_count`]: task.skipped_task_count,
            // [`${task.Node.type}_pending_count`]: task.pending_task_count,
            // Total counts of all nodes
            done_task_count: task.completed_task_count,
            done_time_count: parseInt(task.total_completed_time ?? 0, 10),
            // avg time = done_time_count/done_task_count -> ms ->/(1000*60*60*24)
            skipped_task_count: task.skipped_task_count,
            // pending_task_count: task.pending_task_count,

            // Total tasks
            total_task_count:
              task.completed_task_count + task.skipped_task_count,
            // task.pending_task_count,
          },
        };
        if (AUTOMATED_NODE_TYPES_ARRAY.includes(task.Node.type)) {
          result[task.Cadence.cadence_id][task.User.user_id][
            `${task.Node.type}_count`
          ] = task.automated_task_count;
        }
      }
    }

    for (let task of pendingTasks) {
      if (result.hasOwnProperty(task.Cadence.cadence_id)) {
        if (result[task.Cadence.cadence_id].hasOwnProperty(task.User.user_id)) {
          // User id is present then -> add the total count

          result[task.Cadence.cadence_id][
            task.User.user_id
          ].pending_task_count = task.pending_task_count;

          result[task.Cadence.cadence_id][task.User.user_id].active_lead_count =
            task.active_lead_count;

          result[task.Cadence.cadence_id][task.User.user_id].total_task_count =
            parseInt(
              result[task.Cadence.cadence_id][task.User.user_id]
                .total_task_count,
              10
            ) + parseInt(task.pending_task_count, 10);
        } else {
          // New user for present cadence

          result[task.Cadence.cadence_id][task.User.user_id] = {
            total_leads_in_cadence: task.Cadence.total_lead_count,
            user_id: task.User.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
            sub_department: task.User.Sub_Department.name,

            pending_task_count: task.pending_task_count,
            active_lead_count: task.active_lead_count,
            // Total tasks
            total_task_count: task.pending_task_count,
          };
        }
      } else {
        // New Cadence id and new user id
        // so 0 other tasks only pending tasks for this cadence and user

        result[task.Cadence.cadence_id] = {
          cadence_id: task.Cadence.cadence_id,
          name: task.Cadence.name,
          node_length: task.Cadence.node_count,
          [task.User.user_id]: {
            total_leads_in_cadence: task.Cadence.total_lead_count,
            user_id: task.User.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
            sub_department: task.User.Sub_Department.name,

            pending_task_count: task.pending_task_count,
            active_lead_count: task.active_lead_count,
            // Total tasks
            total_task_count: task.pending_task_count,
          },
        };
      }
    }

    for (let task of statusCount) {
      if (task.disqualified_count == 0 && task.converted_count == 0) continue;

      if (result.hasOwnProperty(task.LeadToCadences[0].cadence_id)) {
        if (
          result[task.LeadToCadences[0].cadence_id].hasOwnProperty(
            task.User.user_id
          )
        ) {
          // User id is present then -> add the total count

          result[task.LeadToCadences[0].cadence_id][
            task.User.user_id
          ].converted_count = task.converted_count;

          result[task.LeadToCadences[0].cadence_id][
            task.User.user_id
          ].disqualified_count = task.disqualified_count;
        } else {
          // New user for present cadence

          result[task.LeadToCadences[0].cadence_id][task.User.user_id] = {
            total_leads_in_cadence:
              task.LeadToCadences[0].Cadences[0].total_lead_count,
            user_id: task.User.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
            sub_department: task.User.Sub_Department.name,

            converted_count: task.converted_count,
            disqualified_count: task.disqualified_count,
          };
        }
      } else {
        // New Cadence id and new user id
        // so 0 other tasks only pending tasks for this cadence and user

        result[task.LeadToCadences[0].cadence_id] = {
          cadence_id: task.LeadToCadences[0].cadence_id,
          name: task.LeadToCadences[0].Cadences[0].name,
          node_length: task.LeadToCadences[0].Cadences[0].node_count,
          // TODO: handle if total leads in cadence not present.
          [task.User.user_id]: {
            total_leads_in_cadence:
              task.LeadToCadences[0].Cadences[0].total_lead_count,
            user_id: task.User.user_id,
            user_first_name: task.User.first_name,
            user_last_name: task.User.last_name,
            user_role: task.User.role,
            user_profile_picture: task.User.profile_picture,
            is_profile_picture_present: task.User.is_profile_picture_present,
            sub_department: task.User.Sub_Department.name,

            converted_count: task.converted_count,
            disqualified_count: task.disqualified_count,
          },
        };
      }
    }

    for (let task of demosCount) {
      if (task.demos_booked == 0) continue;

      if (result.hasOwnProperty(task.Cadence.cadence_id)) {
        if (
          result[task.Cadence.cadence_id].hasOwnProperty(task.Lead.User.user_id)
        ) {
          // User id is present then -> add the total count

          result[task.Cadence.cadence_id][task.Lead.User.user_id].demos_booked =
            task.demos_booked;
        } else {
          // New user for present cadence

          result[task.Cadence.cadence_id][task.Lead.User.user_id] = {
            total_leads_in_cadence: task.Cadence.total_lead_count,
            user_id: task.Lead.User.user_id,
            user_first_name: task.Lead.User.first_name,
            user_last_name: task.Lead.User.last_name,
            user_role: task.Lead.User.role,
            user_profile_picture: task.Lead.User.profile_picture,
            is_profile_picture_present:
              task.Lead.User.is_profile_picture_present,
            sub_department: task.Lead.User.Sub_Department.name,
            demos_booked: task.demos_booked,
          };
        }
      } else {
        // New Cadence id and new user id
        // so 0 other tasks only pending tasks for this cadence and user

        result[task.Cadence.cadence_id] = {
          cadence_id: task.Cadence.cadence_id,
          name: task.Cadence.name,
          node_length: task.Cadence.node_count,
          // TODO: handle if total leads in cadence not present.

          [task.Lead.User.user_id]: {
            total_leads_in_cadence: task.Cadence.total_lead_count,
            user_id: task.Lead.User.user_id,
            user_first_name: task.Lead.User.first_name,
            user_last_name: task.Lead.User.last_name,
            user_role: task.Lead.User.role,
            user_profile_picture: task.Lead.User.profile_picture,
            is_profile_picture_present:
              task.Lead.User.is_profile_picture_present,
            sub_department: task.Lead.User.Sub_Department.name,

            demos_booked: task.demos_booked,
          },
        };
      }
    }

    // console.log(result);

    for (let cadence in result) {
      result[cadence].total_email_count = 0;

      // automated counts for automated cols
      result[cadence].total_automated_email_count = 0;
      result[cadence].total_automated_message_count = 0;

      result[cadence].total_message_count = 0;
      result[cadence].total_linkedin_count = 0;
      result[cadence].total_data_check_count = 0;
      result[cadence].total_whatsapp_count = 0;
      result[cadence].total_done_task_count = 0;

      result[cadence].total_done_time_count = 0;

      result[cadence].total_active_lead_count = 0;

      result[cadence].total_converted_count = 0;
      result[cadence].total_disqualified_count = 0;

      result[cadence].total_demos_booked = 0;

      result[cadence].total_pending_task_count = 0;
      result[cadence].total_skipped_task_count = 0;
      result[cadence].total_task_count = 0;

      result[cadence].total_call_count = 0;
      result[cadence].total_user_count = 0;
      result[cadence].total_cadence_custom_count = 0;

      result[cadence].total_leads_in_cadence_sum = 0;

      for (let user in result[cadence]) {
        if (typeof result[cadence][user] === 'object') {
          result[cadence][user].email_count =
            (result[cadence][user]?.[`${NODE_TYPES.MAIL}_count`] ?? 0) +
            (result[cadence][user]?.[`${NODE_TYPES.REPLY_TO}_count`] ?? 0);

          result[cadence][user].automated_email_count =
            (result[cadence][user]?.[`${NODE_TYPES.AUTOMATED_MAIL}_count`] ??
              0) +
            (result[cadence][user]?.[
              `${NODE_TYPES.AUTOMATED_REPLY_TO}_count`
            ] ?? 0);

          result[cadence][user].linkedin_count =
            (result[cadence][user]?.[`${NODE_TYPES.LINKEDIN_MESSAGE}_count`] ??
              0) +
            (result[cadence][user]?.[
              `${NODE_TYPES.LINKEDIN_CONNECTION}_count`
            ] ?? 0) +
            (result[cadence][user]?.[`${NODE_TYPES.LINKEDIN_PROFILE}_count`] ??
              0) +
            (result[cadence][user]?.[`${NODE_TYPES.LINKEDIN_INTERACT}_count`] ??
              0);

          result[cadence].total_email_count +=
            result[cadence][user]?.email_count ?? 0;

          result[cadence].total_automated_email_count +=
            result[cadence][user]?.automated_email_count ?? 0;

          result[cadence].total_automated_message_count +=
            result[cadence][user]?.automated_message_count ?? 0;

          result[cadence].total_linkedin_count +=
            result[cadence][user]?.linkedin_count ?? 0;
          result[cadence].total_data_check_count +=
            result[cadence][user]?.data_check_count ?? 0;

          result[cadence].total_whatsapp_count +=
            result[cadence][user]?.whatsapp_count ?? 0;

          result[cadence].total_done_task_count +=
            result[cadence][user]?.done_task_count ?? 0;

          result[cadence].total_done_time_count += parseInt(
            result[cadence][user]?.done_time_count ?? 0,
            10
          );

          result[cadence].total_call_count +=
            result[cadence][user]?.call_count ?? 0;
          result[cadence].total_message_count +=
            result[cadence][user]?.message_count ?? 0;
          result[cadence].total_cadence_custom_count +=
            result[cadence][user]?.cadence_custom_count ?? 0;

          result[cadence].total_active_lead_count +=
            result[cadence][user]?.active_lead_count ?? 0;

          // converted & disqulified leads
          result[cadence].total_converted_count += parseInt(
            result[cadence][user].converted_count ?? 0,
            10
          );

          result[cadence].total_disqualified_count += parseInt(
            result[cadence][user].disqualified_count ?? 0,
            10
          );
          result[cadence].total_demos_booked += parseInt(
            result[cadence][user].demos_booked ?? 0,
            10
          );

          result[cadence].total_pending_task_count +=
            result[cadence][user]?.pending_task_count ?? 0;
          result[cadence].total_skipped_task_count +=
            result[cadence][user]?.skipped_task_count ?? 0;

          result[cadence].total_task_count +=
            result[cadence][user]?.total_task_count ?? 0;

          result[cadence].total_leads_in_cadence_sum +=
            result[cadence][user]?.total_leads_in_cadence ?? 0;

          if (result[cadence][user].hasOwnProperty('user_id'))
            result[cadence].total_user_count++;
          // }
        }
      }
    }

    // initialise total of all cadences

    result.total_automated_email_count = 0;
    result.total_automated_message_count = 0;

    result.total_message_count = 0;
    result.total_linkedin_count = 0;
    result.total_data_check_count = 0;
    result.total_whatsapp_count = 0;

    result.total_done_task_count = 0;

    result.total_done_time_count = 0;

    result.total_active_lead_count = 0;

    result.total_converted_count = 0;
    result.total_disqualified_count = 0;

    result.total_demos_booked = 0;

    result.total_pending_task_count = 0;
    result.total_skipped_task_count = 0;
    result.total_task_count = 0;

    result.total_email_count = 0;

    result.total_call_count = 0;
    result.total_cadence_custom_count = 0;

    result.total_leads_in_cadence_sum = 0;

    // total of all cadences
    for (let cadence in result) {
      result.total_email_count += result[cadence]?.total_email_count ?? 0;

      result.total_automated_email_count +=
        result[cadence]?.total_automated_email_count ?? 0;

      result.total_automated_message_count +=
        result[cadence]?.total_automated_message_count ?? 0;

      result.total_linkedin_count += result[cadence]?.total_linkedin_count ?? 0;

      result.total_data_check_count +=
        result[cadence]?.total_data_check_count ?? 0;

      result.total_whatsapp_count += result[cadence]?.total_whatsapp_count ?? 0;

      result.total_done_task_count +=
        result[cadence]?.total_done_task_count ?? 0;

      result.total_done_time_count += parseInt(
        result[cadence].total_done_time_count ?? 0,
        10
      );

      result.total_call_count += result[cadence]?.total_call_count ?? 0;
      result.total_message_count += result[cadence]?.total_message_count ?? 0;
      result.total_cadence_custom_count +=
        result[cadence]?.total_cadence_custom_count ?? 0;

      result.total_active_lead_count +=
        result[cadence]?.total_active_lead_count ?? 0;

      // converted & disqulified leads
      result.total_converted_count += parseInt(
        result[cadence].total_converted_count ?? 0,
        10
      );

      result.total_disqualified_count += parseInt(
        result[cadence].total_disqualified_count ?? 0,
        10
      );

      result.total_demos_booked += parseInt(
        result[cadence].total_demos_booked ?? 0,
        10
      );

      result.total_pending_task_count +=
        result[cadence].total_pending_task_count ?? 0;
      result.total_skipped_task_count +=
        result[cadence]?.total_skipped_task_count ?? 0;

      result.total_task_count += result[cadence].total_task_count ?? 0;

      result.total_leads_in_cadence_sum +=
        result[cadence].total_leads_in_cadence_sum ?? 0;
    }

    return successResponse(res, 'Fetched history table statistics', result);
  } catch (err) {
    logger.error(`Error while fetching history table statistics:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching history table statistics: ${err.message}`,
    });
  }
};

const historyTableUpdate = async (req, res) => {
  try {
    let body = statisticsSchema.updateColumnsSchema.validate(req.body);

    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser) {
      logger.error(`Error while fetching user: `, errForUser);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update columns',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update columns',
        error: `User not found`,
      });

    const [tableUpdate, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.SETTINGS,
      query: {
        user_id: req.user.user_id,
      },
      updateObject: {
        stats_columns: req.body,
      },
    });
    if (errForUpdate)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update columns',
        error: `Error while updating settings: ${errForUpdate}`,
      });

    return successResponse(res, `Columns updated successfully.`);
  } catch (err) {
    logger.error(`Error while updating columns:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating columns: ${err.message}`,
    });
  }
};

const getHistoryTableColumns = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser) {
      logger.error(`Error while fetching user: `, errForUser);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history table',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history table',
        error: `User not found`,
      });

    const [setting, errForSetting] = await Repository.fetchOne({
      tableName: DB_TABLES.SETTINGS,
      query: {
        user_id: user.user_id,
      },
    });
    if (errForSetting) {
      logger.error(`Error while fetching settings: `, errForSetting);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch history table',
        error: `Error while fetching settings: ${errForSetting}`,
      });
    }

    return successResponse(res, `Fetched columns.`, setting?.stats_columns);
  } catch (err) {
    logger.error(`Error while getting columns:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching history table columns: ${err.message}`,
    });
  }
};

const cadenceComparisonController = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser) {
      logger.error(`Error while fetching user: `, errForUser);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence comparision',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence comparision',
        error: `User not found`,
      });

    let { cadence_id, kpiObjects } = req.body;

    // if (!Object.values(LEADERBOARD_DATE_FILTERS).includes(filter))
    //   return badRequestResponse(res, 'Invalid filter');

    if (!cadence_id || cadence_id.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Please choose a cadence`,
      });

    const [cadences, errForCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query: {
        cadence_id,
      },
    });
    if (errForCadences) {
      logger.error(`Error while fetching cadences: `, errForCadences);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence comparision',
        error: `Error while fetching cadences: ${errForCadences}`,
      });
    }

    const totalTasksPromise = Repository.fetchAll({
      tableName: DB_TABLES.TASK,
      query: {
        cadence_id: cadence_id,
      },
      include: {
        [DB_TABLES.USER]: {
          where: {
            company_id: user.company_id,
          },
          attributes: [],
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
      },
      extras: {
        group: ['Task.cadence_id'],
        attributes: [
          [sequelize.literal(`COUNT(DISTINCT task_id) `), 'total_task_count'],
          'cadence_id',
        ],
      },
    });
    const totalLeadsPromise = Repository.fetchAll({
      tableName: DB_TABLES.LEADTOCADENCE,
      query: {
        cadence_id: cadence_id,
      },
      extras: {
        group: ['cadence_id'],
        attributes: [
          [
            sequelize.literal(`COUNT(DISTINCT lead_cadence_id) `),
            'total_lead_count',
          ],
          'cadence_id',
        ],
      },
    });
    const [[totalTasks, errForTotalTasks], [totalLeads, errForLeads]] =
      await Promise.all([totalTasksPromise, totalLeadsPromise]);

    let cadenceData = [];
    for (let cadence of cadences) {
      cadenceData.push({
        name: cadence.name,
        cadence_id: cadence.cadence_id,
        totalTasks: totalTasks.find((c) => c.cadence_id == cadence.cadence_id),
        totalLeads: totalLeads.find((c) => c.cadence_id == cadence.cadence_id),
      });
    }

    let result = [cadenceData];

    for (let kpiObject of kpiObjects) {
      const { type, filter, valueType, comparisonType } = kpiObject;

      switch (type) {
        case COMPARE_CADENCE_KPI_TYPE.DONE_TASKS: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          const [completedTasks, errForCompletedTasks] =
            await Repository.fetchAll({
              tableName: DB_TABLES.TASK,
              query: {
                cadence_id: cadence_id,
                complete_time: {
                  [Op.between]: [start_date, end_date],
                },
              },
              include: {
                [DB_TABLES.NODE]: {
                  attributes: [],
                  required: true,
                  where: {
                    type: {
                      [Op.notIn]: [
                        NODE_TYPES.AUTOMATED_MAIL,
                        NODE_TYPES.AUTOMATED_MESSAGE,
                        NODE_TYPES.AUTOMATED_REPLY_TO,
                        NODE_TYPES.END,
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
                nest: true,
                group: ['Task.cadence_id'],
                attributes: [
                  [sequelize.literal(`COUNT(DISTINCT task_id) `), 'count'],
                  'cadence_id',
                ],
              },
            });
          if (errForCompletedTasks) {
            logger.error('Error while fetching count', errForCompletedTasks);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching completed tasks: ${errForCompletedTasks}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(completedTasks);
          } else {
            // calculate percentage

            const [totalTasks, errForTotalTasks] = await Repository.fetchAll({
              tableName: DB_TABLES.TASK,
              query: {
                cadence_id: cadence_id,
                [Op.or]: [
                  {
                    start_time: {
                      [Op.between]: dateRange,
                    },
                    is_skipped: false,
                    completed: false,
                  },
                  {
                    complete_time: {
                      [Op.between]: dateRange,
                    },
                    completed: true,
                  },
                  {
                    skip_time: {
                      [Op.between]: dateRange,
                    },
                    is_skipped: true,
                  },
                ],
              },
              include: {
                [DB_TABLES.USER]: {
                  where: {
                    company_id: user.company_id,
                  },
                  attributes: [],
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
              },
              extras: {
                group: ['Task.cadence_id'],
                attributes: [
                  [sequelize.literal(`COUNT(DISTINCT task_id) `), 'count'],
                  'cadence_id',
                ],
              },
            });
            if (errForTotalTasks) {
              logger.error(
                'Error while fetching total count for skipped percentage: ',
                errForTotalTasks
              );
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch cadence comparision',
                error: `Error while fetching tasks: ${errForTotalTasks}`,
              });
            }
            let percentage = [];

            // max 4 cadences chosen ->  16 iterations
            for (let total of totalTasks) {
              for (let count of completedTasks) {
                if (total.cadence_id == count.cadence_id) {
                  percentage.push({
                    cadence_id: total.cadence_id,
                    percentage: (count.count / total.count) * 100,
                  });
                }
              }
            }
            result.push(percentage);
          }
          break;
        }
        case COMPARE_CADENCE_KPI_TYPE.SKIPPED_TASKS: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          const [skippedTasks, errForSkippedTasks] = await Repository.fetchAll({
            tableName: DB_TABLES.TASK,
            query: {
              cadence_id: cadence_id,
              skip_time: {
                [Op.between]: [start_date, end_date],
              },
            },

            include: {
              [DB_TABLES.NODE]: {
                attributes: [],
                required: true,
                where: {
                  type: {
                    [Op.notIn]: [
                      NODE_TYPES.AUTOMATED_MAIL,
                      NODE_TYPES.AUTOMATED_MESSAGE,
                      NODE_TYPES.AUTOMATED_REPLY_TO,
                      NODE_TYPES.END,
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
              nest: true,
              group: ['Task.cadence_id'],
              attributes: [
                [sequelize.literal(`COUNT(DISTINCT task_id) `), 'count'],
                'cadence_id',
              ],
            },
          });
          if (errForSkippedTasks) {
            logger.error(
              'Error while fetching skipped count',
              errForSkippedTasks
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching skipped tasks: ${errForSkippedTasks}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(skippedTasks);
          } else {
            // calculate percentage

            const [totalTasks, errForTotalTasks] = await Repository.fetchAll({
              tableName: DB_TABLES.TASK,
              query: {
                cadence_id: cadence_id,
                [Op.or]: [
                  {
                    start_time: {
                      [Op.between]: dateRange,
                    },
                    is_skipped: false,
                    completed: false,
                  },
                  {
                    complete_time: {
                      [Op.between]: dateRange,
                    },
                    completed: true,
                  },
                  {
                    skip_time: {
                      [Op.between]: dateRange,
                    },
                    is_skipped: true,
                  },
                ],
              },
              include: {
                [DB_TABLES.USER]: {
                  where: {
                    company_id: user.company_id,
                  },
                  attributes: [],
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
              },
              extras: {
                group: ['Task.cadence_id'],
                attributes: [
                  [sequelize.literal(`COUNT(DISTINCT task_id) `), 'count'],
                  'cadence_id',
                ],
              },
            });
            if (errForTotalTasks) {
              logger.error(
                'Error while fetching total count for skipped percentage: ',
                errForTotalTasks
              );
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch cadence comparision',
                error: `Error while fetching tasks: ${errForTotalTasks}`,
              });
            }

            let percentage = [];

            // max 4 cadences chosen ->  16 iterations
            for (let total of totalTasks) {
              for (let count of skippedTasks) {
                if (total.cadence_id == count.cadence_id) {
                  percentage.push({
                    cadence_id: total.cadence_id,
                    percentage: (count.count / total.count) * 100,
                  });
                }
              }
            }
            result.push(percentage);
          }
          break;
        }
        case COMPARE_CADENCE_KPI_TYPE.TOTAL_TASKS: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          const [tasks, errForTotalTasks] = await Repository.fetchAll({
            tableName: DB_TABLES.TASK,
            query: {
              cadence_id: cadence_id,
              [Op.or]: [
                {
                  start_time: {
                    [Op.between]: dateRange,
                  },
                  is_skipped: false,
                  completed: false,
                },
                {
                  complete_time: {
                    [Op.between]: dateRange,
                  },
                  completed: true,
                },
                {
                  skip_time: {
                    [Op.between]: dateRange,
                  },
                  is_skipped: true,
                },
              ],
            },
            include: {
              [DB_TABLES.USER]: {
                where: {
                  company_id: user.company_id,
                },
                attributes: [],
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
            },
            extras: {
              group: ['Task.cadence_id'],
              attributes: [
                [sequelize.literal(`COUNT(DISTINCT task_id) `), 'count'],
                'cadence_id',
              ],
            },
          });
          if (errForTotalTasks) {
            logger.error(
              'Error while fetching skipped count',
              errForTotalTasks
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching tasks: ${errForTotalTasks}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(tasks);
          } else {
            // no percentage support for total tasks

            return badRequestResponseWithDevMsg({
              res,
              msg: `Percentage not valid for total tasks`,
            });
          }
          break;
        }
        case COMPARE_CADENCE_KPI_TYPE.AVERAGE_TIME: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          const [tasks, errForTotalTasks] = await Repository.fetchAll({
            tableName: DB_TABLES.TASK,
            query: {
              cadence_id: cadence_id,
              complete_time: {
                [Op.between]: [start_date, end_date],
              },
            },
            include: {
              [DB_TABLES.USER]: {
                where: {
                  company_id: user.company_id,
                },
                attributes: [],
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
            },
            extras: {
              group: ['Task.cadence_id'],
              attributes: [
                [sequelize.literal(`COUNT(DISTINCT task_id) `), 'count'],
                'cadence_id',
                // total time is in minutes to avoid integer overflow
                [
                  sequelize.literal(`SUM(CASE
                    WHEN complete_time BETWEEN ${start_date} AND ${end_date} AND completed = 1 
                    THEN task.complete_time/60000 - task.shown_time/60000
                    ELSE 0
                END ) `),
                  'total_completed_time',
                ],
              ],
            },
          });
          if (errForTotalTasks) {
            logger.error(
              'Error while fetching skipped count',
              errForTotalTasks
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching tasks: ${errForTotalTasks}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(tasks);
          } else {
            // no percentage support for total tasks

            return badRequestResponseWithDevMsg({
              res,
              msg: `Percentage not valid for total tasks`,
            });
          }
          break;
        }
        case COMPARE_CADENCE_KPI_TYPE.CALLS:
        case COMPARE_CADENCE_KPI_TYPE.LINKEDIN:
        case COMPARE_CADENCE_KPI_TYPE.DATA_CHECK:
        case COMPARE_CADENCE_KPI_TYPE.CUSTOM_TASK:
        case COMPARE_CADENCE_KPI_TYPE.DATA_CHECK:
        case COMPARE_CADENCE_KPI_TYPE.EMAILS: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          let nodeType;

          switch (type) {
            case COMPARE_CADENCE_KPI_TYPE.CALLS: {
              nodeType = NODE_TYPES.CALL;
              break;
            }
            case COMPARE_CADENCE_KPI_TYPE.LINKEDIN: {
              nodeType = [
                NODE_TYPES.LINKEDIN_CONNECTION,
                NODE_TYPES.LINKEDIN_INTERACT,
                NODE_TYPES.LINKEDIN_MESSAGE,
                NODE_TYPES.LINKEDIN_PROFILE,
              ];
              break;
            }
            case COMPARE_CADENCE_KPI_TYPE.DATA_CHECK: {
              nodeType = NODE_TYPES.DATA_CHECK;
              break;
            }
            case COMPARE_CADENCE_KPI_TYPE.CUSTOM_TASK: {
              nodeType = NODE_TYPES.CADENCE_CUSTOM;
              break;
            }
            case COMPARE_CADENCE_KPI_TYPE.DATA_CHECK: {
              nodeType = NODE_TYPES.DATA_CHECK;
              break;
            }
            case COMPARE_CADENCE_KPI_TYPE.EMAILS: {
              nodeType = [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO];
              break;
            }
          }

          const [completedNodeTasks, errForSkippedTasks] =
            await Repository.fetchAll({
              tableName: DB_TABLES.TASK,
              query: {
                cadence_id: cadence_id,
                complete_time: {
                  [Op.between]: [start_date, end_date],
                },
              },

              include: {
                [DB_TABLES.NODE]: {
                  attributes: [],
                  required: true,
                  where: {
                    type: nodeType,
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
                // subQuery: false,
                // nest: true,
                // logging: true,
                group: ['Task.cadence_id'],
                attributes: [
                  [sequelize.literal(`COUNT(DISTINCT Task.task_id) `), 'count'],
                  'cadence_id',
                ],
              },
            });
          if (errForSkippedTasks) {
            logger.error(
              'Error while fetching email count',
              errForSkippedTasks
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching skipped tasks: ${errForSkippedTasks}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(completedNodeTasks);
          } else {
            // calculate percentage

            const [totalTasks, errForTotalTasks] = await Repository.fetchAll({
              tableName: DB_TABLES.TASK,
              query: {
                cadence_id: cadence_id,
                [Op.or]: [
                  {
                    start_time: {
                      [Op.between]: dateRange,
                    },
                    is_skipped: false,
                    completed: false,
                  },
                  {
                    complete_time: {
                      [Op.between]: dateRange,
                    },
                    completed: true,
                  },
                  {
                    skip_time: {
                      [Op.between]: dateRange,
                    },
                    is_skipped: true,
                  },
                ],
              },
              include: {
                [DB_TABLES.USER]: {
                  where: {
                    company_id: user.company_id,
                  },
                  attributes: [],
                  required: true,
                },

                [DB_TABLES.NODE]: {
                  attributes: [],
                  required: true,
                  where: {
                    type: nodeType,
                  },
                },
              },
              extras: {
                group: ['Task.cadence_id'],
                attributes: [
                  [sequelize.literal(`COUNT(DISTINCT task_id) `), 'count'],
                  'cadence_id',
                ],
              },
            });
            if (errForTotalTasks) {
              logger.error(
                'Error while fetching total count for email percentage: ',
                errForTotalTasks
              );
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch cadence comparision',
                error: `Error while fetching tasks: ${errForTotalTasks}`,
              });
            }

            let percentage = [];

            // max 4 cadences chosen ->  16 iterations
            for (let total of totalTasks) {
              for (let count of completedNodeTasks) {
                if (total.cadence_id == count.cadence_id) {
                  percentage.push({
                    cadence_id: total.cadence_id,
                    percentage: (count.count / total.count) * 100,
                  });
                }
              }
            }
            result.push(percentage);
          }
          break;
        }
        case COMPARE_CADENCE_KPI_TYPE.TOTAL_LEADS: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          const [leads, errForLeads] = await Repository.fetchAll({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: {
              cadence_id: cadence_id,
              created_at: {
                [Op.between]: dateRange,
              },
            },
            extras: {
              group: ['cadence_id'],
              attributes: [
                [
                  sequelize.literal(`COUNT(DISTINCT lead_cadence_id) `),
                  'total_lead_count',
                ],
                'cadence_id',
              ],
            },
          });
          if (errForLeads) {
            logger.error(`Error while fetching total leads: `, errForLeads);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching lead to cadence: ${errForLeads}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(leads);
          } else {
            // no percentage support for total leads

            return badRequestResponseWithDevMsg({
              res,
              msg: `Percentage not valid for total leads`,
            });
          }
          break;
        }
        case COMPARE_CADENCE_KPI_TYPE.ACTIVE_LEADS: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          const [leadsLeft, errForLeadsLeft] = await Repository.fetchAll({
            tableName: DB_TABLES.LEADTOCADENCE,
            query: {
              cadence_id: cadence_id,
              created_at: {
                [Op.between]: dateRange,
              },
              status: CADENCE_LEAD_STATUS.IN_PROGRESS,
            },
            include: {
              [DB_TABLES.LEAD]: {
                where: {
                  status: [LEAD_STATUS.ONGOING, LEAD_STATUS.NEW_LEAD],
                },
                attributes: [],
                required: true,
              },
              [DB_TABLES.CADENCE]: {
                required: true,
                attributes: [],
                where: {
                  status: CADENCE_STATUS.IN_PROGRESS,
                },
              },
            },

            extras: {
              group: ['cadence_id'],
              attributes: [
                [
                  sequelize.literal(`COUNT(DISTINCT lead_cadence_id) `),
                  'count',
                ],
                'cadence_id',
              ],
            },
          });
          if (errForLeadsLeft) {
            logger.error('Error while fetching skipped count', errForLeadsLeft);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching lead to cadence: ${errForLeadsLeft}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(leadsLeft);
          } else {
            // calculate percentage

            const [leads, errForLeads] = await Repository.fetchAll({
              tableName: DB_TABLES.LEADTOCADENCE,
              query: {
                cadence_id: cadence_id,
                created_at: {
                  [Op.between]: dateRange,
                },
              },
              extras: {
                group: ['cadence_id'],
                attributes: [
                  [
                    sequelize.literal(`COUNT(DISTINCT lead_cadence_id) `),
                    'total_lead_count',
                  ],
                  'cadence_id',
                ],
              },
            });
            if (errForLeads) {
              logger.error(`Error while fetching total leads: `, errForLeads);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch cadence comparision',
                error: `Error while fetching lead to cadence: ${errForLeads}`,
              });
            }

            let percentage = [];

            console.log(leads);

            // max 4 cadences chosen ->  16 iterations
            for (let total of leads) {
              for (let count of leadsLeft) {
                if (total.cadence_id == count.cadence_id) {
                  percentage.push({
                    cadence_id: total.cadence_id,
                    percentage: (count.count / total.total_lead_count) * 100,
                  });
                }
              }
            }
            result.push(percentage);
          }
          break;
        }
        case COMPARE_CADENCE_KPI_TYPE.CONVERTED_LEADS:
        case COMPARE_CADENCE_KPI_TYPE.DISQUALIFIED_LEADS: {
          const dateRange = LeaderboardHelper.dateFilters[filter](
            user.timezone
          );
          const [start_date, end_date] = dateRange;

          let status;

          if (type == COMPARE_CADENCE_KPI_TYPE.CONVERTED_LEADS)
            status = LEAD_STATUS.CONVERTED;
          else status = LEAD_STATUS.TRASH;

          const [leadsLeft, errForLeadsLeft] = await Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              status: status,
              status_update_timestamp: {
                [Op.between]: dateRange,
              },
            },
            include: {
              [DB_TABLES.LEADTOCADENCE]: {
                where: {
                  cadence_id: cadence_id,
                },
                attributes: [],
                required: true,
              },
            },

            extras: {
              group: ['cadence_id'],
              attributes: [
                [sequelize.literal(`COUNT(DISTINCT lead_id)`), 'count'],
                'cadence_id',
              ],
            },
          });
          if (errForLeadsLeft) {
            logger.error('Error while fetching skipped count', errForLeadsLeft);
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch cadence comparision',
              error: `Error while fetching lead: ${errForLeadsLeft}`,
            });
          }

          if (valueType == COMPARE_CADENCE_VALUE_TYPE.ABSOLUTE_VALUES) {
            result.push(leadsLeft);
          } else {
            // calculate percentage

            const [leads, errForLeads] = await Repository.fetchAll({
              tableName: DB_TABLES.LEADTOCADENCE,
              query: {
                cadence_id: cadence_id,
                created_at: {
                  [Op.between]: dateRange,
                },
              },
              extras: {
                group: ['cadence_id'],
                attributes: [
                  [
                    sequelize.literal(`COUNT(DISTINCT lead_cadence_id) `),
                    'total_lead_count',
                  ],
                  'cadence_id',
                ],
              },
            });
            if (errForLeads) {
              logger.error(`Error while fetching total leads: `, errForLeads);
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to fetch cadence comparision',
                error: `Error while fetching lead to cadence: ${errForLeads}`,
              });
            }

            let percentage = [];

            console.log(leads);

            // max 4 cadences chosen ->  16 iterations
            for (let total of leads) {
              for (let count of leadsLeft) {
                if (total.cadence_id == count.cadence_id) {
                  percentage.push({
                    cadence_id: total.cadence_id,
                    percentage: (count.count / total.total_lead_count) * 100,
                  });
                }
              }
            }
            result.push(percentage);
          }
          break;
        }
      }
    }

    return successResponse(res, 'Fetched comparision stats', result);
  } catch (err) {
    logger.error(`Error while fetching compare cadences:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching compare cadences: ${err.message}`,
    });
  }
};

const StatisticsRedesignController = {
  cadenceStatisticsController,
  taskStatisticsController,
  leadStatusCountController,
  opportunityMetrics,
  revenueMetricsController,
  pendingTaskStatistics,
  completedTaskStatistics,
  skippedTaskStatistics,
  historyGraphStatistics,
  heatmapStatistics,
  historyTableStatistics,
  historyTableUpdate,
  getHistoryTableColumns,
  cadenceComparisonController,
};
module.exports = StatisticsRedesignController;
