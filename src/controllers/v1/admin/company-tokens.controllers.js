// Utils
const logger = require('../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
  notFoundResponse,
} = require('../../../utils/response');

// Repositories
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');
const CompanyTokensRepository = require('../../../../../Cadence-Brain/src/repository/company-tokens.repository');

// Helpers
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');

const getCompanyTokens = async (req, res) => {
  try {
    const [user, userErr] = await UserRepository.getUserWithCompanyTokens({
      user_id: req.user.user_id,
    });
    if (userErr) return serverErrorResponse(res);
    if (!user) return notFoundResponse(res, 'User not found.');

    return successResponse(
      res,
      'Successfully fetched user company tokens',
      user.Company
    );
  } catch (err) {
    logger.error(`Error while fetching company tokens: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const updateCompanyTokens = async (req, res) => {
  try {
    const { company_id } = req.params;
    const body = { ...req.body, company_id };

    if (body.lusha_api_key) {
      const [encryptedLushaApiKey, errForEncryptedLushaApiKey] =
        CryptoHelper.encrypt(body.lusha_api_key);
      body.encrypted_lusha_api_key = encryptedLushaApiKey;
      delete body.lusha_api_key;
    }

    if (body.kaspr_api_key) {
      const [encryptedKasprApiKey, errForEncryptedKasprApiKey] =
        CryptoHelper.encrypt(body.kaspr_api_key);
      body.encrypted_kaspr_api_key = encryptedKasprApiKey;
      delete body.kaspr_api_key;
    }

    const [updatedTokens, updatedTokensErr] =
      await CompanyTokensRepository.updateCompanyTokens({ company_id }, body);
    if (updatedTokensErr)
      return serverErrorResponse(res, 'Failed to update company tokens');

    return successResponse(res, 'Successfully updated company tokens');
  } catch (err) {
    logger.error(`Error while fetching company tokens: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const CompanyTokensController = { getCompanyTokens, updateCompanyTokens };

module.exports = CompanyTokensController;
