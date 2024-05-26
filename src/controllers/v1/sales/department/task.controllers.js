// Utils
const logger = require('../../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
  badRequestResponse,
  notFoundResponse,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  TASK_FILTERS,
  SORT_TYPES,
  ACTIVITY_TYPE,
  CADENCE_LEAD_ACTIONS,
  CUSTOM_TASK_NODE_ID,
  CADENCE_LEAD_STATUS,
  WORKFLOW_TRIGGERS,
  NODE_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const SocketHelper = require('../../../../utils/socket');

// Packages
const { customAlphabet } = require('nanoid');
const alphabet = '0123456789abcdefghijklmnopqrstuv';
const nanoid = customAlphabet(alphabet, 32);

// Repositories
const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');
const NodeRepository = require('../../../../../../Cadence-Brain/src/repository/node.repository');
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const UserTokenRepository = require('../../../../../../Cadence-Brain/src/repository/user-token.repository');
const AgendaRepository = require('../../../../../../Cadence-Brain/src/repository/agenda.repository');
const DailyTasksRepository = require('../../../../../../Cadence-Brain/src/repository/daily-tasks.repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');

// Helpers and services
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const calendarEvents = require('../../../../../../Cadence-Brain/src/services/Google/Calendar/lib/Events');
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const JsonHelper = require('../../../../../../Cadence-Brain/src/helper/json');
const WorkflowHelper = require('../../../../../../Cadence-Brain/src/helper/workflow');

const markAsComplete = async (req, res) => {
  try {
    const { id: task_id } = req.params;

    // * retreive requiredd task
    const [requiredTask, errForRequiredTask] = await TaskRepository.getTask({
      task_id,
    });

    if (errForRequiredTask)
      return serverErrorResponse(res, 'Cannot mark task as complete.');

    if (!requiredTask)
      return badRequestResponse(res, `No task found with ${task_id}.`);

    if (requiredTask.user_id !== req.user.user_id)
      return badRequestResponse(res, `This task is not assigned to you.`);

    if (requiredTask.completed) {
      logger.info(
        `Received request to mark a task complete which is already completed.`
      );
      return badRequestResponse(res, `Task already marked complete.`);
    }

    // * mark the task as complete
    await TaskRepository.updateTask(
      { task_id },
      { completed: true, complete_time: new Date().getTime() }
    );

    logger.info(`Task marked as complete.`);

    if (!requiredTask.node_id && !requiredTask.cadence_id) {
      logger.info(`Custom task marked as complete.`);
      return successResponse(res, `Custom task marked as complete.`);
    }

    SocketHelper.updateCompletedTasks({
      user_id: requiredTask.user_id,
      taskCount: 1,
    });

    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: requiredTask.user_id,
    });

    if (!errForUser) {
      SocketHelper.deleteTask(JSON.parse(JSON.stringify(user)), task_id);
      SocketHelper.updateLeaderboard(user, requiredTask);
    }

    // * fecth required lead
    const [requiredLead, errForRequiredLead] =
      await LeadRepository.getLeadByQuery({
        lead_id: requiredTask.lead_id,
      });

    // * fetch current node for task
    const [currentNode, errForCurrentNode] = await NodeRepository.getNode({
      node_id: requiredTask.node_id,
    });
    if (errForCurrentNode)
      return [null, `No node found linked with given task.`];

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
        });
      if (errForActivity)
        logger.error(`Error while creating activity:`, errForActivity);

      if (activity)
        logger.info('Created activity' + JSON.stringify(activity, null, 4));
    } else if (currentNode?.type === ACTIVITY_TYPE.CADENCE_CUSTOM) {
      // * If task belongs to CUSTOM TASK node, then create activity for custom task completion
      activity = {
        name: 'Completed custom task',
        status: '',
        type: ACTIVITY_TYPE.CADENCE_CUSTOM,
        lead_id: requiredLead.lead_id,
        incoming: null,
      };

      await ActivityHelper.activityCreation(activity, requiredTask.user_id);
    } else if (currentNode?.type === ACTIVITY_TYPE.DATA_CHECK) {
      // * If task belongs to DATA CHECK node, then create activity for custom task completion
      activity = {
        name: 'Completed data check',
        status: '',
        type: ACTIVITY_TYPE.DATA_CHECK,
        lead_id: requiredLead.lead_id,
        incoming: null,
      };

      await ActivityHelper.activityCreation(activity, requiredTask.user_id);
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
      await LeadRepository.updateLead({
        lead_id: requiredTask.lead_id,
        status: LEAD_STATUS.ONGOING,
      });
    }

    // * If no next node present, end of process for this lead
    if (!currentNode.next_node_id) {
      const [currentCadence, errForCurrentCadence] =
        await CadenceRepository.getCadence({
          cadence_id: currentNode.cadence_id,
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
      activity = {
        name: 'Cadence has been completed',
        status: `${currentCadence.name} has been completed.`,
        type: ACTIVITY_TYPE.COMPLETED_CADENCE,
        lead_id: requiredTask.lead_id,
        incoming: null,
        node_id: currentNode.node_id,
      };
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
    const [nextNode, errForNextNode] = await NodeRepository.getNode({
      node_id: currentNode.next_node_id,
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
    logger.error(`Error while marking task as complete: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const TaskController = {
  markAsComplete,
};

module.exports = TaskController;
