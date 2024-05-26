// Utils
const logger = require('../../../utils/winston');
const {
  badRequestResponseWithDevMsg,
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');

// Repositories
const CalendarSettingsRepository = require('../../../../../Cadence-Brain/src/repository/calendar-settings.repository');

const fetchCalendarSettings = async (req, res) => {
  try {
    const [data, err] = await CalendarSettingsRepository.getCalendarSettings({
      user_id: req.user.user_id,
    });
    if (err) {
      if (err === 'No calendar settings found for given query.') {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to fetch calendar settings',
          error: `Error while fetching calendar settings: ${err}`,
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to find calendar settings',
        error: `Error while fetching calendar settings: ${err}`,
      });
    }
    return successResponse(res, 'Fetched successfully.', data);
  } catch (err) {
    logger.error(err.message);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching calendar settings: ${err.message}`,
    });
  }
};

const changeCalendarSettings = async (req, res) => {
  try {
    const [data, err] = await CalendarSettingsRepository.updateCalendarSettings(
      req.user.user_id,
      req.body
    );
    if (err) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update calendar settings',
        error: `Error while updating calendar settings: ${err}`,
      });
    }
    return successResponse(res, data);
  } catch (err) {
    logger.error(err.message);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating calendar settings: ${err.message}`,
    });
  }
};

const CalendarSettingsController = {
  fetchCalendarSettings,
  changeCalendarSettings,
};

module.exports = CalendarSettingsController;
