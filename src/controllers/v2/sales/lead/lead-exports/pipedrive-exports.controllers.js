// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../../utils/response');
const {
  CRM_INTEGRATIONS,
  ACCOUNT_SIZE,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../../Cadence-Brain/src/utils/modelEnums');

// DB
const {
  sequelize,
} = require('../../../../../../../Cadence-Brain/src/db/models');

// Repositories
const LeadRepository = require('../../../../../../../Cadence-Brain/src/repository/lead.repository');
const Repository = require('../../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const PipedriveService = require('../../../../../../../Cadence-Brain/src/services/Pipedrive');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../../../Cadence-Brain/src/helper/email');
const ActivityHelper = require('../../../../../../../Cadence-Brain/src/helper/activity');

// Joi
const pipedriveExportSchema = require('../../../../../joi/v2/sales/lead/lead-exports/pipedrive-exports.joi');

const previewPerson = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetch pipedrive field map
    const pipedriveFieldMapPromise =
      CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });

    // * Fetching the lead with emails and phone_numbers with lead_id
    const leadFetchPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.LEAD_PHONE_NUMBER]: {},
        [DB_TABLES.LEAD_EMAIL]: {},
      },
    });

    const [[pipedriveFieldMap, errFetchingPipedriveFieldMap], [lead, leadErr]] =
      await Promise.all([pipedriveFieldMapPromise, leadFetchPromise]);
    if (errFetchingPipedriveFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingPipedriveFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    const pipedrivePersonMap = pipedriveFieldMap.person_map;
    const pipedriveOrganizationMap = pipedriveFieldMap.organization_map;
    if (!pipedrivePersonMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for pipedrive person',
      });
    if (!pipedriveOrganizationMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for pipedrive organization',
      });

    // *  Obtaining Person fields
    let personFields = [];
    if (pipedrivePersonMap.first_name)
      personFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedrivePersonMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (pipedrivePersonMap.last_name)
      personFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedrivePersonMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (pipedrivePersonMap.job_position)
      personFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedrivePersonMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (pipedrivePersonMap.linkedin_url)
      personFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedrivePersonMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    lead.Lead_emails?.forEach((lead_email) => {
      emails.push({
        editable: true,
        input_type: 'string',
        integration_label: `${lead_email.type} email`,
        value: lead_email.email_id,
        name: lead_email.type,
        type: 'input_box',
      });
    });

    // * Phone numbers
    let phone_numbers = [];
    lead.Lead_phone_numbers?.forEach((lead_phone) => {
      phone_numbers.push({
        editable: true,
        input_type: 'string',
        integration_label: `${lead_phone.type} phone`,
        value: lead_phone.phone_number,
        name: lead_phone.type,
        type: 'input_box',
      });
    });

    // *  Obtaining Account fields
    let organizationFields = [];
    if (pipedriveOrganizationMap.name)
      organizationFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedriveOrganizationMap.name,
        value: lead?.Account?.name ?? '',
        name: 'name',
        type: 'advanced_dropdown',
      });
    if (pipedriveOrganizationMap.phone_number)
      organizationFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedriveOrganizationMap.phone_number,
        value: lead?.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (pipedriveOrganizationMap.linkedin_url)
      organizationFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedriveOrganizationMap.linkedin_url,
        value: lead?.Account?.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: pipedriveOrganizationMap?.size,
      })[0]
    )
      organizationFields.push({
        editable: true,
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: pipedriveOrganizationMap?.size,
        })[0],
        possible_values:
          pipedriveOrganizationMap?.size?.picklist_values?.map((opt) => ({
            label: opt.label,
            value: opt.label,
          })) ??
          ACCOUNT_SIZE.map((size) => ({
            label: size,
            value: size,
          })),
        value: lead?.Account?.size ?? '',
        name: 'size',
        type: 'dropdown',
      });
    if (pipedriveOrganizationMap.country)
      organizationFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedriveOrganizationMap.country,
        value: lead?.Account?.country ?? '',
        name: 'country',
        type: 'input_box',
      });
    if (pipedriveOrganizationMap.url)
      organizationFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedriveOrganizationMap.url,
        value: lead?.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (pipedriveOrganizationMap.zip_code)
      organizationFields.push({
        editable: true,
        input_type: 'string',
        integration_label: pipedriveOrganizationMap.zip_code,
        value: lead?.Account?.zipcode ?? '',
        name: 'zipcode',
        type: 'input_box',
      });

    // * Data to be returned
    let data = {};
    data.lead_id = lead.lead_id;
    data.user_id = lead.user_id;
    data.account_id = lead.account_id;
    data.person_fields = personFields;
    data.organization_fields = organizationFields;
    data.phone_numbers = phone_numbers;
    data.emails = emails;

    return successResponse(
      res,
      'Successfully fetched preview data for lead',
      data
    );
  } catch (err) {
    logger.error(
      'Error while previewing pipedrive lead data for export: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing lead: ${err.message}`,
    });
  }
};

const searchPipedriveOrganizations = async (req, res) => {
  try {
    // * JOI Validation
    const body =
      pipedriveExportSchema.searchPipedriveOrganizationsSchema.validate(
        req.body
      );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { organization } = body.value;

    // * Fetching pipedrive access token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });

    let [orgSearchResults, errForOrgSearchResults] =
      await PipedriveService.searchOrganizations({
        access_token,
        instance_url,
        search_term: organization.name,
        exact_match: true,
      });
    if (errForOrgSearchResults)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching pipedrive organizations',
        error: errForOrgSearchResults,
      });

    return successResponse(
      res,
      'Successfully fetched pipedrive organizations.',
      orgSearchResults?.map((record) => record?.item) ?? []
    );
  } catch (err) {
    logger.error(`Error while fetching pipedrive organizations: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Error while fetching pipedrive organizations',
      error: `Error while fetching pipedrive organizations: ${err.message}`,
    });
  }
};

const exportPerson = async (req, res) => {
  try {
    // * JOI Validation
    const body = pipedriveExportSchema.exportPersonSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, person_data, organization_data, phone_numbers, emails } =
      body.value;

    // * Fetching pipedrive token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
      user_id: req.user.user_id,
    });

    // * Fetch pipedrive field map and get the Lead map
    const pipedriveFieldMapPromise =
      CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });

    // * Fetching the lead with lead_id
    const leadFetchPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
    });

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [pipedriveFieldMap, errFetchingPipedriveFieldMap],
      [leadData, leadDataErr],
    ] = await Promise.all([
      accessTokenPromise,
      pipedriveFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingPipedriveFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching Pipedrive field map`,
        msg: errFetchingPipedriveFieldMap,
      });
    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    const pipedrivePersonMap = pipedriveFieldMap.person_map;
    const pipedriveOrganizationMap = pipedriveFieldMap.organization_map;
    if (!pipedrivePersonMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for pipedrive person',
      });
    if (!pipedriveOrganizationMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for pipedrive organization',
      });

    // * Structure Person
    let person = { ...person_data };
    person.lead_id = lead_id;
    person.account_id = leadData.account_id;
    person.user_id = leadData.user_id;
    person.account = { ...organization_data };
    person.account.account_id = leadData.account_id;
    person.phone_numbers =
      phone_numbers?.filter((item) => item.phone_number?.length) ?? [];
    person.emails = emails?.filter((item) => item.email_id?.length) ?? [];

    // * Create the Person in Pipedrive
    let [data, errForData] = await LeadHelper.exportPersonToPipedrive({
      access_token,
      instance_url,
      pipedrivePersonMap,
      pipedriveOrganizationMap,
      person,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Error occured while exporting person to pipedrive',
        msg: errForData,
      });

    // * Updating lead and account
    LeadRepository.updateLead(data);

    let t = await sequelize.transaction();

    // * Updating emails
    await Repository.destroy({
      tableName: DB_TABLES.LEAD_EMAIL,
      query: { lead_id },
      t,
    });
    if (data.emails?.length) {
      const [emailsArray, errForEmailArray] =
        await LeadEmailHelper.formatForCreate(data.emails, lead_id);
      const [createdEmails, errForCreatedEmails] = await Repository.bulkCreate({
        tableName: DB_TABLES.LEAD_EMAIL,
        createObject: emailsArray,
        t,
      });
      if (errForCreatedEmails) {
        logger.error(
          `Error while creating contact emails: ${errForCreatedEmails}`
        );
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating contact emails`,
        });
      }
      data.emails = createdEmails;
    }

    // * Updating phone_numbers
    await Repository.destroy({
      tableName: DB_TABLES.LEAD_PHONE_NUMBER,
      query: { lead_id },
      t,
    });
    if (data.phone_numbers?.length) {
      const [numberArray, errForArray] =
        await PhoneNumberHelper.formatForCreate(data.phone_numbers, lead_id);
      const [createdNumbers, errForCreatedNumbers] =
        await Repository.bulkCreate({
          tableName: DB_TABLES.LEAD_PHONE_NUMBER,
          createObject: numberArray,
          t,
        });
      if (errForCreatedNumbers) {
        logger.error(
          `Error while creating contact numbers: ${errForCreatedNumbers}`
        );
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating contact numbers`,
        });
      }
      data.phone_numbers = createdNumbers;
    }

    t.commit();

    // * Create activity for lead export
    let [activity, errForActivity] =
      await ActivityHelper.createExportLeadActivity({
        lead: data,
        crm_integration: CRM_INTEGRATIONS.PIPEDRIVE,
        exported_as: 'person',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported person to pipedrive.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting person to pipedrive: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting person to pipedrive: ${err}`,
    });
  }
};

const ExportController = {
  previewPerson,
  searchPipedriveOrganizations,
  exportPerson,
};

module.exports = ExportController;
