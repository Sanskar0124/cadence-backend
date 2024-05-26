// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  ACTIVITY_TYPE,
  LEAD_STATUS,
  CRM_INTEGRATIONS,
  LEAD_INTEGRATION_TYPES,
  HIRING_INTEGRATIONS,
  SELLSY_ENDPOINTS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// DB
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const {
  createNoteActivity,
} = require('../../../../../../Cadence-Brain/src/grpc/v2/crm-integration');
const hiringIntegration = require('../../../../../../Cadence-Brain/src/grpc/v2/hiring-integration');

// Joi
const noteSchema = require('../../../../joi/v2/sales/lead/note.joi');

const createNote = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    let noteObject = req.body;

    const body = noteSchema.createNoteSchema.validate(noteObject);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id: req.body.lead_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id'],
          [DB_TABLES.COMPANY]: {
            attributes: ['company_id', 'integration_type'],
            [DB_TABLES.COMPANY_SETTINGS]: {
              //attributes: ['sf_activity_to_log'],
              attributes: ['activity_to_log'],
            },
          },
        },
      },
      extras: {
        attributes: [
          'first_name',
          'last_name',
          'salesforce_lead_id',
          'salesforce_contact_id',
          'integration_id',
          'integration_type',
        ],
      },
    });
    if (errForLead) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create note',
        error: `Error while fetching lead: ${errForLead}`,
      });
    }
    if (!lead) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: 'Lead not found',
      });
    }

    if (
      //lead?.User?.Company?.Company_Setting?.sf_activity_to_log?.NOTE?.enabled
      lead?.User?.Company?.Company_Setting?.activity_to_log?.NOTE?.enabled
    ) {
      let access_token = '',
        instance_url = '',
        errForAccessToken = '';
      switch (lead?.User?.Company?.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          [{ access_token, instance_url }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: CRM_INTEGRATIONS.SALESFORCE,
              user_id: lead?.User.user_id,
            });
          if (access_token && instance_url) {
            const [salesforce_note_id, salesforceErr] =
              await SalesforceService.Note.createSalesforceNote(
                req.body.note,
                req.body.title,
                lead.salesforce_lead_id ?? lead.salesforce_contact_id,
                access_token,
                instance_url
              );
            if (salesforce_note_id)
              noteObject.salesforce_note_id = salesforce_note_id;
          }
          break;
        case CRM_INTEGRATIONS.PIPEDRIVE:
          [{ access_token, instance_url }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
              user_id: lead?.User.user_id,
            });
          if (access_token === null || instance_url === null) {
            logger.error(
              '\nError while getting access token or instance url:\n',
              errForAccessToken
            );
            break;
          }
          const [pipedriveData, pipedriveDataError] = await createNoteActivity({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            integration_data: {
              access_token,
              instance_url,
              content: `<B>${req.body.title}</B><br>${req.body.note}`,
              person_id: lead.integration_id,
            },
          });
          if (pipedriveDataError)
            logger.error(
              `Error while creating pipedrive note: `,
              pipedriveDataError
            );
          break;
        case CRM_INTEGRATIONS.HUBSPOT:
          [{ access_token }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: CRM_INTEGRATIONS.HUBSPOT,
              user_id: lead?.User.user_id,
            });
          if (access_token === null) {
            logger.error(
              '\nError while getting access token or instance url:\n',
              errForAccessToken
            );
            break;
          }

          const [hubspotData, hubspotDataError] = await createNoteActivity({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            integration_data: {
              access_token,
              hs_timestamp: new Date(),
              hs_note_body: `<h4>${req.body.title}</h4>${req.body.note}`,
              hubspot_contact_id: lead.integration_id,
            },
          });
          if (hubspotDataError)
            logger.error(
              `Error while creating hubspot note: `,
              hubspotDataError
            );
          break;
        case CRM_INTEGRATIONS.ZOHO:
          [{ access_token, instance_url }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              user_id: lead?.User.user_id,
            });
          if (access_token === null || instance_url === null) {
            logger.error('\n Please sign in with zoho:\n', errForAccessToken);
            break;
          }
          const type =
            lead.integration_type === LEAD_INTEGRATION_TYPES.ZOHO_LEAD
              ? 'Leads'
              : 'Contacts';
          const content = {
            Note_Title: req.body.title,
            Note_Content: req.body.note,
            Parent_Id: lead.integration_id,
            se_module: type,
          };
          const [zohoData, zohoDataError] = await createNoteActivity({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            integration_data: {
              access_token,
              instance_url,
              content,
            },
          });
          if (zohoDataError)
            logger.error(`Error while creating zoho note: `, zohoDataError);
          break;
        case HIRING_INTEGRATIONS.BULLHORN:
          [{ access_token, instance_url }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              user_id: lead.User.user_id,
            });
          if (access_token === null || instance_url === null) {
            logger.error(
              '\n Please sign in with bullhorn:\n',
              errForAccessToken
            );
            break;
          }
          let bullhornContent = {};
          switch (lead.integration_type) {
            case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT:
              bullhornContent = {
                action: 'Other',
                comments: `Title: ${req.body.title}
Content: ${req.body.note}`,
                personReference: {
                  id: lead.integration_id,
                  _subtype: 'ClientContact',
                },
              };
              break;
            case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE:
              bullhornContent = {
                action: 'Other',
                comments: `Title: ${req.body.title}
Content: ${req.body.note}`,
                personReference: {
                  id: lead.integration_id,
                  _subtype: 'Candidate',
                },
              };
              break;
            case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD:
              bullhornContent = {
                action: 'Other',
                personReference: {
                  id: parseInt(lead.integration_id),
                  _subtype: 'Lead',
                },
                comments: `<b>Title :</b> ${req.body.title} <br>

<b>Content :</b> ${req.body.note}`,
              };
              break;
          }
          const [bullhornData, bullhornDataError] =
            await hiringIntegration.createNoteActivity({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                access_token,
                instance_url,
                bullhornContent,
              },
            });
          if (bullhornDataError) {
            logger.error(
              `Error while creating bullhorn note: `,
              bullhornDataError
            );
          }
          break;
        case CRM_INTEGRATIONS.SELLSY:
          [{ access_token }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: CRM_INTEGRATIONS.SELLSY,
              user_id: lead?.User.user_id,
            });
          if (errForAccessToken) {
            logger.error(
              '\nError while getting access token:\n',
              errForAccessToken
            );
            break;
          }

          const [sellsyData, sellsyDataError] = await createNoteActivity({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: {
              access_token,
              created: new Date(),
              description: req.body.note,
              related: [
                {
                  id: parseInt(lead.integration_id),
                  type: SELLSY_ENDPOINTS.CONTACT,
                },
              ],
            },
          });
          if (sellsyDataError)
            logger.error(
              `Error while creating note in Sellsy: ${sellsyDataError}`
            );
          break;
        case CRM_INTEGRATIONS.DYNAMICS:
          [{ access_token, instance_url }, errForAccessToken] =
            await AccessTokenHelper.getAccessToken({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              user_id: lead?.User.user_id,
            });
          if (access_token === null || instance_url === null) {
            logger.error(
              '\n Please sign in with dynamics:\n',
              errForAccessToken
            );
            break;
          }
          const dynamicsContent = {
            subject: req.body.title,
            notetext: req.body.note,
          };
          if (lead.integration_type === LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT)
            dynamicsContent[
              'objectid_contact@odata.bind'
            ] = `/contacts(${lead.integration_id})`;
          else
            dynamicsContent[
              'objectid_lead@odata.bind'
            ] = `/leads(${lead.integration_id})`;
          const [dynamicsData, dynamicsDataError] = await createNoteActivity({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            integration_data: {
              access_token,
              instance_url,
              content: dynamicsContent,
            },
          });
          if (dynamicsDataError)
            logger.error(
              `Error while creating dynamics note: `,
              dynamicsDataError
            );
          break;
        default:
          logger.error(`Bad integration type.`);
      }
    }

    const [createdNote, err] = await Repository.create({
      tableName: DB_TABLES.NOTE,
      createObject: noteObject,
      t,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create note',
        error: `Error while creating note: ${err}`,
      });
    }

    const [activityFromTemplate, errForActivityFromTemplate] =
      ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.NOTE,
        variables: {
          lead_first_name: lead.first_name,
          lead_last_name: lead.last_name,
          note: req.body.note,
          first_name: req.user.first_name,
          last_name: req.user.last_name,
        },
        activity: {
          lead_id: createdNote.lead_id,
          note_id: createdNote.note_id,
          user_id: req.user.user_id,
        },
      });

    // Creating activity
    const [createdActivity, errForActivity] =
      await ActivityHelper.activityCreation(
        activityFromTemplate,
        lead?.User?.user_id
      );
    if (errForActivity) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create note',
        error: `Error while creating activity: ${errForActivity}`,
      });
    }

    if (lead.status === LEAD_STATUS.NEW_LEAD)
      await Repository.update({
        tableName: DB_TABLES.LEAD,
        updateObject: { status: LEAD_STATUS.ONGOING },
        query: { lead_id: lead.lead_id },
        t,
      });

    t.commit();
    return successResponse(res, 'Note created succesfully.', createdNote);
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating note: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating note: ${err.message}`,
    });
  }
};

const fetchNote = async (req, res) => {
  try {
    const [note, err] = await Repository.fetchOne({
      tableName: DB_TABLES.NOTE,
      query: { note_id: req.params.id },
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch note',
        error: `Error while fetching note: ${err}`,
      });
    if (note === null)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch note',
        error: 'No note found',
      });

    return successResponse(res, 'Note fetched succesfully.', note);
  } catch (err) {
    logger.error(`Error while fetching note: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching note: ${err.message}`,
    });
  }
};

const NoteController = {
  createNote,
  fetchNote,
};

module.exports = NoteController;
