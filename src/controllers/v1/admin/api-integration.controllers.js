// Utils
const logger = require('../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
} = require('../../../utils/response');
const {
  LUSHA_KASPR_OPTIONS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');

// Repositories
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');
const CompanyTokensRepository = require('../../../../../Cadence-Brain/src/repository/company-tokens.repository');
const SubDepartmentRepository = require('../../../../../Cadence-Brain/src/repository/sub-department.repository');
const SubDepartmentSettingsRepository = require('../../../../../Cadence-Brain/src/repository/sub-department-settings.repository');
const CompanySettingsRepository = require('../../../../../Cadence-Brain/src/repository/company-settings.repository');
const UserTokenRepository = require('../../../../../Cadence-Brain/src/repository/user-token.repository');

// Helpers
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');

const getTokensAndSettings = async (req, res) => {
  try {
    // Fetch the admin
    const [admin, adminErr] = await UserRepository.getUserWithCompanyTokens({
      user_id: req.user.user_id,
    });
    if (adminErr) return serverErrorResponse(res, adminErr);
    if (!admin) return notFoundResponse(res, 'User not found.');

    // Fetch the sub-depts of the admin
    const [subDepartments, subDepartmentsErr] =
      await SubDepartmentRepository.getAllSubDepartmentsWithSettings({
        department_id: admin.department_id,
      });
    if (subDepartmentsErr) return serverErrorResponse(res, subDepartmentsErr);

    const data = { Company: admin.Company, Sub_Departments: subDepartments };
    return successResponse(
      res,
      'Successfully fetched all api tokens and settings',
      data
    );
  } catch (err) {
    logger.error(`Error while fetching all tokens and settings: `, err);
    return serverErrorResponse(res);
  }
};

const updateTokensAndSettings = async (req, res) => {
  try {
    const { api_keys, sub_department_settings, company_settings, company_id } =
      req.body;

    // update api keys (i.e. lusha and kaspr)
    if (api_keys.lusha_api_key) {
      const [encryptedLushaApiKey, errForEncryptedLushaApiKey] =
        CryptoHelper.encrypt(api_keys.lusha_api_key);
      if (!errForEncryptedLushaApiKey)
        api_keys.encrypted_lusha_api_key = encryptedLushaApiKey;
      delete api_keys.lusha_api_key;
    }

    if (api_keys.kaspr_api_key) {
      const [encryptedKasprApiKey, errForEncryptedKasprApiKey] =
        CryptoHelper.encrypt(api_keys.kaspr_api_key);
      if (!errForEncryptedKasprApiKey)
        api_keys.encrypted_kaspr_api_key = encryptedKasprApiKey;
      delete api_keys.kaspr_api_key;
    }

    const [_, errForUpdateCompanyTokens] =
      await CompanyTokensRepository.updateCompanyTokens(
        { company_id },
        api_keys
      );
    if (errForUpdateCompanyTokens)
      return serverErrorResponse(res, 'Failed to update company tokens');

    // 1. Loop through each sub-dept
    // 2. update sub-dept settings
    // 3. Fetch all users of the sub-dept
    // 4. Update the same setting in user_token of all users
    for (const sd_setting of sub_department_settings) {
      const [_, errForUpdateSubDept] =
        await SubDepartmentSettingsRepository.updateSubDepartmentSettingsByQuery(
          { sd_settings_id: sd_setting.sd_settings_id },
          sd_setting
        );
      const [users, errForUsers] = await UserRepository.findUsersByQuery({
        sd_id: sd_setting.sd_id,
      });
      if (!users?.length) continue;

      const userIds = users?.map((user) => user.user_id);
      const query = {
        user_id: {
          [Op.in]: userIds,
        },
      };

      const newTokens = {};
      if ('lusha_service_enabled' in sd_setting)
        newTokens.lusha_service_enabled = sd_setting.lusha_service_enabled;
      if ('kaspr_service_enabled' in sd_setting)
        newTokens.kaspr_service_enabled = sd_setting.kaspr_service_enabled;

      const [__, errForUpdatedTokens] =
        await UserTokenRepository.updateUserTokenByQuery(query, newTokens);
    }

    // update company_settings (i.e. 'lusha_kaspr_action')
    if (
      company_settings?.lusha_kaspr_action &&
      Object.values(LUSHA_KASPR_OPTIONS).includes(
        company_settings.lusha_kaspr_action
      )
    ) {
      const [_, companySettingsErr] =
        await CompanySettingsRepository.updateCompanySettingsByQuery(
          { company_id },
          company_settings
        );
      if (companySettingsErr)
        return serverErrorResponse(res, 'Failed to update company settings.');
    }

    return successResponse(res, 'Successfully updated api tokens and settings');
  } catch (err) {
    logger.error(`Error while updating tokens and settings: `, err);
    return serverErrorResponse(res);
  }
};

const ApiIntegrationsController = {
  getTokensAndSettings,
  updateTokensAndSettings,
};

module.exports = ApiIntegrationsController;
