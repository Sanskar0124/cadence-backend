// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');

// Repostories
const CompanySettingsRepository = require('../../../../../Cadence-Brain/src/repository/company-settings.repository');

const getCompanySettings = async (req, res) => {
  try {
    const [data, err] =
      await CompanySettingsRepository.getCompanySettingsByQuery({
        company_id: req.params.company_id,
      });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Failed to fetch company settings by query: ${err}`,
      });

    return successResponse(res, 'Fetched company settings successfully.', data);
  } catch (err) {
    logger.error(`Error while fetching company settings: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching company settings: ${err.message}`,
    });
  }
};

const updateCompanySettings = async (req, res) => {
  try {
    let { company_id } = req.params;
    const [data, err] =
      await CompanySettingsRepository.updateCompanySettingsByQuery(
        { company_id },
        req.body
      );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company settings',
        error: `Error while updating company settings by query: ${err.message}`,
      });

    return successResponse(res, 'Updated company settings successfully.');
  } catch (err) {
    logger.error(`Error while updating company settings: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company settings: ${err.message}`,
    });
  }
};

const getCompanySettingsForUser = async (req, res) => {
  try {
    const [data, err] = await CompanySettingsRepository.getCompanySettingByUser(
      {
        user_id: req.user.user_id,
      }
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while fetching company setting by user: ${err}`,
      });

    return successResponse(
      res,
      'Fetched company settings for user successfully.',
      data
    );
  } catch (err) {
    logger.error(`Error while fetching company settings for user: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching company settings for user: ${err.message}`,
    });
  }
};

const CompanySettingsController = {
  getCompanySettings,
  updateCompanySettings,
  getCompanySettingsForUser,
};

module.exports = CompanySettingsController;
