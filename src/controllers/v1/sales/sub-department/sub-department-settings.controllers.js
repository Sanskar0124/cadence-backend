// Utils
const logger = require('../../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
  badRequestResponse,
} = require('../../../../utils/response');
const {
  USER_ROLE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Repositories
const SubDepartmentSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/sub-department-settings.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');

// Helpers and Services
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');

const createSubDepartmentSettings = async (req, res) => {
  try {
    const [subDepartmentSetting, errForSubDepartmentSetting] =
      await SubDepartmentSettingsRepository.createSubDepartmentSettings(
        req.body
      );

    if (errForSubDepartmentSetting)
      return serverErrorResponse(
        res,
        `Error occured while creating sub-department settings: ${errForSubDepartmentSetting}.`
      );

    return successResponse(
      res,
      `Created sub-department setting successfully.`,
      subDepartmentSetting
    );
  } catch (err) {
    logger.error(
      `Error while creating sub-department settings: ${err.message}.`
    );
    return serverErrorResponse(
      res,
      `Error while creating sub-department settings: ${err.message}.`
    );
  }
};

const getSubDepartmentSettingsForManager = async (req, res) => {
  try {
    const [manager, errForManager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    if (errForManager) return serverErrorResponse(res, errForManager);

    if (!manager) return badRequestResponse(res, `Manager not found.`);

    if (
      ![USER_ROLE.SALES_MANAGER, USER_ROLE.SALES_MANAGER_PERSON].includes(
        manager?.role
      )
    )
      return badRequestResponse(
        res,
        "You don't have permission to access this route."
      );

    const [subDepartmentsSettings, errForSubDepartment] =
      await SubDepartmentSettingsRepository.getSubDepartmentSettingByQuery({
        sd_id: manager.sd_id,
      });

    if (errForSubDepartment)
      return serverErrorResponse(
        res,
        `Error while fetching sub-department settings: ${errForSubDepartment}.`
      );

    if (!subDepartmentsSettings)
      return badRequestResponse(
        res,
        `No sub-dpartment settings found for manager.`
      );

    return successResponse(
      res,
      `Fetched sub-department settings successfully.`,
      subDepartmentsSettings
    );
  } catch (err) {
    logger.error(
      `Error while fetching sub-department settings: ${err.message}.`
    );
    return serverErrorResponse(
      res,
      `Error while fetching sub-department settings: ${err.message}.`
    );
  }
};

const getSubDepartmentSettings = async (req, res) => {
  try {
    const [subDepartmentsSettings, errForSubDepartment] =
      await SubDepartmentSettingsRepository.getSubDepartmentSettingByQuery({
        sd_id: req.params.sd_settings_id,
      });

    if (errForSubDepartment)
      return serverErrorResponse(
        res,
        `Error while fetching sub-department settings: ${errForSubDepartment}.`
      );

    if (!subDepartmentsSettings)
      return badRequestResponse(
        res,
        `No sub-dpartment settings found with given id ${req.params.sd_settings_id}.`
      );

    return successResponse(
      res,
      `Fetched sub-department settings successfully.`,
      subDepartmentsSettings
    );
  } catch (err) {
    logger.error(
      `Error while fetching sub-department settings: ${err.message}.`
    );
    return serverErrorResponse(
      res,
      `Error while fetching sub-department settings: ${err.message}.`
    );
  }
};

const updateSubDepartmentSettingsForManager = async (req, res) => {
  try {
    const [manager, errForManager] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });

    const [data, err] =
      await SubDepartmentSettingsRepository.updateSubDepartmentSettingsByQuery(
        {
          sd_id: manager.sd_id,
        },
        req.body
      );

    if (err)
      return serverErrorResponse(
        `Error while updating sub-department settings: ${err}.`
      );

    // if anything changes, recalculate for all sd users
    if (req.body.max_tasks || req.body.high_priority_split)
      TaskHelper.recalculateDailyTasksForSdUsers(manager.sd_id);

    return successResponse(
      res,
      `Updated sub-department settings successfully.`
    );
  } catch (err) {
    logger.error(
      `Error while updating sub-department settings: ${err.message}.`
    );
    return serverErrorResponse(
      res,
      `Error while updating sub-department settings: ${err.message}.`
    );
  }
};

const updateSubDepartmentSettings = async (req, res) => {
  try {
    const sd_id = req.body.sd_id;

    // * cannot update sd_id for sd-settings
    delete req.body.sd_id;

    const [data, err] =
      await SubDepartmentSettingsRepository.updateSubDepartmentSettingsByQuery(
        {
          sd_id: req.params.sd_settings_id,
        },
        req.body
      );

    if (err)
      return serverErrorResponse(
        `Error while updating sub-department settings: ${err}.`
      );

    // if anything changes, recalculate for all sd users
    if (req.body.max_tasks || req.body.high_priority_split)
      TaskHelper.recalculateDailyTasksForSdUsers(sd_id);

    return successResponse(
      res,
      `Updated sub-department settings successfully.`
    );
  } catch (err) {
    logger.error(
      `Error while updating sub-department settings: ${err.message}.`
    );
    return serverErrorResponse(
      res,
      `Error while updating sub-department settings: ${err.message}.`
    );
  }
};

const deleteSubDepartmentSettings = async (req, res) => {
  try {
    const [data, err] =
      await SubDepartmentSettingsRepository.deleteSubDepartmentSettingsByQuery({
        sd_id: req.params.sd_settings_id,
      });

    if (err)
      return serverErrorResponse(
        `Error while deleting sub-department settings: ${err}.`
      );

    if (data)
      return successResponse(
        res,
        `Deleted  sub-department setting successfully.`
      );
    else return successResponse(res, `No matching entry found.`);
  } catch (err) {
    logger.error(
      `Error while deleting sub-department settings: ${err.message}.`
    );
    return serverErrorResponse(
      res,
      `Error while deleting sub-department settings: ${err.message}.`
    );
  }
};

const SubDepartmentSettingsController = {
  createSubDepartmentSettings,
  getSubDepartmentSettings,
  updateSubDepartmentSettings,
  deleteSubDepartmentSettings,
  getSubDepartmentSettingsForManager,
  updateSubDepartmentSettingsForManager,
};

module.exports = SubDepartmentSettingsController;
