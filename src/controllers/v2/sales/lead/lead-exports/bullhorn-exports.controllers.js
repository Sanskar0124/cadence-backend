// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../../utils/response');
const {
  HIRING_INTEGRATIONS,
  BULLHORN_ENDPOINTS,
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
const BullhornService = require('../../../../../../../Cadence-Brain/src/services/Bullhorn');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../../../Cadence-Brain/src/helper/email');
const ActivityHelper = require('../../../../../../../Cadence-Brain/src/helper/activity');
const hiringIntegration = require('../../../../../../../Cadence-Brain/src/grpc/v2/hiring-integration/');

// Joi
const bullhornExportSchema = require('../../../../../joi/v2/sales/lead/lead-exports/bullhorn-exports.joi');

const previewLead = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetching bullhorn token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
      user_id: req.user.user_id,
    });

    // * Fetch bullhorn field map
    const bullhornFieldMapPromise =
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

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [bullhornFieldMap, errFetchingBullhornFieldMap],
      [lead, leadErr],
    ] = await Promise.all([
      accessTokenPromise,
      bullhornFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errForAccessToken,
      });
    if (errFetchingBullhornFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingBullhornFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    // * Fetching country data
    const [countriesData, countriesDataErr] =
      await hiringIntegration.describePicklist({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        integration_data: JSON.stringify({
          object: 'country',
          access_token,
          instance_url,
        }),
      });
    if (countriesDataErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: countriesDataErr,
      });

    const bullhornLeadMap = bullhornFieldMap.lead_map;
    const bullhornAccountMap = bullhornFieldMap.account_map;
    if (!bullhornLeadMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn lead',
      });
    if (!bullhornAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn account',
      });

    // * Parse company size and zip_code
    let size = null;
    let zip_code = null;
    try {
      size = parseInt(lead?.Account?.size);
      if (isNaN(size)) size = null;
    } catch (err) {
      logger.error('Unable to parse company size of account');
    }
    try {
      zip_code = parseInt(lead?.Account?.zipcode);
      if (isNaN(zip_code)) zip_code = null;
    } catch (err) {
      logger.error('Unable to parse zipcode of account');
    }

    // *  Obtaining Lead fields
    let leadFields = [];
    if (bullhornLeadMap.first_name)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornLeadMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (bullhornLeadMap.last_name)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornLeadMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (bullhornLeadMap.job_position)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornLeadMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (bullhornLeadMap.linkedin_url)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornLeadMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // *  Obtaining Account fields
    let accountFields = [];
    if (bullhornAccountMap.name)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornAccountMap.name,
        value: lead.Account?.name ?? '',
        name: 'name',
        type: 'advanced_dropdown',
      });
    if (bullhornAccountMap.phone_number)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornAccountMap.phone_number,
        value: lead.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: bullhornAccountMap.size,
      })[0]
    )
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: bullhornAccountMap.size,
        })[0],
        value: size,
        name: 'size',
        type: 'input_box',
      });
    if (bullhornAccountMap.country)
      accountFields.push({
        editable: true,
        integration_label: bullhornAccountMap.country,
        possible_values: countriesData?.data ?? [],
        value: countriesData?.data?.find(
          (item) => item.label?.trim() === lead.Account?.country?.trim()
        )?.value,
        name: 'country',
        type: 'dropdown',
      });
    if (bullhornAccountMap.url)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornAccountMap.url,
        value: lead.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (bullhornAccountMap.zip_code)
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: bullhornAccountMap.zip_code,
        value: zip_code,
        name: 'zipcode',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    bullhornLeadMap?.emails?.forEach((email_type, i) => {
      emails.push({
        editable: true,
        input_type: 'string',
        integration_label: email_type,
        value: i < lead.Lead_emails?.length ? lead.Lead_emails[i].email_id : '',
        name: email_type,
        type: 'input_box',
      });
    });

    // * Phone numbers
    let phone_numbers = [];
    bullhornLeadMap?.phone_numbers?.forEach((phone_number_type, i) => {
      phone_numbers.push({
        editable: true,
        input_type: 'string',
        integration_label: phone_number_type,
        value:
          i < lead.Lead_phone_numbers?.length
            ? lead.Lead_phone_numbers[i].phone_number
            : '',
        name: phone_number_type,
        type: 'input_box',
      });
    });

    // * Data to be returned
    let data = {};
    data.lead_id = lead.lead_id;
    data.user_id = lead.user_id;
    data.account_id = lead.account_id;
    data.lead_fields = leadFields;
    data.account_fields = accountFields;
    data.phone_numbers = phone_numbers;
    data.emails = emails;
    data.country_list = countriesData?.data;

    return successResponse(
      res,
      'Successfully fetched preview data for lead',
      data
    );
  } catch (err) {
    logger.error('Error while previewing bullhorn lead data for export: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing lead: ${err.message}`,
    });
  }
};

const previewContact = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetching bullhorn token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
      user_id: req.user.user_id,
    });

    // * Fetch bullhorn field map
    const bullhornFieldMapPromise =
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

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [bullhornFieldMap, errFetchingBullhornFieldMap],
      [lead, leadErr],
    ] = await Promise.all([
      accessTokenPromise,
      bullhornFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errForAccessToken,
      });
    if (errFetchingBullhornFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingBullhornFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    // * Fetching country data
    const [countriesData, countriesDataErr] =
      await hiringIntegration.describePicklist({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        integration_data: JSON.stringify({
          object: 'country',
          access_token,
          instance_url,
        }),
      });
    if (countriesDataErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: countriesDataErr,
      });

    const bullhornContactMap = bullhornFieldMap.contact_map;
    const bullhornAccountMap = bullhornFieldMap.account_map;
    if (!bullhornContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn contact',
      });
    if (!bullhornAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn account',
      });

    // * Parse company size and zip_code
    let size = null;
    let zip_code = null;
    try {
      size = parseInt(lead?.Account?.size);
      if (isNaN(size)) size = null;
    } catch (err) {
      logger.error('Unable to parse company size of account');
    }
    try {
      zip_code = parseInt(lead?.Account?.zipcode);
      if (isNaN(zip_code)) zip_code = null;
    } catch (err) {
      logger.error('Unable to parse zipcode of account');
    }

    // *  Obtaining Contact fields
    let contactFields = [];
    if (bullhornContactMap.first_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornContactMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (bullhornContactMap.last_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornContactMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (bullhornContactMap.job_position)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornContactMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (bullhornContactMap.linkedin_url)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornContactMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    bullhornContactMap?.emails?.forEach((email_type, i) => {
      emails.push({
        editable: true,
        input_type: 'string',
        integration_label: email_type,
        value: i < lead.Lead_emails?.length ? lead.Lead_emails[i].email_id : '',
        name: email_type,
        type: 'input_box',
      });
    });

    // * Phone numbers
    let phone_numbers = [];
    bullhornContactMap?.phone_numbers?.forEach((phone_number_type, i) => {
      phone_numbers.push({
        editable: true,
        input_type: 'string',
        integration_label: phone_number_type,
        value:
          i < lead.Lead_phone_numbers?.length
            ? lead.Lead_phone_numbers[i].phone_number
            : '',
        name: phone_number_type,
        type: 'input_box',
      });
    });

    // *  Obtaining Account fields
    let accountFields = [];

    if (bullhornAccountMap.name)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornAccountMap.name,
        value: lead?.Account?.name ?? '',
        name: 'name',
        type: 'advanced_dropdown',
      });
    if (bullhornAccountMap.phone_number)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornAccountMap.phone_number,
        value: lead?.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: bullhornAccountMap?.size,
      })[0]
    )
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: bullhornAccountMap?.size,
        })[0],
        value: size,
        name: 'size',
        type: 'input_box',
      });
    if (bullhornAccountMap.country)
      accountFields.push({
        editable: true,
        integration_label: bullhornAccountMap.country,
        possible_values: countriesData?.data ?? [],
        value: countriesData?.data?.find(
          (item) => item.label?.trim() === lead.Account?.country?.trim()
        )?.value,
        name: 'country',
        type: 'dropdown',
      });
    if (bullhornAccountMap.url)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornAccountMap.url,
        value: lead?.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (bullhornAccountMap.zip_code)
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: bullhornAccountMap.zip_code,
        value: zip_code,
        name: 'zipcode',
        type: 'input_box',
      });

    // * Data to be returned
    let data = {};
    data.lead_id = lead.lead_id;
    data.user_id = lead.user_id;
    data.account_id = lead.account_id;
    data.contact_fields = contactFields;
    data.account_fields = accountFields;
    data.phone_numbers = phone_numbers;
    data.emails = emails;
    data.country_list = countriesData?.data;

    return successResponse(
      res,
      'Successfully fetched preview data for lead',
      data
    );
  } catch (err) {
    logger.error('Error while previewing bullhorn lead data for export: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing lead: ${err.message}`,
    });
  }
};

const previewCandidate = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetching bullhorn token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
      user_id: req.user.user_id,
    });

    // * Fetch bullhorn field map
    const bullhornFieldMapPromise =
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

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [bullhornFieldMap, errFetchingBullhornFieldMap],
      [lead, leadErr],
    ] = await Promise.all([
      accessTokenPromise,
      bullhornFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errForAccessToken,
      });
    if (errFetchingBullhornFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingBullhornFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    // * Fetching country data
    const [countriesData, countriesDataErr] =
      await hiringIntegration.describePicklist({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        integration_data: JSON.stringify({
          object: 'country',
          access_token,
          instance_url,
        }),
      });
    if (countriesDataErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: countriesDataErr,
      });

    const bullhornCandidateMap = bullhornFieldMap.candidate_map;
    if (!bullhornCandidateMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn candidate',
      });

    // * Parse company size and zip_code
    let size = null;
    let zip_code = null;
    try {
      size = parseInt(lead?.Account?.size);
      if (isNaN(size)) size = null;
    } catch (err) {
      logger.error('Unable to parse company size of account');
    }
    try {
      zip_code = parseInt(lead?.Account?.zipcode);
      if (isNaN(zip_code)) zip_code = null;
    } catch (err) {
      logger.error('Unable to parse zipcode of account');
    }

    // *  Obtaining Lead fields
    let candidateFields = [];
    if (bullhornCandidateMap.first_name)
      candidateFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornCandidateMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (bullhornCandidateMap.last_name)
      candidateFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornCandidateMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (bullhornCandidateMap.job_position)
      candidateFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornCandidateMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (bullhornCandidateMap.linkedin_url)
      candidateFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornCandidateMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // *  Obtaining Account fields
    let accountFields = [];
    if (bullhornCandidateMap.company)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornCandidateMap.company,
        value: lead.Account?.name ?? '',
        name: 'name',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: bullhornCandidateMap.size,
      })[0]
    )
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: bullhornCandidateMap.size,
        })[0],
        value: size,
        name: 'size',
        type: 'input_box',
      });
    if (bullhornCandidateMap.url)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: bullhornCandidateMap.url,
        value: lead.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (bullhornCandidateMap.zip_code)
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: bullhornCandidateMap.zip_code,
        value: zip_code,
        name: 'zipcode',
        type: 'input_box',
      });
    if (bullhornCandidateMap.country)
      accountFields.push({
        editable: true,
        integration_label: bullhornCandidateMap.country,
        possible_values: countriesData?.data ?? [],
        value: countriesData?.data?.find(
          (item) => item.label?.trim() === lead.Account?.country?.trim()
        )?.value,
        name: 'country',
        type: 'dropdown',
      });

    // * Emails
    let emails = [];
    bullhornCandidateMap?.emails?.forEach((email_type, i) => {
      emails.push({
        editable: true,
        input_type: 'string',
        integration_label: email_type,
        value: i < lead.Lead_emails?.length ? lead.Lead_emails[i].email_id : '',
        name: email_type,
        type: 'input_box',
      });
    });

    // * Phone numbers
    let phone_numbers = [];
    bullhornCandidateMap?.phone_numbers?.forEach((phone_number_type, i) => {
      phone_numbers.push({
        editable: true,
        input_type: 'string',
        integration_label: phone_number_type,
        value:
          i < lead.Lead_phone_numbers?.length
            ? lead.Lead_phone_numbers[i].phone_number
            : '',
        name: phone_number_type,
        type: 'input_box',
      });
    });

    // * Data to be returned
    let data = {};
    data.lead_id = lead.lead_id;
    data.user_id = lead.user_id;
    data.account_id = lead.account_id;
    data.candidate_fields = candidateFields;
    data.account_fields = accountFields;
    data.phone_numbers = phone_numbers;
    data.emails = emails;
    data.country_list = countriesData?.data;

    return successResponse(
      res,
      'Successfully fetched preview data for lead',
      data
    );
  } catch (err) {
    logger.error('Error while previewing bullhorn lead data for export: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing lead: ${err.message}`,
    });
  }
};

const searchBullhornAccounts = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornExportSchema.searchBullhornAccountsSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { account } = body.value;

    // * Fetching bullhorn access token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
      user_id: req.user.user_id,
    });

    // * Fetch bullhorn field map
    const bullhornFieldMapPromise =
      CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [bullhornFieldMap, errFetchingBullhornFieldMap],
    ] = await Promise.all([accessTokenPromise, bullhornFieldMapPromise]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingBullhornFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to search Bullhorn Accounts',
        error: errFetchingBullhornFieldMap,
      });

    const bullhornAccountMap = bullhornFieldMap.account_map;
    if (!bullhornAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Bullhorn Account',
      });

    let fieldMapping = { id: 'id' };
    let fields = `id`;

    if (bullhornAccountMap.name) {
      fields += `,${bullhornAccountMap.name}`;
      fieldMapping[bullhornAccountMap.name] = 'name';
    }
    if (bullhornAccountMap.phone_number) {
      fields += `,${bullhornAccountMap.phone_number}`;
      fieldMapping[bullhornAccountMap.phone_number] = 'phone_number';
    }
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: bullhornAccountMap.size,
      })[0]
    ) {
      const sizeLabel = CompanyFieldMapHelper.getCompanySize({
        size: bullhornAccountMap.size,
      })[0];
      fields += `,${sizeLabel}`;
      fieldMapping[sizeLabel] = 'size';
    }
    // if (bullhornAccountMap.country) {
    //   fields += `,${bullhornAccountMap.country}`;
    //   fieldMapping[bullhornAccountMap.country] = 'country';
    // }
    if (bullhornAccountMap.url) {
      fields += `,${bullhornAccountMap.url}`;
      fieldMapping[bullhornAccountMap.url] = 'url';
    }
    // if (bullhornAccountMap.zip_code) {
    //   fields += `,${bullhornAccountMap.zip_code}`;
    //   fieldMapping[bullhornAccountMap.zip_code] = 'zipcode';
    // }

    const [accountData, errForAccountData] = await BullhornService.search({
      start: '0',
      object: BULLHORN_ENDPOINTS.CORPORATION,
      query: `name:"*${account?.name}*"`,
      fields,
      access_token,
      instance_url,
    });
    if (errForAccountData)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching bullhorn accounts',
        error: `Error while fetching bullhorn accounts: ${errForAccountData}`,
      });

    let accounts = accountData?.data?.map((record) => {
      let modRecord = {};
      Object.keys(fieldMapping).forEach((key) => {
        if (record[key] !== undefined)
          modRecord[fieldMapping[key]] = record[key];
      });
      return modRecord;
    });

    return successResponse(
      res,
      'Successfully fetched bullhorn accounts.',
      accounts
    );
  } catch (err) {
    logger.error(`Error while fetching bullhorn accounts: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Error while fetching bullhorn accounts',
      error: `Error while fetching bullhorn accounts: ${err.message}`,
    });
  }
};

const exportLead = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornExportSchema.exportLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, lead_data, account_data, phone_numbers, emails } =
      body.value;

    // * Fetching bullhorn token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
      user_id: req.user.user_id,
    });

    // * Fetch bullhorn field map and get the Lead map
    const bullhornFieldMapPromise =
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
      [bullhornFieldMap, errFetchingBullhornFieldMap],
      [leadData, leadDataErr],
    ] = await Promise.all([
      accessTokenPromise,
      bullhornFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingBullhornFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingBullhornFieldMap,
        msg: `Error while fetching bullhorn field map`,
      });
    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    const bullhornLeadMap = bullhornFieldMap.lead_map;
    const bullhornAccountMap = bullhornFieldMap.account_map;
    if (!bullhornLeadMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No field map set for bullhorn lead.',
      });
    if (!bullhornAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn account',
      });

    // * Fetch owner of the lead
    const [user, userErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: leadData.user_id },
      extras: {
        attributes: ['integration_id', 'user_id'],
      },
    });
    if (userErr || user === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user',
        error: 'Owner not present in cadence tool.',
      });

    // * Structure Lead with Account in it
    let lead = { ...lead_data };
    lead.lead_id = lead_id;
    lead.account_id = leadData.account_id;
    lead.user_id = leadData.user_id;
    lead.account = { ...account_data };
    lead.account.account_id = leadData.account_id;
    lead.phone_numbers =
      phone_numbers?.filter((item) => item.phone_number?.length) ?? [];
    lead.emails = emails?.filter((item) => item.email_id?.length) ?? [];
    logger.info(`lead obj: ${JSON.stringify(lead, null, 2)}`);

    // * Create the lead in Bullhorn
    let [data, errForData] = await LeadHelper.exportLeadToBullhorn({
      access_token,
      instance_url,
      bullhornLeadMap,
      bullhornAccountMap,
      lead,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting lead to bullhorn',
      });
    logger.info('Created lead in bullhorn: ', data);

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
          `Error while creating lead emails: ${errForCreatedEmails}`
        );
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating lead emails`,
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
          `Error while creating lead numbers: ${errForCreatedNumbers}`
        );
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating lead numbers`,
        });
      }
      data.phone_numbers = createdNumbers;
    }

    t.commit();

    // * Create activity for lead export
    let [activity, errForActivity] =
      await ActivityHelper.createExportLeadActivity({
        lead: data,
        crm_integration: HIRING_INTEGRATIONS.BULLHORN,
        exported_as: 'lead',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported lead to Bullhorn.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting lead to bullhorn: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting lead to bullhorn: ${err}`,
    });
  }
};

const exportContact = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornExportSchema.exportContactSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, contact_data, account_data, phone_numbers, emails } =
      body.value;

    // * Fetching bullhorn token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
      user_id: req.user.user_id,
    });

    // * Fetch bullhorn field map and get the Lead map
    const bullhornFieldMapPromise =
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
      [bullhornFieldMap, errFetchingBullhornFieldMap],
      [leadData, leadDataErr],
    ] = await Promise.all([
      accessTokenPromise,
      bullhornFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingBullhornFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingBullhornFieldMap,
        msg: `Error while fetching Bullhorn field map`,
      });
    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    const bullhornContactMap = bullhornFieldMap.contact_map;
    const bullhornAccountMap = bullhornFieldMap.account_map;
    if (!bullhornContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn contact',
      });
    if (!bullhornAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for bullhorn account',
      });

    // * Fetch owner of the lead
    const [user, userErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: leadData.user_id },
      extras: {
        attributes: ['integration_id', 'user_id'],
      },
    });
    if (userErr || user === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user',
        error: 'Owner not present in cadence tool.',
      });

    // * Structure Contact with Account in it
    let contact = { ...contact_data };
    contact.lead_id = lead_id;
    contact.account_id = leadData.account_id;
    contact.user_id = leadData.user_id;
    contact.account = { ...account_data };
    contact.account.account_id = leadData.account_id;
    contact.phone_numbers =
      phone_numbers?.filter((item) => item.phone_number?.length) ?? [];
    contact.emails = emails?.filter((item) => item.email_id?.length) ?? [];

    // * Create the lead in Bullhorn
    let [data, errForData] = await LeadHelper.exportContactToBullhorn({
      access_token,
      instance_url,
      bullhornContactMap,
      bullhornAccountMap,
      contact,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting contact to bullhorn',
      });
    logger.info('Created contact in bullhorn: ', data);

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
        crm_integration: HIRING_INTEGRATIONS.BULLHORN,
        exported_as: 'contact',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported lead as bullhorn contact.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting lead as bullhorn contact: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting lead as bullhorn contact: ${err}`,
    });
  }
};

const exportCandidate = async (req, res) => {
  try {
    // * JOI Validation
    const body = bullhornExportSchema.exportCandidateSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, candidate_data, account_data, phone_numbers, emails } =
      body.value;

    // * Fetching bullhorn token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: HIRING_INTEGRATIONS.BULLHORN,
      user_id: req.user.user_id,
    });

    // * Fetch bullhorn field map and get the Lead map
    const bullhornFieldMapPromise =
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
      [bullhornFieldMap, errFetchingBullhornFieldMap],
      [leadData, leadDataErr],
    ] = await Promise.all([
      accessTokenPromise,
      bullhornFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingBullhornFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching bullhorn field map`,
        msg: errFetchingBullhornFieldMap,
      });
    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    const bullhornCandidateMap = bullhornFieldMap.candidate_map;
    if (!bullhornCandidateMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No field map set for bullhorn candidate.',
      });

    // * Fetch owner of the lead
    const [user, userErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: leadData.user_id },
      extras: {
        attributes: ['integration_id', 'user_id'],
      },
    });
    if (userErr || user === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch user',
        error: 'Owner not present in cadence tool.',
      });

    // * Structure Candidate with Account in it
    let candidate = { ...candidate_data };
    candidate.lead_id = lead_id;
    candidate.account_id = leadData.account_id;
    candidate.user_id = leadData.user_id;
    candidate.account = { ...account_data };
    candidate.account.account_id = leadData.account_id;
    candidate.phone_numbers =
      phone_numbers?.filter((item) => item.phone_number?.length) ?? [];
    candidate.emails = emails?.filter((item) => item.email_id?.length) ?? [];
    if (candidate.emails.length === 0)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: `At least one email is required for a candidate`,
      });

    // * Create the lead in Bullhorn
    logger.info(`candidate obj: ${JSON.stringify(candidate, null, 2)}`);
    let [data, errForData] = await LeadHelper.exportCandidateToBullhorn({
      access_token,
      instance_url,
      bullhornCandidateMap,
      candidate,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting candidate to bullhorn',
      });
    logger.info('Created candidate in bullhorn: ', data);

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
          `Error while creating lead emails: ${errForCreatedEmails}`
        );
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating lead emails`,
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
          `Error while creating lead numbers: ${errForCreatedNumbers}`
        );
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while updating lead numbers`,
        });
      }
      data.phone_numbers = createdNumbers;
    }

    t.commit();

    // * Create activity for lead export
    let [activity, errForActivity] =
      await ActivityHelper.createExportLeadActivity({
        lead: data,
        crm_integration: HIRING_INTEGRATIONS.BULLHORN,
        exported_as: 'candidate',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported candidate to Bullhorn.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting candidate to bullhorn: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting candidate to bullhorn: ${err}`,
    });
  }
};

const ExportController = {
  previewLead,
  previewContact,
  previewCandidate,
  searchBullhornAccounts,
  exportLead,
  exportContact,
  exportCandidate,
};

module.exports = ExportController;
