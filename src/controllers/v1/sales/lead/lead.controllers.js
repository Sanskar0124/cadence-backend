// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  serverErrorResponse,
  forbiddenResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  EMAIL_STATUS,
  ACTIVITY_TYPE,
  CADENCE_LEAD_STATUS,
  CADENCE_STATUS,
  LUSHA_KASPR_OPTIONS,
  INTEGRATION_TYPE,
  SETTING_TYPES,
  NODE_TYPES,
  WORKFLOW_TRIGGERS,
  NOTIFICATION_TYPES,
  CRM_INTEGRATIONS,
  LEAD_INTEGRATION_TYPES,
  LEAD_SCORE_RUBRIKS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const { sendNotification } = require('../../../../utils/socket');

// Packages
const { Op } = require('sequelize');

// Repositories
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const AgendaRepository = require('../../../../../../Cadence-Brain/src/repository/agenda.repository');
const StatusRepository = require('../../../../../../Cadence-Brain/src/repository/status.repository');
const LeadPhoneNumberRepository = require('../../../../../../Cadence-Brain/src/repository/lead-pn.repository');
const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');
const NodeRepository = require('../../../../../../Cadence-Brain/src/repository/node.repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const LeadEmailRepository = require('../../../../../../Cadence-Brain/src/repository/lead-em.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const ActivityRepository = require('../../../../../../Cadence-Brain/src/repository/activity.repository');
const EmailRepository = require('../../../../../../Cadence-Brain/src/repository/email.repository');
// Helpers and services
const phoneNumberHelper = require('../../../../../../Cadence-Brain/src/helper/phone-number');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const leadEmailHelper = require('../../../../../../Cadence-Brain/src/helper/email');
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const LushaService = require('../../../../../../Cadence-Brain/src/services/Lusha');
const KasprService = require('../../../../../../Cadence-Brain/src/services/Kaspr');
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');
const WorkflowHelper = require('../../../../../../Cadence-Brain/src/helper/workflow');
const SocketHelper = require('../../../../../../Cadence-Brain/src/helper/socket');
const NotificationHelper = require('../../../../../../Cadence-Brain/src/helper/notification');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const LeadScoreHelper = require('../../../../../../Cadence-Brain/src/helper/lead-score');

const moveLeadToTrash = async (req, res) => {
  try {
    // * fetch lead
    const [fetchedLead, _] = await LeadRepository.getLeadByQuery({
      lead_id: req.params.id,
    });

    // * see if lead is assigned to requesting user
    if (fetchedLead.user_id !== req.user.user_id)
      return forbiddenResponseWithDevMsg({
        res,
        msg: `This lead is not assigned to you`,
      });

    const lead = {
      lead_id: req.params.id,
      status: LEAD_STATUS.TRASH,
      status_update_timestamp: new Date(),
    };

    // * see if lead is already in trash
    if (fetchedLead.status !== LEAD_STATUS.TRASH) {
      // * update lead's status
      const [updatedLead, errForUpdatedLead] = await LeadRepository.updateLead(
        lead
      );

      if (errForUpdatedLead)
        return serverErrorResponse(
          res,
          `Error while moving lead to trash: ${errForUpdatedLead}.`
        );

      // * create a entry in status table
      await StatusRepository.createStatus({
        lead_id: req.params.id,
        status: LEAD_STATUS.TRASH,
        message: req.body.note,
      });
    } else return successResponse(res, `Lead is already in trash.`);

    //get user for lead
    const [userForLead, errForUserForLead] =
      await UserRepository.findUserByQuery({
        user_id: req.user.user_id,
      });

    if (errForUserForLead)
      logger.info(`Error while fetching user for lead: ${errForUserForLead}`);

    //get present date as per timezone
    const today = new Date().toLocaleDateString('en-GB', {
      timeZone: userForLead.timezone,
    });

    const [activityFromTemplate, errForActivityFromTemplate] =
      ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.LEAD_DISQUALIFIED,
        variables: {
          today,
        },
        activity: {
          lead_id: req.params.id,
          incoming: null,
        },
      });
    const [sendingActivity, errForSendingActivity] =
      await ActivityHelper.activityCreation(
        activityFromTemplate,
        req.user.user_id
      );

    if (errForSendingActivity) logger.error(errForSendingActivity);
    if (req.body.disqualifyFromSalesforce) {
      // Fetching salesforce token and instance url
      const [{ access_token, instance_url }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          user_id: req.user.user_id,
        });
      if (errForAccessToken === 'Please log in with salesforce')
        return successResponse(
          res,
          'Disqualified in the tool. Please log in with salesforce to disqualify there as well.'
        );

      const [salesforceTrash, salesforceErr] =
        await SalesforceService.DisqualifyLead(
          req.body.note,
          fetchedLead.salesforce_lead_id,
          access_token,
          instance_url
        );
      if (salesforceErr) logger.error(salesforceErr);
    }

    return successResponse(res, 'Moved to trash successfully.');
  } catch (err) {
    logger.error(err);
    return serverErrorResponse(res);
  }
};

const restoreFromTrash = async (req, res) => {
  try {
    const [status, errForStatus] = await StatusRepository.getRestoreStatus(
      req.params.id
    );
    if (errForStatus) {
      return serverErrorResponse(res, errForStatus);
    }
    if (!status) {
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected status does not exist',
      });
    }
    const [data, errForLead] = await LeadRepository.updateLead({
      lead_id: req.params.id,
      status: status.status,
    });
    if (errForLead) {
      return serverErrorResponse(res, 'Error while restoring lead from trash.');
    }
    console.log(status, data);
    await StatusRepository.createStatus({
      lead_id: req.params.id,
      status: status.status,
      message: 'Restored from trash.',
    });
    return successResponse(res, 'Successfully restored from trash.');
  } catch (err) {
    logger.error(err.message);
    return serverErrorResponse(res);
  }
};

const deleteLeadWithPhoneNumber = async (req, res) => {
  try {
    const { id } = req.params;

    const [deleteLead, errForDeleteLead] = await LeadHelper.deleteAllLeadInfo({
      leadIds: [id],
    });

    if (errForDeleteLead) return serverErrorResponse(res, errForDeleteLead);

    return successResponse(res, 'Deleted lead successfully');
  } catch (err) {
    logger.error(`Error while deleting lead: ${err.message}.`);
    return serverErrorResponse(res, err.message);
  }
};

const getSalesforceAccountInfo = async (req, res) => {
  try {
    const { id: salesforce_account_id } = req.params;
    if (salesforce_account_id === null || salesforce_account_id === undefined)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch account',
        error: 'Salesforce account id is incorrect',
      });

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        user_id: req.user.user_id,
        integration_type: req.user.integration_type,
      });
    if (errForAccessToken)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Kindly connect with Salesforce',
      });

    // Fetching account from salesforce
    const [account, errForAccount] =
      await SalesforceService.getAccountFromSalesforce(
        salesforce_account_id,
        access_token,
        instance_url
      );
    if (errForAccount === 'Account not found.')
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch account',
        error: `Error while fetching account from Salesforce: ${errForAccount}`,
      });
    else if (errForAccount)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch account',
        error: `Error while fetching account from salesforce: ${errForAccount}`,
      });

    // Fetching account topics from salesforce
    const [topics, errForTopics] = await SalesforceService.getAccountTopics(
      salesforce_account_id,
      access_token,
      instance_url
    );
    if (errForTopics)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch account',
        error: `Error while fetching account topics: ${errForTopics}`,
      });

    let decisionInfo = null;
    if (account.Decision_Maker__c)
      [decisionInfo, errForDecision] = await SalesforceService.getContactById(
        account.Decision_Maker__c,
        access_token,
        instance_url
      );

    const [contactsList, errForContactList] =
      await SalesforceService.getAllAccountLeads(
        salesforce_account_id,
        access_token,
        instance_url
      );

    return successResponse(res, 'Account fetch from salesforce successfully.', {
      topics,
      status: account.Techaccountstatutsalesloft__c,
      account,
      decisionInfo,
      contactsList,
    });
  } catch (err) {
    console.log(err);
    logger.error(
      `Error while fetching account from salesforce: ${err.message}.`
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching account from salesforce: ${err.message}`,
    });
  }
};

const getSalesforceLeadInfo = async (req, res) => {
  try {
    const { id: salesforce_lead_id } = req.params;
    if (salesforce_lead_id === null || salesforce_lead_id === undefined)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead',
        error: 'Salesforce lead id is incorrect',
      });

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        user_id: req.user.user_id,
        integration_type: req.user.integration_type,
      });
    if (errForAccessToken)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Kindly connect with Salesforce',
      });

    const [lead, err] = await SalesforceService.getLeadFromSalesforce(
      salesforce_lead_id,
      access_token,
      instance_url
    );
    if (err === 'Lead not found.')
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead',
        error: `Error while fetching lead from Salesforce`,
      });
    else if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead',
        error: `Error while fetching lead from salesforce: ${err}`,
      });
    if (!lead)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: 'Lead not found',
      });

    let possible_status = {
      Unqualified: 'Disqualified',
      ToContact: 'New',
      working: 'Working',
      Converted: 'Converted',
    };

    return successResponse(res, 'Lead fetch from salesforce successfully.', {
      status: possible_status[lead.Status],
      lead: lead,
    });
  } catch (err) {
    logger.error(`Error while fetching lead from salesforce: ${err.message}.`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead from salesforce: ${err.message}`,
    });
  }
};

const unsubscribeLead = async (req, res) => {
  try {
    /*
    Unsubscribe Lead
      // === NOT IMPLEMENTING FOR V1 ===
        - Fetch company settings for associated lead (LeadToCadence -> Lead -> User -> Company -> Company_Settings)
        - Check if user needs to be removed from all cadences (check if unsubscribe_from_all_cadences is true)
      // ======
      - Update all cadences where lead_id is same.
      - Check if current assigned task (which has not been completed is within the restriction. If restrcited -> Skip and create the next allowed task)
    */

    //* Extracting lead_cadence_id
    const { id } = req.params;
    const node_id = req.params.node ?? null;

    let [leadCadenceLink, errFetchingLeadCadenceLink] =
      await LeadToCadenceRepository.getLeadToCadenceLinkByQuery({
        lead_cadence_id: id,
      });

    if (errFetchingLeadCadenceLink)
      return serverErrorResponse(res, 'Error while fetching cadence link');

    let lead_id = leadCadenceLink[0].dataValues.lead_id;

    if (leadCadenceLink[0].dataValues.unsubscribed)
      return successResponse(res, 'Lead already unsubscribed');

    if (node_id) {
      await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
        {
          lead_id,
        },
        {
          unsubscribed: 1,
          unsubscribe_node_id: node_id,
        }
      );
      //Get Email and mark as unsubscribed

      const [leadEmail, _] = await EmailRepository.update(
        {
          lead_id: lead_id,
          node_id: node_id,
        },
        {
          unsubscribed: true,
        }
      );
    } else {
      await LeadToCadenceRepository.updateLeadToCadenceLinkByQuery(
        {
          lead_id,
        },
        {
          unsubscribed: 1,
        }
      );
    }

    // * Check current tasks related to lead
    let [tasks, errFetchingTasks] = await TaskRepository.getTasks({
      lead_id,
      completed: 0,
      is_skipped: 0,
    });

    if (errFetchingTasks)
      return serverErrorResponse(res, 'Error while fetching tasks');

    let taskIds = [];
    let tasksToSkip = [];

    // * Fetch lead for company settings
    let [lead, errForLead] = await LeadRepository.getLeadByQuery({ lead_id });

    if (errForLead)
      return serverErrorResponse(res, 'Error while fetching lead');

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: lead?.User?.Company?.integration_type,
        user_id: lead.user_id,
      });
    if (!errForAccessToken) {
      // * Update unsubscribe in salesforce
      switch (lead?.User?.Company?.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          if (lead.type === LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD)
            await SalesforceService.updateLead(
              lead.integration_id,
              {
                HasOptedOutOfEmail: true,
              },
              access_token,
              instance_url
            );
          else if (lead.type === LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT)
            await SalesforceService.updateContact(
              lead.integration_id,
              {
                HasOptedOutOfEmail: true,
              },
              access_token,
              instance_url
            );
          break;

        case CRM_INTEGRATIONS.PIPEDRIVE:
          break;

        default:
          break;
      }
    }

    const [notificationFromTemplate, errForNotificationFromTemplate] =
      NotificationHelper.getNotificationFromTemplate({
        type: NOTIFICATION_TYPES.UNSUBSCRIBED,
        variables: {
          lead_first_name: lead.first_name,
          lead_last_name: lead.last_name,
        },
        notification: {
          email: lead?.User?.email,
          lead_id: lead_id,
          lead_first_name: lead?.first_name,
          lead_last_name: lead?.last_name,
          user_id: lead?.user_id,
        },
      });

    // * Send socket event for unsubscribed mail
    SocketHelper.sendNotification(notificationFromTemplate);

    //get Cadence
    const [cadence, errForCadence] = await CadenceRepository.getCadence({
      cadence_id: leadCadenceLink[0].dataValues.cadence_id,
    });
    if (errForCadence)
      return serverErrorResponse(res, 'Error while fetching cadence');

    const [activityFromTemplate, errForActivityFromTemplate] =
      ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.UNSUBSCRIBE,
        variables: {
          lead_first_name: lead.first_name,
          lead_last_name: lead.last_name,
          cadence_name: cadence.name,
        },
        activity: {
          lead_id: lead_id,
          incoming: null,
          cadence_id: leadCadenceLink[0].dataValues.cadence_id,
          node_id: node_id,
        },
      });

    // Creating activity
    const [createdActivity, errForActivity] =
      await ActivityHelper.activityCreation(activityFromTemplate, lead.user_id);
    if (errForActivity) return serverErrorResponse(res, errForActivity);

    const [settings, errForSettings] = await UserHelper.getSettingsForUser({
      user_id: lead.user_id,
      setting_type: SETTING_TYPES.UNSUBSCRIBE_MAIL_SETTINGS,
    });

    const [currentNode, _] = await NodeRepository.getNode({
      node_id: node_id,
    });

    let unsubscribe_settings;

    if (currentNode.type == NODE_TYPES.AUTOMATED_MAIL)
      unsubscribe_settings =
        settings?.Unsubscribe_Mail_Setting?.automatic_unsubscribed_data;
    else
      unsubscribe_settings =
        settings?.Unsubscribe_Mail_Setting?.semi_automatic_unsubscribed_data;
    for (let task of tasks) {
      if (!unsubscribe_settings) break;
      else if (unsubscribe_settings[task?.Node?.type]) {
        tasksToSkip.push(task);
        taskIds.push(task.task_id);
      }
    }

    await TaskRepository.updateTasks(
      {
        task_id: {
          [Op.in]: taskIds,
        },
      },
      { is_skipped: true, skip_time: new Date().getTime() }
    );

    // * Generate next task
    for (let task of tasksToSkip) {
      const [nextNode, errForNextNode] = await NodeRepository.getNode({
        node_id: task.Node.next_node_id,
      });

      if (errForNextNode)
        return serverErrorResponse(res, 'Error while fetching node');

      if (nextNode)
        await TaskHelper.createTasksForLeads({
          leads: [lead],
          node: nextNode,
          cadence_id: task.cadence_id,
          firstTask: false,
        });
    }

    const [node, errForNode] = await NodeRepository.getNode({ node_id });

    WorkflowHelper.applyWorkflow({
      trigger: WORKFLOW_TRIGGERS.WHEN_PEOPLE_UNSUBSCRIBE,
      lead_id,
      cadence_id: node?.cadence_id,
    });
    TaskHelper.recalculateDailyTasksForUsers([lead.user_id]);

    TaskHelper.recalculateDailyTasksForUsers([lead.user_id]);

    // Score the lead
    const [leadScore, errForLeadScore] = await LeadScoreHelper.updateLeadScore({
      lead,
      rubrik: LEAD_SCORE_RUBRIKS.UNSUBSCRIBE,
      activity_id: createdActivity?.activity_id,
    });

    return successResponse(res, 'Lead unsubscribed successfully.');
  } catch (err) {
    logger.error(`Error while unsubscribing lead: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const LeadController = {
  moveLeadToTrash,
  restoreFromTrash,
  deleteLeadWithPhoneNumber,
  getSalesforceAccountInfo,
  getSalesforceLeadInfo,
  unsubscribeLead,
};

module.exports = LeadController;
