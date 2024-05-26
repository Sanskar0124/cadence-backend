// Utils
const logger = require('../../../../utils/winston');
const {
  ACTIVITY_TYPE,
  ACTIVITY_SUBTYPES,
  CADENCE_LEAD_STATUS,
  CUSTOM_TASK_NODE_ID,
  WORKFLOW_TRIGGERS,
  LEAD_STATUS,
  TEMPLATE_TYPE,
  NODE_TYPES,
  CALENDAR_INTEGRATION_TYPES,
  COMPANY_CONTACT_REASSIGNMENT_OPTIONS,
  CUSTOM_TASK_NODE_NAME,
  USER_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  MAIL_INTEGRATION_TYPES,
  TASK_NAMES_BY_TYPE,
  TASK_NAME_FOR_DISPLAY,
  SETTING_TYPES,
  TASK_STATUSES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  forbiddenResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  badRequestResponse,
} = require('../../../../utils/response');

// Packages
const { Op } = require('sequelize');

// Models
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const DailyTasksRepository = require('../../../../../../Cadence-Brain/src/repository/daily-tasks.repository');
const Repository = require('../../../../../../Cadence-Brain/src/repository');

//  Helpers and Services
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const SocketHelper = require('../../../../../../Cadence-Brain/src/helper/socket');
const WorkflowHelper = require('../../../../../../Cadence-Brain/src/helper/workflow');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const VariablesHelper = require('../../../../../../Cadence-Brain/src/helper/variables');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');
const logToIntegration = require('../../../../../../Cadence-Brain/src/helper/logToIntegration');
const AutomatedSettingsHelper = require('../../../../../../Cadence-Brain/src/helper/automated-settings');
const JsonHelper = require('../../../../../../Cadence-Brain/src/helper/json');

// Joi validation
const taskSchema = require('../../../../joi/v2/sales/department/task.joi');

// GRPC
const v2GrpcClients = require('../../../../../../Cadence-Brain/src/grpc/v2');

const getTasks = async (req, res) => {
  try {
    let { filters } = req.body;
    let { limit, offset } = req.query;

    const [tasks, errForTasks] = await TaskHelper.getPendingTasksV2(
      filters,
      req.user.user_id,
      limit,
      offset
    );
    if (errForTasks)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to find pending tasks',
        error: `Error while fetching pending tasks v2: ${errForTasks}`,
      });

    return successResponse(res, `Fetched Tasks Successfully for user.`, tasks);
  } catch (err) {
    logger.error('Error while fetching tasks: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching tasks: ${err.message}`,
    });
  }
};

const getCountSummaryForTasksView = async (req, res) => {
  try {
    const [data, err] = await TaskHelper.findOrCreateTaskSummary({
      user_id: req.user.user_id,
      toUpdateInRedis: false,
    });
    if (err) {
      if (err === `Requested user not found.`)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to fetch count summary',
          error: `Requested user not found`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while finding or creating task summary: ${err} `,
      });
    }

    return successResponse(
      res,
      `Fetched count summary for task view successfully.`,
      data
    );
  } catch (err) {
    logger.error('Error while fetching count summary for task view: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching count summary for task view: ${err.message}`,
    });
  }
};

// * Skip any task
const skipTask = async (req, res) => {
  try {
    const params = taskSchema.skipTaskSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    // * Destructuring
    let { task_id, skip_reason } = params.value;

    // * Fetch task to get next node
    let [task, errFetchingTask] = await TaskRepository.getTask(
      {
        task_id,
        completed: false,
        is_skipped: false,
      },
      false
    );
    if (errFetchingTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to skip task',
        error: `Error while fetching task: ${errFetchingTask}`,
      });
    if (!task)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'This cannot be skipped',
      });

    // * Remove task dataValues
    task = JSON.parse(JSON.stringify(task));

    // * Skip current task
    await TaskRepository.updateTask(
      {
        task_id,
      },
      {
        is_skipped: true,
        skip_time: new Date().getTime(),
        skip_reason: skip_reason ?? null,
        status: TASK_STATUSES.SKIPPED,
      }
    );

    const [activityFromTemplate, errForActivityFromTemplate] =
      ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.TASK_SKIPPED,
        variables: {
          task_name: TASK_NAME_FOR_DISPLAY[task.name] || 'Task',
        },
        activity: {
          lead_id: task.lead_id,
          incoming: null,
          cadence_id: task.cadence_id,
          node_id: task.node_id,
        },
      });
    // * Create activity for skipped task
    const [activity, errCreatingActivity] =
      await ActivityHelper.activityCreation(activityFromTemplate, task.user_id);
    if (errCreatingActivity)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to skip task',
        error: `Error while creating activity: ${errCreatingActivity}`,
      });

    WorkflowHelper.applyWorkflow({
      trigger: WORKFLOW_TRIGGERS.WHEN_A_TASK_IS_SKIPPED,
      lead_id: task.lead_id,
      cadence_id: task.cadence_id,
    });

    // * Generating next task
    const [nextNode, errForNextNode] = await Repository.fetchOne({
      tableName: DB_TABLES.NODE,
      query: { node_id: task.Node.next_node_id },
    });
    if (errForNextNode)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to skip task',
        error: `Error while fetching node: ${errForNextNode}`,
      });

    const [currentCadence, errForCurrentCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id: task.cadence_id },
    });

    if (nextNode) {
      // * Fetch lead to generate next task for
      let [lead, errFetchingLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: { lead_id: task.lead_id },
      });
      if (errFetchingLead)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to skip task',
          error: `Error while fetching lead: ${errFetchingLead}`,
        });

      const [taskCreated, errForTaskCreated] =
        await TaskHelper.createTasksForLeads({
          leads: [lead],
          node: nextNode,
          cadence_id: task.cadence_id,
          firstTask: false,
        });

      if (!nextNode.wait_time && taskCreated) {
        TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);
        return successResponse(
          res,
          'Successfully skipped task and generated next task.',
          {
            data: taskCreated?.[0]?.task_id
              ? { task_id: taskCreated[0].task_id }
              : {},
          }
        );
      }
    } else if (!Object.values(CUSTOM_TASK_NODE_ID).includes(task?.node_id)) {
      const [activityFromTemplate, errForActivityFromTemplate] =
        ActivityHelper.getActivityFromTemplates({
          type: ACTIVITY_TYPE.COMPLETED_CADENCE,
          variables: {
            cadence_name: currentCadence?.name,
          },
          activity: {
            lead_id: task.lead_id,
            incoming: null,
            node_id: task.node_id,
          },
        });

      await Repository.update({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { lead_id: task.lead_id, cadence_id: task.cadence_id },
        updateObject: { status: CADENCE_LEAD_STATUS.COMPLETED },
      });

      let [createdActivity, _] = await ActivityHelper.activityCreation(
        activityFromTemplate,
        task.user_id
      );
      if (createdActivity) logger.info('Created activity');

      WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_A_CADENCE_ENDS,
        lead_id: task.lead_id,
        cadence_id: task.cadence_id,
      });
    }

    // need to recalculate in any case, since the current task is skipped
    TaskHelper.recalculateDailyTasksForUsers([task.user_id]);
    return successResponse(res, `Successfully skipped task.`);
  } catch (err) {
    logger.error('Error while skipping task: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while skipping task: ${err.message}.`,
    });
  }
};

const createCustomTask = async (req, res) => {
  try {
    const validation = taskSchema.createCustomTaskSchema.validate(req.body);
    if (validation.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: validation.error.message,
      });

    // if (!CUSTOM_TASK_NODE_ID[req.body?.name])
    //   return badRequestResponse(res, `Invalid name sent.`);
    // Fetching lead
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id: req.body.lead_id },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
        [DB_TABLES.USER]: {},
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create custom task',
        error: `Error while fetching lead: ${errForLead}`,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: 'No lead found with given lead id',
      });
    // Fetching user
    const user = lead.User;
    if (!user)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create custom task',
        error: `User not found: ${errForUser}`,
      });

    if (!req.body.duration)
      return badRequestResponseWithDevMsg({ res, msg: 'Duration is required' });
    //if (!req.body.cadence_id)
    //return successResponse(res, `Cadence_id not provided to stop cadence`);

    // Checking lead is assigned to the user
    if (lead.user_id !== req.user.user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'This lead is not assigned to you',
      });

    if (lead.user_id !== req.body.user_id) {
      const [{ access_token, instance_url }, errForTokenFetch] =
        await AccessTokenHelper.getAccessToken({
          integration_type: req.user.integration_type,
          user_id: req.user.user_id,
        });
      if (errForTokenFetch) {
        if (
          errForTokenFetch.toLowerCase().includes('kindly sign in') ||
          errForTokenFetch.toLowerCase().includes('kindly log in')
        ) {
          return badRequestResponseWithDevMsg({
            res,
            msg: errForTokenFetch,
            error: `Error while fetching access token: ${errForTokenFetch}`,
          });
        }
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Something went wrong, please try after some time or contact support.',
          error: `Error while fetching access token: ${errForTokenFetch}`,
        });
      }

      // * Check if integration is salesforce
      switch (user.integration_type) {
        case USER_INTEGRATION_TYPES.SALESFORCE_OWNER: {
          // reassign
          let data = {
            cadence_id: req.body.cadence_id,
            leads: [],
            contacts: [],
            reassignTasksForLeads: true,
            reassignTasksForContacts: true,
            reassignToForLeads: [],
            reassignToForContacts: [],
            contact_reassignment_rule:
              COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_ACCOUNT_AND_OTHER_CONTACTS,
          };

          if (lead.salesforce_lead_id) {
            data['leads'] = [lead];
            data['reassignToForLeads'] = [
              {
                user_id: req.body.user_id,
                count: 1,
              },
            ];
          }

          if (lead.salesforce_contact_id) {
            data['contacts'] = [lead];
            data['reassignToForContacts'] = [
              {
                user_id: req.body.user_id,
                count: 1,
              },
            ];
          }

          const [reassignData, err] = await LeadHelper.reassignLeads({
            ...data,
            access_token,
            instance_url,
          });
          if (err)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to create custom task',
              error: `Error while reassigning leads: ${err}`,
            });
          break;
        }
      }
    }

    let portal_id = '';
    if (user.integration_type === USER_INTEGRATION_TYPES.HUBSPOT_OWNER) {
      const [company, errForCompany] = await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY,
        query: { company_id: req.user.company_id },
      });
      if (errForCompany)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create custom task',
          error: `Error while fetching company: ${errForCompany}`,
        });
      if (!company)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to create custom task',
          error: 'No company found for the given lead id',
        });
      portal_id = company.integration_id;
    }

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: {
        cadence_id: req.body?.cadence_id || null,
      },
    });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create custom task',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    //if (!cadence) return notFoundResponse(res, 'Cadence not found');

    // Creating task
    const [task, errForTask] = await TaskRepository.createTask({
      ...req.body,
      name: TASK_NAMES_BY_TYPE[req.body.name],
      node_id: CUSTOM_TASK_NODE_ID[req.body.name],
      urgent_time: 0, // * since custom task have no use of start time
      cadence_id: req.body.cadence_id,
      user_id: req.body.user_id,
      event_id: null,
      // duration stored in minutes
      duration: req.body.duration ?? null,
      ...(req.body.reminder_time
        ? {
            metadata: {
              reminder_time: req.body.reminder_time,
              send_reminder_email: req.body.send_reminder_email,
              is_reminder_sent: 0,
            },
          }
        : {}),
    });
    if (errForTask)
      logger.error(`Error while creating custom task: `, errForTask);

    if (!errForTask)
      WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_YOU_CREATE_CUSTOM_TASK,
        lead_id: req.body.lead_id,
        cadence_id: req.body.cadence_id,
      });

    // * milli sec for
    const msForMinute = 1000 * 60 * 1;
    // unix time for next nearest minute
    const unixTimeStampForNextNearestMinute =
      Math.ceil(new Date().getTime() / msForMinute) * msForMinute;

    // if no error i.e. task is created,and it has start time in current minute, add it to daily tasks table since it is a custom task
    if (!errForTask && req.body.start_time < unixTimeStampForNextNearestMinute)
      await DailyTasksRepository.createDailyTask({
        user_id: req.body.user_id,
        task_id: task.task_id,
      });

    let customTaskName = req.body.event_name;

    if (Object.keys(CUSTOM_TASK_NODE_NAME).includes(req.body.name))
      customTaskName = CUSTOM_TASK_NODE_NAME[req.body.name];

    // create activity only if task is  being assigned to another salesperson
    if (cadence) {
      // Stop the particular cadence for the lead
      const [updatedLeadToCadence, errForUpate] =
        await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
          {
            lead_id: lead.lead_id,
            cadence_id: req.body.cadence_id,
          },
          { status: CADENCE_LEAD_STATUS.STOPPED }
        );

      const [activityFromTemplate, errForActivityFromTemplate] =
        ActivityHelper.getActivityFromTemplates({
          type: ACTIVITY_TYPE.STOP_CADENCE,
          sub_type: ACTIVITY_SUBTYPES.LEAD,
          variables: {
            cadence_name: cadence.name,
            first_name: req?.user?.first_name || null,
            last_name: req?.user?.last_name || null,
          },
          activity: {
            lead_id: lead.lead_id,
            incoming: null,
          },
        });

      const [sendingActivity, errForSendingActivity] =
        await ActivityHelper.activityCreation(
          activityFromTemplate,
          req.body.user_id
        );

      TaskHelper.recalculateDailyTasksForUsers([req.body.user_id]);
    }

    /*
    // Check if the cadence stop value is true
    if (req.body.action === CADENCE_LEAD_ACTIONS.STOP) {
      // Changing status to stopped for all cadences for the lead
      const [stopCadence, errForStopCadence] =
        await CadenceHelper.stopCadenceForLead(
          req.body.lead_id,
          req.body.status,
          req.body.reason,
          req.body.cadence_ids
        );
      if (errForStopCadence) return serverErrorResponse(res, errForStopCadence);

      return successResponse(
        res,
        'Created task and stopped all cadences successfully.',
        task
      );
    } else if (req.body.action === CADENCE_LEAD_ACTIONS.PAUSE) {
      const [pauseCadence, errForPauseCadence] =
        await CadenceHelper.pauseCadenceForLead(
          req.body.lead_id,
          req.body.cadence_ids,
          req.body.pause_for
        );
      if (errForPauseCadence)
        return serverErrorResponse(res, errForPauseCadence);
      return successResponse(
        res,
        'Created task and paused requested cadences successfully'
      );
    }
    */
    successResponse(
      res,
      'Created task and stopped cadence successfully.',
      task
    );
    let event_id;
    if (user.create_agendas_from_custom_task) {
      //using GRPC service to create calendar event
      const mail_integration_type = req.user.mail_integration_type;

      const MEET_TYPE = {
        [MAIL_INTEGRATION_TYPES.GOOGLE]: 'google',
        [MAIL_INTEGRATION_TYPES.OUTLOOK]: 'teamsForBusiness',
      };

      logger.info(
        `Creating ${mail_integration_type} calendar event through GRPC`
      );

      const duration = req.body.duration ?? null;
      const startTime = req.body.start_time;
      const endTime = startTime + duration * 60000;

      let [eventDescription, errForDescription] =
        TaskHelper.getCustomTaskDescription({
          lead,
          cadence,
          integration_type: req.user.integration_type,
          instance_url: req.body.instance_url || '',
          portal_id,
        });
      if (errForDescription)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create custom task',
          error: `Error while fetching custom task description: ${errForDescription}`,
        });

      const [data, createEventError] = await v2GrpcClients.calendar.createEvent(
        {
          integrationType: mail_integration_type,
          user_id: req.body.user_id,
          lead_id: req.body.lead_id,
          startTime,
          endTime,
          conferenceName: req.body.event_name,
          meetType: MEET_TYPE[mail_integration_type],
          ringoverMeetLink: null,
          eventDescription,
          addAttendees: false,
        }
      );

      if (createEventError) {
        logger.error(
          `Error in creation of ${mail_integration_type} calendar event through grpc: ${createEventError}`
        );
      }

      logger.info(
        `Creation of ${mail_integration_type} calendar event through grpc successful: ${data?.msg}`
      );

      if (data?.data) event_id = JSON.parse(data.data).id;
    }
    if (event_id) {
      const [updateTask, errAddingEventId] = await Repository.update({
        tableName: DB_TABLES.TASK,
        updateObject: {
          event_id,
        },
        query: {
          task_id: task.task_id,
        },
      });
      if (errAddingEventId)
        logger.error(`Error while adding event_id: ${errAddingEventId}`);
    }

    if (req.body.user_id != req.user.user_id) {
      // create custom task assigned to you activity
      let activity = {
        name: `Custom task : ${customTaskName}`,
        status: `Assigned by ${user.first_name} ${user.last_name}`,
        type: ACTIVITY_TYPE.CUSTOM_TASK_FOR_OTHER,
        lead_id: task.lead_id,
        task_id: task.task_id,
        incoming: null,
        event_id,
        node_id: task.node_id,
      };

      ActivityHelper.activityCreation(
        activity,
        req.body.user_id,
        task.start_time
      );
    } else {
      const [activityFromTemplate, errForActivityFromTemplate] =
        ActivityHelper.getActivityFromTemplates({
          type: ACTIVITY_TYPE.CUSTOM_TASK,
          variables: {
            custom_task_name: customTaskName,
          },
          activity: {
            lead_id: task.lead_id,
            task_id: task.task_id,
            incoming: null,
            event_id,
            node_id: task.node_id,
          },
        });

      ActivityHelper.activityCreation(
        activityFromTemplate,
        req.body.user_id,
        task.start_time
      );
    }
  } catch (err) {
    logger.error('Error while creating custom task: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating custom task: ${err.message}`,
    });
  }
};

const markAsComplete = async (req, res) => {
  try {
    const { id: task_id } = req.params;

    const { template_type, template_id, isFocus } = req.body;
    let { linkedin_message } = req.body;

    // * Retrieve required task
    const [requiredTask, errForRequiredTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: {
        task_id,
      },
      include: {
        [DB_TABLES.NODE]: {},
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'first_name', 'last_name'],
        },
      },
    });

    if (errForRequiredTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to mark task as complete`,
        error: `Error while fetching task: ${errForRequiredTask}`,
      });

    if (!requiredTask)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Selected task does not exist`,
        error: `No task found with task id:  ${task_id}`,
      });

    if (requiredTask.user_id !== req.user.user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `This task is not assigned to you`,
      });

    if (requiredTask.completed) {
      logger.info(
        `Received request to mark a task complete which is already completed.`,
        { user_id: req.user.user_id }
      );
      return badRequestResponseWithDevMsg({
        res,
        msg: `Task already marked complete`,
      });
    }

    // * Cannot complete task if skipped
    if (requiredTask.skipped || requiredTask.status === TASK_STATUSES.SKIPPED) {
      logger.info(
        `Received request to mark a task complete which has been skipped.`,
        { user_id: req.user.user_id }
      );
      return badRequestResponseWithDevMsg({
        res,
        msg: `Task has already been skipped`,
      });
    }

    if (requiredTask.status === TASK_STATUSES.SCHEDULED) {
      logger.info(`Received request to schedule an already scheduled task`, {
        user_id: req.user.user_id,
      });
      return badRequestResponseWithDevMsg({
        res,
        msg: `Email is already scheduled at ${requiredTask.start_time}`,
      });
    }

    // * Schedule task
    if (
      isFocus &&
      [NODE_TYPES.MAIL, NODE_TYPES.REPLY_TO].includes(requiredTask.Node.type)
    ) {
      let user = requiredTask.User;

      // * Get automated delay settings
      const [setting, errForSetting] = await UserHelper.getSettingsForUser({
        user_id: user.user_id,
        setting_type: SETTING_TYPES.AUTOMATED_TASK_SETTINGS,
      });
      if (errForSetting)
        return serverErrorResponseWithDevMsg({ res, error: errForSetting });

      let automatedSetting = setting.Automated_Task_Setting;

      // * Check if daily limit reached or not
      const [dailyLimitReached, errForDailyLimitReached] =
        await UserHelper.checkIfDailyLimitReachedForEmail(
          user,
          null,
          automatedSetting
        );
      // * If reached, don't add it to queue
      if (
        errForDailyLimitReached ===
        `Automated mail count per day exceeded for user ${user?.first_name} ${user?.last_name}.`
      )
        return badRequestResponseWithDevMsg({
          res,
          msg: `Mail limit exceeded for today.`,
        });

      // * Put a wait time depending on email settings for company of sales person
      // * Get delay from email setting
      let waitTime = AutomatedSettingsHelper.getDelay(automatedSetting); // * in secs
      waitTime = waitTime * 1000; // * convert into ms

      logger.info(`Wait time: ${waitTime}`, { user_id: req.user.user_id });

      let [lastMailScheduled, errForLastMailScheduled] =
        await Repository.fetchOne({
          tableName: DB_TABLES.AUTOMATED_TASKS,
          query: {
            [Op.or]: [
              { user_id: requiredTask.user_id, added: 0, completed: 0 },
              { user_id: requiredTask.user_id, added: 1, completed: 0 },
              { user_id: requiredTask.user_id, added: 1, completed: 1 },
            ],
          },
          include: {
            [DB_TABLES.TASK]: {
              required: true,
              where: {
                name: {
                  [Op.in]: [
                    TASK_NAMES_BY_TYPE[NODE_TYPES.AUTOMATED_MAIL],
                    TASK_NAMES_BY_TYPE[NODE_TYPES.MAIL],
                    TASK_NAMES_BY_TYPE[NODE_TYPES.REPLY_TO],
                    TASK_NAMES_BY_TYPE[NODE_TYPES.AUTOMATED_REPLY_TO],
                  ],
                },
              },
              extras: { attributes: ['task_id'] },
            },
          },
          extras: {
            limit: 1,
            order: [['start_time', 'desc']],
            attributes: ['start_time', 'at_id'],
          },
        });
      lastMailScheduled = lastMailScheduled?.start_time;

      // * Convert it to int, since it will be used in addition
      lastMailScheduled = parseInt(lastMailScheduled);

      const currentTime = new Date().getTime();
      let timestamp = 0;

      // * If last mail scheduled was found for user

      if (lastMailScheduled) {
        // * If that time + waitTime is greater then currentTime than set the addition as timestamp
        // * If it is less than currentTime then set currentTime as timestamp
        if (lastMailScheduled + waitTime > currentTime)
          timestamp = lastMailScheduled + waitTime;
        else timestamp = currentTime;
      } else timestamp = currentTime;

      logger.info(
        `Semi automated mail scheduled at ${new Date(timestamp).toLocaleString(
          'en-US',
          { timeZone: 'Asia/Kolkata' }
        )}`,
        { user_id: req.user.user_id }
      );

      requiredTask.metadata.scheduled_mail = req.body.mail;

      // * Update task to be scheduled
      Repository.update({
        tableName: DB_TABLES.TASK,
        query: { task_id },
        updateObject: {
          status: TASK_STATUSES.SCHEDULED,
          start_time: timestamp,
          metadata: requiredTask.metadata,
        },
      });

      // * Add task to automated_tasks
      Repository.create({
        tableName: DB_TABLES.AUTOMATED_TASKS,
        createObject: {
          task_id: requiredTask.task_id,
          user_id: user.user_id,
          start_time: timestamp,
        },
        // extras: { logging: console.log },
      });

      return successResponse(res, 'Email has been scheduled', {
        is_scheduled: true,
        scheduled_at: timestamp,
      });
    }

    // * mark the task as complete
    await TaskRepository.updateTask(
      { task_id },
      {
        completed: true,
        complete_time: new Date().getTime(),
        status: TASK_STATUSES.COMPLETED,
      }
    );

    logger.info(`Task marked as complete.`);

    if (!requiredTask.node_id && !requiredTask.cadence_id) {
      logger.info(`Custom task marked as complete.`);
      return successResponse(res, `Custom task marked as complete.`);
    }

    SocketHelper.sendUpdateCompleteTask({
      user_id: requiredTask.user_id,
      taskCount: 1,
    });

    // * Fetch required lead
    const [requiredLead, errForRequiredLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id: requiredTask.lead_id },
    });

    // * fetch current node for task
    const [currentNode, errForCurrentNode] = await Repository.fetchOne({
      tableName: DB_TABLES.NODE,
      query: { node_id: requiredTask.node_id },
    });
    if (errForCurrentNode)
      return badRequestResponseWithDevMsg({
        res,
        msg: `No node found linked with given task.`,
      });

    // * If task belongs to LINKEDIN node, then create activity for it as it is a manual task
    if (
      [
        NODE_TYPES.LINKEDIN_CONNECTION,
        NODE_TYPES.LINKEDIN_INTERACT,
        NODE_TYPES.LINKEDIN_MESSAGE,
        NODE_TYPES.LINKEDIN_PROFILE,
      ].includes(currentNode?.type)
    ) {
      let linkedinActivityType;
      switch (currentNode?.type) {
        case NODE_TYPES.LINKEDIN_CONNECTION: {
          linkedinActivityType = ACTIVITY_TYPE.LINKEDIN_CONNECTION;
          break;
        }
        case NODE_TYPES.LINKEDIN_INTERACT: {
          linkedinActivityType = ACTIVITY_TYPE.LINKEDIN_INTERACT;
          break;
        }
        case NODE_TYPES.LINKEDIN_MESSAGE: {
          linkedinActivityType = ACTIVITY_TYPE.LINKEDIN_MESSAGE;
          break;
        }
        case NODE_TYPES.LINKEDIN_PROFILE: {
          linkedinActivityType = ACTIVITY_TYPE.LINKEDIN_PROFILE;
          break;
        }
      }

      // * create activity for linkedin node
      let [activity, errForActivity] =
        await ActivityHelper.createLinkedinActivity({
          lead: requiredLead,
          cadence_id: requiredTask.cadence_id,
          type: linkedinActivityType,
          node_id: currentNode.node_id,
          status: linkedin_message ?? '',
        });
      if (errForActivity)
        logger.error(`Error while creating activity:`, errForActivity);

      if (activity) {
        logger.info('Created activity' + JSON.stringify(activity, null, 4));
        logToIntegration.logLinkedInToIntegration({
          lead_id: requiredLead.lead_id,
          activity,
        });
      }
    } else if (currentNode?.type === ACTIVITY_TYPE.CADENCE_CUSTOM) {
      // * If task belongs to CUSTOM TASK node, then create activity for custom task completion
      let [activity, errForActivity] = ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.CADENCE_CUSTOM,
        sub_type: ACTIVITY_SUBTYPES.DEFAULT,
        activity: {
          lead_id: requiredLead.lead_id,
          incoming: null,
        },
      });

      await ActivityHelper.activityCreation(activity, requiredTask.user_id);
    } else if (currentNode?.type === ACTIVITY_TYPE.DATA_CHECK) {
      // * If task belongs to DATA CHECK node, then create activity for custom task completion
      let [activity, errForActivity] = ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.DATA_CHECK,
        sub_type: ACTIVITY_SUBTYPES.DEFAULT,
        activity: {
          lead_id: requiredLead.lead_id,
          incoming: null,
        },
      });

      await ActivityHelper.activityCreation(activity, requiredTask.user_id);
    } else if (currentNode?.type === ACTIVITY_TYPE.WHATSAPP) {
      let [currentNodeMessage] = await VariablesHelper.replaceVariablesForLead(
        currentNode?.data?.message,
        requiredTask.lead_id
      );

      // * create activity for whatsapp node
      let [activity, errForActivity] =
        await ActivityHelper.createWhatsappActivity({
          lead: requiredLead,
          cadence_id: requiredTask.cadence_id,
          type: ACTIVITY_TYPE.WHATSAPP,
          node_id: currentNode.node_id,
          message: currentNodeMessage,
        });
      if (errForActivity)
        logger.error(`Error while creating activity:`, errForActivity);

      if (activity) {
        logger.info('Created activity' + JSON.stringify(activity));
        logToIntegration.logWhatsappToIntegration({
          lead_id: requiredLead.lead_id,
          activity,
        });
      }
    }

    // *
    if (currentNode.is_first) {
      // * update first contact time
      await LeadRepository.updateContactTime(
        requiredTask.lead_id,
        requiredTask.user_id
      );
      WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_FIRST_MANUAL_TASK_IS_COMPLETED,
        cadence_id: requiredTask.cadence_id,
        lead_id: requiredTask.lead_id,
      });
    } else {
      // * if not first node, update only status to "ongoing"
      await Repository.update({
        tableName: DB_TABLES.LEAD,
        query: { lead_id: requiredTask.lead_id },
        updateObject: { status: LEAD_STATUS.ONGOING },
      });
    }

    // * Update Template Used type
    if (template_type && template_id) {
      if (template_type === TEMPLATE_TYPE.SMS) {
        await Repository.update({
          tableName: DB_TABLES.MESSAGE_TEMPLATE,
          updateObject: {
            used: sequelize.literal('used + 1'),
          },
          query: {
            mt_id: template_id,
          },
        });
      } else if (template_type === TEMPLATE_TYPE.LINKEDIN) {
        await Repository.update({
          tableName: DB_TABLES.LINKEDIN_TEMPLATE,
          updateObject: {
            used: sequelize.literal('used + 1'),
          },
          query: {
            lt_id: template_id,
          },
        });
      } else if (template_type === TEMPLATE_TYPE.SCRIPT) {
        await Repository.update({
          tableName: DB_TABLES.SCRIPT_TEMPLATE,
          updateObject: {
            used: sequelize.literal('used + 1'),
          },
          query: {
            st_id: template_id,
          },
        });
      } else if (template_type === TEMPLATE_TYPE.WHATSAPP) {
        await Repository.update({
          tableName: DB_TABLES.WHATSAPP_TEMPLATE,
          updateObject: {
            used: sequelize.literal('used + 1'),
          },
          query: {
            wt_id: template_id,
          },
        });
      }
    }

    // * If no next node present, end of process for this lead
    if (!currentNode.next_node_id) {
      const [currentCadence, errForCurrentCadence] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: currentNode.cadence_id },
      });
      await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
        {
          lead_id: requiredTask.lead_id,
          cadence_id: currentNode.cadence_id,
        },
        {
          status: CADENCE_LEAD_STATUS.COMPLETED,
        }
      );

      let [activity, errForActivity] = ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.COMPLETED_CADENCE,
        sub_type: ACTIVITY_SUBTYPES.DEFAULT,
        variables: {
          cadence_name: currentCadence?.name,
        },
        activity: {
          lead_id: requiredTask.lead_id,
          incoming: null,
          node_id: currentNode.node_id,
        },
      });
      [activity, errForActivity] = await ActivityHelper.activityCreation(
        activity,
        requiredTask.user_id
      );
      if (activity) logger.info('Created activity');

      WorkflowHelper.applyWorkflow({
        trigger: WORKFLOW_TRIGGERS.WHEN_A_CADENCE_ENDS,
        lead_id: requiredTask.lead_id,
        cadence_id: requiredTask.cadence_id,
      });

      return successResponse(res, 'All Cadence steps completed for this lead.');
    }

    // * fetch next node
    const [nextNode, errForNextNode] = await Repository.fetchOne({
      tableName: DB_TABLES.NODE,
      query: { node_id: currentNode.next_node_id },
    });

    // * create task for next node
    const [taskCreated, errForTaskCreated] =
      await TaskHelper.createTasksForLeads({
        leads: [requiredLead],
        node: nextNode,
        cadence_id: requiredTask.cadence_id,
        firstTask: false,
      });

    // if there is no wait time and task is created then only recalculate task.
    // In case of delay it will be recalculated in cron.
    if (!nextNode.wait_time && taskCreated) {
      TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);
      return successResponse(
        res,
        'Marked task as complete and created next node.',
        {
          data: taskCreated?.[0]?.task_id
            ? { task_id: taskCreated[0].task_id }
            : {},
        } // if only one task created, return its task_id
      );
    }

    return successResponse(
      res,
      'Marked task as complete and created next node.'
    );
  } catch (err) {
    logger.error(`Error while marking task as complete:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while marking task as complete: ${err.message}`,
    });
  }
};
const getSkipTaskReasons = async (req, res) => {
  try {
    const { task_id } = req.params;

    const [task, errForFetchTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: {
        task_id,
      },
      include: {
        [DB_TABLES.NODE]: {
          required: true,
        },
      },
    });
    if (errForFetchTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch skip task reasons',
        error: `Error while fetching task: ${errForFetchTask}`,
      });

    const [settings, errForSettings] = await UserHelper.getSettingsForUser({
      user_id: req.user.user_id,
      setting_type: SETTING_TYPES.SKIP_SETTINGS,
    });
    if (errForSettings) {
      logger.error(`Error while fetching skip settings: `, errForSettings);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch skip task reasons',
        error: `Error while fetching skip settings for user: ${errForSettings}`,
      });
    }

    if (!settings.Skip_Setting?.skip_allowed_tasks?.[task?.Node?.type])
      return forbiddenResponseWithDevMsg({ res, msg: `Skip task not allowed` });

    if (!settings.Skip_Setting.skip_reasons)
      return notFoundResponseWithDevMsg({ res, msg: `Skip reasons not found` });

    return successResponse(
      res,
      `Fetched skip settings successfully.`,
      settings.Skip_Setting.skip_reasons
    );
  } catch (err) {
    logger.error('Error while fetching skip reasons for user: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching skip task reasons: ${err.message}.`,
    });
  }
};
const getTaskById = async (req, res) => {
  try {
    const { id: task_id } = req.params;

    const [requiredTask, errForRequiredTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: {
        task_id,
      },
    });
    if (errForRequiredTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch task',
        error: `Error while fetching task: ${errForRequiredTask}`,
      });
    if (!requiredTask)
      return badRequestResponseWithDevMsg({
        res,
        msg: `No task found with task id: ${task_id}`,
      });
    if (requiredTask.user_id !== req.user.user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `This task is not assigned to you`,
      });

    return successResponse(
      res,
      `Fetched Task Successfully for user.`,
      requiredTask
    );
  } catch (err) {
    logger.error('Error while fetching task: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching task: ${err.message}.`,
    });
  }
};
const updateStartTime = async (req, res) => {
  try {
    const validation = taskSchema.updateCustomTaskSchema.validate(req.body);
    if (validation.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: validation.error.message,
      });

    const { id: task_id } = req.params;
    const { start_time } = req.body;

    const [requiredTask, errForRequiredTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: {
        task_id,
      },
    });
    if (errForRequiredTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update start time',
        error: `Error while fetching task: ${errForRequiredTask}`,
      });
    if (!requiredTask)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update start time',
        error: `No task found with task id: ${task_id}`,
      });
    if (requiredTask.user_id !== req.user.user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `This task is not assigned to you`,
      });
    if (!Object.values(CUSTOM_TASK_NODE_ID).includes(requiredTask.node_id)) {
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update start time',
        error: `Custom task must be of type ${Object.keys(
          CUSTOM_TASK_NODE_ID
        )} .`,
      });
    }
    let [updatedTask, updatedTaskErr] = await Repository.update({
      tableName: DB_TABLES.TASK,
      query: { task_id },
      updateObject: start_time,
    });
    if (updatedTaskErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update start time',
        error: `Error while updating task: ${errForRequiredTask}`,
      });
    return successResponse(res, `Successfully updated Task for user.`);
  } catch (err) {
    logger.error('Error while updating start time: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating start time: ${err.message}.`,
    });
  }
};
const updateCustomTask = async (req, res) => {
  try {
    const validation = taskSchema.updateCustomTaskSchema.validate(req.body);
    if (validation.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: validation.error.message,
      });

    const [task, errFetchingTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: {
        task_id: req.params.id,
      },
      include: {
        [DB_TABLES.LEAD]: {
          [DB_TABLES.ACCOUNT]: {},
        },
      },
    });
    if (errFetchingTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update task',
        error: `Error while fetching task: ${errUpdatingTask}`,
      });
    if (!task)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update task',
        error: 'Task not found',
      });
    if (task.user_id !== req.user.user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'This lead is not assigned to you',
      });

    let updateObject = {};
    if (req.body.name) {
      updateObject.name = TASK_NAMES_BY_TYPE[req.body.name];
      updateObject.node_id = CUSTOM_TASK_NODE_ID[req.body.name];
    }
    if (req.body.user_id) updateObject.user_id = req.body.user_id;
    if (req.body.start_time) updateObject.start_time = req.body.start_time;

    updateObject.metadata = {
      reminder_time: req.body.reminder_time,
      send_reminder_email: req.body.send_reminder_email,
    };

    const [isUpdated, errUpdatingTask] = await Repository.update({
      tableName: DB_TABLES.TASK,
      query: {
        task_id: req.params.id,
      },
      updateObject,
    });
    if (errUpdatingTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update task',
        error: `Error while updating custom task: ${errUpdatingTask}`,
      });

    const lead = task?.Lead;

    const [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.body.user_id || req.user.user_id,
      },
    });
    if (errFetchingUser) {
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating custom task: ${errFetchingUser}`,
      });
    }

    if (req.user.user_id != req.body.user_id) {
      const [{ access_token, instance_url }, errForTokenFetch] =
        await AccessTokenHelper.getAccessToken({
          integration_type: req.user.integration_type,
          user_id: req.user.user_id,
        });
      if (errForTokenFetch)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to update task',
          error: `Error while fetching access token: ${errForTokenFetch}`,
        });

      let portal_id = '';
      // * Check if integration is salesforce
      switch (user.integration_type) {
        case USER_INTEGRATION_TYPES.SALESFORCE_OWNER: {
          // reassign
          let data = {
            cadence_id: task.cadence_id,
            leads: [],
            contacts: [],
            reassignTasksForLeads: true,
            reassignTasksForContacts: true,
            reassignToForLeads: [],
            reassignToForContacts: [],
            contact_reassignment_rule:
              COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_ACCOUNT_AND_OTHER_CONTACTS,
          };

          if (lead.salesforce_lead_id) {
            data['leads'] = [lead];
            data['reassignToForLeads'] = [
              {
                user_id: req.body.user_id,
                count: 1,
              },
            ];
          }

          if (lead.salesforce_contact_id) {
            data['contacts'] = [lead];
            data['reassignToForContacts'] = [
              {
                user_id: req.body.user_id,
                count: 1,
              },
            ];
          }

          const [reassignData, err] = await LeadHelper.reassignLeads({
            ...data,
            access_token,
            instance_url,
          });
          if (err)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to create custom task',
              error: `Error while reassigning leads: ${err}`,
            });
          break;
        }
        case USER_INTEGRATION_TYPES.HUBSPOT_OWNER: {
          const [company, errForCompany] = await Repository.fetchOne({
            tableName: DB_TABLES.COMPANY,
            query: { company_id: user.company_id },
          });
          if (errForCompany)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to create custom task',
              error: `Error while fetching company: ${errForCompany}`,
            });
          if (!company)
            return notFoundResponseWithDevMsg({
              res,
              msg: 'Failed to create custom task',
              error: 'No company found for the given lead id',
            });
          portal_id = company.integration_id;
        }
      }
    }

    if (user.create_agendas_from_custom_task && req.body.event_id) {
      const mail_integration_type = user.mail_integration_type;

      logger.info(
        `Updating ${mail_integration_type} calendar event through GRPC`
      );
      const startTime = req.body.start_time;
      const endTime = req.body.duration
        ? startTime + req.body.duration * 60000
        : null;

      let from_user_id = null,
        to_user_id = req.user.user_id;
      if (req.body.user_id != req.user.user_id) {
        from_user_id = req.user.user_id;
        to_user_id = req.body.user_id;
      }
      const [data, updateEventError] = await v2GrpcClients.calendar.updateEvent(
        {
          startTime,
          endTime,
          conferenceName: req.body.event_name,
          from_user_id,
          to_user_id,
          eventId: req.body.event_id,
        }
      );
      if (updateEventError) {
        logger.error(
          `Error in updating  calendar event through grpc: `,
          updateEventError
        );
      }

      logger.info(
        `Updated calendar event through grpc successfully`,
        data?.msg
      );
    }
    return successResponse(res, 'Custom Task updated successfully');
  } catch (err) {
    logger.error('Error while updating custom task:', err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Failed to update task',
      error: `Error while updating custom task: ${err.message}`,
    });
  }
};

const getCustomTask = async (req, res) => {
  try {
    const validation = taskSchema.getCustomTaskSchema.validate(req.params);
    if (validation.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: validation.error.message,
      });

    const { task_id, event_id } = req.params;

    const [task, errFetchingTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: { task_id },
    });
    if (errFetchingTask)
      return serverErrorResponseWithDevMsg({ res, error: errFetchingTask });
    if (!task)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch custom task',
        error: 'Task not found',
      });

    let responseObj = {
      task_id: task.task_id,
      name: Object.keys(CUSTOM_TASK_NODE_ID).find(
        (key) => CUSTOM_TASK_NODE_ID[key] == task.node_id
      ),
      start_time: task.start_time,
      lead_id: task.lead_id,
      user_id: task.user_id,
      reminder_time: task.metadata.reminder_time,
      send_reminder_email: task.metadata.send_reminder_email,
    };
    if (event_id) {
      let [event, errFetchingEvent] = await v2GrpcClients.calendar.getEvent({
        eventId: event_id,
        user_id: req.user.user_id,
      });
      if (errFetchingEvent)
        return serverErrorResponseWithDevMsg({ res, error: errFetchingEvent });
      if (!event)
        return badRequestResponse(
          res,
          'No calendar event associated with this custom task'
        );

      event = JSON.parse(event?.data);
      const duration =
        (new Date(event?.end.dateTime).getTime() -
          new Date(event?.start.dateTime).getTime()) /
        60000;
      responseObj = {
        ...responseObj,
        event_id: event?.id,
        event_name: event?.summary,
        duration,
      };
    }
    return successResponse(res, 'task fetched successfully', responseObj);
  } catch (err) {
    logger.error('Error while fetching custom task:', err);
    return serverErrorResponseWithDevMsg({ res, error: err.message });
  }
};

/**
 * mark task as complete for dummy leads
 * */
const markAsCompleteForDummyLeads = async (req, res) => {
  try {
    /*
     * Step: mark task as complete
     * Step: create activity for completed task
     * Step: create next task
     *
     * */
    // Step: Joi validation
    const validation =
      taskSchema.taskCompletionForProductTourLeadsSchema.validate(req.body);
    if (validation.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: validation.error.message,
      });

    // Destructure variables
    const { task_id, from_number, to_number, subject, message } = req.body;
    const { user_id } = req.user;

    // Step: mark task as complete
    // fetch task
    const [task, errForTask] = await Repository.fetchOne({
      tableName: DB_TABLES.TASK,
      query: { task_id },
      include: {
        [DB_TABLES.LEAD]: {},
        [DB_TABLES.NODE]: {},
        [DB_TABLES.CADENCE]: {},
      },
    });
    if (errForTask)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while marking task as complete for dummy lead: ${errForTask}`,
      });
    if (!task)
      return badRequestResponseWithDevMsg({ res, msg: `No task found` });
    // task is not assigned to the calling user
    if (task.user_id !== user_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: `This task is not assigned to you`,
      });
    // task is already completed
    if (task.completed) {
      logger.info(
        `Received request to mark a task complete which is already completed.`,
        { user_id }
      );
      return badRequestResponseWithDevMsg({
        res,
        msg: `Task already marked complete`,
      });
    }
    // if already skipped, then dont allow to complete
    if (task.skipped || task.status === TASK_STATUSES.SKIPPED) {
      logger.info(
        `Received request to mark a task complete which has been skipped.`,
        { user_id }
      );
      return badRequestResponseWithDevMsg({
        res,
        msg: `Task has already been skipped`,
      });
    }
    // check for lead
    if (!task.Lead)
      return badRequestResponseWithDevMsg({
        res,
        error: `Lead not found`,
      });
    // check for node
    if (!task.Node)
      return badRequestResponseWithDevMsg({
        res,
        error: `Node not found`,
      });
    // check for cadence
    if (!task.Cadence)
      return badRequestResponseWithDevMsg({
        res,
        error: `Cadence not found`,
      });
    // update task to mark as completed
    const [data, err] = await Repository.update({
      tableName: DB_TABLES.TASK,
      query: { task_id },
      updateObject: {
        completed: 1,
        status: TASK_STATUSES.COMPLETED,
        complete_time: new Date().getTime(),
      },
    });

    SocketHelper.sendUpdateCompleteTask({
      user_id: task.user_id,
      taskCount: 1,
    });

    // Step: create activity for completed task
    // declare variables
    // Destructure lead and current node
    const { Lead: lead, Node: currentNode, Cadence: cadence } = task;
    let activityToPass = {
      sub_type: ACTIVITY_SUBTYPES.DEFAULT,
      lead_id: task?.lead_id,
    };
    let variablesToPass = {};

    // if activity to be create is of below types then get variables in message replaced by their values for activity
    if (
      [
        NODE_TYPES.LINKEDIN_MESSAGE,
        NODE_TYPES.LINKEDIN_PROFILE,
        NODE_TYPES.LINKEDIN_INTERACT,
        NODE_TYPES.LINKEDIN_CONNECTION,
        NODE_TYPES.WHATSAPP,
      ]?.includes(currentNode?.type)
    )
      var [currentNodeMessage] = await VariablesHelper.replaceVariablesForLead(
        message,
        task?.lead_id
      );

    // if activity to create is for linkedin, then use its helper
    if (
      [
        NODE_TYPES.LINKEDIN_MESSAGE,
        NODE_TYPES.LINKEDIN_PROFILE,
        NODE_TYPES.LINKEDIN_INTERACT,
        NODE_TYPES.LINKEDIN_CONNECTION,
      ]?.includes(currentNode?.type)
    ) {
      // * create activity for linkedin node
      let [activity, errForActivity] =
        await ActivityHelper.createLinkedinActivity({
          lead: task?.Lead,
          cadence_id: task.cadence_id,
          type: currentNode?.type,
          node_id: currentNode?.node_id,
          status: currentNodeMessage,
        });
      if (errForActivity)
        logger.error(`Error while creating activity:`, errForActivity);
      // for all other activity types, get activity from getActivityFromTemplates and create
    } else {
      switch (currentNode?.type) {
        case NODE_TYPES.CADENCE_CUSTOM:
          activityToPass = {
            ...activityToPass,
            type: ACTIVITY_TYPE.CADENCE_CUSTOM,
            incoming: null,
            lead_id: task?.lead_id,
          };
          break;
        case NODE_TYPES.DATA_CHECK:
          activityToPass = {
            ...activityToPass,
            type: ACTIVITY_TYPE.DATA_CHECK,
            incoming: null,
            lead_id: task?.lead_id,
          };
          break;
        case NODE_TYPES.WHATSAPP:
          activityToPass = {
            ...activityToPass,
            type: ACTIVITY_TYPE.WHATSAPP,
            incoming: null,
            message: currentNodeMessage,
            lead_id: task?.lead_id,
          };
          variablesToPass = {
            lead_first_name: task?.Lead?.first_name,
            lead_last_name: task?.Lead?.last_name,
            message: currentNodeMessage ?? '',
          };
          break;
        case NODE_TYPES.CALL:
          activityToPass = {
            ...activityToPass,
            type: ACTIVITY_TYPE.CALL,
            cadence_id: task?.cadence_id,
            lead_id: task?.lead_id,
            from_number,
            to_number,
          };
          variablesToPass = {
            lead_first_name: task?.Lead?.first_name,
            lead_last_name: task?.Lead?.last_name,
          };
          break;
        case NODE_TYPES.MAIL:
          activityToPass = {
            ...activityToPass,
            sub_type: ACTIVITY_SUBTYPES.SENT,
            type: ACTIVITY_TYPE.MAIL,
            cadence_id: task?.cadence_id,
            lead_id: task?.lead_id,
            incoming: 0,
            node_id: task?.node_id,
          };
          variablesToPass = {
            lead_first_name: task?.Lead?.first_name,
            lead_last_name: task?.Lead?.last_name,
            mail_subject: subject ?? 'No Subject',
          };
          break;
        case NODE_TYPES.MESSAGE:
          activityToPass = {
            ...activityToPass,
            sub_type: ACTIVITY_SUBTYPES.SENT,
            type: ACTIVITY_TYPE.MESSAGE,
            cadence_id: task?.cadence_id,
            lead_id: task?.lead_id,
            incoming: 0,
            to_number,
            from_number,
            node_id: task?.node_id,
          };
          variablesToPass = {
            lead_first_name: task?.Lead?.first_name,
            lead_last_name: task?.Lead?.last_name,
            message,
          };
          break;
      }

      let [activity, errForActivity] = ActivityHelper.getActivityFromTemplates({
        type: activityToPass.type,
        sub_type: activityToPass.sub_type,
        variables: variablesToPass,
        activity: activityToPass,
      });
      [activity, errForActivity] = await ActivityHelper.activityCreation(
        activity,
        task?.user_id
      );
    }

    // Step: create next task
    // If no next node present, end of process for this lead
    if (!currentNode.next_node_id) {
      let [activity, errForActivity] = ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.COMPLETED_CADENCE,
        sub_type: ACTIVITY_SUBTYPES.DEFAULT,
        variables: {
          cadence_name: cadence?.name,
        },
        activity: {
          lead_id: task.lead_id,
          incoming: null,
          node_id: task.node_id,
        },
      });
      [activity, errForActivity] = await ActivityHelper.activityCreation(
        activity,
        task?.user_id
      );
      TaskHelper.recalculateDailyTasksForUsers([user_id]);
      return successResponse(res, 'All Cadence steps completed for this lead.');
    }
    // if logic reaches here then next node id is present, create next task
    // fetch next node
    const [nextNode, errForNextNode] = await Repository.fetchOne({
      tableName: DB_TABLES.NODE,
      query: { node_id: currentNode.next_node_id },
    });
    if (errForNextNode)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while marking task as complete for dummy lead: ${errForNextNode}`,
      });
    if (!nextNode)
      return badRequestResponseWithDevMsg({
        res,
        error: `Next node not found`,
      });
    // create task for next node
    let [taskCreated, errForTaskCreated] = await TaskHelper.createTasksForLeads(
      {
        leads: [lead],
        node: nextNode,
        cadence_id: task.cadence_id,
        firstTask: false,
      }
    );
    if (errForTaskCreated)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while marking task as complete for dummy lead: ${errForTaskCreated}`,
      });

    if (taskCreated) {
      taskCreated = JsonHelper.parse(taskCreated);
      const [dailyTasks, errForDailyTasks] = await Repository.create({
        tableName: DB_TABLES.DAILY_TASKS,
        createObject: {
          user_id: taskCreated?.[0]?.user_id,
          node_id: taskCreated?.[0]?.node_id,
          task_id: taskCreated?.[0]?.task_id,
        },
      });
      if (errForDailyTasks)
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while creating next task: ${errForDailyTasks}`,
        });
    }

    //TaskHelper.recalculateDailyTasksForUsers([user_id]);
    return successResponse(
      res,
      'Marked task as complete and created next node.',
      {
        data: taskCreated?.[0]?.task_id
          ? { task_id: taskCreated[0].task_id }
          : {},
      } // if only one task created, return its task_id
    );
  } catch (err) {
    logger.error(`Error while marking task as complete for dummy lead: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while marking task as complete for dummy lead: ${err.message}`,
    });
  }
};

const TaskController = {
  getTasks,
  getCountSummaryForTasksView,
  skipTask,
  createCustomTask,
  markAsComplete,
  getSkipTaskReasons,
  getTaskById,
  updateStartTime,
  updateCustomTask,
  getCustomTask,
  markAsCompleteForDummyLeads,
};

module.exports = TaskController;
