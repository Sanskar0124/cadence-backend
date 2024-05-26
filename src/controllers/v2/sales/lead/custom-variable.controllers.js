// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  CRM_INTEGRATIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

//Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const SignatureRepository = require('../../../../../../Cadence-Brain/src/repository/signature.repository');

// Helpers and Services
const VariablesHelper = require('../../../../../../Cadence-Brain/src/helper/variables');

// Joi
const customVariableSchema = require('../../../../joi/v2/sales/lead/custom-variable.joi');

const processVariables = async (req, res) => {
  try {
    // Checking the request body
    const params = customVariableSchema.requestBodySchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    let { lead_id, body, from_email_address } = req.body;

    // Fetching lead from the db with lead_id
    const [lead, errForLeadFetch] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.ACCOUNT]: {},
        [DB_TABLES.USER]: {
          [DB_TABLES.COMPANY]: {},
        },
      },
    });
    if (errForLeadFetch || lead === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching custom variables',
        error: 'Lead not present in cadence tool.',
      });

    //generate date variables
    if (!lead?.User?.timezone?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: `No timezone selected. Please select a timezone from your profile section to send mail`,
      });

    let today = new Date();

    let todaysDate = today.toLocaleDateString('en-GB', {
      timeZone: lead?.User?.timezone,
      day: 'numeric',
      month: 'numeric',
    });

    //get day according to timezone
    let todaysDayDate = new Date().toLocaleDateString('en-US', {
      timeZone: lead?.User?.timezone,
    });
    todaysDayDate = new Date(todaysDayDate);
    let todaysDay = todaysDayDate.getDay();

    let tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow = tomorrow.toLocaleDateString('en-GB', {
      timeZone: lead?.User?.timezone,
      day: 'numeric',
      month: 'numeric',
    });

    //tomorrow day according to timezone
    let tomorrowsDay = new Date().toLocaleDateString('en-US', {
      timeZone: lead?.User?.timezone,
    });
    tomorrowsDay = new Date(tomorrowsDay);
    tomorrowsDay.setDate(tomorrowsDay.getDate() + 1);
    tomorrowsDay = tomorrowsDay.getDay();

    //get Primary phone number of lead
    const leadPrimaryPhonePromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD_PHONE_NUMBER,
      query: {
        lead_id: lead.lead_id,
        is_primary: true,
      },
    });
    const leadPrimaryEmailPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD_EMAIL,
      query: {
        lead_id: lead.lead_id,
        is_primary: true,
      },
    });
    let salesforceFieldMapPromise;
    if (lead?.User.integration_type === CRM_INTEGRATIONS.SALESFORCE) {
      salesforceFieldMapPromise = Repository.fetchOne({
        tableName: DB_TABLES.SALESFORCE_FIELD_MAP,
        query: {
          user_id: lead?.User.user_id,
        },
      });
    }

    let leadPrimaryPhone,
      errForLeadPrimaryPhone,
      leadPrimaryEmail,
      errForLeadPrimaryEmail,
      salesforceFieldMap,
      errForSalesforceFieldMap;

    if (lead?.User.integration_type === CRM_INTEGRATIONS.SALESFORCE) {
      [
        [leadPrimaryPhone, errForLeadPrimaryPhone],
        [leadPrimaryEmail, errForLeadPrimaryEmail],
        [salesforceFieldMap, errForSalesforceFieldMap],
      ] = await Promise.all([
        leadPrimaryPhonePromise,
        leadPrimaryEmailPromise,
        salesforceFieldMapPromise,
      ]);
    } else {
      [
        [leadPrimaryPhone, errForLeadPrimaryPhone],
        [leadPrimaryEmail, errForLeadPrimaryEmail],
      ] = await Promise.all([leadPrimaryPhonePromise, leadPrimaryEmailPromise]);
    }

    let lead_primary_phone = '';
    let lead_primary_email = '';
    //if (errForLeadPrimaryPhone) return [null, errForLeadPrimaryPhone];
    if (leadPrimaryPhone) {
      lead_primary_phone = leadPrimaryPhone.phone_number ?? lead.phone_number;
    }
    //if (errForLeadPrimaryEmail) return [null, errForLeadPrimaryEmail];
    if (leadPrimaryEmail) lead_primary_email = leadPrimaryEmail?.email_id || '';

    let zoomInfo = '';
    if (lead?.User.integration_type === CRM_INTEGRATIONS.SALESFORCE) {
      if (salesforceFieldMap) {
        const leadMap = JSON.parse(salesforceFieldMap.lead_map);
        zoomInfo = leadMap.zoom_nfo;
      }
    }

    // Processing the custom variables
    const stringArrayToProcess = [body];
    let signature = '';
    let allSignatures = null;
    if (
      body.includes('{{user_signature}}') ||
      body.includes('{{user_signature_primary}}')
    ) {
      let [defaultSignature, __] = await Repository.fetchAll({
        tableName: DB_TABLES.SIGNATURE,
        query: {
          user_id: lead?.User?.user_id,
          is_primary: true,
        },
      });
      if (defaultSignature == null) {
        let [selectedSignature, ___] = await Repository.fetchAll({
          tableName: DB_TABLES.SIGNATURE,
          query: {
            user_id: lead?.User?.user_id,
          },
        });
        if (selectedSignature === null) {
          signature = selectedSignature[0].signature;
        } else {
          signature = lead?.User?.first_name + ' ' + lead?.User?.last_name;
        }
      } else {
        signature = defaultSignature.signature;
      }
      let [allSignature, ___] = await Repository.fetchAll({
        tableName: DB_TABLES.SIGNATURE,
        query: {
          user_id: lead?.User?.user_id,
        },
      });
      allSignatures = allSignature;
    }
    let standardVariables = {
      //prospect variables
      first_name: lead?.first_name ?? ' ',
      last_name: lead?.last_name ?? ' ',
      full_name: `${lead?.first_name} ${lead?.last_name}`?.toString() ?? '',
      company_name: lead?.Account?.name ?? ' ',
      email: lead_primary_email ?? ' ',
      phone: lead_primary_phone ?? ' ',
      job_position: lead?.job_position ?? ' ',
      owner: lead?.User?.first_name ?? '' + ' ' + lead?.User?.last_name ?? '',
      linkedin_url: lead?.linkedin_url ?? ' ',
      signature: signature ?? ' ',
      allSignatures: allSignatures ?? ' ',
      //Account Variables
      company_linkedin_url: lead?.Account?.linkedin_url ?? ' ',
      website: lead?.Account?.url ?? ' ',
      size: lead?.Account?.size ?? ' ',
      zipcode: lead?.Account?.zipcode ?? ' ',
      country: lead?.Account?.country ?? ' ',
      company_phone_number: lead?.Account?.phone_number ?? ' ',
      //sender variables
      sender_first_name: lead?.User?.first_name ?? ' ',
      sender_last_name: lead?.User?.last_name ?? ' ',
      sender_name: lead?.User?.first_name + ' ' + lead?.User?.last_name ?? ' ',
      sender_email: from_email_address ?? lead?.User?.primary_email ?? ' ',
      sender_phone_number: lead?.User?.primary_phone_number ?? ' ',
      sender_company: lead?.User?.Company?.name ?? ' ',
      //Date Variables
      today: todaysDate ?? ' ',
      today_day: todaysDay ?? ' ',
      tomorrow: tomorrow ?? ' ',
      tomorrow_day: tomorrowsDay ?? ' ',
      fromTimezone: lead?.User?.timezone ?? ' ',
      calendly_link: lead?.User?.calendly_url,
      //Others
      zoom_info: zoomInfo ?? ' ',
    };
    const [processedStringArray, processingErr] =
      await VariablesHelper.replaceCustomVariables(
        lead,
        stringArrayToProcess,
        standardVariables
      );
    if (
      processingErr &&
      processingErr?.toLowerCase().includes('lead not found')
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching custom variables',
        error: `Lead does not exist in ${lead?.User?.Company?.integration_type}`,
      });
    else if (processingErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while fetching custom variables',
        error: processingErr,
      });

    body = VariablesHelper.replaceVariables(
      processedStringArray[0],
      standardVariables
    );

    return successResponse(res, 'Processed custom variables successfully', {
      body,
    });
  } catch (err) {
    logger.error(
      'Error occured while processing custom variables in controller: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error occured while processing custom variables: ${err.message}`,
    });
  }
};

const CustomVariablesController = {
  processVariables,
};

module.exports = CustomVariablesController;
