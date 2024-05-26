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
const SellsyService = require('../../../../../../../Cadence-Brain/src/services/Sellsy');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const PhoneNumberHelper = require('../../../../../../../Cadence-Brain/src/helper/phone-number');
const LeadEmailHelper = require('../../../../../../../Cadence-Brain/src/helper/email');
const ActivityHelper = require('../../../../../../../Cadence-Brain/src/helper/activity');

// Joi
const sellsyExportSchema = require('../../../../../joi/v2/sales/lead/lead-exports/sellsy-exports.joi');

const COMPANY_SIZE_OPTIONS_SELLSY = [
  { label: 'None', value: '0' },
  { label: 'From 1 to 5', value: '1' },
  { label: 'From 6 to 10', value: '6' },
  { label: 'From 11 to 49', value: '11' },
  { label: '50 and +', value: '51' },
];

const previewContact = async (req, res) => {
  try {
    const { lead_id } = req.params;
    if (!lead_id?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: 'Lead id cannot be null.',
      });

    // * Fetch sellsy field map
    const sellsyFieldMapPromise =
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

    const [[sellsyFieldMap, errFetchingSellsyFieldMap], [lead, leadErr]] =
      await Promise.all([sellsyFieldMapPromise, leadFetchPromise]);
    if (errFetchingSellsyFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview lead',
        error: errFetchingSellsyFieldMap,
      });
    if (leadErr || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Lead not present in cadence tool',
        error: leadErr,
      });

    const sellsyContactMap = sellsyFieldMap.contact_map;
    const sellsyCompanyMap = sellsyFieldMap.company_map;
    if (!sellsyContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for sellsy contact',
      });
    if (!sellsyCompanyMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for sellsy company',
      });

    // *  Obtaining Contact fields
    let contactFields = [];
    if (sellsyContactMap.first_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyContactMap.first_name?.replace('_', ' '),
        value: lead.first_name ?? '',
        name: 'first_name',
        type: 'input_box',
      });
    if (sellsyContactMap.last_name)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyContactMap.last_name?.replace('_', ' '),
        value: lead.last_name ?? '',
        name: 'last_name',
        type: 'input_box',
      });
    if (sellsyContactMap.job_position)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyContactMap.job_position?.replace('_', ' '),
        value: lead.job_position ?? '',
        name: 'job_position',
        type: 'input_box',
      });
    if (sellsyContactMap.linkedin_url)
      contactFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyContactMap.linkedin_url?.includes('.')
          ? sellsyContactMap.linkedin_url?.split('.')[1]?.replace('_', ' ')
          : sellsyContactMap.linkedin_url?.replace('_', ' '),
        value: lead.linkedin_url ?? '',
        name: 'linkedin_url',
        type: 'input_box',
      });

    // * Emails
    let emails = [];
    sellsyContactMap?.emails?.forEach((email_type, i) => {
      emails.push({
        editable: true,
        input_type: 'string',
        integration_label: email_type?.replace('_', ' '),
        value: i < lead.Lead_emails?.length ? lead.Lead_emails[i].email_id : '',
        name: email_type,
        type: 'input_box',
      });
    });

    // * Phone numbers
    let phone_numbers = [];
    sellsyContactMap?.phone_numbers?.forEach((phone_number_type, i) => {
      phone_numbers.push({
        editable: true,
        input_type: 'string',
        integration_label: phone_number_type?.replace('_', ' '),
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
    if (sellsyCompanyMap.name)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyCompanyMap.name?.replace('_', ' '),
        value: lead.Account?.name ?? '',
        name: 'name',
        type: 'advanced_dropdown',
      });
    if (sellsyCompanyMap.phone_number)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyCompanyMap.phone_number?.replace('_', ' '),
        value: lead.Account?.phone_number ?? '',
        name: 'phone_number',
        type: 'input_box',
      });
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: sellsyCompanyMap.size,
      })[0]
    ) {
      let numberOfEmp = lead.Account?.size;
      const numberValue = parseInt(lead.Account?.size);
      if (Number.isInteger(numberValue)) {
        if (numberValue <= 0) numberOfEmp = '0';
        if (numberValue >= 1 && numberValue <= 5) numberOfEmp = '1';
        else if (numberValue >= 6 && numberValue <= 10) numberOfEmp = '6';
        else if (numberValue >= 11 && numberValue <= 49) numberOfEmp = '11';
        else numberOfEmp = '51';
      }
      const sizeLabel = CompanyFieldMapHelper.getCompanySize({
        size: sellsyCompanyMap.size,
      })[0];
      companyFields.push({
        editable: true,
        integration_label: sizeLabel?.includes('.')
          ? sizeLabel?.split('.')[0]?.replaceAll('_', ' ')
          : sizeLabel?.replace('_', ' '),
        possible_values: COMPANY_SIZE_OPTIONS_SELLSY,
        value: numberOfEmp?.toString(),
        name: 'size',
        type: 'dropdown',
      });
    }
    if (sellsyCompanyMap.country)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyCompanyMap.country,
        value: lead.Account?.country ?? '',
        name: 'country',
        type: 'input_box',
      });
    if (sellsyCompanyMap.url)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyCompanyMap.url,
        value: lead?.Account?.url ?? '',
        name: 'url',
        type: 'input_box',
      });
    if (sellsyCompanyMap.zipcode)
      companyFields.push({
        editable: true,
        input_type: 'string',
        integration_label: sellsyCompanyMap.zipcode?.replace('_', ' '),
        value: lead?.Account?.zipcode,
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
      'Error while previewing sellsy contact data for export: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing sellsy contact data: ${err.message}`,
    });
  }
};

const searchSellsyCompanies = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name)
      return successResponse(res, 'Successfully fetched sellsy accounts', []);

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
          [DB_TABLES.SELLSY_FIELD_MAP]: {
            attributes: ['company_map'],
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
        msg: 'Failed to fetch Sellsy companies',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });
    }

    const adminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!adminUserId) {
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No CRM admin found for company',
      });
    }

    const sellsyCompanyMap =
      crmAdmin?.Company_Setting?.Sellsy_Field_Map?.company_map;
    if (!sellsyCompanyMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Sellsy company',
      });

    // * Fetching sellsy access token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SELLSY,
        user_id: adminUserId,
      });
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForAccessToken,
      });

    let fieldMapping = { id: 'integration_id' };
    let queryFields = 'field[]=id';

    if (sellsyCompanyMap.name) {
      fieldMapping[sellsyCompanyMap.name] = 'name';
      queryFields += `&field[]=${sellsyCompanyMap.name}`;
    }
    if (sellsyCompanyMap.phone_number) {
      fieldMapping[sellsyCompanyMap.phone_number] = 'phone_number';
      queryFields += `&field[]=${
        sellsyCompanyMap?.phone_number || 'phone_number'
      }`;
    }
    if (
      CompanyFieldMapHelper.getCompanySize({
        size: sellsyCompanyMap.size,
      })[0]
    ) {
      fieldMapping[
        CompanyFieldMapHelper.getCompanySize({
          size: sellsyCompanyMap.size,
        })[0]
      ] = 'size';
      queryFields += `&field[]=${
        sellsyCompanyMap.size || 'number_of_employees.label'
      }`;
    }
    if (sellsyCompanyMap.url) {
      fieldMapping[sellsyCompanyMap.url] = 'url';
      queryFields += `&field[]=${sellsyCompanyMap.url || 'website'}`;
    }

    let [orgSearchResults, errForOrgSearchResults] =
      await SellsyService.searchCompany({
        access_token,
        fields: queryFields,
        body: {
          filters: {
            name: name,
          },
        },
      });
    if (errForOrgSearchResults)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching sellsy companies',
        error: errForOrgSearchResults,
      });

    let results = orgSearchResults?.map((record) => {
      let modRecord = {};
      Object.keys(fieldMapping).forEach((fieldKey) => {
        let obj = record;
        let splitKeys = fieldKey.split('.');
        for (let i = 0; i < splitKeys.length - 1; i++) {
          let key = splitKeys[i];
          if (obj[key]) obj = obj[key];
        }
        modRecord[fieldMapping[fieldKey]] =
          obj?.[splitKeys[splitKeys.length - 1]];
      });

      if (modRecord.size) {
        const sizeLabel = modRecord.size;
        const sizeOption = COMPANY_SIZE_OPTIONS_SELLSY.find(
          (option) => option.label === sizeLabel
        );
        if (sizeOption) modRecord.size = sizeOption.value;
      }
      return modRecord;
    });

    return successResponse(
      res,
      'Successfully fetched sellsy companies.',
      results ?? []
    );
  } catch (err) {
    logger.error(`Error while fetching sellsy companies: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Error while fetching sellsy companies',
      error: `Error while fetching sellsy companies: ${err.message}`,
    });
  }
};

const exportContact = async (req, res) => {
  try {
    // * JOI Validation
    const body = sellsyExportSchema.exportContactSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Destructure request
    const { lead_id, contact_data, company_data, phone_numbers, emails } =
      body.value;

    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
          [DB_TABLES.SELLSY_FIELD_MAP]: {
            attributes: ['contact_map', 'company_map'],
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
        msg: 'Failed to export contact to sellsy',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });
    }
    const adminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!adminUserId) {
      return serverErrorResponseWithDevMsg({
        res,
        error: 'No CRM admin found for company',
      });
    }

    const sellsyContactMap =
      crmAdmin?.Company_Setting?.Sellsy_Field_Map?.contact_map;
    const sellsyCompanyMap =
      crmAdmin?.Company_Setting?.Sellsy_Field_Map?.company_map;
    if (!sellsyContactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for sellsy contact',
      });
    if (!sellsyCompanyMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for sellsy company',
      });

    // * Fetching sellsy token and instance url
    const accessTokenPromise = AccessTokenHelper.getAccessToken({
      integration_type: CRM_INTEGRATIONS.SELLSY,
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

    let accountPromise = [null, null];
    if (company_data?.integration_id)
      accountPromise = Repository.fetchOne({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          integration_id: company_data?.integration_id?.toString(),
          company_id: req.user.company_id,
        },
      });

    const [
      [{ access_token, instance_url }, errForAccessToken],
      [leadData, leadDataErr],
      [dbAccount, errForDbAccount],
    ] = await Promise.all([
      accessTokenPromise,
      leadFetchPromise,
      accountPromise,
    ]);
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
    if (errForDbAccount)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForDbAccount,
        msg: `Error while fetching account`,
      });

    if (dbAccount?.account_id) {
      await Repository.destroy({
        tableName: DB_TABLES.ACCOUNT,
        query: { account_id: leadData?.account_id },
      });

      leadData.account_id = dbAccount?.account_id;
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

    // * When a new company is to be created, check that company phone number
    // * is a valid phone number with a valid country code
    // const phoneNumberRegex = /^\+\d{1,3}\s?\d{10,15}$/;
    const phoneNumberRegex =
      /^(?:\+\d{1,3}\s?)?(?:\(\d{1,4}\)\s?)?(?:\d{1,4}[\s-])?\d{7,14}$/;
    if (
      company_data.phone_number &&
      !phoneNumberRegex.test(company_data.phone_number)
    )
      return serverErrorResponseWithDevMsg({
        res,
        error:
          'Company phone number must be a valid phone number with a valid country code',
        msg: 'Error occurred while exporting contact to sellsy',
      });

    // * Create the Person in sellsy
    let [data, errForData] = await LeadHelper.exportContactToSellsy({
      access_token,
      instance_url: instance_url || 'https://api.sellsy.com/v2',
      sellsyContactMap,
      sellsyCompanyMap,
      sellsy_owner_id: leadData?.User?.integration_id,
      contact,
    });
    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        error: errForData,
        msg: 'Error occurred while exporting contact to sellsy',
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
        crm_integration: CRM_INTEGRATIONS.SELLSY,
        exported_as: 'contact',
      });
    if (errForActivity)
      logger.error(`Error while creating activity:`, errForActivity);

    if (activity) logger.info('Created activity: ' + JSON.stringify(activity));

    return successResponse(
      res,
      'Successfully exported contact to sellsy.',
      data
    );
  } catch (err) {
    logger.error('Error while exporting contact to sellsy: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while exporting contact to sellsy: ${err}`,
    });
  }
};

const ExportController = {
  previewContact,
  searchSellsyCompanies,
  exportContact,
};

module.exports = ExportController;
