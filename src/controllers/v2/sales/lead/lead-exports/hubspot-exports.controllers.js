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
const HubspotService = require('../../../../../../../Cadence-Brain/src/services/Hubspot');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../../../Cadence-Brain/src/helper/email');
const ActivityHelper = require('../../../../../../../Cadence-Brain/src/helper/activity');

// Joi
const hubspotExportSchema = require('../../../../../joi/v2/sales/lead/lead-exports/hubspot-exports.joi');

const previewContact = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetch hubspot field map
    const hubspotFieldMapPromise =
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

    const [[hubspotFieldMap, errFetchingHubspotFieldMap], [lead, leadErr]] =
      await Promise.all([hubspotFieldMapPromise, leadFetchPromise]);
    if (errFetchingHubspotFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingHubspotFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    const hubspotContactMap = hubspotFieldMap.contact_map;
    const hubspotCompanyMap = hubspotFieldMap.company_map;
    if (!hubspotContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for hubspot contact',
      });
    if (!hubspotCompanyMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for hubspot company',
      });

    // *  Obtaining Contact fields
    let contactFields = [];
    if (hubspotContactMap.first_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotContactMap.first_name,
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (hubspotContactMap.last_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotContactMap.last_name,
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (hubspotContactMap.job_position)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotContactMap.job_position,
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (hubspotContactMap.linkedin_url)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotContactMap.linkedin_url,
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    hubspotContactMap?.emails?.forEach((email_type, i) => {
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
    hubspotContactMap?.phone_numbers?.forEach((phone_number_type, i) => {
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

    // *  Obtaining Company fields
    let companyFields = [];
    if (hubspotCompanyMap.name)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotCompanyMap.name,
        value: lead?.Account?.name ?? '',
        name: 'name',
        type: 'advanced_dropdown',
      });
    if (hubspotCompanyMap.phone_number)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotCompanyMap.phone_number,
        value: lead?.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (hubspotCompanyMap.linkedin_url)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotCompanyMap.linkedin_url,
        value: lead?.Account?.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: hubspotCompanyMap?.size,
      })[0]
    )
      companyFields.push({
        editable: true,
        integration_label: CompanyFieldMapHelper.getCompanySize({
          size: hubspotCompanyMap?.size,
        })[0],
        possible_values:
          hubspotCompanyMap?.size?.picklist_values ??
          ACCOUNT_SIZE.map((size) => ({
            label: size,
            value: size,
          })),
        value: lead?.Account?.size ?? '',
        name: 'size',
        type: 'dropdown',
      });
    if (hubspotCompanyMap.country)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotCompanyMap.country,
        value: lead?.Account?.country ?? '',
        name: 'country',
        type: 'input_box',
      });
    if (hubspotCompanyMap.url)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotCompanyMap.url,
        value: lead?.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (hubspotCompanyMap.zip_code)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: hubspotCompanyMap.zip_code,
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
    data.company_fields = companyFields;
    data.phone_numbers = phone_numbers;
    data.emails = emails;

    return successResponse(
      res,
      'Successfully fetched preview data for contact',
      data
    );
  } catch (err) {
    logger.error(
      'Error while previewing hubspot contact data for export: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing hubspot contact data: ${err.message}`,
    });
  }
};

const searchHubspotCompanies = async (req, res) => {
  try {
    const { company } = req.body;
    if (!company.name)
      return successResponse(res, 'Successfully fetched hubspot accounts', []);

    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'integration_id'],
        },
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
          [DB_TABLES.HUBSPOT_FIELD_MAP]: {
            attributes: ['company_map'],
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch hubspot accounts',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });

    const adminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!adminUserId)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch hubspot accounts',
        error: 'No admin user found for company',
      });

    const hubspotFieldMap =
      crmAdmin?.Company_Setting?.Hubspot_Field_Map?.company_map;
    if (!hubspotFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch hubspot accounts',
        error: 'No field map set for hubspot company',
      });

    // converting users into object for easy access
    let userObject = {};
    for (let user of crmAdmin.Users)
      if (user.integration_id) userObject[user.integration_id] = user.user_id;

    // * Fetching hubspot access token and instance url
    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        user_id: adminUserId,
      });
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    let account_properties_query = [];
    for (const [key, value] of Object.entries(hubspotFieldMap)) {
      if (key === 'disqualification_reason') continue;
      if (key === 'integration_status') {
        account_properties_query.push(value?.name);
        continue;
      }
      if (key === 'size') {
        account_properties_query.push(value?.name);
        continue;
      }
      if (key === 'variables') continue;

      if (typeof value === 'string') account_properties_query.push(value);
      else if (typeof value === 'object') {
        for (let v of value) account_properties_query.push(v);
      }
    }
    let search_term = company?.name.toLowerCase();
    instance_url = instance_url || 'https://api.hubapi.com';
    let [orgSearchResults, errForOrgSearchResults] =
      await HubspotService.searchCompany({
        access_token,
        instance_url,
        search_term,
        fields: account_properties_query,
        limit: 10,
      });
    if (errForOrgSearchResults)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching hubspot companies',
        error: errForOrgSearchResults,
      });

    let filteredResults = orgSearchResults?.results
      ?.map((record) => {
        record = { ...record, ...record.properties };
        delete record.properties;
        return record;
      })
      .filter((record) => record.name?.toLowerCase() === search_term);

    return successResponse(
      res,
      'Successfully fetched hubspot companies.',
      filteredResults ?? []
    );
  } catch (err) {
    logger.error(`Error while fetching hubspot companies: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Error while fetching hubspot companies',
      error: `Error while fetching hubspot companies: ${err.message}`,
    });
  }
};

const exportContact = async (req, res) => {
  try {
    // * JOI Validation
    const body = hubspotExportSchema.exportContactSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, contact_data, company_data, phone_numbers, emails } =
      body.value;

    // * Fetching hubspot token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.HUBSPOT,
      user_id: req.user.user_id,
    });

    // * Fetch hubspot field map and get the Lead map
    const hubspotFieldMapPromise =
      CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });

    // * Fetching the lead with lead_id
    const leadFetchPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['integration_id', 'user_id'],
        },
      },
    });

    let [
      [{ access_token, instance_url }, errForAccessToken],
      [hubspotFieldMap, errFetchingHubspotFieldMap],
      [leadData, leadDataErr],
    ] = await Promise.all([
      accessTokenPromise,
      hubspotFieldMapPromise,
      leadFetchPromise,
    ]);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });
    if (errFetchingHubspotFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingHubspotFieldMap,
        msg: `Error while fetching hubspot field map`,
      });
    if (leadDataErr || leadData === null)
      return serverErrorResponseWithDevMsg({
        res,
        error: 'Lead with the given lead id not present in cadence tool',
      });

    const hubspotContactMap = hubspotFieldMap.contact_map;
    const hubspotCompanyMap = hubspotFieldMap.company_map;
    if (!hubspotContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for hubspot contact',
      });
    if (!hubspotCompanyMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for hubspot company',
      });

    if (company_data?.integration_id) {
      const [fetchedAccount, errForFetchedAccount] = await Repository.fetchOne({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          integration_id: company_data?.integration_id,
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
    // * Structure Person
    let contact = { ...contact_data };
    contact.lead_id = lead_id;
    contact.account_id = leadData.account_id;
    contact.user_id = leadData.user_id;
    contact.account = { ...company_data };
    contact.account.account_id = leadData.account_id;
    contact.phone_numbers =
      phone_numbers?.filter((item) => item.phone_number?.length) ?? [];
    contact.emails = emails?.filter((item) => item.email_id?.length) ?? [];

    // * Create the Person in Pipedrive
    let [data, errForData] = await LeadHelper.exportContactToHubspot({
      access_token,
      instance_url: instance_url || 'https://api.hubapi.com',
      hubspot_owner_id: leadData.User?.integration_id,
      hubspotContactMap,
      hubspotCompanyMap,
      contact,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occured while exporting contact to hubspot',
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
        crm_integration: CRM_INTEGRATIONS.HUBSPOT,
        exported_as: 'contact',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported contact to hubspot.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting contact to hubspot: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting contact to hubspot: ${err}`,
    });
  }
};

const ExportController = {
  previewContact,
  searchHubspotCompanies,
  exportContact,
};

module.exports = ExportController;
