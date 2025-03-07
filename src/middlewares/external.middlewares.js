// Utils
const logger = require('../utils/winston');
const {
  unauthorizedResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../utils/response');
const { DB_TABLES } = require('../../../Cadence-Brain/src/utils/modelEnums');

// Repository
const Repository = require('../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../Cadence-Brain/src/helper/crypto');

module.exports.externalAuth = async (req, res, next) => {
  try {
    if (req.headers.authorization === undefined)
      return unauthorizedResponseWithDevMsg({ res });

    const token = req.headers.authorization.split(' ')[1];
    const [encryptedToken, errForEncrypt] = CryptoHelper.encrypt(token);
    if (errForEncrypt)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while encrypting token: ${errForEncrypt}`,
      });

    const [companyToken, errForCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY_TOKENS,
      query: { encrypted_api_token: encryptedToken },
      include: {
        [DB_TABLES.COMPANY]: { attributes: ['company_id', 'integration_type'] },
      },
    });
    if (errForCompany)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching company: ${errForCompany}`,
      });
    if (!companyToken) return unauthorizedResponseWithDevMsg({ res });

    req.integration_type = companyToken?.Company?.integration_type;
    req.company_id = companyToken.company_id;
    next();
    return;
  } catch (err) {
    logger.error('Error while checking external auth:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking external auth: ${err.message}`,
    });
  }
};
