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
const SalesforceService = require('../../../../../../../Cadence-Brain/src/services/Salesforce');
const SalesforceHelper = require('../../../../../../../Cadence-Brain/src/helper/salesforce');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../../../Cadence-Brain/src/helper/email');
const ActivityHelper = require('../../../../../../../Cadence-Brain/src/helper/activity');

// Joi
const salesforceExportSchema = require('../../../../../joi/v2/sales/lead/lead-exports/salesforce-exports.joi');

const previewLead = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetch salesforce field map and get the Lead map
    const salesforceFieldMapPromise =
      SalesforceHelper.getFieldMapForCompanyFromUser(req.user.user_id);

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
      [salesforceFieldMap, errFetchingSalesforceFieldMap],
      [lead, leadErr],
    ] = await Promise.all([salesforceFieldMapPromise, leadFetchPromise]);
    if (errFetchingSalesforceFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingSalesforceFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    const salesforceLeadMap = salesforceFieldMap.lead_map;
    if (!salesforceLeadMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Lead',
      });

    // *  Obtaining Lead fields
    let leadFields = [];
    if (salesforceLeadMap.first_name)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (salesforceLeadMap.last_name)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (salesforceLeadMap.job_position)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (salesforceLeadMap.linkedin_url)
      leadFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // *  Obtaining Account fields
    let accountFields = [];
    if (salesforceLeadMap.company)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.company,
        value: lead.Account?.name ?? '',
        name: 'name',
        type: 'input_box',
      });
    if (salesforceLeadMap.company_phone_number)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.company_phone_number,
        value: lead.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: salesforceLeadMap?.size,
      })[0]
    )
      accountFields.push({
        editable: true,
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: salesforceLeadMap?.size,
        })[0],
        possible_values:
          salesforceLeadMap?.size?.picklist_values ??
          ACCOUNT_SIZE.map((size) => ({
            label: size,
            value: size,
          })),
        value: salesforceLeadMap?.size?.picklist_values
          ? SalesforceHelper.formatPickListCompanySize(lead?.Account?.size)
          : lead?.Account?.size ?? '',
        name: 'size',
        type: 'dropdown',
      });
    if (salesforceLeadMap.country)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.country,
        value: lead.Account?.country ?? '',
        name: 'country',
        type: 'input_box',
      });
    if (salesforceLeadMap.url)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.url,
        value: lead.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (salesforceLeadMap.zip_code)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceLeadMap.zip_code,
        value: lead.Account?.zipcode ?? '',
        name: 'zipcode',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    salesforceLeadMap?.emails?.forEach((email_type, i) => {
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
    salesforceLeadMap?.phone_numbers?.forEach((phone_number_type, i) => {
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
    logger.error(
      'Error while previewing salesforce lead data for export: ',
      err
    );
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

    // * Fetch salesforce field map
    const salesforceFieldMapPromise =
      SalesforceHelper.getFieldMapForCompanyFromUser(req.user.user_id);

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
      [salesforceFieldMap, errFetchingSalesforceFieldMap],
      [lead, leadErr],
    ] = await Promise.all([salesforceFieldMapPromise, leadFetchPromise]);
    if (errFetchingSalesforceFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingSalesforceFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    const salesforceContactMap = salesforceFieldMap.contact_map;
    const salesforceAccountMap = salesforceFieldMap.account_map;
    if (!salesforceContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Contact',
      });
    if (!salesforceAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Account',
      });

    // *  Obtaining Contact fields
    let contactFields = [];
    if (salesforceContactMap.first_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceContactMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (salesforceContactMap.last_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceContactMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (salesforceContactMap.job_position)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceContactMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (salesforceContactMap.linkedin_url)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceContactMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    salesforceContactMap?.emails?.forEach((email_type, i) => {
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
    salesforceContactMap?.phone_numbers?.forEach((phone_number_type, i) => {
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

    if (salesforceAccountMap.name)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceAccountMap.name,
        value: lead?.Account?.name ?? '',
        name: 'name',
        type: 'advanced_dropdown',
      });
    if (salesforceAccountMap.phone_number)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceAccountMap.phone_number,
        value: lead?.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: salesforceAccountMap?.size,
      })[0]
    )
      accountFields.push({
        editable: true,
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: salesforceAccountMap?.size,
        })[0],
        possible_values:
          salesforceAccountMap?.size?.picklist_values ??
          ACCOUNT_SIZE.map((size) => ({
            label: size,
            value: size,
          })),

        value: salesforceAccountMap?.size?.picklist_values
          ? SalesforceHelper.formatPickListCompanySize(lead?.Account?.size)
          : lead?.Account?.size ?? '',

        name: 'size',
        type: 'dropdown',
      });
    if (salesforceAccountMap.country)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceAccountMap.country,
        value: lead?.Account?.country ?? '',
        name: 'country',
        type: 'input_box',
      });
    if (salesforceAccountMap.url)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceAccountMap.url,
        value: lead?.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (salesforceAccountMap.zip_code)
      accountFields.push({
        editable: true,
        input_type: 'string',
        integration_label: salesforceAccountMap.zip_code,
        value: lead?.Account?.zipcode ?? '',
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
    logger.error(
      'Error while previewing salesforce lead data for export: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing lead: ${err.message}`,
    });
  }
};

const searchSalesforceAccounts = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceExportSchema.searchSalesforceAccountsSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { account } = body.value;

    // * Fetching salesforce access token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
      user_id: req.user.user_id,
    });

    // * Fetch salesforce field map
    const salesforceFieldMapPromise =
      SalesforceHelper.getFieldMapForCompanyFromUser(req.user.user_id);

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [salesforceFieldMap, errFetchingSalesforceFieldMap],
    ] = await Promise.all([accessTokenPromise, salesforceFieldMapPromise]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingSalesforceFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to search Salesforce Accounts',
        error: errFetchingSalesforceFieldMap,
      });

    const salesforceAccountMap = salesforceFieldMap.account_map;
    if (!salesforceAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Account',
      });

    let fieldMapping = { Id: 'id' };
    let accountQuery = `SELECT Id`;

    if (salesforceAccountMap.name) {
      accountQuery += `,${salesforceAccountMap.name}`;
      fieldMapping[salesforceAccountMap.name] = 'name';
    }
    if (salesforceAccountMap.phone_number) {
      accountQuery += `,${salesforceAccountMap.phone_number}`;
      fieldMapping[salesforceAccountMap.phone_number] = 'phone_number';
    }
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: salesforceAccountMap?.size,
      })[0]
    ) {
      const sizeLabel = CompanyFieldMapHelper.getCompanySize({
        size: salesforceAccountMap?.size,
      })[0];
      accountQuery += `,${sizeLabel}`;
      fieldMapping[sizeLabel] = 'size';
    }
    if (salesforceAccountMap.country) {
      accountQuery += `,${salesforceAccountMap.country}`;
      fieldMapping[salesforceAccountMap.country] = 'country';
    }
    if (salesforceAccountMap.url) {
      accountQuery += `,${salesforceAccountMap.url}`;
      fieldMapping[salesforceAccountMap.url] = 'url';
    }
    if (salesforceAccountMap.zip_code) {
      accountQuery += `,${salesforceAccountMap.zip_code}`;
      fieldMapping[salesforceAccountMap.zip_code] = 'zipcode';
    }

    accountQuery += ` FROM ACCOUNT WHERE ${salesforceAccountMap?.name}='${account?.name}'`;
    const [accountData, errForAccountData] = await SalesforceService.query(
      accountQuery,
      access_token,
      instance_url
    );
    if (errForAccountData)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching salesforce accounts',
        error: `Error while fetching salesforce accounts: ${errForAccountData}`,
      });

    let accounts = accountData?.records?.map((record) => {
      let modRecord = {};
      Object.keys(fieldMapping).forEach((key) => {
        if (record[key] !== undefined)
          modRecord[fieldMapping[key]] = record[key];
      });
      return modRecord;
    });

    return successResponse(
      res,
      'Successfully fetched salesforce accounts.',
      accounts
    );
  } catch (err) {
    logger.error(`Error while fetching salesforce accounts: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Error while fetching salesforce accounts',
      error: `Error while fetching salesforce accounts: ${err.message}`,
    });
  }
};

const exportLead = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceExportSchema.exportLeadSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, lead_data, account_data, phone_numbers, emails } =
      body.value;

    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
          [DB_TABLES.SALESFORCE_FIELD_MAP]: {
            attributes: ['account_map', 'lead_map'],
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to export lead',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });
    }
    const adminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!adminUserId) {
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No admin user found for company',
      });
    }
    const salesforceLeadMap =
      crmAdmin?.Company_Setting?.Salesforce_Field_Map?.lead_map;
    if (!salesforceLeadMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No field map set for Salesforce Lead.',
      });

    // * Fetching salesforce token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
      user_id: adminUserId,
    });

    // * Fetching the lead with lead_id
    const leadFetchPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['salesforce_owner_id', 'integration_id', 'user_id'],
        },
      },
    });

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [leadData, leadDataErr],
    ] = await Promise.all([accessTokenPromise, leadFetchPromise]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });

    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    // * Fetch owner of the lead
    const [user, userErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: leadData.user_id },
      extras: {
        attributes: ['salesforce_owner_id', 'integration_id', 'user_id'],
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

    const phoneNumberRegex =
      /^(?:\+\d{1,3}\s?)?(?:\(\d{1,4}\)\s?)?(?:\d{1,4}[\s-])?\d{7,14}$/;
    if (
      lead?.account?.phone_number &&
      !phoneNumberRegex.test(lead?.account?.phone_number)
    ) {
      return serverErrorResponseWithDevMsg({
        res,
        error:
          'Company phone number must be a valid phone number with a valid country code',
        msg: 'Error occurred while exporting lead to Salesforce',
      });
    }

    if (Array.isArray(lead?.phone_numbers)) {
      for (const phoneNumber of lead.phone_numbers) {
        if (!phoneNumberRegex.test(phoneNumber?.phone_number)) {
          return serverErrorResponseWithDevMsg({
            res,
            error: 'One or more phone numbers are invalid',
            msg: 'Error occurred while exporting lead to Salesforce',
          });
        }
      }
    }

    // * Create the lead in Salesforce
    let [data, errForData] = await LeadHelper.exportLeadToSalesforce({
      access_token,
      instance_url,
      salesforce_owner_id: leadData?.User?.salesforce_owner_id,
      salesforceLeadMap,
      lead,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting lead to salesforce',
      });
    logger.info('Created lead from salesforce: ', data);

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
        crm_integration: CRM_INTEGRATIONS.SALESFORCE,
        exported_as: 'lead',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported lead to Salesforce.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting lead to salesforce: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting lead to salesforce: ${err}`,
    });
  }
};

const exportContact = async (req, res) => {
  try {
    // * JOI Validation
    const body = salesforceExportSchema.exportContactSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, contact_data, account_data, phone_numbers, emails } =
      body.value;

    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
          [DB_TABLES.SALESFORCE_FIELD_MAP]: {
            attributes: ['account_map', 'contact_map'],
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to export contact',
        error: `Error while fetching CRM Admin: ${errCrmAdmin}`,
      });
    }
    const adminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!adminUserId) {
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No admin user found for company',
      });
    }

    const salesforceContactMap =
      crmAdmin?.Company_Setting?.Salesforce_Field_Map?.contact_map;
    const salesforceAccountMap =
      crmAdmin?.Company_Setting?.Salesforce_Field_Map?.account_map;
    if (!salesforceContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Contact',
      });
    if (!salesforceAccountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Account',
      });

    // * Fetching salesforce token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.SALESFORCE,
      user_id: adminUserId,
    });

    // * Fetching the lead with lead_id
    const leadFetchPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['salesforce_owner_id', 'integration_id', 'user_id'],
        },
      },
    });

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [leadData, leadDataErr],
    ] = await Promise.all([accessTokenPromise, leadFetchPromise]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });

    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    // * Fetch owner of the lead
    const [user, userErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: leadData.user_id },
      extras: {
        attributes: ['salesforce_owner_id', 'integration_id', 'user_id'],
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

    const phoneNumberRegex =
      /^(?:\+\d{1,3}\s?)?(?:\(\d{1,4}\)\s?)?(?:\d{1,4}[\s-])?\d{7,14}$/;

    if (
      contact?.account?.phone_number &&
      !phoneNumberRegex.test(contact?.account?.phone_number)
    ) {
      return serverErrorResponseWithDevMsg({
        res,
        error:
          'Company phone number must be a valid phone number with a valid country code',
        msg: 'Error occurred while exporting contact to Salesforce',
      });
    }

    if (Array.isArray(contact?.phone_numbers)) {
      for (const phoneNumber of contact.phone_numbers) {
        if (!phoneNumberRegex.test(phoneNumber?.phone_number)) {
          return serverErrorResponseWithDevMsg({
            res,
            error: 'One or more phone numbers are invalid',
            msg: 'Error occurred while exporting contact to Salesforce',
          });
        }
      }
    }

    // * Create the lead in Salesforce
    let [data, errForData] = await LeadHelper.exportContactToSalesforce({
      access_token,
      instance_url,
      salesforce_owner_id: leadData?.User?.salesforce_owner_id,
      salesforceContactMap,
      salesforceAccountMap,
      contact,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting contact to salesforce',
      });
    logger.info('Created contact in salesforce: ', data);

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
        crm_integration: CRM_INTEGRATIONS.SALESFORCE,
        exported_as: 'contact',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported lead as salesforce contact.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting lead as salesforce contact: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting lead as salesforce contact: ${err}`,
    });
  }
};

const ExportController = {
  previewLead,
  previewContact,
  searchSalesforceAccounts,
  exportLead,
  exportContact,
};

module.exports = ExportController;
