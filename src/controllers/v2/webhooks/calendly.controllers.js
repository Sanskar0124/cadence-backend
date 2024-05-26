// Utils
const logger = require('../../../utils/winston.js');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

//Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const CalendlyHelper = require('../../../../../Cadence-Brain/src/helper/calendly');
const LeadScoreHelper = require('../../../../../Cadence-Brain/src/helper/lead-score/');
const ActivityHelper = require('../../../../../Cadence-Brain/src/helper/activity');
const WorkflowHelper = require('../../../../../Cadence-Brain/src/helper/workflow');
// DB
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Packages
const axios = require('axios');
const {
  LEAD_SCORE_RUBRIKS,
  ACTIVITY_TYPE,
  WORKFLOW_TRIGGERS,
} = require('../../../../../Cadence-Brain/src/utils/enums.js');

const updateEvent = async (req, res) => {
  try {
    const {
      email,
      event,
      reschedule_url,
      rescheduled,
      uri,
      timezone,
      new_invitee,
    } = req.body.payload;
    let { payload } = req.body;
    const { created_by } = req.body;
    const [calendlyUserId, _] = CryptoHelper.encrypt(created_by.slice(31));
    let str = '';
    let integration_id = event.slice(42);

    // Checking if user exists
    const [userExists, errUserExists] = await Repository.fetchOne({
      tableName: DB_TABLES.USER_TOKEN,
      query: {
        encrypted_calendly_user_id: calendlyUserId,
      },
    });
    if (errUserExists)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update event',
        error: `Error while fetching user token: ${errUserExists}`,
      });
    if (!userExists) str += ' User not exist in our tool';

    // Checking if email id exists in lead
    const [isMailExistsInLead, errisMailExistsInLead] =
      await Repository.fetchOne({
        tableName: DB_TABLES.LEAD_EMAIL,
        query: {
          email_id: email,
        },
        include: {
          [DB_TABLES.LEAD]: {
            where: {
              user_id: userExists.user_id,
            },
            required: true,
          },
        },
      });
    if (errisMailExistsInLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update event',
        error: `Error while fetching lead email: ${errisMailExistsInLead}`,
      });
    if (!isMailExistsInLead) {
      str += 'Mail id is not from leads ';
    }

    const [accessToken, errForAccessToken] =
      await CalendlyHelper.GetAccessToken(userExists.user_id);
    if (errForAccessToken)
      logger.error(
        'Error while fetching access token for calendly: ',
        errForAccessToken
      );

    const eventDetails = await axios.get(
      `https://api.calendly.com/scheduled_events/${event.slice(42)}`,
      {
        headers: {
          Authorization: 'Bearer ' + accessToken,
        },
      }
    );

    if (isMailExistsInLead && userExists) {
      const [leadsDetails, errforLeadDetails] = await Repository.fetchAll({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: {
          lead_id: isMailExistsInLead.Lead.lead_id,
        },
        include: {
          [DB_TABLES.LEAD]: {
            attributes: ['first_name'],
          },
        },
      });
      const leadDetails = leadsDetails?.[0];
      // * Fetch latest task for lead
      const [task, errForTask] = await Repository.fetchOne({
        tableName: DB_TABLES.TASK,
        query: {
          lead_id: leadDetails.lead_id,
          cadence_id: leadDetails.cadence_id,
          completed: false,
          is_skipped: false,
        },
      });
      if (errForTask)
        logger.error(`Error while fetching latest task: `, errForTask);

      const [fetchExistingDemo, errForFetchingExistingDemo] =
        await Repository.fetchOne({
          tableName: DB_TABLES.DEMO,
          query: {
            lead_id: leadDetails.lead_id,
            cadence_id: leadDetails.cadence_id,
          },
        });
      if (errForFetchingExistingDemo) {
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update event',
          error: `Error while fetching demo: ${errForCreatingDemo}`,
        });
      }

      if (fetchExistingDemo) {
        const [deleteExistingDemo, errForDeletingExistingDemo] =
          await Repository.destroy({
            tableName: DB_TABLES.DEMO,
            query: {
              demo_id: fetchExistingDemo.demo_id,
            },
          });
      }

      // Creating Demo Object
      const demoData = {
        lead_id: leadDetails.lead_id,
        lem_id: isMailExistsInLead.lem_id,
        cadence_id: leadDetails.cadence_id,
        node_id: task?.node_id || null,
        meeting_url: uri,
        schedule_time: eventDetails.data.resource.start_time,
        integration_id: integration_id,
        timezone: timezone,
      };
      const [createdDemo, errForCreatingDemo] = await Repository.create({
        tableName: DB_TABLES.DEMO,
        createObject: demoData,
      });
      if (errForCreatingDemo) {
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update event',
          error: `Error while creating demo: ${errForCreatingDemo}`,
        });
      }
      const [activityFromTemplate, errForActivityFromTemplate] =
        ActivityHelper.getActivityFromTemplates({
          type: ACTIVITY_TYPE.MEETING,
          variables: {
            lead_first_name: leadDetails.Leads?.[0].first_name,
            scheduled_at: new Date(demoData.schedule_time).getTime(),
          },
          activity: {
            lead_id: leadDetails.lead_id,
            user_id: userExists.user_id,
            incoming: null,
          },
        });
      const [createdActivity, errForCreatedActivity] =
        await ActivityHelper.activityCreation(
          activityFromTemplate,
          userExists.user_id
        );

      for (const leadCadence of leadsDetails) {
        await WorkflowHelper.applyWorkflow({
          trigger: WORKFLOW_TRIGGERS.WHEN_A_DEMO_IS_BOOKED_VIA_CALENDLY,
          cadence_id: leadCadence.cadence_id,
          lead_id: leadCadence.lead_id,
        });
      }
      //Score the lead if there is a new demo
      if (!fetchExistingDemo) {
        let [leadScore, errForLeadScore] =
          await LeadScoreHelper.updateLeadScore({
            lead: isMailExistsInLead?.Lead,
            rubrik: LEAD_SCORE_RUBRIKS.DEMO_BOOKED,
            activity_id: createdActivity?.activity_id,
          });
        if (errForLeadScore)
          logger.error(
            `An error occured while scoring lead for demo booking: ${errForLeadScore}`
          );
      }
    } else logger.info(str);
    return successResponse(res, 'Calendly Events Updated Successfully');
  } catch (err) {
    logger.error('Error while updating calendly events: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating calendly events: ${err.message}`,
    });
  }
};

const fetchCalendlyEventsTypes = async (req, res) => {
  try {
    const { user_id } = req.user;

    const [accessToken, errForAccessToken] =
      await CalendlyHelper.GetAccessToken(user_id);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch calendly events',
        error: `Error while fetching calendly access token: ${errForAccessToken}`,
      });

    const resp = await axios.get('https://api.calendly.com/users/me', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
      },
    });

    let calendlyUser = resp.data.resource.uri;

    const { data } = await axios.get(
      `https://api.calendly.com/event_types?user=${calendlyUser}`,
      {
        headers: {
          Authorization: 'Bearer ' + accessToken,
        },
      }
    );

    return successResponse(
      res,
      'Calendly Events Type Fetched Successfully',
      data
    );
  } catch (err) {
    logger.error('Error while fetching calendly events: ', err);
    if (err?.response?.data?.message)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching calendly events: ${err?.response?.data?.message}`,
      });
    if (err?.response?.data?.error)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching calendly events: ${err?.response?.data?.error}`,
      });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching calendly events: ${err.message}`,
    });
  }
};

const setCalendlySchedulingUrl = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { calendly_url } = req.body;
    if (!calendly_url)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please specify calendly_url',
      });

    const [updateUserCalendlyLink, errForupdateUserCalendlyLink] =
      await Repository.update({
        tableName: DB_TABLES.USER,
        query: { user_id },
        updateObject: {
          calendly_url: calendly_url,
        },
      });
    if (errForupdateUserCalendlyLink)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update calendly url',
        error: `Error while updating calendly url:  ${errForupdateUserCalendlyLink}`,
      });

    return successResponse(res, 'Calendly Url set Successfully');
  } catch (err) {
    logger.error('Error while updating calendly url: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating calendly url: ${err.message}`,
    });
  }
};

const CalendlyController = {
  updateEvent,
  fetchCalendlyEventsTypes,
  setCalendlySchedulingUrl,
};

module.exports = CalendlyController;
