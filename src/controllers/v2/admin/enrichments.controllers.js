// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  ENRICHMENT_SERVICES,
  CRM_INTEGRATIONS,
  LEAD_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { Op } = require('sequelize');

// Joi
const EnrichmentJoi = require('../../../joi/v2/admin/enrichments.joi');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');

const getEnrichments = async (req, res) => {
  try {
    // Fetch user with company tokens
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {},
          [DB_TABLES.ENRICHMENTS]: {},
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Addons',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestbadRequestResponseWithDevMsgResponse({
        res,
        msg: 'Failed to fetch enrichments',
        error: 'User not found',
      });

    const {
      lusha_api_key,
      kaspr_api_key,
      hunter_api_key,
      dropcontact_api_key,
      snov_client_id,
      snov_client_secret,
    } = user.Company?.Company_Token;

    const enrichments = user?.Company?.Enrichment;
    if (!enrichments)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch enrichments',
        error: 'No enrichments found for the company',
      });

    const data = {
      enr_id: enrichments.enr_id,
      is_lusha_configured: lusha_api_key && enrichments.is_lusha_activated,
      is_kaspr_configured: kaspr_api_key && enrichments.is_kaspr_activated,
      is_hunter_configured: hunter_api_key && enrichments.is_hunter_activated,
      is_dropcontact_configured:
        dropcontact_api_key && enrichments.is_dropcontact_activated,
      is_snov_configured:
        snov_client_id && snov_client_secret && enrichments.is_snov_activated,
      is_linkedin_activated: enrichments.is_linkedin_activated,
    };

    return successResponse(res, 'Successfully fetched enrichments.', data);
  } catch (err) {
    logger.error(`Error while getting enrichments: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while getting enrichments: ${err.message}`,
    });
  }
};

const getConfigurations = async (req, res) => {
  try {
    // Fetch user with company tokens
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      include: {
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_TOKENS]: {},
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['company_settings_id'],
          },
          [DB_TABLES.ENRICHMENTS]: {},
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch configurations',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch configurations',
        error: 'User not found',
      });

    // Fetch company's enrichments config
    const enrichments = user.Company?.Enrichment;
    if (!enrichments)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch configurations',
        error: `Enrichments not found`,
      });

    // Fetch field map
    const [fieldMap, errForFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errForFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch configurations',
        error: `Error while fetching company fieldmap:${errForFieldMap}`,
      });

    let data = {};

    const companyToken = user.Company?.Company_Token;

    switch (user.Company.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        const { lead_map, contact_map } = fieldMap;

        data = {
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: lead_map.phone_numbers,
            [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]:
              contact_map.phone_numbers,
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: lead_map.emails,
            [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: contact_map.emails,
          },
          ...enrichments,
        };
        break;

      case CRM_INTEGRATIONS.PIPEDRIVE:
        data = {
          ...enrichments,
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: [
              'home',
              'work',
              'mobile',
              'other',
            ],
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: [
              'home',
              'work',
              'other',
            ],
          },
        };
        break;

      case CRM_INTEGRATIONS.HUBSPOT:
        const hubspot_contact_map = fieldMap.contact_map;
        data = {
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]:
              hubspot_contact_map.phone_numbers,
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]:
              hubspot_contact_map.emails,
          },
          ...enrichments,
        };
        break;

      case CRM_INTEGRATIONS.SHEETS:
        const google_sheets_lead_map = fieldMap.lead_map;
        data = {
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]:
              google_sheets_lead_map.phone_numbers,
            [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]:
              google_sheets_lead_map.phone_numbers,
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]:
              google_sheets_lead_map.emails,
            [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: google_sheets_lead_map.emails,
          },
          ...enrichments,
        };
        break;

      case CRM_INTEGRATIONS.ZOHO:
        const zoho_lead_map = fieldMap.lead_map;
        const zoho_contact_map = fieldMap.contact_map;
        data = {
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: zoho_lead_map.phone_numbers,
            [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]:
              zoho_contact_map.phone_numbers,
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: zoho_lead_map.emails,
            [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: zoho_contact_map.emails,
          },
          ...enrichments,
        };
        break;

      case CRM_INTEGRATIONS.SELLSY:
        const sellsy_contact_map = fieldMap.contact_map;
        data = {
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]:
              sellsy_contact_map.phone_numbers,
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: sellsy_contact_map.emails,
          },
          ...enrichments,
        };
        break;

      case CRM_INTEGRATIONS.BULLHORN:
        const bullhorn_lead_map = fieldMap.lead_map;
        const bullhorn_contact_map = fieldMap.contact_map;
        const bullhorn_candidate_map = fieldMap.candidate_map;
        data = {
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]:
              bullhorn_lead_map.phone_numbers,
            [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]:
              bullhorn_contact_map.phone_numbers,
            [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]:
              bullhorn_candidate_map.phone_numbers,
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: bullhorn_lead_map.emails,
            [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]:
              bullhorn_contact_map.emails,
            [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]:
              bullhorn_candidate_map.emails,
          },
          ...enrichments,
        };
        break;

      case CRM_INTEGRATIONS.DYNAMICS:
        const dynamics_lead_map = fieldMap.lead_map;
        const dynamics_contact_map = fieldMap.contact_map;
        data = {
          lusha_api_key: companyToken?.lusha_api_key,
          kaspr_api_key: companyToken?.kaspr_api_key,
          hunter_api_key: companyToken?.hunter_api_key,
          dropcontact_api_key: companyToken?.dropcontact_api_key,
          snov_client_id: companyToken?.snov_client_id,
          snov_client_secret: companyToken?.snov_client_secret,
          phone_options: {
            [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]:
              dynamics_lead_map.phone_numbers,
            [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]:
              dynamics_contact_map.phone_numbers,
          },
          email_options: {
            [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: dynamics_lead_map.emails,
            [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]:
              dynamics_contact_map.emails,
          },
          ...enrichments,
        };
        break;

      default:
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Enrichments are not available for this integration_type',
        });
    }

    return successResponse(
      res,
      'Successfully fetched enrichments config.',
      data
    );
  } catch (err) {
    logger.error(`Error while fetching enrichments config: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching configurations: ${err.message}`,
    });
  }
};

const updateConfigurations = async (req, res) => {
  try {
    let body = EnrichmentJoi.updateEnrichmentsConfigSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: `${body.error.message}`,
      });
    body = body.value;

    delete body.integration_type;

    // Fetch user for company_id
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update configurations',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update configurations',
        error: 'User not found',
      });

    const apiKeys = {};

    // encrypt api keys
    if (body.lusha_api_key) {
      const [encryptedLushaApiKey, errForEncryptedLushaApiKey] =
        CryptoHelper.encrypt(body.lusha_api_key);
      if (!errForEncryptedLushaApiKey)
        apiKeys.encrypted_lusha_api_key = encryptedLushaApiKey;
      delete body.lusha_api_key;
    }

    if (body.kaspr_api_key) {
      const [encryptedKasprApiKey, errForEncryptedKasprApiKey] =
        CryptoHelper.encrypt(body.kaspr_api_key);
      if (!errForEncryptedKasprApiKey)
        apiKeys.encrypted_kaspr_api_key = encryptedKasprApiKey;
      delete body.kaspr_api_key;
    }

    if (body.hunter_api_key) {
      const [encryptedHunterApiKey, errForEncryptedHunterApiKey] =
        CryptoHelper.encrypt(body.hunter_api_key);
      if (!errForEncryptedHunterApiKey)
        apiKeys.encrypted_hunter_api_key = encryptedHunterApiKey;
      delete body.hunter_api_key;
    }

    if (body.dropcontact_api_key) {
      const [encryptedDCApiKey, errForEncryptedDCApiKey] = CryptoHelper.encrypt(
        body.dropcontact_api_key
      );
      if (!errForEncryptedDCApiKey)
        apiKeys.encrypted_dropcontact_api_key = encryptedDCApiKey;
      delete body.dropcontact_api_key;
    }

    if (body.snov_client_id) {
      const [encryptedSnovClientId, errForEncryptedSnovClientId] =
        CryptoHelper.encrypt(body.snov_client_id);
      if (!errForEncryptedSnovClientId)
        apiKeys.encrypted_snov_client_id = encryptedSnovClientId;
      delete body.snov_client_id;
    }

    if (body.snov_client_secret) {
      const [encryptedSnovClientSecret, errForEncryptedSnovClientSecret] =
        CryptoHelper.encrypt(body.snov_client_secret);
      if (!errForEncryptedSnovClientSecret)
        apiKeys.encrypted_snov_client_secret = encryptedSnovClientSecret;
      delete body.snov_client_secret;
    }
    const updatePromises = [];

    // update api keys
    if (Object.keys(apiKeys).length !== 0)
      updatePromises.push(
        Repository.update({
          tableName: DB_TABLES.COMPANY_TOKENS,
          updateObject: apiKeys,
          query: { company_id: user.company_id },
        })
      );

    // update enrichments config
    updatePromises.push(
      Repository.update({
        tableName: DB_TABLES.ENRICHMENTS,
        updateObject: body,
        query: {
          enr_id: body.enr_id,
        },
      })
    );

    await Promise.all(updatePromises);

    return successResponse(res, 'Successfully updated enrichments config.');
  } catch (err) {
    logger.error(`Error while updating enrichments config: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating enrichments config: ${err.message}`,
    });
  }
};

const getAllSubdepartmentsWithUsers = async (req, res) => {
  try {
    // Fetch user for company_id
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      extras: {
        attributes: ['department_id', 'company_id'],
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch groups',
        error: `Error while fetching user: ${errForUser}`,
      });
    if (!user)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sub departments with users',
        error: 'User not found',
      });

    let [subDepartments, errForSubDepartments] = await Repository.fetchAll({
      tableName: DB_TABLES.SUB_DEPARTMENT,
      query: {
        department_id: user.department_id,
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: [
            'first_name',
            'last_name',
            'user_id',
            'is_profile_picture_present',
            'profile_picture',
          ],
          [DB_TABLES.USER_TOKEN]: {
            attributes: [
              'lusha_service_enabled',
              'kaspr_service_enabled',
              'hunter_service_enabled',
              'dropcontact_service_enabled',
              'snov_service_enabled',
            ],
          },
        },
        [DB_TABLES.SUB_DEPARTMENT_SETTINGS]: {
          attributes: [
            'enable_new_users_lusha',
            'enable_new_users_kaspr',
            'enable_new_users_hunter',
            'enable_new_users_dropcontact',
            'enable_new_users_snov',
          ],
        },
      },
    });
    if (errForSubDepartments)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch groups',
        error: `Error while fetching groups: ${errForSubDepartments}`,
      });
    if (!subDepartments)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'No sub-departments found',
      });

    let adminSd = null;

    subDepartments = subDepartments.filter((sd) => {
      if (sd.name !== 'Admin') return true;
      else {
        adminSd = { ...sd };
        return false;
      }
    });

    subDepartments.unshift(adminSd);

    return successResponse(
      res,
      'Successfully fetched sub-departments with users.',
      subDepartments
    );
  } catch (err) {
    logger.error(
      `Error while fetching sub-departments for enrichment config: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching sub-departments for enrichment config: ${err.message}`,
    });
  }
};

const updateEnrichmentsAccess = async (req, res) => {
  try {
    let body = EnrichmentJoi.updateEnrichmentsAccessSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    const {
      type,
      checkedUserIds,
      uncheckedUserIds,
      enabledSdIds,
      disabledSdIds,
    } = body;

    let userTokenfield = null;
    let sdSettingField = null;

    switch (type) {
      case ENRICHMENT_SERVICES.LUSHA:
        userTokenfield = 'lusha_service_enabled';
        sdSettingField = 'enable_new_users_lusha';
        break;

      case ENRICHMENT_SERVICES.KASPR:
        userTokenfield = 'kaspr_service_enabled';
        sdSettingField = 'enable_new_users_kaspr';
        break;

      case ENRICHMENT_SERVICES.HUNTER:
        userTokenfield = 'hunter_service_enabled';
        sdSettingField = 'enable_new_users_hunter';
        break;

      case ENRICHMENT_SERVICES.DROPCONTACT:
        userTokenfield = 'dropcontact_service_enabled';
        sdSettingField = 'enable_new_users_dropcontact';
        break;

      case ENRICHMENT_SERVICES.SNOV:
        userTokenfield = 'snov_service_enabled';
        sdSettingField = 'enable_new_users_snov';
        break;
    }

    const updatePromises = [];

    if (checkedUserIds.length)
      updatePromises.push(
        Repository.update({
          tableName: DB_TABLES.USER_TOKEN,
          updateObject: {
            [userTokenfield]: true,
          },
          query: {
            user_id: {
              [Op.in]: checkedUserIds,
            },
          },
        })
      );

    if (uncheckedUserIds.length)
      updatePromises.push(
        Repository.update({
          tableName: DB_TABLES.USER_TOKEN,
          updateObject: {
            [userTokenfield]: false,
          },
          query: {
            user_id: {
              [Op.in]: uncheckedUserIds,
            },
          },
        })
      );

    if (enabledSdIds.length)
      updatePromises.push(
        Repository.update({
          tableName: DB_TABLES.SUB_DEPARTMENT_SETTINGS,
          updateObject: {
            [sdSettingField]: true,
          },
          query: {
            sd_id: {
              [Op.in]: enabledSdIds,
            },
          },
        })
      );

    if (disabledSdIds.length)
      updatePromises.push(
        Repository.update({
          tableName: DB_TABLES.SUB_DEPARTMENT_SETTINGS,
          updateObject: {
            [sdSettingField]: false,
          },
          query: {
            sd_id: {
              [Op.in]: disabledSdIds,
            },
          },
        })
      );

    await Promise.all(updatePromises);

    return successResponse(
      res,
      'Successfully updated enrichment access for users.'
    );
  } catch (err) {
    logger.error(`Error while updating enrichments access: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating enrichments access: ${err.message}`,
    });
  }
};

const EnrichmentControllers = {
  getEnrichments,
  getConfigurations,
  updateConfigurations,
  getAllSubdepartmentsWithUsers,
  updateEnrichmentsAccess,
};

module.exports = EnrichmentControllers;
