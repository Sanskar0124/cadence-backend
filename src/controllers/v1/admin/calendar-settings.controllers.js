// Utils
const logger = require('../../../utils/winston');
const {
  badRequestResponse,
  serverErrorResponse,
  successResponse,
} = require('../../../utils/response');

// Repositories
const CalendarSettingsRepository = require('../../../../../Cadence-Brain/src/repository/calendar-settings.repository');

const createCalendarSettings = async (req, res) => {
  try {
    const [data, err] = await CalendarSettingsRepository.createCalendarSettings(
      req.body
    );
    if (err) return serverErrorResponse(res);

    return successResponse(res, 'Fetched successfully.', data);
  } catch (err) {
    logger.error(`Error while creating calendar settings: `, err);
    return serverErrorResponse(res);
  }
};

const fetchCalendarSettings = async (req, res) => {
  try {
    const [data, err] = await CalendarSettingsRepository.getCalendarSettings({
      company_id: req.params.company_id,
    });
    if (err) {
      if (err === 'No calendar settings found for given query.')
        return badRequestResponse(res, err);
      return serverErrorResponse(res);
    }

    return successResponse(res, 'Fetched successfully.', data);
  } catch (err) {
    logger.error(`Error while fetching calendar settings: `, err);
    return serverErrorResponse(res);
  }
};

const changeCalendarSettings = async (req, res) => {
  try {
    const [data, err] = await CalendarSettingsRepository.updateCalendarSettings(
      null,
      req.body
    );
    if (err) return serverErrorResponse(res, err);

    return successResponse(res, data);
  } catch (err) {
    logger.error(`Error while changing calendar settings: `, err);
    return serverErrorResponse(res);
  }
};

const deleteCalendarSettings = async (req, res) => {
  try {
    const [data, err] = await CalendarSettingsRepository.deleteCalendarSettings(
      {
        cs_id: req.params.calendar_id,
      }
    );
    if (err) {
      if (err === 'No calendar settings found for given query.')
        return badRequestResponse(res, err);
      return serverErrorResponse(res);
    }

    return successResponse(res, 'Deleted successfully.', data);
  } catch (err) {
    logger.error(`Error while deleting calendar settings: `, err);
    return serverErrorResponse(res);
  }
};

const CalendarSettingsController = {
  createCalendarSettings,
  fetchCalendarSettings,
  changeCalendarSettings,
  deleteCalendarSettings,
};

module.exports = CalendarSettingsController;
