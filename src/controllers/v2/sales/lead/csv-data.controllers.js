// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  placeholderDataForSFLead,
  placeholderDataForSFContact,
  placeholderDataForPDPerson,
} = require('../../../../utils/placeholderData');
const {
  SALESFORCE_CSV_IMPORT_FIELDS,
  PIPEDRIVE_CSV_IMPORT_FIELDS,
  SALESFORCE_EMAIL_FIELDS,
  SALESFORCE_PHONE_FIELDS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

//Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

const getCSVDataForSalesforceLeads = async (req, res) => {
  try {
    let csvFields = [];
    let dataRow = [];
    Object.entries(SALESFORCE_CSV_IMPORT_FIELDS).map((entry) => {
      csvFields.push(entry[1]);
      dataRow.push(placeholderDataForSFLead[entry[0]] ?? '');
    });
    SALESFORCE_EMAIL_FIELDS.map((email) => {
      csvFields.push(email);
      dataRow.push('');
    });
    SALESFORCE_PHONE_FIELDS.map((phoneNo) => {
      csvFields.push(phoneNo);
      dataRow.push('');
    });

    return successResponse(res, 'Fetched CSV data successfully', [
      csvFields,
      dataRow,
    ]);
  } catch (err) {
    logger.error(
      'Error occured while fetching CSV lead data for Salesforce in controller: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error occured while fetching CSV lead data: ${err.message}`,
    });
  }
};

const getCSVDataForSalesforceContacts = async (req, res) => {
  try {
    let [userForFieldMap, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_SETTINGS]: {
            [DB_TABLES.SALESFORCE_FIELD_MAP]: {},
          },
        },
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch CSV data for salesforce contacts',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    if (!userForFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly ask admin to create field map',
      });

    let salesforceFieldMap =
      userForFieldMap?.Company?.Company_Setting?.Salesforce_Field_Map;
    if (!salesforceFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'User does not have a salesforce crm account',
      });
    let contactMap = salesforceFieldMap?.contact_map;
    let accountMap = salesforceFieldMap?.account_map;
    if (!contactMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Contact',
      });
    if (!accountMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Salesforce Account',
      });

    let phoneNumbers = contactMap?.phone_numbers ?? [];
    let emails = contactMap?.emails ?? [];
    let csvFieldMap = {
      ...contactMap,
      ...accountMap,
      Id: SALESFORCE_CSV_IMPORT_FIELDS.CONTACT_ID,
      first_name: SALESFORCE_CSV_IMPORT_FIELDS.FIRST_NAME,
      last_name: SALESFORCE_CSV_IMPORT_FIELDS.LAST_NAME,
      salesforce_owner_id: SALESFORCE_CSV_IMPORT_FIELDS.OWNER_ID,
      company_id: SALESFORCE_CSV_IMPORT_FIELDS.COMPANY_ID,
      company_name: SALESFORCE_CSV_IMPORT_FIELDS.COMPANY_NAME,
      ...(accountMap?.phone_number !== undefined && {
        company_phone_number: SALESFORCE_CSV_IMPORT_FIELDS.COMPANY_PHONE_NUMBER,
      }),
    };
    delete csvFieldMap.integration_status;
    delete csvFieldMap.disqualification_reason;
    delete csvFieldMap.variables;
    delete csvFieldMap.emails;
    delete csvFieldMap.phone_numbers;
    delete csvFieldMap.name;
    delete csvFieldMap.phone_number;

    let csvFields = [];
    let dataRow = [];
    Object.entries(csvFieldMap).map((entry) => {
      csvFields.push(entry[1]);
      dataRow.push(placeholderDataForSFContact[entry[0]] ?? '');
    });
    emails.map((email) => {
      csvFields.push(email);
      dataRow.push('');
    });
    phoneNumbers.map((phoneNo) => {
      csvFields.push(phoneNo);
      dataRow.push('');
    });

    return successResponse(res, 'Fetched CSV data successfully', [
      csvFields,
      dataRow,
    ]);
  } catch (err) {
    logger.error(
      'Error occured while fetching CSV contact data for Salesforce in controller: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Error occured while fetching CSV contact data',
    });
  }
};

const getCSVDataForPipedrive = async (req, res) => {
  try {
    let [userForFieldMap, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_SETTINGS]: {
            [DB_TABLES.PIPEDRIVE_FIELD_MAP]: {},
          },
        },
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch csv data for Pipedrive',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    if (!userForFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly ask admin to create field map',
      });

    let pipedriveFieldMap =
      userForFieldMap?.Company?.Company_Setting?.Pipedrive_Field_Map;
    if (!pipedriveFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'User does not have a pipedrive crm account',
      });
    let personMap = pipedriveFieldMap?.person_map;
    let organizationMap = pipedriveFieldMap?.organization_map;
    if (!personMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Pipedrive Person',
      });
    if (!organizationMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'No field map set for Pipedrive Organization',
      });

    let phoneNumbers = [].concat(personMap?.phone_numbers ?? []);
    let emails = [].concat(personMap?.emails ?? []);
    let csvFieldMap = {
      ...personMap,
      ...organizationMap,
      Id: PIPEDRIVE_CSV_IMPORT_FIELDS.ID,
      first_name: PIPEDRIVE_CSV_IMPORT_FIELDS.FIRST_NAME,
      last_name: PIPEDRIVE_CSV_IMPORT_FIELDS.LAST_NAME,
      pipedrive_owner_id: PIPEDRIVE_CSV_IMPORT_FIELDS.OWNER_ID,
      company_id: PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_ID,
      company_name: PIPEDRIVE_CSV_IMPORT_FIELDS.COMPANY_NAME,
      ...(organizationMap?.size !== undefined && {
        size: PIPEDRIVE_CSV_IMPORT_FIELDS.SIZE,
      }),
    };
    delete csvFieldMap?.name;
    delete csvFieldMap?.variables;
    delete csvFieldMap?.phone_numbers;
    delete csvFieldMap?.emails;

    let csvFields = [];
    let dataRow = [];
    Object.entries(csvFieldMap).map((entry) => {
      csvFields.push(entry[1]);
      dataRow.push(placeholderDataForPDPerson[entry[0]] ?? '');
    });
    emails.map((email) => {
      csvFields.push(email);
      dataRow.push('');
    });
    phoneNumbers.map((phoneNo) => {
      csvFields.push(phoneNo);
      dataRow.push('');
    });

    return successResponse(res, 'Fetched CSV data successfully', [
      csvFields,
      dataRow,
    ]);
  } catch (err) {
    logger.error(
      'Error occured while fetching CSV data for Pipedrive in controller: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error occured while fetching CSV data for Pipedrive: ${err.message}`,
    });
  }
};

const CSVDataController = {
  getCSVDataForSalesforceLeads,
  getCSVDataForSalesforceContacts,
  getCSVDataForPipedrive,
};

module.exports = CSVDataController;
