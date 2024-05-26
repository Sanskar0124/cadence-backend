// Utils
const logger = require('../../../utils/winston.js');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
} = require('../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  TASK_STATUSES,
  ACTIVITY_TYPE,
  TASK_NAME_FOR_DISPLAY,
  CUSTOM_TASK_NODE_ID,
  CADENCE_LEAD_STATUS,
  WORKFLOW_TRIGGERS,
} = require('../../../../../Cadence-Brain/src/utils/enums.js');

// Packages

// DB

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const LinkedinHelper = require('../../../../../Cadence-Brain/src/helper/linkedin');
const LinkedinService = require('../../../../../Cadence-Brain/src/services/Linkedin');
const ActivityHelper = require('../../../../../Cadence-Brain/src/helper/activity/index.js');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task/index.js');
const WorkflowHelper = require('../../../../../Cadence-Brain/src/helper/workflow/index.js');

// Joi
const nodeSchema = require('../../../joi/v2/sales/department/node.joi');

const sendLinkedinConnRequest = async (req, res) => {
  try {
    let body = nodeSchema.sendConnectionRequestSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    let { message, lead_id } = body;

    // fetch lead, user and user_token
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.USER]: {
          [DB_TABLES.USER_TOKEN]: {},
        },
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to send linkedin connection request',
        error: `Error while fetching lead: ${errForLead}`,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to send linkedin connection request',
        error: 'Lead not found',
      });

    if (!lead.linkedin_url)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Lead does not have a Linkedin url associated',
      });
    const linkedin_cookie = lead.User?.User_Token?.linkedin_cookie;
    if (!linkedin_cookie)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Please add your Linkedin cookie in your Profile settings',
      });

    const [, errForLinkedin] = await LinkedinHelper.sendConnectionRequest({
      linkedin_cookie,
      linkedin_url: lead.linkedin_url,
      message,
      lead_id: lead.lead_id,
    });
    if (errForLinkedin) {
      if (
        errForLinkedin ==
        'Your session cookie has expired. Please update the session cookie in your profile page.'
      ) {
        LinkedinHelper.removeLinkedInCookie({
          user_id: req.user.user_id,
        });
        return badRequestResponseWithDevMsg({
          res,
          msg: errForLinkedin,
        });
      }

      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to send linkedin connection request',
        error: `Error while sending connection request: ${errForLinkedin}`,
      });
    }

    return successResponse(res, 'Successfully sent connection request.');
  } catch (err) {
    logger.error('Error while sending connection request: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while sending linkedin connection request`,
    });
  }
};

const sendLinkedinMessage = async (req, res) => {
  try {
    let body = nodeSchema.sendLinkedinMessageSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    let { message, lead_id, task_id } = body;

    // fetch lead, user and user_token
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.USER]: {
          [DB_TABLES.USER_TOKEN]: {},
        },
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to send linkedin message',
        error: `Error while fetching lead: ${errForLead}`,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to send linkedin message',
        error: 'Lead not found.',
      });

    if (!lead.linkedin_url)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Lead does not have a Linkedin url associated',
      });
    const linkedin_cookie = lead.User?.User_Token?.linkedin_cookie;
    if (!linkedin_cookie)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Please add your Linkedin cookie in your Profile settings',
      });

    const [, errForLinkedin] = await LinkedinHelper.sendMessage({
      linkedin_cookie,
      linkedin_url: lead.linkedin_url,
      message,
      lead_id: lead.lead_id,
    });
    if (errForLinkedin) {
      if (
        errForLinkedin ===
        'Your session cookie has expired. Please update the session cookie in your profile page.'
      ) {
        LinkedinHelper.removeLinkedInCookie({
          user_id: req.user.user_id,
        });
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Your session cookie has expired. Please update the session cookie in your profile page.',
        });
      }
      if (errForLinkedin === 'Failed to fetch linkedin profile data.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch LinkedIn profile data',
        });

      if (!task_id)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to send LinkedIn message',
          error: `Error while sending LinkedIn message: ${errForLinkedin}`,
        });

      // * Fetch task - It must be incomplete
      const [task, errFetchingTask] = await Repository.fetchOne({
        tableName: DB_TABLES.TASK,
        query: {
          task_id,
          status: TASK_STATUSES.INCOMPLETE,
        },
        include: {
          [DB_TABLES.NODE]: {
            attributes: ['next_node_id'],
          },
        },
        extras: {
          attributes: [
            'task_id',
            'name',
            'lead_id',
            'cadence_id',
            'node_id',
            'user_id',
          ],
        },
      });
      if (errFetchingTask)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to send LinkedIn message',
          error: `Error fetching task: ${errFetchingTask}. Cannot send LinkedIn message : ${errForLinkedin}`,
        });
      if (!task)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to send LinkedIn message',
          error: `Task does not exist. Cannot send LinkedIn message : ${errForLinkedin}`,
        });

      // * Skip task
      await Repository.update({
        tableName: DB_TABLES.TASK,
        query: {
          task_id: task.task_id,
        },
        updateObject: {
          is_skipped: true,
          skip_time: new Date().getTime(),
          skip_reason: null,
          status: TASK_STATUSES.SKIPPED,
        },
      });

      // * Create activity for skipped task
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
      await ActivityHelper.activityCreation(activityFromTemplate, task.user_id);

      // * Generating next task
      const [nextNode, errForNextNode] = await Repository.fetchOne({
        tableName: DB_TABLES.NODE,
        query: { node_id: task.Node.next_node_id },
      });
      const [currentCadence, errForCurrentCadence] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: task.cadence_id },
        extras: {
          attributes: ['name'],
        },
      });

      if (nextNode) {
        const [taskCreated, errForTaskCreated] =
          await TaskHelper.createTasksForLeads({
            leads: [lead],
            node: nextNode,
            cadence_id: task.cadence_id,
            firstTask: false,
          });

        if (!nextNode.wait_time && taskCreated)
          TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);
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

      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to send LinkedIn message, task skipped.',
      });
    }
    return successResponse(res, 'Successfully sent Linkedin message.');
  } catch (err) {
    logger.error('Error while sending linkedin msg: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while sending linkedin message: ${err.message}`,
    });
  }
};

const viewLinkedinProfile = async (req, res) => {
  try {
    // fetch lead, user and user_token
    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        lead_id: req.params.lead_id,
      },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.USER]: {
          [DB_TABLES.USER_TOKEN]: {},
        },
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to view linkedin profile',
        error: `Error while fetching lead: ${errForLead}`,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to view linkedin profile',
        error: 'Lead not found',
      });
    if (!lead.linkedin_url)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Lead does not have a Linkedin url associated',
      });

    const linkedin_cookie = lead.User?.User_Token?.linkedin_cookie;
    if (!linkedin_cookie)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Please add your Linkedin cookie in your Profile settings',
      });

    const [headers, errForHeaders] = await LinkedinService.fetchHeaders(
      linkedin_cookie
    );
    if (errForHeaders) {
      if (
        errForHeaders === 'Maximum number of redirects exceeded' ||
        errForHeaders === 'Request failed with status code 999'
      )
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Your session cookie has expired. Please update the session cookie in your profile page',
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching headers: ${errForHeaders}`,
      });
    }
    //console.log(headers);
    //return successResponse(res);

    const [profileViewed, errForProfileViewed] =
      await LinkedinService.viewLinkedinProfile({
        linkedin_url: lead.linkedin_url,
        headers,
      });
    if (errForProfileViewed) {
      if (
        errForProfileViewed === 'Maximum number of redirects exceeded' ||
        errForProfileViewed === 'Request failed with status code 999'
      ) {
        LinkedinHelper.removeLinkedInCookie({
          user_id: req.user.user_id,
        });
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Your session cookie has expired. Please update the session cookie in your profile page',
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while viewing linkedin profile: ${errForProfileViewed}`,
      });
    }

    return successResponse(res, `Profile viewed`);
  } catch (err) {
    logger.error(`Error while viewing linkedin profile: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while viewing linkedin profile: ${err.message}`,
    });
  }
};

const LinkedinController = {
  sendLinkedinConnRequest,
  sendLinkedinMessage,
  viewLinkedinProfile,
};

module.exports = LinkedinController;
