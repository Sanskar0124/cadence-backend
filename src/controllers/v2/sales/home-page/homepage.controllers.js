// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LIVE_FEED_FILTER,
  NODE_TYPES,
  ACTIVITY_TYPE,
  LEAD_STATUS,
  CADENCE_STATUS,
  CADENCE_LEAD_STATUS,
  ACTIVE_CADENCE_FILTER,
  CUSTOM_TASK_NODE_ID,
  HOMEPAGE_ACTIVE_CADENCE_TYPE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');

// Models
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');

const fetchLiveFeed = async (req, res) => {
  try {
    const { filter, limit, offset } = req.body;

    if (!filter)
      badRequestResponseWithDevMsg({ res, msg: `No filter specified` });

    if (!limit)
      badRequestResponseWithDevMsg({ res, msg: `Limit not specified` });

    if (parseInt(limit) + parseInt(offset) > 200)
      badRequestResponseWithDevMsg({ res, msg: `Limit exceeded` });

    const fetchLimit = parseInt(limit) + parseInt(offset);

    const user_id = req.user.user_id;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch live feed',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch live feed',
        error: `User not found`,
      });

    let userActivities, errForUserActivities;
    let allActivities,
      callActivities,
      unsubscribeActivities,
      bouncedActivities,
      otherActivities;

    if (filter.length === 1 && filter[0] === LIVE_FEED_FILTER.ALL) {
      [allActivities, errForUserActivities] = await Repository.fetchAll({
        tableName: DB_TABLES.ACTIVITY,
        query: {
          [Op.or]: [
            { incoming: true },
            {
              type: [ACTIVITY_TYPE.UNSUBSCRIBE, ACTIVITY_TYPE.BOUNCED_MAIL],
            },
          ],
        },
        include: {
          [DB_TABLES.LEAD]: {
            required: true,
            attributes: [
              'lead_id',
              'full_name',
              'first_name',
              'lead_id',
              'linkedin_url',
              'job_position',
              'integration_type',
              'integration_id',
              'status',
              'salesforce_lead_id',
              'salesforce_contact_id',
              'account_id',
            ],
            [DB_TABLES.LEADTOCADENCE]: {
              attributes: ['status'],
              [DB_TABLES.CADENCE]: {
                attributes: [
                  'cadence_id',
                  'name',
                  // 'salesforce_cadence_id',
                  'status',
                  // 'unix_resume_at',
                ],
              },
            },
            [DB_TABLES.USER]: {
              [DB_TABLES.COMPANY]: {
                attributes: ['company_id', 'name'],
              },
              required: true,
              attributes: [
                'user_id',
                'primary_phone_number',
                'primary_email',
                'first_name',
                'last_name',
                'calendly_url',
                'company_id',
              ],
              where: {
                user_id,
              },
            },
            [DB_TABLES.ACCOUNT]: {
              attributes: [
                'phone_number',
                'url',
                'linkedin_url',
                'size',
                'name',
                'zipcode',
                'country',
                'name',
                'integration_id',
              ],
            },
            [DB_TABLES.LEAD_EMAIL]: {
              attributes: ['is_primary', 'email_id'],
            },
            [DB_TABLES.LEAD_PHONE_NUMBER]: {
              attributes: [
                'is_primary',
                'phone_number',
                'formatted_phone_number',
              ],
            },
          },
          // [DB_TABLES.EMAIL]: {
          //   attributes: [],
          // },
        },
        extras: {
          order: [['created_at', 'DESC']],
          limit: fetchLimit,
          // logging: true,
          attributes: [
            'activity_id',
            'read',
            'type',
            'cadence_id',
            'created_at',
            'incoming',
            'status',
            'name',
            'from_number',
            'comment',
            'recording',
            'lead_id',
            'message_id',
            'sent_message_id',
          ],
        },
      });
    } else {
      let activitiesType = [];

      for (let i = 0; i < filter.length; i++) {
        switch (filter[i]) {
          case LIVE_FEED_FILTER.RECEIVED_MAILS:
            activitiesType.push(ACTIVITY_TYPE.MAIL);
            activitiesType.push(ACTIVITY_TYPE.REPLY_TO);
            break;
          case LIVE_FEED_FILTER.RECEIVED_SMS:
            activitiesType.push(ACTIVITY_TYPE.MESSAGE);
            break;
          case LIVE_FEED_FILTER.REPLIED_MAILS:
            activitiesType.push(ACTIVITY_TYPE.REPLY_TO);
            break;
          case LIVE_FEED_FILTER.CLICKED_MAILS:
            activitiesType.push(ACTIVITY_TYPE.CLICKED_MAIL);
            break;
          case LIVE_FEED_FILTER.VIEWED_MAILS:
            activitiesType.push(ACTIVITY_TYPE.VIEWED_MAIL);
            break;
          case LIVE_FEED_FILTER.HOT_LEADS:
            activitiesType.push(ACTIVITY_TYPE.HOT_LEAD);
            break;
        }
      }

      if (
        filter.includes(LIVE_FEED_FILTER.MISSED_CALLS) ||
        filter.includes(LIVE_FEED_FILTER.RECEIVED_CALLS) ||
        filter.includes(LIVE_FEED_FILTER.REJECTED_CALLS)
      ) {
        let nameQuery = [];

        if (filter.includes(LIVE_FEED_FILTER.MISSED_CALLS))
          nameQuery.push({
            [Op.substring]: 'You missed a call',
          });

        if (filter.includes(LIVE_FEED_FILTER.RECEIVED_CALLS))
          nameQuery.push({
            [Op.substring]: 'You received a call from',
          });

        if (filter.includes(LIVE_FEED_FILTER.REJECTED_CALLS))
          nameQuery.push({
            [Op.substring]: 'You rejected a call from',
          });

        [callActivities, errForUserActivities] = await Repository.fetchAll({
          tableName: DB_TABLES.ACTIVITY,
          query: {
            type: ACTIVITY_TYPE.CALL,
            incoming: true,
            name: {
              [Op.or]: nameQuery,
            },
          },
          include: {
            [DB_TABLES.LEAD]: {
              required: true,
              attributes: [
                'lead_id',
                'full_name',
                'first_name',
                'lead_id',
                'linkedin_url',
                'job_position',
                'integration_type',
                'integration_id',
                'status',
                'salesforce_lead_id',
                'salesforce_contact_id',
                'account_id',
              ],
              [DB_TABLES.LEADTOCADENCE]: {
                attributes: ['status'],
                [DB_TABLES.CADENCE]: {
                  attributes: [
                    'cadence_id',
                    'name',
                    // 'salesforce_cadence_id',
                    'status',
                    // 'unix_resume_at',
                  ],
                },
              },
              [DB_TABLES.USER]: {
                [DB_TABLES.COMPANY]: {
                  attributes: ['company_id', 'name'],
                },
                required: true,
                attributes: [
                  'user_id',
                  'primary_phone_number',
                  'primary_email',
                  'first_name',
                  'last_name',
                  'calendly_url',
                  'company_id',
                ],
                where: {
                  user_id,
                },
              },
              [DB_TABLES.ACCOUNT]: {
                attributes: [
                  'phone_number',
                  'url',
                  'linkedin_url',
                  'size',
                  'name',
                  'zipcode',
                  'country',
                  'name',
                  'integration_id',
                ],
              },
              [DB_TABLES.LEAD_EMAIL]: {
                attributes: ['is_primary', 'email_id'],
              },
              [DB_TABLES.LEAD_PHONE_NUMBER]: {
                attributes: [
                  'is_primary',
                  'phone_number',
                  'formatted_phone_number',
                ],
              },
            },
          },
          extras: {
            order: [['created_at', 'DESC']],
            attributes: [
              'activity_id',
              'read',
              'type',
              'cadence_id',
              'created_at',
              'incoming',
              'status',
              'name',
              'from_number',
              'comment',
              'recording',
              'lead_id',
              'message_id',
              'sent_message_id',
            ],
            limit: fetchLimit,
          },
        });
      }

      if (filter.includes(LIVE_FEED_FILTER.UNSUBSCRIBED_MAILS)) {
        [unsubscribeActivities, errForUserActivities] =
          await Repository.fetchAll({
            tableName: DB_TABLES.ACTIVITY,
            query: {
              type: ACTIVITY_TYPE.UNSUBSCRIBE,
            },
            include: {
              [DB_TABLES.LEAD]: {
                required: true,
                attributes: [
                  'lead_id',
                  'full_name',
                  'first_name',
                  'lead_id',
                  'linkedin_url',
                  'job_position',
                  'integration_type',
                  'integration_id',
                  'status',
                  'salesforce_lead_id',
                  'salesforce_contact_id',
                  'account_id',
                ],
                [DB_TABLES.LEADTOCADENCE]: {
                  attributes: ['status'],
                  [DB_TABLES.CADENCE]: {
                    attributes: [
                      'cadence_id',
                      'name',
                      // 'salesforce_cadence_id',
                      'status',
                      // 'unix_resume_at',
                    ],
                  },
                },
                [DB_TABLES.USER]: {
                  [DB_TABLES.COMPANY]: {
                    attributes: ['company_id', 'name'],
                  },
                  required: true,
                  attributes: [
                    'user_id',
                    'primary_phone_number',
                    'primary_email',
                    'first_name',
                    'last_name',
                    'calendly_url',
                    'company_id',
                  ],
                  where: {
                    user_id,
                  },
                },
                [DB_TABLES.ACCOUNT]: {
                  attributes: [
                    'phone_number',
                    'url',
                    'linkedin_url',
                    'size',
                    'name',
                    'zipcode',
                    'country',
                    'name',
                    'integration_id',
                  ],
                },
                [DB_TABLES.LEAD_EMAIL]: {
                  attributes: ['is_primary', 'email_id'],
                },
                [DB_TABLES.LEAD_PHONE_NUMBER]: {
                  attributes: [
                    'is_primary',
                    'phone_number',
                    'formatted_phone_number',
                  ],
                },
              },
            },
            extras: {
              order: [['created_at', 'DESC']],
              limit: fetchLimit,
              attributes: [
                'activity_id',
                'read',
                'type',
                'cadence_id',
                'created_at',
                'incoming',
                'status',
                'name',
                'from_number',
                'comment',
                'recording',
                'lead_id',
                'message_id',
                'sent_message_id',
              ],
            },
          });
      }

      if (filter.includes(LIVE_FEED_FILTER.BOUNCED_MAILS)) {
        [bouncedActivities, errForUserActivities] = await Repository.fetchAll({
          tableName: DB_TABLES.ACTIVITY,
          query: {
            type: ACTIVITY_TYPE.BOUNCED_MAIL,
          },
          include: {
            [DB_TABLES.LEAD]: {
              required: true,
              attributes: [
                'lead_id',
                'full_name',
                'first_name',
                'lead_id',
                'linkedin_url',
                'job_position',
                'integration_type',
                'integration_id',
                'status',
                'salesforce_lead_id',
                'salesforce_contact_id',
                'account_id',
              ],
              [DB_TABLES.LEADTOCADENCE]: {
                attributes: ['status'],
                [DB_TABLES.CADENCE]: {
                  attributes: [
                    'cadence_id',
                    'name',
                    // 'salesforce_cadence_id',
                    'status',
                    // 'unix_resume_at',
                  ],
                },
              },
              [DB_TABLES.USER]: {
                [DB_TABLES.COMPANY]: {
                  attributes: ['company_id', 'name'],
                },
                required: true,
                attributes: [
                  'user_id',
                  'primary_phone_number',
                  'primary_email',
                  'first_name',
                  'last_name',
                  'calendly_url',
                  'company_id',
                ],
                where: {
                  user_id,
                },
              },
              [DB_TABLES.ACCOUNT]: {
                attributes: [
                  'phone_number',
                  'url',
                  'linkedin_url',
                  'size',
                  'name',
                  'zipcode',
                  'country',
                  'name',
                  'integration_id',
                ],
              },
              [DB_TABLES.LEAD_EMAIL]: {
                attributes: ['is_primary', 'email_id'],
              },
              [DB_TABLES.LEAD_PHONE_NUMBER]: {
                attributes: [
                  'is_primary',
                  'phone_number',
                  'formatted_phone_number',
                ],
              },
            },
          },
          extras: {
            order: [['created_at', 'DESC']],
            limit: fetchLimit,
            attributes: [
              'activity_id',
              'read',
              'type',
              'cadence_id',
              'created_at',
              'incoming',
              'status',
              'name',
              'from_number',
              'comment',
              'recording',
              'lead_id',
              'message_id',
              'sent_message_id',
            ],
          },
        });
      }

      if (activitiesType.length > 0) {
        [otherActivities, errForUserActivities] = await Repository.fetchAll({
          tableName: DB_TABLES.ACTIVITY,
          query: {
            incoming: true,
            type: {
              [Op.in]: activitiesType,
            },
          },
          include: {
            [DB_TABLES.LEAD]: {
              required: true,
              [DB_TABLES.LEADTOCADENCE]: {
                attributes: ['status'],
                [DB_TABLES.CADENCE]: {
                  attributes: [
                    'cadence_id',
                    'name',
                    'salesforce_cadence_id',
                    'status',
                    'unix_resume_at',
                  ],
                },
              },
              [DB_TABLES.USER]: {
                [DB_TABLES.COMPANY]: {},
                required: true,
                where: {
                  user_id,
                },
              },
              [DB_TABLES.ACCOUNT]: {},
              [DB_TABLES.LEAD_EMAIL]: {},
              [DB_TABLES.LEAD_PHONE_NUMBER]: {},
            },
          },
          extras: {
            order: [['activity_id', 'DESC']],
            limit: fetchLimit,
          },
        });
      }
    }

    if (errForUserActivities)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch live feed',
        error: `Error while fetching user activities: ${errForUserActivities}`,
      });

    userActivities = [
      ...(allActivities ?? []),
      ...(callActivities ?? []),
      ...(unsubscribeActivities ?? []),
      ...(bouncedActivities ?? []),
      ...(otherActivities ?? []),
    ].sort((a, b) => b.activity_id - a.activity_id);

    if (userActivities.length === 0)
      return successResponse(res, 'No activites found');

    if (limit && offset) {
      userActivities = userActivities.slice(parseInt(offset));
      userActivities = userActivities.slice(0, parseInt(limit));
    } else if (limit) userActivities = userActivities.slice(0, parseInt(limit));
    else if (offset) userActivities = userActivities.slice(parseInt(offset));

    return successResponse(res, 'Activities found', userActivities);
  } catch (err) {
    logger.error(`Error while fetching live feed: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching live feed: ${err.message}`,
    });
  }
};

const fetchPendingTasks = async (req, res) => {
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
        msg: 'failed to fetch pending tasks',
        error: `Error while fethcing user: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch pending tasks',
        error: `User not found`,
      });

    const [tasksCount, errForTasks] = await Repository.fetchAll({
      tableName: DB_TABLES.DAILY_TASKS,
      query: {
        user_id: user.user_id,
      },
      include: {
        [DB_TABLES.NODE]: {
          where: {
            type: {
              [Op.not]: [
                NODE_TYPES.AUTOMATED_MAIL,
                NODE_TYPES.AUTOMATED_MESSAGE,
                NODE_TYPES.AUTOMATED_REPLY_TO,
                NODE_TYPES.END,
              ],
            },
          },
          required: true,
          attributes: [],
        },
        [DB_TABLES.TASK]: {
          where: {
            node_id: {
              [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
            },
            completed: 0,
          },
          required: true,
          subQuery: false,
          attributes: [],

          [DB_TABLES.LEAD]: {
            where: {
              status: {
                [Op.in]: [LEAD_STATUS.NEW_LEAD, LEAD_STATUS.ONGOING],
              },
            },
            required: true,
            subQuery: false,

            [DB_TABLES.LEADTOCADENCE]: {
              subQuery: false,
              where: {
                cadence_id: {
                  [Op.eq]: sequelize.col('Task.cadence_id'),
                },
                status: CADENCE_LEAD_STATUS.IN_PROGRESS,
              },
              required: true,
              attributes: [],
            },
          },
          [DB_TABLES.CADENCE]: {
            where: {
              status: CADENCE_STATUS.IN_PROGRESS,
            },
            attributes: [],
          },
        },
      },
      extras: {
        group: ['Node.type'],
        attributes: [
          [
            sequelize.literal(`COUNT(DISTINCT daily_tasks.task_id ) `),
            'pending_task_count',
          ],
          [sequelize.col('Node.type'), 'type'],
        ],
      },
    });

    let countObject = {
      mail: 0,
      message: 0,
      call: 0,
      linkedin: 0,
      data_check: 0,
      whatsapp: 0,
      custom: 0,
    };
    for (let count of tasksCount) {
      switch (count.type) {
        case NODE_TYPES.MAIL: {
          countObject['mail'] = countObject['mail'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.REPLY_TO: {
          countObject['mail'] = countObject['mail'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.CALL: {
          countObject['call'] = countObject['call'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.MESSAGE: {
          countObject['message'] =
            countObject['message'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.LINKEDIN_CONNECTION: {
          countObject['linkedin'] =
            countObject['linkedin'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.LINKEDIN_INTERACT: {
          countObject['linkedin'] =
            countObject['linkedin'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.LINKEDIN_MESSAGE: {
          countObject['linkedin'] =
            countObject['linkedin'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.LINKEDIN_PROFILE: {
          countObject['linkedin'] =
            countObject['linkedin'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.DATA_CHECK: {
          countObject['data_check'] =
            countObject['data_check'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.WHATSAPP: {
          countObject['whatsapp'] =
            countObject['whatsapp'] + count.pending_task_count;
          break;
        }
        case NODE_TYPES.CADENCE_CUSTOM: {
          countObject['custom'] =
            countObject['custom'] + count.pending_task_count;
          break;
        }
      }
    }

    return successResponse(res, 'Fetched pending task statistics', countObject);
  } catch (err) {
    logger.error(`Error while fetching pending tasks: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching pending tasks: ${err.message}`,
    });
  }
};

const fetchPendingTaskCadences = async (req, res) => {
  try {
    const { type, limit, offset } = req.query;

    if (!type)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences for pending tasks',
        error: 'Type is required',
      });

    if (!limit || !offset)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences for pending tasks',
        error: `Limit or offset is not specified`,
      });

    if (parseInt(limit) + parseInt(offset) > 200)
      return badRequestResponseWithDevMsg({ res, msg: `Limit exceeded` });

    if (!Object.values(ACTIVE_CADENCE_FILTER).includes(type))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences for pending tasks',
        error: `Invalid type specified`,
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences for pending tasks',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences for pending tasks',
        error: `User not found`,
      });

    let [dailyTaskCadences, errForDailyTaskCadences] =
      await Repository.fetchAll({
        tableName: DB_TABLES.DAILY_TASKS,
        query: {
          user_id: user.user_id,
        },
        include: {
          [DB_TABLES.NODE]: {
            where: {
              type: {
                [Op.not]: [
                  NODE_TYPES.AUTOMATED_MAIL,
                  NODE_TYPES.AUTOMATED_MESSAGE,
                  NODE_TYPES.AUTOMATED_REPLY_TO,
                  NODE_TYPES.END,
                ],
              },
            },
            required: true,
            attributes: [],
          },
          [DB_TABLES.TASK]: {
            where: {
              node_id: {
                [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
              },
              completed: 0,
            },
            required: true,
            subQuery: false,
            attributes: ['cadence_id'],

            [DB_TABLES.LEAD]: {
              where: {
                status: {
                  [Op.in]: [LEAD_STATUS.NEW_LEAD, LEAD_STATUS.ONGOING],
                },
              },
              required: true,
              subQuery: false,
              attributes: [],

              [DB_TABLES.LEADTOCADENCE]: {
                subQuery: false,
                where: {
                  cadence_id: {
                    [Op.eq]: sequelize.col('Task.cadence_id'),
                  },
                  status: CADENCE_LEAD_STATUS.IN_PROGRESS,
                },
                required: true,
                attributes: [],
              },
            },
            [DB_TABLES.CADENCE]: {
              where: {
                status: CADENCE_STATUS.IN_PROGRESS,
                type:
                  type == ACTIVE_CADENCE_FILTER.ALL ? { [Op.ne]: null } : type,
              },
              attributes: [
                'cadence_id',
                'name',
                [
                  sequelize.literal(
                    '(SELECT COUNT(*) FROM node WHERE node.cadence_id=Task.cadence_id)'
                  ),
                  'node_count',
                ],
                [sequelize.literal(`COUNT(DISTINCT Task.lead_id)`), 'people'],
              ],
            },
          },
        },
        extras: {
          subQuery: false,
          attributes: ['Task.cadence_id'],
          group: ['Task.cadence_id'],
          order: [[sequelize.col('Task.cadence_id')]],
        },
      });
    if (errForDailyTaskCadences) {
      logger.error(
        `Error while fetching pending cadences: `,
        errForDailyTaskCadences
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Cadences of the pending task cannot be found',
        error: `Error while fetching cadences of the pending task : ${errForDailyTaskCadences}`,
      });
    }

    if (limit && offset) {
      dailyTaskCadences = dailyTaskCadences.slice(parseInt(offset));
      dailyTaskCadences = dailyTaskCadences.slice(0, parseInt(limit));
    } else if (limit) {
      dailyTaskCadences = dailyTaskCadences.slice(0, parseInt(limit));
    } else if (offset) {
      dailyTaskCadences = dailyTaskCadences.slice(parseInt(offset));
    }

    return successResponse(
      res,
      'Cadences fetched successfully.',
      dailyTaskCadences
    );
  } catch (err) {
    logger.error(`Error while fetching pending task cadences: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching pending task cadences: ${err.message}`,
    });
  }
};

const fetchActiveCadences = async (req, res) => {
  try {
    const { cadenceType, taskTag } = req.query;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch active cadences',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch active cadences',
        error: `User not found`,
      });

    let fetchCustomTasks = false;
    let taskQuery, nodeQuery;

    if (!taskTag) {
      taskQuery = {
        node_id: {
          [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
        },
        completed: 0,
      };
      nodeQuery = {
        type: {
          [Op.not]: [
            NODE_TYPES.AUTOMATED_MAIL,
            NODE_TYPES.AUTOMATED_MESSAGE,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.END,
          ],
        },
      };

      fetchCustomTasks = true;
    } else if (taskTag === HOMEPAGE_ACTIVE_CADENCE_TYPE.URGENT) {
      taskQuery = {
        node_id: {
          [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
        },
        completed: 0,
      };

      nodeQuery = {
        type: {
          [Op.not]: [
            NODE_TYPES.AUTOMATED_MAIL,
            NODE_TYPES.AUTOMATED_MESSAGE,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.END,
          ],
        },
        is_urgent: 1,
      };
    } else if (taskTag === HOMEPAGE_ACTIVE_CADENCE_TYPE.LATE) {
      taskQuery = {
        node_id: {
          [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
        },
        completed: 0,
        late_time: {
          [Op.lte]: new Date().getTime(),
        },
      };
      nodeQuery = {
        type: {
          [Op.not]: [
            NODE_TYPES.AUTOMATED_MAIL,
            NODE_TYPES.AUTOMATED_MESSAGE,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.END,
          ],
        },
      };
    } else
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch active cadences',
        error: 'Invalid task tag',
      });

    const assignedTaskCadencePromise = Repository.fetchAll({
      tableName: DB_TABLES.DAILY_TASKS,
      query: {
        user_id: user.user_id,
      },
      include: {
        [DB_TABLES.NODE]: {
          where: nodeQuery,
          required: true,
          attributes: [],
        },
        [DB_TABLES.TASK]: {
          where: taskQuery,
          required: true,
          subQuery: false,
          attributes: ['cadence_id'],

          [DB_TABLES.LEAD]: {
            where: {
              status: {
                [Op.in]: [LEAD_STATUS.NEW_LEAD, LEAD_STATUS.ONGOING],
              },
            },
            required: true,
            subQuery: false,
            attributes: [],

            [DB_TABLES.LEADTOCADENCE]: {
              subQuery: false,
              where: {
                cadence_id: {
                  [Op.eq]: sequelize.col('Task.cadence_id'),
                },
                status: CADENCE_LEAD_STATUS.IN_PROGRESS,
              },
              required: true,
              attributes: [],
            },
          },
          [DB_TABLES.CADENCE]: {
            where: {
              status: CADENCE_STATUS.IN_PROGRESS,
              type: !cadenceType ? { [Op.ne]: null } : cadenceType,
            },
            attributes: [
              'cadence_id',
              'name',
              'type',
              [
                sequelize.literal(
                  '(SELECT COUNT(node_id) FROM node WHERE node.cadence_id=Task.cadence_id)'
                ),
                'node_count',
              ],
              [
                sequelize.literal(
                  '(SELECT COUNT(lead_to_cadence.lead_id) FROM lead_to_cadence WHERE lead_to_cadence.cadence_id=Task.cadence_id)'
                ),
                'total_lead_count',
              ],
            ],
          },
        },
      },
      extras: {
        subQuery: false,
        attributes: [
          'Task.cadence_id',
          [sequelize.literal(`COUNT(Task.task_id)`), 'task_count'],
        ],
        group: ['Task.cadence_id'],
        order: [[sequelize.col('Task.cadence_id')]],
      },
    });

    let customTaskPromise = [[], null];

    if (fetchCustomTasks)
      customTaskPromise = Repository.fetchAll({
        tableName: DB_TABLES.DAILY_TASKS,
        query: {
          user_id: user.user_id,
        },
        include: {
          [DB_TABLES.NODE]: {
            where: nodeQuery,
            required: true,
            attributes: [],
          },
          [DB_TABLES.TASK]: {
            where: {
              completed: 0,
              node_id: Object.values(CUSTOM_TASK_NODE_ID).filter(
                (node_id) => node_id !== CUSTOM_TASK_NODE_ID.other
              ),
            },
            required: true,
            subQuery: false,
            attributes: ['cadence_id'],

            [DB_TABLES.CADENCE]: {
              where: {
                type: !cadenceType ? { [Op.ne]: null } : cadenceType,
              },
              attributes: [
                'cadence_id',
                'name',
                'type',
                [
                  sequelize.literal(
                    '(SELECT COUNT(node_id) FROM node WHERE node.cadence_id=Task.cadence_id)'
                  ),
                  'node_count',
                ],
                [
                  sequelize.literal(
                    '(SELECT COUNT(lead_to_cadence.lead_id) FROM lead_to_cadence WHERE lead_to_cadence.cadence_id=Task.cadence_id)'
                  ),
                  'total_lead_count',
                ],
              ],
            },
          },
        },
        extras: {
          subQuery: false,
          attributes: [
            'Task.cadence_id',
            [sequelize.literal(`COUNT(Task.task_id)`), 'task_count'],
          ],
          group: ['Task.cadence_id'],
          order: [[sequelize.col('Task.cadence_id')]],
        },
      });

    const [
      [dailyTaskCadences, errForDailyTaskCadences],
      [customTaskCadences, errForCustomTaskCadences],
    ] = await Promise.all([assignedTaskCadencePromise, customTaskPromise]);
    if (errForDailyTaskCadences) {
      logger.error(
        `Error while fetching active cadences: `,
        errForDailyTaskCadences
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch active cadences',
        error: `Error while fetching active cadences : ${errForDailyTaskCadences}`,
      });
    }
    if (errForCustomTaskCadences) {
      logger.error(
        `Error while fetching active cadences for custom tasks : `,
        errForCustomTaskCadences
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch active cadences',
        error: `Error while fetching active cadences for custom tasks : ${errForCustomTaskCadences}`,
      });
    }

    // Filter duplicate cadences

    // Merge and add task counts
    const mergedArray = [];
    let i = 0;
    let j = 0;

    while (i < dailyTaskCadences.length && j < customTaskCadences.length) {
      const dailyTaskCadence = dailyTaskCadences[i];
      const customTaskCadence = customTaskCadences[j];

      if (
        dailyTaskCadence.Task.cadence_id < customTaskCadence.Task.cadence_id
      ) {
        mergedArray.push(dailyTaskCadence);
        i++;
      } else if (
        dailyTaskCadence.Task.cadence_id > customTaskCadence.Task.cadence_id
      ) {
        mergedArray.push(customTaskCadence);
        j++;
      } else {
        // If cadence_ids match, add the task counts
        mergedArray.push({
          task_count:
            dailyTaskCadence.task_count + customTaskCadence.task_count,
          Task: dailyTaskCadence.Task,
        });
        i++;
        j++;
      }
    }
    // Add remaining items from dailyTaskCadences (if any)
    while (i < dailyTaskCadences.length) {
      mergedArray.push(dailyTaskCadences[i]);
      i++;
    }
    // Add remaining items from customTaskCadences (if any)
    while (j < customTaskCadences.length) {
      mergedArray.push(customTaskCadences[j]);
      j++;
    }

    return successResponse(
      res,
      'Active Cadences fetched successfully.',
      mergedArray
    );
  } catch (err) {
    logger.error(`Error while fetching active cadences: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching active cadences: ${err.message}`,
    });
  }
};

const fetchTaskCompletion = async (req, res) => {
  try {
    const { taskTag } = req.query;

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
        msg: 'Failed to fetch user progress',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch active cadences',
        error: `User not found`,
      });

    const [startTime, endTime] = [
      UserHelper.setHoursForTimezone(0, new Date().getTime(), user.timezone),
      UserHelper.setHoursForTimezone(24, new Date().getTime(), user.timezone),
    ];

    let taskQuery, nodeQuery;
    let fetchCustomTasks = false;

    if (!taskTag) {
      taskQuery = {
        node_id: {
          [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
        },
      };
      nodeQuery = {
        type: {
          [Op.not]: [
            NODE_TYPES.AUTOMATED_MAIL,
            NODE_TYPES.AUTOMATED_MESSAGE,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.END,
          ],
        },
      };
      // Fetch custom tasks for no task tag
      fetchCustomTasks = true;
    } else if (taskTag === HOMEPAGE_ACTIVE_CADENCE_TYPE.URGENT) {
      taskQuery = {
        node_id: {
          [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
        },
      };

      nodeQuery = {
        type: {
          [Op.not]: [
            NODE_TYPES.AUTOMATED_MAIL,
            NODE_TYPES.AUTOMATED_MESSAGE,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.END,
          ],
        },
        is_urgent: 1,
      };
    } else if (taskTag === HOMEPAGE_ACTIVE_CADENCE_TYPE.LATE) {
      taskQuery = {
        node_id: {
          [Op.notIn]: Object.values(CUSTOM_TASK_NODE_ID),
        },
        late_time: {
          [Op.lte]: new Date().getTime(),
        },
      };
      nodeQuery = {
        type: {
          [Op.not]: [
            NODE_TYPES.AUTOMATED_MAIL,
            NODE_TYPES.AUTOMATED_MESSAGE,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.END,
          ],
        },
      };
    } else
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user progress',
        error: 'Invalid task tag',
      });

    const assignedTasksPromise = Repository.fetchAll({
      tableName: DB_TABLES.DAILY_TASKS,
      query: {
        user_id: user.user_id,
      },
      include: {
        [DB_TABLES.NODE]: {
          where: nodeQuery,
          required: true,
          attributes: ['type'],
        },
        [DB_TABLES.TASK]: {
          where: taskQuery,
          required: true,
          subQuery: false,

          [DB_TABLES.LEAD]: {
            required: true,
            attributes: [],
            [DB_TABLES.LEADTOCADENCE]: {
              subQuery: false,
              where: {
                cadence_id: {
                  [Op.eq]: sequelize.col('Task.cadence_id'),
                },
              },
              required: true,
              attributes: [],
            },
          },

          [DB_TABLES.CADENCE]: {
            required: true,
            attributes: [],
          },
          attributes: [], // 'cadence_id',],
        },
      },
      extras: {
        // logging: true,
        attributes: [
          [
            sequelize.literal(`COUNT(CASE 
                WHEN completed = 1 AND complete_time BETWEEN ${startTime} AND ${endTime} 
                THEN 1
                ELSE NULL
              END)`),
            'completed',
          ],
          [
            sequelize.literal(`COUNT(CASE WHEN completed = 0 AND is_skipped = 0
                AND \`Task->Cadence\`.status = "${CADENCE_STATUS.IN_PROGRESS}" 
                AND \`Task->Lead\`.status IN ("${LEAD_STATUS.NEW_LEAD}", "${LEAD_STATUS.ONGOING}")
               AND \`Task->Lead->LeadToCadences\`.status IN ("${CADENCE_LEAD_STATUS.IN_PROGRESS}")
                THEN 1 ELSE NULL END)`),
            'pending',
          ],
        ],
        group: ['Node.type'],
      },
    });

    let customTaskPromise = [[], null];

    if (fetchCustomTasks)
      customTaskPromise = Repository.fetchAll({
        tableName: DB_TABLES.DAILY_TASKS,
        query: {
          user_id: user.user_id,
        },
        include: {
          [DB_TABLES.NODE]: {
            where: {
              node_id: {
                [Op.in]: Object.values(CUSTOM_TASK_NODE_ID).filter(
                  (node_id) => node_id !== CUSTOM_TASK_NODE_ID.other
                ),
              },
            },
            required: true,
            attributes: ['type'],
          },
          [DB_TABLES.TASK]: {
            where: {},
            required: true,
            subQuery: false,

            attributes: [], // 'cadence_id',],
          },
        },
        extras: {
          // logging: true,
          attributes: [
            [
              sequelize.literal(`COUNT(CASE 
                WHEN completed = 1 AND complete_time BETWEEN ${startTime} AND ${endTime} 
                THEN 1
                ELSE NULL
              END)`),
              'completed',
            ],
            [
              sequelize.literal(`COUNT(CASE WHEN completed = 0 AND is_skipped = 0
                THEN 1 ELSE NULL END)`),
              'pending',
            ],
          ],
          group: ['Node.type'],
        },
      });

    const [
      [assignedTasks, errForAssignedTasks],
      [customTasks, errForCustomTasks],
    ] = await Promise.all([assignedTasksPromise, customTaskPromise]);

    if (errForAssignedTasks) {
      logger.error(
        `Error while fetching assigned tasks for user: `,
        errForAssignedTasks
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch progress for user',
        error: `Error while fetching progress for user : ${errForAssignedTasks}`,
      });
    }
    if (errForCustomTasks) {
      logger.error(
        `Error while fetching custom tasks for user: `,
        errForCustomTasks
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch progress for user',
        error: `Error while fetching progress for user : ${errForCustomTasks}`,
      });
    }

    let result = {};

    [...assignedTasks, ...customTasks].forEach((taskCount) => {
      if (
        [
          NODE_TYPES.LINKEDIN_CONNECTION,
          NODE_TYPES.LINKEDIN_INTERACT,
          NODE_TYPES.LINKEDIN_MESSAGE,
          NODE_TYPES.LINKEDIN_PROFILE,
        ].includes(taskCount['Node']['type'])
      ) {
        if (result.hasOwnProperty('linkedin'))
          result['linkedin'] = {
            completed: taskCount.completed + result['linkedin']['completed'],
            pending: taskCount.pending + result['linkedin']['pending'],
          };
        else
          result['linkedin'] = {
            completed: taskCount.completed,
            pending: taskCount.pending,
          };
      } else if (
        [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO].includes(
          taskCount['Node']['type']
        )
      ) {
        if (result.hasOwnProperty('email'))
          result['email'] = {
            completed: taskCount.completed + result['email']['completed'],
            pending: taskCount.pending + result['email']['pending'],
          };
        else
          result['email'] = {
            completed: taskCount.completed,
            pending: taskCount.pending,
          };
      } else {
        if (result.hasOwnProperty(taskCount['Node']['type']))
          result[taskCount['Node']['type']] = {
            completed:
              taskCount.completed +
              result[taskCount['Node']['type']]['completed'],
            pending:
              taskCount.pending + result[taskCount['Node']['type']]['pending'],
          };
        else
          result[taskCount['Node']['type']] = {
            completed: taskCount.completed,
            pending: taskCount.pending,
          };
      }
    });

    return successResponse(res, 'User progress fetched successfully.', result);
  } catch (err) {
    logger.error(`Error while fetching user progress: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching user progress: ${err.message}`,
    });
  }
};

const HomepageController = {
  fetchLiveFeed,
  fetchPendingTasks,
  fetchPendingTaskCadences,
  fetchActiveCadences,
  fetchTaskCompletion,
};

module.exports = HomepageController;
