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
const ZohoService = require('../../../../../../../Cadence-Brain/src/services/Zoho');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../../../Cadence-Brain/src/helper/email');
const ActivityHelper = require('../../../../../../../Cadence-Brain/src/helper/activity');

// Joi
const zohoExportSchema = require('../../../../../joi/v2/sales/lead/lead-exports/zoho-exports.joi');

const previewLead = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetch zoho field map and get the Lead map
    const zohoFieldMapPromise =
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

    const [[zohoFieldMap, errFetchingZohoFieldMap], [lead, leadErr]] =
      await Promise.all([zohoFieldMapPromise, leadFetchPromise]);
    if (errFetchingZohoFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingZohoFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    const zohoLeadMap = zohoFieldMap.lead_map;
    if (!zohoLeadMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Zoho Lead',
      });

    // * Parse company size and zip_code
    let size = null;
    let zip_code = null;
    try {
      size = parseInt(lead.Account?.size);
      if (isNaN(size)) size = null;
    } catch (err) {
      logger.error('Unable to parse company size of account');
    }
    try {
      zip_code = parseInt(lead.Account?.zipcode);
      if (isNaN(zip_code)) zip_code = null;
    } catch (err) {
      logger.error('Unable to parse zipcode of account');
    }

    // *  Obtaining Lead fields
    let leadFields = [];
    if (zohoLeadMap.first_name)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoLeadMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (zohoLeadMap.last_name)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoLeadMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (zohoLeadMap.job_position)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoLeadMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (zohoLeadMap.linkedin_url)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoLeadMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // *  Obtaining Account fields
    let accountFields = [];
    if (zohoLeadMap.company)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoLeadMap.company,
        value: lead.Account?.name ?? '',
        name: 'name',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: zohoLeadMap.size,
      })[0]
    )
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: zohoLeadMap.size,
        })[0],
        value: size,
        name: 'size',
        type: 'input_box',
      });
    if (zohoLeadMap.country)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoLeadMap.country,
        value: lead.Account?.country ?? '',
        name: 'country',
        type: 'input_box',
      });
    if (zohoLeadMap.url)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoLeadMap.url,
        value: lead.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (zohoLeadMap.zip_code)
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: zohoLeadMap.zip_code,
        value: zip_code,
        name: 'zipcode',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    zohoLeadMap.emails?.forEach((email_type, i) => {
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
    zohoLeadMap.phone_numbers?.forEach((phone_number_type, i) => {
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

    return successResponse(
      res,
      'Successfully fetched preview data for lead',
      data
    );
  } catch (err) {
    logger.error('Error while previewing zoho lead data for export: ', err);
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

    // * Fetch zoho field map
    const zohoFieldMapPromise =
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

    const [[zohoFieldMap, errFetchingZohoFieldMap], [lead, leadErr]] =
      await Promise.all([zohoFieldMapPromise, leadFetchPromise]);
    if (errFetchingZohoFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingZohoFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    const zohoContactMap = zohoFieldMap.contact_map;
    const zohoAccountMap = zohoFieldMap.account_map;
    if (!zohoContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Zoho Contact',
      });
    if (!zohoAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Zoho Account',
      });

    // * Parse company size and zip_code
    let size = null;
    let zip_code = null;
    try {
      size = parseInt(lead.Account?.size);
      if (isNaN(size)) size = null;
    } catch (err) {
      logger.error('Unable to parse company size of account');
    }
    try {
      zip_code = parseInt(lead.Account?.zipcode);
      if (isNaN(zip_code)) zip_code = null;
    } catch (err) {
      logger.error('Unable to parse zipcode of account');
    }

    // *  Obtaining Contact fields
    let contactFields = [];
    if (zohoContactMap.first_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoContactMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (zohoContactMap.last_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoContactMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (zohoContactMap.job_position)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoContactMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (zohoContactMap.linkedin_url)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoContactMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    zohoContactMap.emails?.forEach((email_type, i) => {
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
    zohoContactMap.phone_numbers?.forEach((phone_number_type, i) => {
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

    if (zohoAccountMap.name)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoAccountMap.name,
        value: lead.Account?.name ?? '',
        name: 'name',
        type: 'advanced_dropdown',
      });
    if (zohoAccountMap.phone_number)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoAccountMap.phone_number,
        value: lead.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: zohoAccountMap.size,
      })[0]
    )
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: zohoAccountMap.size,
        })[0],
        value: size,
        name: 'size',
        type: 'input_box',
      });
    if (zohoAccountMap.country)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoAccountMap.country,
        value: lead.Account?.country ?? '',
        name: 'country',
        type: 'input_box',
      });
    if (zohoAccountMap.url)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: zohoAccountMap.url,
        value: lead.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (zohoAccountMap.zip_code)
      accountFields.push({
        editable: true,
        input_type: 'number',
        integration_label: zohoAccountMap.zip_code,
        value: lead.Account?.zipcode ?? '',
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

    return successResponse(
      res,
      'Successfully fetched preview data for lead',
      data
    );
  } catch (err) {
    logger.error('Error while previewing zoho lead data for export: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing lead: ${err.message}`,
    });
  }
};

const searchZohoAccounts = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoExportSchema.searchZohoAccountsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { account } = body.value;

    // * Fetching zoho access token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.ZOHO,
      user_id: req.user.user_id,
    });

    // * Fetch zoho field map
    const zohoFieldMapPromise =
      CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [zohoFieldMap, errFetchingZohoFieldMap],
    ] = await Promise.all([accessTokenPromise, zohoFieldMapPromise]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingZohoFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to search Zoho Accounts',
        error: errFetchingZohoFieldMap,
      });

    const zohoAccountMap = zohoFieldMap.account_map;
    if (!zohoAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Zoho Account',
      });

    let fieldMapping = { id: 'id' };

    if (zohoAccountMap.name) fieldMapping[zohoAccountMap.name] = 'name';
    if (zohoAccountMap.phone_number)
      fieldMapping[zohoAccountMap.phone_number] = 'phone_number';
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: zohoAccountMap?.size,
      })[0]
    )
      fieldMapping[
        CompanyFieldMapHelper.getCompanySize({
          size: zohoAccountMap?.size,
        })[0]
      ] = 'size';
    if (zohoAccountMap.country)
      fieldMapping[zohoAccountMap.country] = 'country';
    if (zohoAccountMap.url) fieldMapping[zohoAccountMap.url] = 'url';
    if (zohoAccountMap.zip_code)
      fieldMapping[zohoAccountMap.zip_code] = 'zipcode';

    const [accountData, errForAccountData] = await ZohoService.searchAccount({
      access_token,
      instance_url,
      accountName: account?.name,
    });
    if (errForAccountData)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching zoho accounts',
        error: `Error while fetching zoho accounts: ${errForAccountData}`,
      });
    console.log('account data: ', JSON.stringify(accountData));

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
      'Successfully fetched zoho accounts.',
      accounts
    );
  } catch (err) {
    logger.error(`Error while fetching zoho accounts: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Error while fetching zoho accounts',
      error: `Error while fetching zoho accounts: ${err.message}`,
    });
  }
};

const exportLead = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoExportSchema.exportLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, lead_data, account_data, phone_numbers, emails } =
      body.value;

    // * Fetching zoho token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.ZOHO,
      user_id: req.user.user_id,
    });

    // * Fetch zoho field map and get the Lead map
    const zohoFieldMapPromise =
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
      [zohoFieldMap, errFetchingZohoFieldMap],
      [leadData, leadDataErr],
    ] = await Promise.all([
      accessTokenPromise,
      zohoFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingZohoFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingZohoFieldMap,
        msg: `Error while fetching Zoho field map`,
      });
    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    const zohoLeadMap = zohoFieldMap.lead_map;
    if (!zohoLeadMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No field map set for Zoho Lead.',
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

    // * Create the lead in Zoho
    let [data, errForData] = await LeadHelper.exportLeadToZoho({
      access_token,
      instance_url,
      zohoLeadMap,
      lead,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting lead to zoho',
      });
    logger.info('Created lead in zoho: ', data);

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
        crm_integration: CRM_INTEGRATIONS.ZOHO,
        exported_as: 'lead',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(res, 'Successfully exported lead to Zoho.', data);
  } catch (err) {
    logger.error('Error while exporting lead to zoho: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting lead to zoho: ${err}`,
    });
  }
};

const exportContact = async (req, res) => {
  try {
    // * JOI Validation
    const body = zohoExportSchema.exportContactSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, contact_data, account_data, phone_numbers, emails } =
      body.value;

    // * Fetching zoho token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.ZOHO,
      user_id: req.user.user_id,
    });

    // * Fetch zoho field map and get the Lead map
    const zohoFieldMapPromise =
      CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });

    // * Fetching the lead with lead_id
    const leadFetchPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
    });

    let [
      [{ access_token, instance_url }, errForAccessToken],
      [zohoFieldMap, errFetchingZohoFieldMap],
      [leadData, leadDataErr],
    ] = await Promise.all([
      accessTokenPromise,
      zohoFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingZohoFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingZohoFieldMap,
        msg: `Error while fetching Zoho field map`,
      });
    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    const zohoContactMap = zohoFieldMap.contact_map;
    const zohoAccountMap = zohoFieldMap.account_map;
    if (!zohoContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Zoho Contact',
      });
    if (!zohoAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Zoho Account',
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

    if (account_data?.integration_id) {
      const [fetchedAccount, errForFetchedAccount] = await Repository.fetchOne({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          integration_id: account_data?.integration_id,
          company_id: req.user.company_id,
        },
      });
      if (errForFetchedAccount)
        return serverErrorResponseWithDevMsg({
          res,
          error: errForFetchedAccount,
          msg: `Error while fetching account`,
        });
      if (fetchedAccount) {
        await Repository.destroy({
          tableName: DB_TABLES.ACCOUNT,
          query: { account_id: leadData.account_id },
        });
        leadData.account_id = fetchedAccount?.account_id;
      }
    }

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

    // * Create the lead in Zoho
    let [data, errForData] = await LeadHelper.exportContactToZoho({
      access_token,
      instance_url,
      zohoContactMap,
      zohoAccountMap,
      contact,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting contact to zoho',
      });
    logger.info('Created contact in zoho: ', data);

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
        crm_integration: CRM_INTEGRATIONS.ZOHO,
        exported_as: 'contact',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported lead as zoho contact.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting lead as zoho contact: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting lead as zoho contact: ${err}`,
    });
  }
};

const ExportController = {
  previewLead,
  previewContact,
  searchZohoAccounts,
  exportLead,
  exportContact,
};

module.exports = ExportController;
