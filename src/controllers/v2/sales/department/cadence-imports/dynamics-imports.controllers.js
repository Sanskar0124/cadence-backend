// Utils
const logger = require('../../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
} = require('../../../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../../../Cadence-Brain/src/utils/modelEnums');

const {
  DYNAMICS_DATA_IMPORT_TYPES,
  DYNAMICS_LEAD_IMPORT_STATUS,
  CADENCE_LEAD_STATUS,
  LEAD_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  IMPORT_ERROR_TYPE,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');
const xlsx = require('xlsx');

// Repositories
const Repository = require('../../../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const DynamicsHelper = require('../../../../../../../Cadence-Brain/src/helper/dynamics');
const DynamicsService = require('../../../../../../../Cadence-Brain/src/services/Dynamics');
const AccessTokenHelper = require('../../../../../../../Cadence-Brain/src/helper/access-token');
const LeadHelper = require('../../../../../../../Cadence-Brain/src/helper/lead');
const SocketHelper = require('../../../../../../../Cadence-Brain/src/helper/socket');
const CompanyFieldMapHelper = require('../../../../../../../Cadence-Brain/src/helper/company-field-map');
const ImportHelper = require('../../../../../../../Cadence-Brain/src/helper/imports');
const LeadsToCadenceHelper = require('../../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const ExcelHelper = require('../../../../../../../Cadence-Brain/src/helper/excel');

// Joi validation
const DynamicsImportSchema = require('../../../../../joi/v2/sales/department/cadence-imports/dynamics-imports.joi');

// * Import list/lead/contact from dynamics
const importDynamicsDataToCadence = async (req, res) => {
  try {
    // * JOI Validation
    const params = DynamicsImportSchema.importDataToCadenceSchema.validate({
      ...req.params,
      ...req.query,
    });
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import data from dynamics',
        error: `Error while importing data from dynamics: ${params.error.message}`,
      });

    // * Destructuring
    const { type, id } = params.value;

    const initialPromise = await Promise.all([
      DynamicsHelper.getFieldMapForCompany(req.user.company_id),
      AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.DYNAMICS,
        user_id: req.user.user_id,
      }),
      Repository.fetchAll({
        tableName: DB_TABLES.USER,
        query: { company_id: req.user.company_id },
        extras: {
          attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
        },
      }),
    ]);

    // * Fetch dynamics field map
    let [dynamicsFieldMap, errFetchingDynamicsFieldMap] = initialPromise[0];
    if (errFetchingDynamicsFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Dynamics data to cadence',
        error: `Error while fetching field map for company from user: ${errFetchingDynamicsFieldMap}`,
      });

    const [{ access_token, instance_url }, errFetchingAccessToken] =
      initialPromise[1];
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from dynamics',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });

    const [users, errFetchingUsers] = initialPromise[2];
    if (errFetchingUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to import data from dynamics',
        error: `Error while fetching users: ${errFetchingUsers}`,
      });

    let dynamicsAccountMap = dynamicsFieldMap.account_map;
    let dynamicsContactMap = dynamicsFieldMap.contact_map;
    let dynamicsLeadMap = dynamicsFieldMap.lead_map;
    let contactFields, accountFields, leadFields;
    let leadsFromQuery, errFetchingLeads, leadFromQuery, errFetchingLeadFromDB;
    // * If type = contact
    switch (type) {
      case DYNAMICS_DATA_IMPORT_TYPES.CONTACT:
        if (dynamicsContactMap === null || dynamicsAccountMap === null)
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Please set Dynamics fields',
          });

        // * Construct fields for contact
        contactFields = Object.values(dynamicsContactMap).join(',');

        // * Construct fields for account
        accountFields = Object.values(dynamicsAccountMap).join(',');

        // * ODATA Contact query and search db using dynamics_contact_id
        const contactResults = await Promise.all([
          DynamicsService.query({
            query: `contacts(${id})?$select=${contactFields}&$expand=parentcustomerid_account($select=${accountFields}),owninguser($select=fullname)`,
            access_token,
            instance_url,
            type,
          }),
          Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: id,
              integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT,
              company_id: req.user.company_id,
            },
            include: {
              [DB_TABLES.USER]: {
                attributes: [
                  'user_id',
                  'integration_id',
                  'first_name',
                  'last_name',
                ],
              },
              [DB_TABLES.LEADTOCADENCE]: {
                attributes: ['lead_cadence_id', 'status'],
                [DB_TABLES.CADENCE]: {
                  attributes: ['cadence_id', 'name'],
                },
              },
            },
          }),
        ]);

        // * Destructure data from dynamics
        let [contactFromDynamics, errFetchingContactFromDynamics] =
          contactResults[0];
        if (errFetchingContactFromDynamics)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching contact from dynamics: ${errFetchingContactFromDynamics}`,
          });

        // * Destructure lead data
        [leadFromQuery, errFetchingLeadFromDB] = contactResults[1];
        if (errFetchingLeadFromDB)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching lead from query: ${errFetchingLeadFromDB}`,
          });

        if (!leadFromQuery) {
          contactStatus = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
          let user = users.find(
            (user) =>
              user.integration_id === contactFromDynamics?.owninguser?.ownerid
          );
          if (user) {
            contactFromDynamics.user_id = user?.user_id;
            contactFromDynamics.owner = {
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
              Id: user?.integration_id,
            };
          } else {
            contactStatus = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            contactFromDynamics.owner = null;
          }
        } else {
          contactStatus = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
          contactFromDynamics.lead_id = leadFromQuery?.lead_id;
          contactFromDynamics.Cadences = leadFromQuery.LeadToCadences;
          contactFromDynamics.user_id = leadFromQuery?.user_id;
          contactFromDynamics.owner = {
            name:
              (leadFromQuery?.User?.first_name || '') +
              ' ' +
              (leadFromQuery?.User?.last_name || ''),
            Id: leadFromQuery?.User?.integration_id,
          };
        }

        contactFromDynamics.status = contactStatus;

        let decodedContact = {
          first_name: contactFromDynamics[dynamicsContactMap?.first_name],
          last_name: contactFromDynamics[dynamicsContactMap?.last_name],
          lead_id: contactFromDynamics.lead_id,
          linkedin_url: contactFromDynamics[dynamicsContactMap?.linkedin_url],
          source_site: contactFromDynamics[dynamicsContactMap?.source_site],
          job_position: contactFromDynamics[dynamicsContactMap?.job_position],
          Id: contactFromDynamics.contactid,
          phone_numbers: [],
          emails: [],
          status: contactFromDynamics?.status,
          Owner: contactFromDynamics?.owner,
          user_id: contactFromDynamics?.user_id,
          Cadences: contactFromDynamics.Cadences || [],
        };

        if (contactFromDynamics?.parentcustomerid_account?.accountid) {
          decodedContact.Account = {
            Id: contactFromDynamics?.parentcustomerid_account.accountid,
            name: contactFromDynamics?.parentcustomerid_account?.[
              dynamicsAccountMap?.name
            ],
            url: contactFromDynamics?.parentcustomerid_account?.[
              dynamicsAccountMap?.url
            ],
            size: contactFromDynamics?.parentcustomerid_account?.[
              CompanyFieldMapHelper.getCompanySize({
                size: dynamicsAccountMap?.size,
              })[0]
            ],
            country:
              contactFromDynamics?.parentcustomerid_account?.[
                dynamicsAccountMap?.country
              ],
            zipcode:
              contactFromDynamics?.parentcustomerid_account?.[
                dynamicsAccountMap?.zip_code
              ],
            linkedin_url:
              contactFromDynamics?.parentcustomerid_account?.[
                dynamicsAccountMap?.linkedin_url
              ],
            phone_number:
              contactFromDynamics?.parentcustomerid_account?.[
                dynamicsAccountMap?.phone_number
              ],
          };
        } else decodedContact.Account = null;

        dynamicsContactMap?.phone_numbers.forEach((phone_type) => {
          decodedContact.phone_numbers.push({
            type: phone_type,
            phone_number: contactFromDynamics[phone_type],
          });
        });

        dynamicsContactMap?.emails.forEach((email_type) => {
          decodedContact.emails.push({
            type: email_type,
            email_id: contactFromDynamics[email_type],
          });
        });

        if (!decodedContact.first_name) {
          logger.info(`contact first name not present in dynamics.`);
          decodedContact.status =
            DYNAMICS_LEAD_IMPORT_STATUS.FIRST_NAME_NOT_PRESENT;
        }

        return successResponse(
          res,
          'Successfully fetched contact information',
          decodedContact
        );

      case DYNAMICS_DATA_IMPORT_TYPES.LEAD:
        if (dynamicsLeadMap === null)
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Please set Dynamics fields',
          });

        // * Construct query for lead
        leadFields = Object.values(dynamicsLeadMap).join(',');

        // * ODATA lead query and search db using dynamics_lead_id
        const LeadResults = await Promise.all([
          DynamicsService.query({
            query: `leads(${id})?$select=${leadFields}&$expand=owninguser($select=fullname)`,
            access_token,
            instance_url,
            type,
          }),
          Repository.fetchOne({
            tableName: DB_TABLES.LEAD,
            query: {
              integration_id: id,
              integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD,
              company_id: req.user.company_id,
            },
            include: {
              [DB_TABLES.USER]: {
                attributes: [
                  'user_id',
                  'integration_id',
                  'first_name',
                  'last_name',
                ],
              },
              [DB_TABLES.LEADTOCADENCE]: {
                attributes: ['lead_cadence_id', 'status'],
                [DB_TABLES.CADENCE]: {
                  attributes: ['cadence_id', 'name'],
                },
              },
            },
          }),
        ]);

        // * Destructure data from dynamics
        let [leadFromDynamics, errFetchingLeadFromDynamics] = LeadResults[0];
        if (errFetchingLeadFromDynamics)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching lead from dynamics: ${errFetchingLeadFromDynamics}`,
          });

        // * Destructure lead data
        [leadFromQuery, errFetchingLeadFromDB] = LeadResults[1];
        if (errFetchingLeadFromDB)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching lead from query: ${errFetchingLeadFromDB}`,
          });

        if (!leadFromQuery) {
          leadStatus = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
          let user = users.find(
            (user) =>
              user.integration_id === leadFromDynamics?.owninguser?.ownerid
          );
          if (user) {
            leadFromDynamics.user_id = user?.user_id;
            leadFromDynamics.owner = {
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
              Id: user?.integration_id,
            };
          } else {
            leadStatus = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            leadFromDynamics.owner = null;
          }
        } else {
          leadStatus = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
          leadFromDynamics.lead_id = leadFromQuery?.lead_id;
          leadFromDynamics.Cadences = leadFromQuery.LeadToCadences;
          leadFromDynamics.user_id = leadFromQuery?.user_id;
          leadFromDynamics.owner = {
            name:
              (leadFromQuery?.User?.first_name || '') +
              ' ' +
              (leadFromQuery?.User?.last_name || ''),
            Id: leadFromQuery?.User?.integration_id,
          };
        }
        leadFromDynamics.status = leadStatus;

        let decodedLead = {
          first_name: leadFromDynamics?.[dynamicsLeadMap?.first_name],
          last_name: leadFromDynamics?.[dynamicsLeadMap?.last_name],
          lead_id: leadFromDynamics.lead_id,
          linkedin_url: leadFromDynamics?.[dynamicsLeadMap?.linkedin_url],
          source_site: leadFromDynamics?.[dynamicsLeadMap?.source_site],
          job_position: leadFromDynamics?.[dynamicsLeadMap?.job_position],
          Id: leadFromDynamics.leadid,
          phone_numbers: [],
          emails: [],
          status: leadFromDynamics.status,
          Owner: leadFromDynamics.owner,
          Account: {
            name: leadFromDynamics?.[dynamicsLeadMap?.account],
            size: leadFromDynamics?.[
              CompanyFieldMapHelper.getCompanySize({
                size: dynamicsLeadMap?.size,
              })[0]
            ],
            url: leadFromDynamics?.[dynamicsLeadMap?.url],
            country: leadFromDynamics?.[dynamicsLeadMap?.country],
            zipcode: leadFromDynamics?.[dynamicsLeadMap?.zip_code],
            phone_number:
              leadFromDynamics?.[dynamicsLeadMap?.company_phone_number],
          },
          user_id: leadFromDynamics?.user_id,
          Cadences: leadFromDynamics.Cadences || [],
        };

        dynamicsLeadMap?.phone_numbers.forEach((phone_type) => {
          decodedLead.phone_numbers.push({
            type: phone_type,
            phone_number: leadFromDynamics[phone_type],
          });
        });

        dynamicsLeadMap?.emails.forEach((email_type) => {
          decodedLead.emails.push({
            type: email_type,
            email_id: leadFromDynamics[email_type],
          });
        });

        if (!decodedLead.first_name) {
          logger.info(`lead first name not present in dynamics.`);
          decodedLead.status =
            DYNAMICS_LEAD_IMPORT_STATUS.FIRST_NAME_NOT_PRESENT;
        } else if (!decodedLead?.Account?.name) {
          logger.info('lead account name not present in dynamics.');
          decodedLead.status = DYNAMICS_LEAD_IMPORT_STATUS.COMPANY_NOT_PRESENT;
        }

        return successResponse(
          res,
          'Successfully fetched lead information',
          decodedLead
        );

      case DYNAMICS_DATA_IMPORT_TYPES.CONTACT_LIST:
        if (dynamicsContactMap === null || dynamicsAccountMap === null)
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Please set Dynamics fields',
          });

        let contacts = null;
        let errFetchingContactsFromList = null;
        let contactIdList;
        const contactIds = id.split(',');
        //  validating last contact id length is correct or not
        if (contactIds[0].length !== contactIds[contactIds?.length - 1].length)
          contactIdList = contactIds
            .slice(0, -1)
            .map((id) => `contactid eq '${id}'`)
            .join(' or ');
        else
          contactIdList = contactIds
            .map((id) => `contactid eq '${id}'`)
            .join(' or ');

        // * Construct fields for contact
        contactFields = Object.values(dynamicsContactMap).join(',');

        // * Construct fields for account
        accountFields = Object.values(dynamicsAccountMap).join(',');

        let contactPromise = await Promise.all([
          DynamicsService.query({
            query: `contacts?$filter=${contactIdList}&$select=${contactFields}&$expand=parentcustomerid_account($select=${accountFields}),owninguser($select=fullname)`,
            access_token,
            instance_url,
            type,
          }),
          Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              [Op.or]: { integration_id: contactIds },
              integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT,
              company_id: req.user.company_id,
            },
            include: {
              [DB_TABLES.LEADTOCADENCE]: {
                attributes: ['lead_cadence_id', 'status'],
                [DB_TABLES.CADENCE]: {
                  attributes: ['cadence_id', 'name'],
                },
              },
            },
          }),
        ]);

        [contacts, errFetchingContactsFromList] = contactPromise[0];
        if (errFetchingContactsFromList)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching contact from list: ${errFetchingContactsFromList}`,
          });

        // * Query database to find existing links from dynamics integration_id
        [leadsFromQuery, errFetchingLeads] = contactPromise[1];
        if (errFetchingLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching leads: ${errFetchingLeads}`,
          });

        let decodedContacts = [];

        // * Loop through resultant contacts
        for (let contact of contacts?.value) {
          let decodedContact = {
            first_name: contact[dynamicsContactMap?.first_name],
            last_name: contact[dynamicsContactMap?.last_name],
            linkedin_url: contact[dynamicsContactMap?.linkedin_url],
            source_site: contact[dynamicsContactMap?.source_site],
            job_position: contact[dynamicsContactMap?.job_position],
            Id: contact.contactid,
            phone_numbers: [],
            emails: [],
            Owner: {
              name: contact?.owninguser.fullname,
              Id: contact?.owninguser.ownerid,
            },
          };

          if (contact?.parentcustomerid_account?.accountid) {
            decodedContact.Account = {
              Id: contact?.parentcustomerid_account?.accountid,
              name: contact?.parentcustomerid_account?.[
                dynamicsAccountMap.name
              ],
              url: contact?.parentcustomerid_account?.[dynamicsAccountMap?.url],
              size: contact?.parentcustomerid_account?.[
                CompanyFieldMapHelper.getCompanySize({
                  size: dynamicsAccountMap?.size,
                })[0]
              ],
              country:
                contact?.parentcustomerid_account?.[
                  dynamicsAccountMap?.country
                ],
              zipcode:
                contact?.parentcustomerid_account?.[
                  dynamicsAccountMap?.zip_code
                ],

              linkedin_url:
                contact?.parentcustomerid_account?.[
                  dynamicsAccountMap?.linkedin_url
                ],
              phone_number:
                contact?.parentcustomerid_account?.[
                  dynamicsAccountMap?.phone_number
                ],
            };
          } else decodedContact.Account = null;

          dynamicsContactMap?.phone_numbers.forEach((phone_type) => {
            decodedContact.phone_numbers.push({
              type: phone_type,
              phone_number: contact[phone_type],
            });
          });

          dynamicsContactMap?.emails.forEach((email_type) => {
            decodedContact.emails.push({
              type: email_type,
              email_id: contact[email_type],
            });
          });

          let user = users.find(
            (user) => user.integration_id === contact?.owninguser?.ownerid
          );
          if (user) {
            decodedContact.user_id = user?.user_id;
            decodedContact.Owner = {
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
              Id: user?.integration_id,
            };
          } else {
            logger.info(`user not present in dynamics.`);
            decodedContact.status =
              DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            decodedContact.Owner = null;
            decodedContacts.push(decodedContact);
            continue;
          }

          if (!decodedContact.first_name) {
            logger.info(`contact first name not present in dynamics.`);
            decodedContact.status =
              DYNAMICS_LEAD_IMPORT_STATUS.FIRST_NAME_NOT_PRESENT;
            decodedContacts.push(decodedContact);
            continue;
          }

          let isPresent = leadsFromQuery.find(
            (value) => value.integration_id === decodedContact.Id
          );

          if (isPresent) {
            decodedContact.status =
              DYNAMICS_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
            decodedContact.lead_id = isPresent?.lead_id;
            decodedContact.Cadences = isPresent?.LeadToCadences || [];
            decodedContact.user_id = isPresent?.user_id;
          } else {
            decodedContact.status =
              DYNAMICS_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
          }
          decodedContacts.push(decodedContact);
        }

        return successResponse(
          res,
          'Successfully fetched contact list data',
          decodedContacts
        );

      case DYNAMICS_DATA_IMPORT_TYPES.LEAD_LIST:
        if (dynamicsLeadMap === null)
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Please set Dynamics fields',
          });
        let leads = null;
        let errFetchingLeadsFromList = null;
        let leadIdList;
        const leadIds = id.split(',');
        //  validating last lead id length is correct or not
        if (leadIds[0].length !== leadIds[leadIds?.length - 1].length)
          leadIdList = leadIds
            .slice(0, -1)
            .map((id) => `leadid eq '${id}'`)
            .join(' or ');
        else leadIdList = leadIds.map((id) => `leadid eq '${id}'`).join(' or ');

        // * Construct query for lead
        leadFields = Object.values(dynamicsLeadMap).join(',');

        let leadPromise = await Promise.all([
          DynamicsService.query({
            query: `leads?$filter=${leadIdList}&$select=${leadFields}&$expand=owninguser($select=fullname)`,
            access_token,
            instance_url,
            type,
          }),
          Repository.fetchAll({
            tableName: DB_TABLES.LEAD,
            query: {
              [Op.or]: { integration_id: leadIds },
              integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD,
              company_id: req.user.company_id,
            },
            include: {
              [DB_TABLES.LEADTOCADENCE]: {
                attributes: ['lead_cadence_id', 'status'],
                [DB_TABLES.CADENCE]: {
                  attributes: ['cadence_id', 'name'],
                },
              },
            },
          }),
        ]);

        [leads, errFetchingLeadsFromList] = leadPromise[0];
        if (errFetchingLeadsFromList)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching contact from list: ${errFetchingLeadsFromList}`,
          });

        // * Query database to find existing links from integration_id
        [leadsFromQuery, errFetchingLeads] = leadPromise[1];
        if (errFetchingLeads)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to import data from dynamics',
            error: `Error while fetching leads: ${errFetchingLeads}`,
          });

        let decodedLeads = [];

        // * Loop through resultant contacts
        for (let lead of leads?.value) {
          let decodedLead = {
            first_name: lead?.[dynamicsLeadMap?.first_name],
            last_name: lead?.[dynamicsLeadMap?.last_name],
            linkedin_url: lead?.[dynamicsLeadMap?.linkedin_url],
            source_site: lead?.[dynamicsLeadMap?.source_site],
            job_position: lead?.[dynamicsLeadMap?.job_position],
            Id: lead.leadid,
            phone_numbers: [],
            emails: [],
            Owner: {
              name: lead?.owninguser.fullname,
              Id: lead?.owninguser.ownerid,
            },
            Account: {
              name: lead?.[dynamicsLeadMap?.account],
              size: lead?.[
                `${
                  CompanyFieldMapHelper.getCompanySize({
                    size: dynamicsLeadMap?.size,
                  })[0]
                }`
              ],
              url: lead?.[dynamicsLeadMap?.url],
              country: lead?.[dynamicsLeadMap?.country],
              zipcode: lead?.[dynamicsLeadMap?.zip_code],
              phone_number: lead?.[dynamicsLeadMap.company_phone_number],
            },
          };

          dynamicsLeadMap?.phone_numbers.forEach((phone_type) => {
            decodedLead.phone_numbers.push({
              type: phone_type,
              phone_number: lead[phone_type],
            });
          });

          dynamicsLeadMap?.emails.forEach((email_type) => {
            decodedLead.emails.push({
              type: email_type,
              email_id: lead[email_type],
            });
          });

          let user = users.find(
            (user) => user.integration_id === lead?.owninguser?.ownerid
          );

          if (user) {
            decodedLead.user_id = user?.user_id;
            decodedLead.Owner = {
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
              Id: user?.integration_id,
            };
          } else {
            logger.info(`user not present in dynamics.`);
            decodedLead.status = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            decodedLead.Owner = null;
            decodedLeads.push(decodedLead);
            continue;
          }

          if (!decodedLead.first_name) {
            logger.info(`lead first name not present in dynamics.`);
            decodedLead.status =
              DYNAMICS_LEAD_IMPORT_STATUS.FIRST_NAME_NOT_PRESENT;
            decodedLeads.push(decodedLead);
            continue;
          } else if (!decodedLead?.Account?.name) {
            logger.info('lead account name not present in dynamics.');
            decodedLead.status =
              DYNAMICS_LEAD_IMPORT_STATUS.COMPANY_NOT_PRESENT;
            decodedLeads.push(decodedLead);
            continue;
          }

          let isPresent = leadsFromQuery.find(
            (value) => value.integration_id === decodedLead.Id
          );

          if (isPresent) {
            decodedLead.status =
              DYNAMICS_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
            decodedLead.lead_id = isPresent?.lead_id;
            decodedLead.Cadences = isPresent?.LeadToCadences || [];
            decodedLead.user_id = isPresent?.user_id;
          } else {
            decodedLead.status =
              DYNAMICS_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;
          }
          decodedLeads.push(decodedLead);
        }

        return successResponse(
          res,
          'Successfully fetched lead list data',
          decodedLeads
        );

      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to import data from dynamics',
          error: `Error while importing data from dynamics: Invalid type`,
        });
    }
  } catch (err) {
    logger.error(
      `Error ocurred while fetching import data from dynamics: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching import data from dynamics: ${err.message}`,
    });
  }
};

const importDynamicsContacts = async (req, res) => {
  try {
    // * JOI Validation
    const body = DynamicsImportSchema.importDynamicsContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Dynamics contacts',
        error: `Error while importing Dynamics contacts: ${body.error.message}`,
      });
    // * Destructure request
    const { contacts: leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Dynamics contacts',
        error: 'Contacts array is empty',
      });

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0;
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    let fetchedUserMap = {};
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: {
          where: {
            cadence_id,
            is_first: 1,
          },
          required: false,
        },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['name'],
        },
        [DB_TABLES.USER]: {
          attributes: ['first_name', 'last_name'],
        },
      },
    });
    if (errForCadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import dynamics contacts, please try again or contact support',
        error: errForCadence,
      });

    // * Store cadence in Recent cadences
    if (cadence?.cadence_id)
      await Repository.upsert({
        tableName: DB_TABLES.RECENT_ACTION,
        upsertObject: {
          user_id: req.user.user_id,
          cadence_id: cadence?.cadence_id,
        },
      });
    else
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import dynamics contacts, please try again or contact support',
        error: 'Cadence not found',
      });

    const node = cadence.Nodes?.[0];

    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );

    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg;
            if (r[1].error.includes('must be unique'))
              msg = 'Contact present in cadence tool';
            else msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            SocketHelper.sendCadenceImportLoaderEvent({
              loaderData: {
                index: i,
                size: leads.length,
              },
              socketId: loaderId,
            });
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead: ${lead.Id}`);

      // * Validate lead integration_id
      if (!lead.Id) {
        logger.info('Dynamics contact id not present');
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Contact id not present',
        });
        response.total_error++;
        i++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.Id,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      // * Add user_id to lead
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createContactFromDynamics({
          lead,
          cadence,
          node,
          company_id: user.company_id,
        })
      );

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg;
        if (r[1].error.includes('must be unique'))
          msg = 'Contact present in cadence tool';
        else msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: i,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    // * Send success response with socket
    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create contacts in tool from dynamics: `,
      err
    );
    if (!res.headersSent)
      return successResponse(res, 'Unable to import contacts');
  }
};

// * Import leads
const importDynamicsLeads = async (req, res) => {
  try {
    // * JOI Validation
    const body = DynamicsImportSchema.importDynamicsLeadSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to import Dynamics leads',
        error: `Error while importing Dynamics leads: ${body.error.message}`,
      });

    const { leads, cadence_id, loaderId } = body.value;
    if (leads === undefined || leads.length === 0)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to import Dynamics leads',
        error: 'Leads array in empty',
      });

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0; // * Index declaration for loop
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    let fetchedUserMap = {};
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.NODE]: {
          where: {
            cadence_id,
            is_first: 1,
          },
          required: false,
        },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['name'],
        },
        [DB_TABLES.USER]: {
          attributes: ['first_name', 'last_name'],
        },
      },
    });
    if (errForCadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import dynamics contacts, please try again or contact support',
        error: errForCadence,
      });

    // * Store cadence in Recent cadences
    if (cadence?.cadence_id)
      await Repository.upsert({
        tableName: DB_TABLES.RECENT_ACTION,
        upsertObject: {
          user_id: req.user.user_id,
          cadence_id: cadence?.cadence_id,
        },
      });
    else
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import dynamics contacts, please try again or contact support',
        error: 'Cadence not found',
      });

    const node = cadence.Nodes?.[0];

    successResponse(
      res,
      'Started importing leads, please check back after some time'
    );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg;
            if (r[1].error.includes('must be unique'))
              msg = 'Lead present in cadence tool';
            else msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
            });
            response.total_error++;
            SocketHelper.sendCadenceImportLoaderEvent({
              loaderData: {
                index: leadCadenceOrderBatch,
                size: leads.length,
              },
              socketId: loaderId,
            });
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      // * Assign lead to cadence order for lead
      lead.leadCadenceOrder = i + 1;
      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      logger.info(`For lead id: ${lead.Id}`);

      // * If not lead.integration_id
      if (!lead.Id) {
        logger.info('Lead Id not present');
        i++;
        response.element_error.push({
          integration_id: null,
          cadence_id: lead.cadence_id,
          msg: 'Lead id not present',
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      //* Account name check
      if (!lead?.Account?.name) {
        logger.info('Lead company name is not present');
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: 'Lead company name not present',
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }

      // * Fetch user
      let [user, errFetchingUser] = await ImportHelper.getUser({
        user_integration_id: lead.Owner.Id,
        company_id: req.user.company_id,
        fetchedUserMap,
      });
      if (errFetchingUser) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errFetchingUser,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      // * Add user_id to lead
      lead.user_id = user.user_id;

      // * Check if user has access to cadence
      let [hasAccess, errCheckingAccess] = ImportHelper.checkCadenceAccess({
        cadence,
        user,
      });
      if (errCheckingAccess) {
        i++;
        response.element_error.push({
          integration_id: lead.integration_id,
          cadence_id: lead.cadence_id,
          msg: errCheckingAccess,
          type: IMPORT_ERROR_TYPE.CADENCE_ACCESS,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      }
      lead.cadenceStatus = cadence?.status;

      promiseArray.push(
        LeadHelper.createLeadFromDynamics({
          lead,
          cadence,
          node,
          company_id: user.company_id,
        })
      );

      SocketHelper.sendCadenceImportLoaderEvent({
        loaderData: {
          index: leadCadenceOrderBatch,
          size: leads.length,
        },
        socketId: loaderId,
      });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg;
        if (r[1].error.includes('must be unique'))
          msg = 'Lead present in cadence tool';
        else msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
        });
        response.total_error++;
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];

    SocketHelper.sendCadenceImportResponseEvent({
      socketId: loaderId,
      response_data: response,
    });
  } catch (err) {
    logger.error(
      `An error ocurred while trying to create leads in tool from dynamics: `,
      err
    );
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while importing Dynamics Leads: ${err.message}`,
      });
  }
};

const linkContactsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = DynamicsImportSchema.importDynamicsContactSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to link contacts with cadence',
        error: `Error while linking contacts with cadence: ${body.error.message}`,
      });

    // * Destructure request
    const {
      contacts: leads,
      cadence_id,
      loaderId,
      stopPreviousCadences,
      websocket = true,
    } = body.value;

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0; // * Index declaration for loop
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: CRM_INTEGRATIONS.DYNAMICS,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not link dynamics contacts, please try again or contact support',
        error: errFetchingPreImportData,
      });
    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started linking contacts, please check back after some time'
      );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
              type: r[1].type,
            });
            response.total_error++;
            if (websocket)
              SocketHelper.sendCadenceImportLoaderEvent({
                loaderData: {
                  index: leadCadenceOrderBatch,
                  size: leads.length,
                },
                socketId: loaderId,
              });
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.integration_id}`);

      promiseArray.push(
        LeadHelper.linkDynamicsLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );
      if (websocket)
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
          type: r[1].type,
        });
        response.total_error++;
        if (websocket)
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: leadCadenceOrderBatch,
              size: leads.length,
            },
            socketId: loaderId,
          });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else
      return successResponse(
        res,
        'Leads have been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking contacts to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking contacts to cadence: ${err.message}`,
      });
  }
};

// * Link existing lead with cadence
const linkLeadsWithCadence = async (req, res) => {
  try {
    // * JOI Validation
    const body = DynamicsImportSchema.importDynamicsLeadSchema.validate(
      req.body
    );
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to link leads with cadence',
        error: `Error while linking leads with cadence: ${body.error.message}`,
      });

    // * Destructure request
    const {
      leads,
      cadence_id,
      loaderId,
      stopPreviousCadences,
      websocket = true,
    } = body.value;

    // * === Variable Declaration ===
    let promiseArray = []; // * Promise array to process leads faster
    let i = 0; // * Index declaration for loop
    let leadCadenceOrderBatch = -1; // * Lead cadence order declaration
    // * Declare response structure
    let response = {
      total_success: 0,
      total_error: 0,
      element_success: [],
      element_error: [],
    };
    // * === END OF VARIABLE DECLARATION ===

    // * Fetch Import Pre-requisite
    let [
      { access_token, instance_url, companyFieldMap, cadence, node },
      errFetchingPreImportData,
    ] = await ImportHelper.preImportData({
      user_id: req.user.user_id,
      cadence_id,
      integration_type: CRM_INTEGRATIONS.DYNAMICS,
    });
    if (errFetchingPreImportData)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Could not import dynamics contacts, please try again or contact support',
        error: errFetchingPreImportData,
      });
    // * Send success response indicating processing has been started
    if (websocket)
      successResponse(
        res,
        'Started linking leads, please check back after some time'
      );
    for (let lead of leads) {
      if (leadCadenceOrderBatch != 0 && leadCadenceOrderBatch % 10 === 0) {
        let results = await Promise.all(promiseArray);
        for (let r of results) {
          if (r[1]) {
            let msg = r[1].error;
            response.element_error.push({
              integration_id: r[1].integration_id,
              cadence_id,
              msg,
              type: r[1].type,
            });
            response.total_error++;
            if (websocket)
              SocketHelper.sendCadenceImportLoaderEvent({
                loaderData: {
                  index: leadCadenceOrderBatch,
                  size: leads.length,
                },
                socketId: loaderId,
              });
            continue;
          } else {
            response.element_success.push({
              integration_id: r[0].integration_id,
              cadence_id: cadence_id,
              lead_id: r[0].lead_id,
            });
            response.total_success++;
          }
        }
        LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
        promiseArray = [];
      }

      lead.integration_id = lead.Id;
      lead.cadence_id = cadence_id;

      // * Assign lead to cadence order for lead
      let lead_cadence_order = i + 1;

      logger.info(`Processing link for ${lead.integration_id}`);

      promiseArray.push(
        LeadHelper.linkDynamicsLeadWithCadence({
          integration_id: lead.integration_id,
          company_id: req.user.company_id,
          lead_cadence_order,
          stopPreviousCadences,
          node,
          cadence,
        })
      );
      if (websocket)
        SocketHelper.sendCadenceImportLoaderEvent({
          loaderData: {
            index: leadCadenceOrderBatch,
            size: leads.length,
          },
          socketId: loaderId,
        });

      leadCadenceOrderBatch++;
    }

    let results = await Promise.all(promiseArray);
    for (let r of results) {
      if (r[1]) {
        let msg = r[1].error;
        response.element_error.push({
          integration_id: r[1].integration_id,
          cadence_id,
          msg,
          type: r[1].type,
        });
        response.total_error++;
        if (websocket)
          SocketHelper.sendCadenceImportLoaderEvent({
            loaderData: {
              index: leadCadenceOrderBatch,
              size: leads.length,
            },
            socketId: loaderId,
          });
        continue;
      } else {
        response.element_success.push({
          integration_id: r[0].integration_id,
          cadence_id: cadence_id,
          lead_id: r[0].lead_id,
        });
        response.total_success++;
      }
    }
    LeadsToCadenceHelper.updateLeadCadenceOrderForCadence(cadence_id);
    promiseArray = [];
    if (websocket)
      SocketHelper.sendCadenceImportResponseEvent({
        socketId: loaderId,
        response_data: response,
      });
    else
      return successResponse(
        res,
        'Leads have been processed successfully',
        response
      );
  } catch (err) {
    logger.error(`Error while linking leads to cadence: `, err);
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while linking leads to cadence: ${err.message}`,
      });
  }
};

const extractColumns = async (req, res) => {
  try {
    // File validation
    const supportedExtensions = ['xlsx'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );

    if (!supportedExtensions.includes(fileExtension.toLowerCase()))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `We only support xlsx file type`,
      });
    const workbook = xlsx.readFile(req.file.path);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const options = {
      header: 1,
      range: `A1:AZ10`,
      blankrows: false,
      defval: '',
      raw: false,
      rawNumbers: false,
    };

    let workbook_response = xlsx.utils.sheet_to_json(worksheet, options);
    const headers = workbook_response[0].filter((item) => item !== '');
    return successResponse(res, 'Successfully fetched excel Columns', headers);
  } catch (err) {
    logger.error('An error occurred while fetching Excel Columns : ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching Excel columns: ${err.message}`,
    });
  }
};

const previewLeads = async (req, res) => {
  try {
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }

    let body = DynamicsImportSchema.leadsPreviewSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    const { loaderId, field_map } = body.value;

    // File validation
    const supportedExtensions = ['xlsx'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );
    if (!supportedExtensions.includes(fileExtension.toLowerCase()))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `We only support xlsx file type`,
      });

    let [leads, errForLeads] = await ExcelHelper.parseXlsx(req.file.path, 1000);
    if (errForLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while parsing excel file',
      });

    // * Fetch Import Pre-requisite
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.DYNAMICS,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Kindly log in to dynamics.')
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with dynamics`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    const dynamicsFieldMap = field_map;

    let i = 0;
    let leadsToPreview = [];
    let userObj = {};
    const leadIds = leads.map((lead) => lead[dynamicsFieldMap?.id]);

    const leadPromise = Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        [Op.or]: { integration_id: leadIds },
        integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD,
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
        },
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['lead_cadence_id', 'cadence_id', 'status'],
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
          },
        },
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name', 'phone_number', 'size', 'url'],
        },
      },
    });

    const usersPromise = Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { company_id: req.user.company_id },
      extras: {
        attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
      },
    });

    let [[dbLeads, errFetchingLeads], [users, errForUsers]] = await Promise.all(
      [leadPromise, usersPromise]
    );
    if (errFetchingLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from Excel',
        error: `Error while fetching dbContacts: ${errFetchingLeads}`,
      });

    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from Excel',
        error: `Error while fetching users: ${errForUsers}`,
      });

    while (i < leads.length) {
      let lead = leads[i];

      let createdLead = {
        Id: lead[dynamicsFieldMap?.id],
        first_name: lead[dynamicsFieldMap?.first_name],
        last_name: lead[dynamicsFieldMap?.last_name],
        linkedin_url: lead[dynamicsFieldMap?.linkedin_url],
        job_position: lead[dynamicsFieldMap?.job_position],
        emails: [],
        phone_numbers: [],
        integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD,
        Account: {
          name: lead[dynamicsFieldMap?.company],
          phone_number: lead[dynamicsFieldMap?.company_phone_number],
          size: lead[dynamicsFieldMap?.size],
          url: lead[dynamicsFieldMap?.url],
          country: lead[dynamicsFieldMap?.country],
          zipcode: lead[dynamicsFieldMap?.zip_code],
        },
      };
      dynamicsFieldMap?.phone_numbers?.forEach((phone_number) => {
        createdLead.phone_numbers.push({
          phone_number: lead[phone_number.column_name]?.trim() || null,
          type: phone_number.type,
        });
      });
      dynamicsFieldMap?.emails?.forEach((email) => {
        createdLead.emails.push({
          email_id: lead[email.column_name]?.trim() || null,
          type: email.type,
        });
      });

      if (!lead[dynamicsFieldMap?.id]) {
        logger.info(`lead id not present in excel.`);
        createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_ID_NOT_PRESENT;
        createdLead.Owner = null;
        leadsToPreview.push(createdLead);
        i++;
        continue;
      } else if (!lead[dynamicsFieldMap?.first_name]) {
        logger.info(`first name not present in excel.`);
        createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.FIRST_NAME_NOT_PRESENT;
        createdLead.Owner = null;
        leadsToPreview.push(createdLead);
        i++;
        continue;
      } else if (!lead[dynamicsFieldMap?.company]) {
        logger.info(`company not present in excel.`);
        createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.COMPANY_NOT_PRESENT;
        createdLead.Owner = null;
        createdLead.Account = null;
        leadsToPreview.push(createdLead);
        i++;
        continue;
      } else if (!lead[dynamicsFieldMap?.user_name]) {
        logger.info(`User not present in dynamics.`);
        createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        createdLead.Owner = null;
        leadsToPreview.push(createdLead);
        i++;
        continue;
      }

      const isPresent = dbLeads.find(
        (dbLead) => dbLead.integration_id === createdLead.Id
      );

      if (isPresent) {
        createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        createdLead.lead_id = isPresent.lead_id;
        createdLead.Cadences = isPresent?.LeadToCadences;
        createdLead.Account = isPresent?.Account;
        createdLead.user_id = isPresent?.user_id;
        createdLead.Owner = {
          Id: isPresent?.User?.integration_id,
          name: `${isPresent?.User?.first_name} ${isPresent?.User?.last_name}`,
        };
      } else {
        createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

        if (!(lead[dynamicsFieldMap?.user_name] in userObj)) {
          let [leadFromDynamics, errFetchingLeadFromDynamics] =
            await DynamicsService.query({
              query: `leads(${
                lead[dynamicsFieldMap.id]
              })?$select=fullname&$expand=owninguser($select=fullname,domainname)`,
              access_token,
              instance_url,
            });

          if (errFetchingLeadFromDynamics) {
            logger.error(
              `Error while fetching lead owner from dynamics: ${errFetchingLeadFromDynamics}`
            );
            userObj[lead[dynamicsFieldMap.user_name]] = null; // cache not present case so that we do not try to process this user again
            createdLead.Owner = null;
            createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;

            leadsToPreview.push(createdLead);
            i++;
            continue;
          }
          let user = users.find(
            (user) =>
              user.integration_id === leadFromDynamics?.owninguser?.ownerid
          );
          if (
            lead[dynamicsFieldMap.user_name] !==
              leadFromDynamics?.owninguser?.domainname ||
            !user
          ) {
            logger.info('Owner not present in our tool.');
            userObj[lead[dynamicsFieldMap.user_name]] = null; // cache not present case so that we do not try to process this user again
            createdLead.Owner = null;
            createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          } else {
            userObj[lead[dynamicsFieldMap.user_name]] = user; // cache present case so that we do not try to process this user again
            createdLead.Owner = {
              Id: user.integration_id,
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
            };
            createdLead.user_id = user.user_id;
          }
        } else {
          /*
           * user is cached in this case
           * Here we can have 2 cases
           * Case 1: cache tells that user is present in our tool, the cache will contain the actual user
           * Case 2: cache tells that user is not present in our tool, the cache will contain null
           * */
          if (!userObj[lead[dynamicsFieldMap?.user_name]]) {
            // case 2, if no valid value is present
            logger.info('Owner not present in our tool.');
            createdLead.Owner = null;
            createdLead.status = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            userObj[lead[dynamicsFieldMap?.user_name]] = null; // cache not present case so that we do not try to process this user again
          } else {
            // case 1,  user is found
            let user = userObj[lead[dynamicsFieldMap?.user_name]];
            createdLead.Owner = {
              Id: user.integration_id,
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
            };
            createdLead.user_id = user?.user_id;
          }
        }
      }

      leadsToPreview.push(createdLead);
      i++;
    }
    return successResponse(res, 'Lead have been processed.', leadsToPreview);
  } catch (err) {
    logger.error('Error while creating dynamics leads from excel: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing leads: ${err.message}`,
    });
  }
};

const previewContacts = async (req, res) => {
  try {
    try {
      req.body.field_map = JSON.parse(req.body.field_map);
    } catch (err) {
      return serverErrorResponseWithDevMsg({ res, msg: `Invalid field map` });
    }
    let body = DynamicsImportSchema.contactsPreviewSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to preview leads',
        error: body.error.details[0].message,
      });

    const { loaderId, field_map } = body.value;

    // File validation
    const supportedExtensions = ['xlsx'];
    let filename = req.file.originalname;
    let fileExtension = filename.slice(
      ((filename.lastIndexOf('.') - 1) >>> 0) + 2
    );
    if (!supportedExtensions.includes(fileExtension.toLowerCase()))
      return serverErrorResponseWithDevMsg({
        res,
        msg: `We only support xlsx file type`,
      });

    let [leads, errForLeads] = await ExcelHelper.parseXlsx(req.file.path, 1000);
    if (errForLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while parsing excel file',
      });

    // * Fetch Import Pre-requisite
    let [dynamicsAllFieldMap, errFetchingDynamicsFieldMap] =
      await DynamicsHelper.getFieldMapForCompany(req.user.company_id);
    if (errFetchingDynamicsFieldMap)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from Excel',
        error: `Error while fetching field map for company from user: ${errFetchingDynamicsFieldMap}`,
      });

    let dynamicsAccountMap = dynamicsAllFieldMap?.account_map;

    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.DYNAMICS,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Kindly log in to dynamics.')
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with dynamics`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    accountFields = Object.values(dynamicsAccountMap);

    let dynamicsFieldMap = field_map;

    let i = 0;
    let contactsToPreview = [];
    let userObj = {};
    let AccountMap = {};
    const contactIds = leads.map((lead) => lead[dynamicsFieldMap.id]);

    const contactPromise = Repository.fetchAll({
      tableName: DB_TABLES.LEAD,
      query: {
        [Op.or]: { integration_id: contactIds },
        integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT,
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
        },
        [DB_TABLES.LEADTOCADENCE]: {
          attributes: ['lead_cadence_id', 'cadence_id', 'status'],
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
          },
        },
        [DB_TABLES.ACCOUNT]: {
          attributes: ['name', 'phone_number', 'size', 'url', 'integration_id'],
        },
      },
    });

    const usersPromise = Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: { company_id: req.user.company_id },
      extras: {
        attributes: ['user_id', 'integration_id', 'first_name', 'last_name'],
      },
    });

    let [[dbLeads, errFetchingLeads], [users, errForUsers]] = await Promise.all(
      [contactPromise, usersPromise]
    );
    if (errFetchingLeads)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from Excel',
        error: `Error while fetching dbContacts: ${errFetchingLeads}`,
      });

    if (errForUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to preview contacts from Excel',
        error: `Error while fetching users: ${errForUsers}`,
      });

    while (i < leads.length) {
      let lead = leads[i];

      let createdContact = {
        Id: lead[dynamicsFieldMap?.id],
        first_name: lead[dynamicsFieldMap?.first_name],
        last_name: lead[dynamicsFieldMap?.last_name],
        linkedin_url: lead[dynamicsFieldMap?.linkedin_url],
        job_position: lead[dynamicsFieldMap?.job_position],
        emails: [],
        phone_numbers: [],
        integration_type: LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT,
      };

      dynamicsFieldMap?.phone_numbers?.forEach((phone_number) => {
        createdContact.phone_numbers.push({
          phone_number: lead[phone_number.column_name]?.trim() || null,
          type: phone_number.type,
        });
      });

      dynamicsFieldMap?.emails?.forEach((email) => {
        createdContact.emails.push({
          email_id: lead[email.column_name]?.trim() || null,
          type: email.type,
        });
      });

      if (!lead[dynamicsFieldMap?.id]) {
        logger.info('contact id not present in excel.');
        createdContact.Owner = null;
        createdContact.status =
          DYNAMICS_LEAD_IMPORT_STATUS.CONTACT_ID_NOT_PRESENT;
        createdContact.Account = lead[dynamicsFieldMap?.account_name]
          ? { name: lead[dynamicsFieldMap?.account_name] }
          : null;
        contactsToPreview.push(createdContact);
        i++;
        continue;
      } else if (!lead[dynamicsFieldMap?.first_name]) {
        logger.info('contact first name not present in excel.');
        createdContact.Owner = null;
        createdContact.status =
          DYNAMICS_LEAD_IMPORT_STATUS.FIRST_NAME_NOT_PRESENT;
        createdContact.Account = lead[dynamicsFieldMap?.account_name]
          ? { name: lead[dynamicsFieldMap?.account_name] }
          : null;
        contactsToPreview.push(createdContact);
        i++;
        continue;
      } else if (!lead[dynamicsFieldMap?.user_name]) {
        logger.info('contact owner not present in dynamics.');
        createdContact.Owner = null;
        createdContact.status = DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
        createdContact.Account = lead[dynamicsFieldMap?.account_name]
          ? { name: lead[dynamicsFieldMap?.account_name] }
          : null;
        contactsToPreview.push(createdContact);
        i++;
        continue;
      }

      if (lead[dynamicsFieldMap?.account_name]?.length) {
        if (!(lead[dynamicsFieldMap.account_name] in AccountMap)) {
          let [leadFromDynamics, errFetchingLeadFromDynamics] =
            await DynamicsService.query({
              query: `contacts(${
                lead[dynamicsFieldMap.id]
              })?$select=fullname&$expand=parentcustomerid_account($select=${accountFields}),owninguser($select=fullname,domainname)`,
              access_token,
              instance_url,
            });

          if (
            errFetchingLeadFromDynamics ||
            !leadFromDynamics?.parentcustomerid_account
          )
            createdContact.Account = null;
          else {
            let dynamicsAccount = leadFromDynamics?.parentcustomerid_account;

            let decodedAccount = {
              url: dynamicsAccount[dynamicsAccountMap?.url],
              size: dynamicsAccount[
                `${
                  CompanyFieldMapHelper.getCompanySize({
                    size: dynamicsAccountMap.size,
                  })[0]
                }`
              ],
              country: dynamicsAccount[dynamicsAccountMap?.country],
              name: dynamicsAccount[dynamicsAccountMap?.name],
              zipcode: dynamicsAccount[dynamicsAccountMap?.zip_code],
              phone_number: dynamicsAccount[dynamicsAccountMap?.phone_number],
              Id: dynamicsAccount?.accountid,
            };

            createdContact.Account = decodedAccount;
          }

          AccountMap[lead[dynamicsFieldMap.account_name]] =
            createdContact.Account;

          if (!(lead[dynamicsFieldMap?.user_name] in userObj)) {
            let user = users.find(
              (user) =>
                user.integration_id === leadFromDynamics?.owninguser?.ownerid
            );
            if (
              !user ||
              lead[dynamicsFieldMap?.user_name] !==
                leadFromDynamics?.owninguser?.domainname
            )
              userObj[lead[dynamicsFieldMap?.user_name]] = null;
            else userObj[lead[dynamicsFieldMap?.user_name]] = user;
          }
        } else
          createdContact.Account =
            AccountMap[lead[dynamicsFieldMap?.account_name]];
      } else createdContact.Account = null;

      const isPresent = dbLeads.find(
        (value) => value.integration_id === createdContact.Id
      );

      if (isPresent) {
        createdContact.status =
          DYNAMICS_LEAD_IMPORT_STATUS.LEAD_PRESENT_IN_TOOL;
        createdContact.lead_id = isPresent.lead_id;
        createdContact.Cadences = isPresent?.LeadToCadences;
        createdContact.Account = isPresent?.Account;
        createdContact.user_id = isPresent?.user_id;
        createdContact.Owner = {
          Id: isPresent?.User?.integration_id,
          name: `${isPresent?.User?.first_name} ${isPresent?.User?.last_name}`,
        };
      } else {
        createdContact.status = DYNAMICS_LEAD_IMPORT_STATUS.LEAD_ABSENT_IN_TOOL;

        if (!(lead[dynamicsFieldMap?.user_name] in userObj)) {
          let [leadFromDynamics, errFetchingLeadFromDynamics] =
            await DynamicsService.query({
              query: `contacts(${
                lead[dynamicsFieldMap.id]
              })?$select=fullname&$expand=owninguser($select=fullname,domainname)`,
              access_token,
              instance_url,
            });
          if (errFetchingLeadFromDynamics) {
            logger.error(
              `Error while fetching contact owner from dynamics: ${errFetchingLeadFromDynamics}`
            );
            userObj[lead[dynamicsFieldMap?.user_name]] = null; // cache not present case so that we do not try to process this user again
            createdContact.Owner = null;
            createdContact.status =
              DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;

            contactsToPreview.push(createdContact);
            i++;
            continue;
          }

          let user = users.find(
            (user) =>
              user.integration_id === leadFromDynamics?.owninguser?.ownerid
          );
          if (
            !user ||
            lead[dynamicsFieldMap?.user_name] !==
              leadFromDynamics?.owninguser?.domainname
          ) {
            logger.info('Owner not present in our tool.');
            userObj[lead[dynamicsFieldMap?.user_name]] = null; // cache not present case so that we do not try to process this user again
            createdContact.Owner = null;
            createdContact.status =
              DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
          } else {
            userObj[lead[dynamicsFieldMap?.user_name]] = user; // cache present case so that we do not try to process this user again
            createdContact.Owner = {
              Id: user.integration_id,
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
            };
            createdContact.user_id = user.user_id;
          }
        } else {
          /*
           * user is cached in this case
           * Here we can have 2 cases
           * Case 1: cache tells that user is present in our tool, the cache will contain the actual user
           * Case 2: cache tells that user is not present in our tool, the cache will contain null
           * */
          if (!userObj[lead[dynamicsFieldMap?.user_name]]) {
            // case 2, if no valid value is present
            logger.info('Owner not present in our tool.');
            createdContact.Owner = null;
            createdContact.status =
              DYNAMICS_LEAD_IMPORT_STATUS.USER_NOT_PRESENT;
            userObj[lead[dynamicsFieldMap.user_name]] = null; // cache not present case so that we do not try to process this user again
          } else {
            // case 1,  user is found
            let user = userObj[lead[dynamicsFieldMap?.user_name]];
            createdContact.Owner = {
              Id: user.integration_id,
              name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
            };
            createdContact.user_id = user?.user_id;
          }
        }
      }

      contactsToPreview.push(createdContact);
      i++;
    }
    return successResponse(
      res,
      'Contact have been processed.',
      contactsToPreview
    );
  } catch (err) {
    logger.error('Error while creating dynamics contacts from excel: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while previewing contacts: ${err.message}`,
    });
  }
};

module.exports = {
  importDynamicsDataToCadence,
  importDynamicsContacts,
  importDynamicsLeads,
  linkContactsWithCadence,
  linkLeadsWithCadence,
  extractColumns,
  previewLeads,
  previewContacts,
};
